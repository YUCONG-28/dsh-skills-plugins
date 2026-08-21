import { spawn, type ChildProcess } from "child_process";

export interface SpawnHandle {
  child: ChildProcess;
  spec: { command: string; args: string[]; useShell: boolean };
}

export function spawnCommand(command: string, args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv }): SpawnHandle {
  const isWindows = process.platform === "win32";
  const isCmdShim = isWindows && /\.(cmd|bat)$/i.test(command);
  if (isCmdShim) {
    const child = spawn("cmd.exe", ["/d", "/s", "/c", `"${[command, ...args].map(quote).join(" ")}"`], {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { child, spec: { command, args, useShell: true } };
  }
  const child = spawn(command, args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { child, spec: { command, args, useShell: false } };
}

function quote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

export function killTree(handle: SpawnHandle): void {
  const { child } = handle;
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    } catch {
      child.kill();
    }
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
}
