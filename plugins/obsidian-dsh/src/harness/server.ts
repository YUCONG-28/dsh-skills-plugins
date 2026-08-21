// Owns the shared local dsh web process: probe-first reuse, single-flight
// spawn, crash backoff, and configurable shutdown on Obsidian exit. The plugin
// deliberately shares ONE server with the browser UI so sessions stay in sync.
import { DshApiClient } from "./client";
import { DEFAULT_DSH_URL, urlFor } from "../utils/port";
import { resolveDshExecutable, type DshDetection } from "../utils/dshExecutable";
import { killTree, spawnCommand, type SpawnHandle } from "../utils/spawn";

export type ServerState = "stopped" | "starting" | "running" | "error";

export interface InstanceSnapshot {
  state: ServerState;
  url: string | null;
  port: number | null;
  external: boolean;
  error: string | null;
}

export interface ServerSettings {
  dshExecutable: string;
  fixedPort: number;
  lifecycle: "leave-running" | "stop-on-exit";
  autoStart: boolean;
}

const PROBE_TIMEOUT_MS = 2500;
const STARTUP_TIMEOUT_MS = 120000;
const RESTART_BACKOFF_MS = [5000, 10000, 20000];

interface ManagedInstance {
  snapshot: InstanceSnapshot;
  handle: SpawnHandle | null;
  startupTimer: ReturnType<typeof setTimeout> | null;
  restartTimer: ReturnType<typeof setTimeout> | null;
  restartAttempts: number;
  stopping: boolean;
  generation: number;
}

export class DshServerManager {
  private instance: ManagedInstance | null = null;
  private listeners = new Set<() => void>();
  private startInFlight: Promise<string | null> | null = null;

  constructor(private readonly settings: () => ServerSettings) {}

  getSnapshot(): InstanceSnapshot {
    return (
      this.instance?.snapshot ?? {
        state: "stopped",
        url: null,
        port: null,
        external: false,
        error: null,
      }
    );
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private update(patch: Partial<InstanceSnapshot>): void {
    const instance = this.requireInstance();
    instance.snapshot = { ...instance.snapshot, ...patch };
    this.emit();
  }

  private requireInstance(): ManagedInstance {
    if (!this.instance) {
      this.instance = {
        snapshot: { state: "stopped", url: null, port: null, external: false, error: null },
        handle: null,
        startupTimer: null,
        restartTimer: null,
        restartAttempts: 0,
        stopping: false,
        generation: 0,
      };
    }
    return this.instance;
  }

  private async probe(url: string): Promise<boolean> {
    const client = new DshApiClient(url);
    try {
      const result = await Promise.race([
        client.hostDescribe(),
        new Promise<{ ok: false; error: string }>((resolve) =>
          setTimeout(() => resolve({ ok: false, error: "timeout" }), PROBE_TIMEOUT_MS),
        ),
      ]);
      return result.ok === true;
    } catch {
      return false;
    }
  }

  private candidateUrls(settings: ServerSettings): string[] {
    const urls: string[] = [];
    if (settings.fixedPort !== 3080) urls.push(urlFor(settings.fixedPort));
    urls.push(DEFAULT_DSH_URL);
    return [...new Set(urls)];
  }

  async ensure(workspacePath: string): Promise<string | null> {
    const instance = this.requireInstance();

    if (instance.snapshot.state === "starting") {
      const deadline = Date.now() + STARTUP_TIMEOUT_MS;
      while (instance.snapshot.state === "starting" && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      const settled = this.getSnapshot();
      if (settled.state === "running" && settled.url) return settled.url;
      if (settled.state === "starting") {
        this.update({ state: "error", error: "DSH 启动超时" });
        return null;
      }
    }

    if (instance.snapshot.state === "running" && instance.snapshot.url) {
      if (await this.probe(instance.snapshot.url)) return instance.snapshot.url;
      instance.stopping = false;
    }

    const settings = this.settings();
    for (const url of this.candidateUrls(settings)) {
      if (await this.probe(url)) {
        this.update({ state: "running", url, port: Number(new URL(url).port), external: true, error: null });
        return url;
      }
    }

    return this.start(workspacePath);
  }

  private async start(workspacePath: string): Promise<string | null> {
    if (this.startInFlight) return this.startInFlight;
    const instance = this.requireInstance();
    if (instance.snapshot.state === "starting") return this.ensure(workspacePath);

    const settings = this.settings();
    const detection = resolveDshExecutable(settings.dshExecutable);
    if (!detection) {
      this.update({ state: "error", error: "找不到 dsh 可执行文件，请在设置中指定路径" });
      return null;
    }

    instance.stopping = false;
    instance.generation += 1;
    const generation = instance.generation;
    this.update({ state: "starting", url: null, error: null });

    this.startInFlight = this.spawnAndWait(detection, settings, workspacePath, generation).finally(() => {
      this.startInFlight = null;
    });
    return this.startInFlight;
  }

  private async spawnAndWait(
    detection: DshDetection,
    settings: ServerSettings,
    workspacePath: string,
    generation: number,
  ): Promise<string | null> {
    const instance = this.requireInstance();
    const args = ["web", "--port", String(settings.fixedPort), "--no-open"];
    if (detection.args.length) args.unshift(...detection.args);

    let handle: SpawnHandle;
    try {
      handle = spawnCommand(detection.command, args, { cwd: workspacePath });
    } catch (error) {
      this.update({ state: "error", error: error instanceof Error ? error.message : String(error) });
      return null;
    }
    instance.handle = handle;
    handle.child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      console.log("[obsidian-dsh] dsh:", text.trimEnd());
    });
    handle.child.stderr?.on("data", (chunk: Buffer) => {
      console.error("[obsidian-dsh] dsh:", chunk.toString("utf8").trimEnd());
    });
    handle.child.on("exit", (code) => {
      if (instance.generation !== generation) return;
      instance.handle = null;
      if (!instance.stopping) this.scheduleRestart(workspacePath, code);
    });

    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    const url = urlFor(settings.fixedPort);
    while (Date.now() < deadline) {
      if (instance.generation !== generation) return null;
      if (instance.snapshot.state === "error") return null;
      if (await this.probe(url)) {
        this.update({ state: "running", url, port: settings.fixedPort, external: false, error: null });
        return url;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    this.update({ state: "error", error: "DSH 启动超时" });
    if (!instance.stopping) killTree(handle);
    return null;
  }

  private scheduleRestart(workspacePath: string, code: number | null): void {
    const instance = this.requireInstance();
    if (instance.restartAttempts >= RESTART_BACKOFF_MS.length) {
      this.update({ state: "error", error: `dsh 进程退出（code ${String(code)}），已放弃自动重启` });
      return;
    }
    const delay = RESTART_BACKOFF_MS[instance.restartAttempts] ?? 20000;
    instance.restartAttempts += 1;
    this.update({ state: "starting", error: null });
    instance.restartTimer = setTimeout(() => {
      void this.ensure(workspacePath);
    }, delay);
  }

  async restart(workspacePath: string): Promise<string | null> {
    const instance = this.requireInstance();
    instance.stopping = true;
    if (instance.handle) {
      killTree(instance.handle);
      instance.handle = null;
    }
    if (instance.restartTimer) {
      clearTimeout(instance.restartTimer);
      instance.restartTimer = null;
    }
    instance.restartAttempts = 0;
    this.update({ state: "stopped", url: null, error: null });
    return this.ensure(workspacePath);
  }

  dispose(): void {
    const instance = this.requireInstance();
    instance.stopping = true;
    if (instance.restartTimer) clearTimeout(instance.restartTimer);
    if (instance.handle && this.settings().lifecycle === "stop-on-exit") {
      killTree(instance.handle);
    }
    instance.handle = null;
  }
}
