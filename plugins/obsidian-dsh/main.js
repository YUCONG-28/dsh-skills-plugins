"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => ObsidianDshPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian7 = require("obsidian");

// src/harness/client.ts
var crypto2 = __toESM(require("crypto"));

// src/harness/transport.ts
var crypto = __toESM(require("crypto"));
var import_events = require("events");
var http = __toESM(require("http"));
var net = __toESM(require("net"));
function postJson(baseUrl, path2, body, timeoutMs = 15e3) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(baseUrl);
    } catch (error) {
      reject(error);
      return;
    }
    const payload = Buffer.from(JSON.stringify(body), "utf8");
    const request2 = http.request(
      {
        host: url.hostname,
        port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
        path: path2,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(payload.length)
        },
        timeout: timeoutMs
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on(
          "end",
          () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") })
        );
      }
    );
    request2.on("timeout", () => request2.destroy(new Error(`dsh api timeout after ${timeoutMs}ms`)));
    request2.on("error", reject);
    request2.write(payload);
    request2.end();
  });
}
var CRLFCRLF = Buffer.from("\r\n\r\n");
var MAX_HANDSHAKE_BYTES = 64 * 1024;
function findHttpResponseEnd(buffer) {
  const index = buffer.indexOf(CRLFCRLF);
  return index < 0 ? -1 : index + CRLFCRLF.length;
}
function unmask(payload, mask) {
  const out = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) out[i] = payload[i] ^ mask[i % 4];
  return out;
}
function parseWsFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const b0 = buffer[offset];
    const b1 = buffer[offset + 1];
    const fin = (b0 & 128) !== 0;
    const opcode = b0 & 15;
    const masked = (b1 & 128) !== 0;
    let length = b1 & 127;
    let pos = offset + 2;
    if (length === 126) {
      if (buffer.length - pos < 2) break;
      length = buffer.readUInt16BE(pos);
      pos += 2;
    } else if (length === 127) {
      if (buffer.length - pos < 8) break;
      length = Number(buffer.readBigUInt64BE(pos));
      pos += 8;
    }
    if (length > 64 * 1024 * 1024) throw new Error("dsh ws: frame too large");
    const maskLength = masked ? 4 : 0;
    if (buffer.length - pos < maskLength + length) break;
    let payload = buffer.subarray(pos + maskLength, pos + maskLength + length);
    if (masked) payload = unmask(payload, buffer.subarray(pos, pos + 4));
    frames.push({ fin, opcode, payload: Buffer.from(payload) });
    offset = pos + maskLength + length;
  }
  return { frames, rest: buffer.subarray(offset) };
}
function encodeClientFrame(opcode, payload) {
  if (payload.length > 125) throw new Error("dsh ws: client frame too large");
  const mask = crypto.randomBytes(4);
  const header = Buffer.from([128 | opcode, 128 | payload.length]);
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}
var MiniWebSocket = class extends import_events.EventEmitter {
  url;
  socket = null;
  buffer = Buffer.alloc(0);
  handshaken = false;
  handshakeBuffer = Buffer.alloc(0);
  closed = false;
  constructor(url) {
    super();
    this.url = url;
  }
  connect() {
    let parsed;
    try {
      parsed = new URL(this.url);
    } catch (error) {
      queueMicrotask(() => this.emit("error", error));
      return;
    }
    const host = parsed.hostname;
    const port = parsed.port ? Number(parsed.port) : parsed.protocol === "wss:" ? 443 : 80;
    const socket = net.connect(port, host);
    this.socket = socket;
    socket.setNoDelay(true);
    socket.on("connect", () => {
      const key = crypto.randomBytes(16).toString("base64");
      const path2 = `${parsed.pathname}${parsed.search}`;
      socket.write(
        `GET ${path2} HTTP/1.1\r
Host: ${host}:${port}\r
Upgrade: websocket\r
Connection: Upgrade\r
Sec-WebSocket-Key: ${key}\r
Sec-WebSocket-Version: 13\r
\r
`
      );
    });
    socket.on("data", (chunk) => {
      if (!this.handshaken) {
        this.handshakeBuffer = this.handshakeBuffer.length === 0 ? chunk : Buffer.concat([this.handshakeBuffer, chunk]);
        const end = findHttpResponseEnd(this.handshakeBuffer);
        if (end < 0) {
          if (this.handshakeBuffer.length > MAX_HANDSHAKE_BYTES) {
            this.fail(new Error("dsh ws: handshake response too large"));
          }
          return;
        }
        const head = this.handshakeBuffer.subarray(0, end - CRLFCRLF.length).toString("utf8");
        const leftover = this.handshakeBuffer.subarray(end);
        this.handshakeBuffer = Buffer.alloc(0);
        if (!/^HTTP\/1\.[01] 101\b/.test(head)) {
          this.fail(new Error(`dsh ws handshake rejected: ${head.split("\r\n")[0] ?? "unknown"}`));
          return;
        }
        this.handshaken = true;
        this.emit("open");
        if (leftover.length > 0) {
          this.buffer = leftover;
          this.drain();
        }
        return;
      }
      this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
      this.drain();
    });
    socket.on("close", () => this.fail(new Error("dsh ws: socket closed")));
    socket.on("error", (error) => this.fail(error));
  }
  drain() {
    if (this.closed) return;
    try {
      const { frames, rest } = parseWsFrames(this.buffer);
      this.buffer = rest;
      for (const frame of frames) this.handleFrame(frame);
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }
  handleFrame(frame) {
    if (frame.opcode === 9) {
      this.socket?.write(encodeClientFrame(10, frame.payload));
      return;
    }
    if (frame.opcode === 8) {
      this.close();
      return;
    }
    if (frame.opcode === 1) {
      this.emit("message", frame.payload.toString("utf8"));
    }
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.socket?.end();
    } catch {
    }
    this.socket = null;
    this.emit("close");
  }
  fail(error) {
    if (this.closed) return;
    this.closed = true;
    try {
      this.socket?.destroy();
    } catch {
    }
    this.socket = null;
    this.emit("error", error);
    this.emit("close");
  }
};
function wsUrlFor(baseUrl, path2) {
  return baseUrl.replace(/\/+$/, "").replace(/^http/, "ws") + path2;
}

// src/harness/types.ts
function extractMessageText(data) {
  if (!data || typeof data !== "object") return "";
  const record = data;
  const message = record.message ?? record;
  const content = message.content;
  if (!Array.isArray(content)) return "";
  return content.map((block) => {
    if (block && typeof block === "object" && block.type === "text") {
      const text = block.text;
      return typeof text === "string" ? text : "";
    }
    return "";
  }).join("");
}
function summarizeSession(raw) {
  const values = raw.projections?.values ?? {};
  const title = typeof values.title === "string" && values.title.length > 0 ? values.title : null;
  return { ...raw, title };
}

// src/harness/client.ts
var DshApiClient = class {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }
  async unary(method, payload, rpcId = crypto2.randomUUID()) {
    const message = { type: "client-request", rpcId, method, payload };
    let result;
    try {
      result = await postJson(this.baseUrl, `/api/${method}`, message);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    if (result.status < 200 || result.status >= 300) {
      return { ok: false, error: `HTTP ${result.status}` };
    }
    let full;
    try {
      full = JSON.parse(result.body);
    } catch {
      return { ok: false, error: "\u54CD\u5E94\u4E0D\u662F\u5408\u6CD5 JSON" };
    }
    if (full.type !== "server-response" || full.rpcId !== rpcId) {
      return { ok: false, error: "\u54CD\u5E94\u4FE1\u5C01\u4E0D\u5339\u914D" };
    }
    const envelope = full.result;
    if (!envelope || envelope.ok !== true) {
      const err = envelope && envelope.ok === false ? envelope.error : void 0;
      return { ok: false, error: err?.message ?? "\u670D\u52A1\u7AEF\u9519\u8BEF" };
    }
    return { ok: true, value: envelope.value };
  }
  async hostDescribe() {
    return this.unary("host.describe", {});
  }
  async hostPickDirectory() {
    const result = await this.unary("host.pickDirectory", {});
    if (!result.ok) return null;
    return result.value?.path ?? null;
  }
  async listSessions() {
    const result = await this.unary("session.list", {});
    if (!result.ok) return { sessions: [], error: result.error };
    if (!result.value?.items) return { sessions: [] };
    return { sessions: result.value.items.map(summarizeSession) };
  }
  async createSession(payload = {}) {
    const result = await this.unary("session.create", payload);
    if (!result.ok || !result.value?.sessionId) return null;
    return result.value.sessionId;
  }
  async history(sessionId, maxMessages = 100, beforeSeq) {
    const result = await this.unary(
      "session.history",
      { sessionId, maxMessages, ...beforeSeq !== void 0 ? { beforeSeq } : {} }
    );
    if (!result.ok) return { events: [], hasMore: false, error: result.error };
    return {
      events: result.value?.events ?? [],
      hasMore: result.value?.hasMore ?? false,
      projections: result.value?.projections?.values
    };
  }
  async prompt(sessionId, text, mode = "queue", rpcId) {
    const content = [{ type: "text", text }];
    return this.unary("session.prompt", { sessionId, mode, content }, rpcId);
  }
  async cancel(sessionId) {
    return this.unary("session.cancel", { sessionId });
  }
  async rename(sessionId, title) {
    return this.unary("session.rename", { sessionId, title });
  }
  async sessionModels(sessionId) {
    const result = await this.unary("session.models", { sessionId });
    if (!result.ok) return result;
    const value = result.value;
    return {
      ok: true,
      value: {
        current: value.current ?? { provider: "", model: "" },
        routable: value.routable !== false,
        groups: value.groups ?? [],
        failures: value.failures ?? []
      }
    };
  }
  async selectModel(sessionId, provider, model, reasoningEffort) {
    const result = await this.unary("session.selectModel", {
      sessionId,
      provider,
      model,
      ...reasoningEffort ? { reasoningEffort } : {}
    });
    return result.ok === true;
  }
  async listAgentPresets() {
    const result = await this.unary("agentPreset.list", {});
    if (!result.ok || !result.value?.presets) return [];
    return result.value.presets;
  }
  async selectAgentPreset(sessionId, agentPreset) {
    const result = await this.unary("agentPreset.select", { sessionId, agentPreset });
    return result.ok === true;
  }
  async listWorkspaces() {
    const result = await this.unary("workspace.list", {});
    if (!result.ok) return { items: [], archivedSessionIds: [], error: result.error };
    return { items: result.value?.items ?? [], archivedSessionIds: result.value?.archivedSessionIds ?? [] };
  }
  async createWorkspace(path2) {
    return this.unary("workspace.create", { path: path2 });
  }
  async archiveSession(sessionId) {
    return this.unary("workspace.archiveSession", { sessionId });
  }
  async settingsDescribe() {
    return this.unary("settings.describe", {});
  }
  async settingsMutate(ns, ops) {
    const result = await this.unary("settings.mutate", { ns, ops });
    return result.ok === true;
  }
  async respond(rpcId, value) {
    const message = { type: "client-response", rpcId, result: { ok: true, value } };
    let result;
    try {
      result = await postJson(this.baseUrl, "/api/respond", message, 15e3);
    } catch (error) {
      return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
    }
    if (result.status < 200 || result.status >= 300) return { accepted: false, reason: `HTTP ${result.status}` };
    try {
      const receipt = JSON.parse(result.body);
      return { accepted: receipt.accepted === true, reason: receipt.reason };
    } catch {
      return { accepted: false, reason: "bad-response" };
    }
  }
  newPromptRpcId() {
    return crypto2.randomUUID();
  }
};

// src/utils/port.ts
var DEFAULT_DSH_URL = "http://127.0.0.1:3080";
function urlFor(port) {
  return `http://127.0.0.1:${port}`;
}

// src/utils/dshExecutable.ts
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
function resolveDshExecutable(explicit) {
  if (explicit.trim()) {
    return { command: explicit.trim(), args: [], useShell: false };
  }
  const candidates = [];
  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    const programFiles = process.env.ProgramFiles;
    const programFilesX86 = process.env["ProgramFiles(x86)"];
    const nodeGlobal = appData ? path.join(appData, "npm", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js") : null;
    if (nodeGlobal) {
      candidates.push({ command: process.execPath, args: [nodeGlobal], useShell: false });
    }
    if (programFiles) candidates.push({ command: path.join(programFiles, "nodejs", "dsh.cmd"), args: [], useShell: true });
    if (programFilesX86) candidates.push({ command: path.join(programFilesX86, "nodejs", "dsh.cmd"), args: [], useShell: true });
  } else {
    const npmGlobal = process.env.npm_config_prefix ? path.join(process.env.npm_config_prefix, "lib", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js") : null;
    if (npmGlobal) candidates.push({ command: process.execPath, args: [npmGlobal], useShell: false });
    candidates.push({ command: "/usr/local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js", args: [], useShell: false });
    candidates.push({ command: "/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/lib/bin.js", args: [], useShell: false });
    candidates.push({ command: "dsh", args: [], useShell: false });
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate.command) || candidate.command === "dsh") {
      return candidate;
    }
  }
  return null;
}

// src/utils/spawn.ts
var import_child_process = require("child_process");
function spawnCommand(command, args, opts) {
  const isWindows = process.platform === "win32";
  const isCmdShim = isWindows && /\.(cmd|bat)$/i.test(command);
  if (isCmdShim) {
    const child2 = (0, import_child_process.spawn)("cmd.exe", ["/d", "/s", "/c", `"${[command, ...args].map(quote).join(" ")}"`], {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    return { child: child2, spec: { command, args, useShell: true } };
  }
  const child = (0, import_child_process.spawn)(command, args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  return { child, spec: { command, args, useShell: false } };
}
function quote(value) {
  return `"${value.replace(/"/g, '\\"')}"`;
}
function killTree(handle) {
  const { child } = handle;
  if (child.pid === void 0) return;
  if (process.platform === "win32") {
    try {
      (0, import_child_process.spawn)("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
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

// src/harness/server.ts
var PROBE_TIMEOUT_MS = 2500;
var STARTUP_TIMEOUT_MS = 12e4;
var RESTART_BACKOFF_MS = [5e3, 1e4, 2e4];
var DshServerManager = class {
  constructor(settings) {
    this.settings = settings;
  }
  instance = null;
  listeners = /* @__PURE__ */ new Set();
  startInFlight = null;
  getSnapshot() {
    return this.instance?.snapshot ?? {
      state: "stopped",
      url: null,
      port: null,
      external: false,
      error: null
    };
  }
  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  emit() {
    for (const listener of this.listeners) listener();
  }
  update(patch) {
    const instance = this.requireInstance();
    instance.snapshot = { ...instance.snapshot, ...patch };
    this.emit();
  }
  requireInstance() {
    if (!this.instance) {
      this.instance = {
        snapshot: { state: "stopped", url: null, port: null, external: false, error: null },
        handle: null,
        startupTimer: null,
        restartTimer: null,
        restartAttempts: 0,
        stopping: false,
        generation: 0
      };
    }
    return this.instance;
  }
  async probe(url) {
    const client = new DshApiClient(url);
    try {
      const result = await Promise.race([
        client.hostDescribe(),
        new Promise(
          (resolve) => setTimeout(() => resolve({ ok: false, error: "timeout" }), PROBE_TIMEOUT_MS)
        )
      ]);
      return result.ok === true;
    } catch {
      return false;
    }
  }
  candidateUrls(settings) {
    const urls = [];
    if (settings.fixedPort !== 3080) urls.push(urlFor(settings.fixedPort));
    urls.push(DEFAULT_DSH_URL);
    return [...new Set(urls)];
  }
  async ensure(workspacePath) {
    const instance = this.requireInstance();
    if (instance.snapshot.state === "starting") {
      const deadline = Date.now() + STARTUP_TIMEOUT_MS;
      while (instance.snapshot.state === "starting" && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      const settled = this.getSnapshot();
      if (settled.state === "running" && settled.url) return settled.url;
      if (settled.state === "starting") {
        this.update({ state: "error", error: "DSH \u542F\u52A8\u8D85\u65F6" });
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
  async start(workspacePath) {
    if (this.startInFlight) return this.startInFlight;
    const instance = this.requireInstance();
    if (instance.snapshot.state === "starting") return this.ensure(workspacePath);
    const settings = this.settings();
    const detection = resolveDshExecutable(settings.dshExecutable);
    if (!detection) {
      this.update({ state: "error", error: "\u627E\u4E0D\u5230 dsh \u53EF\u6267\u884C\u6587\u4EF6\uFF0C\u8BF7\u5728\u8BBE\u7F6E\u4E2D\u6307\u5B9A\u8DEF\u5F84" });
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
  async spawnAndWait(detection, settings, workspacePath, generation) {
    const instance = this.requireInstance();
    const args = ["web", "--port", String(settings.fixedPort), "--no-open"];
    if (detection.args.length) args.unshift(...detection.args);
    let handle;
    try {
      handle = spawnCommand(detection.command, args, { cwd: workspacePath });
    } catch (error) {
      this.update({ state: "error", error: error instanceof Error ? error.message : String(error) });
      return null;
    }
    instance.handle = handle;
    handle.child.stdout?.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      console.log("[obsidian-dsh] dsh:", text.trimEnd());
    });
    handle.child.stderr?.on("data", (chunk) => {
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
    this.update({ state: "error", error: "DSH \u542F\u52A8\u8D85\u65F6" });
    if (!instance.stopping) killTree(handle);
    return null;
  }
  scheduleRestart(workspacePath, code) {
    const instance = this.requireInstance();
    if (instance.restartAttempts >= RESTART_BACKOFF_MS.length) {
      this.update({ state: "error", error: `dsh \u8FDB\u7A0B\u9000\u51FA\uFF08code ${String(code)}\uFF09\uFF0C\u5DF2\u653E\u5F03\u81EA\u52A8\u91CD\u542F` });
      return;
    }
    const delay = RESTART_BACKOFF_MS[instance.restartAttempts] ?? 2e4;
    instance.restartAttempts += 1;
    this.update({ state: "starting", error: null });
    instance.restartTimer = setTimeout(() => {
      void this.ensure(workspacePath);
    }, delay);
  }
  async restart(workspacePath) {
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
  dispose() {
    const instance = this.requireInstance();
    instance.stopping = true;
    if (instance.restartTimer) clearTimeout(instance.restartTimer);
    if (instance.handle && this.settings().lifecycle === "stop-on-exit") {
      killTree(instance.handle);
    }
    instance.handle = null;
  }
};

// src/settings/settingsTab.ts
var import_obsidian = require("obsidian");

// src/approval/policy.ts
var PERMISSION_MODES = [
  {
    mode: "read-only",
    preset: "read-only",
    sandbox: "read-only",
    approval: "never",
    label: "Read Only",
    description: "\u5B8C\u5168\u53EA\u8BFB\uFF1A\u4EFB\u4F55\u5199\u5165\u90FD\u88AB\u786E\u5B9A\u6027\u62D2\u7EDD\uFF0C\u4E0D\u5F39\u7A97\u3002"
  },
  {
    mode: "ask-before-write",
    preset: "ask-before-write",
    sandbox: "read-only",
    approval: "ask",
    label: "Ask Before Write",
    description: "\u8BFB\u53D6\u81EA\u52A8\u653E\u884C\uFF1B\u4EFB\u4F55\u5199\u5165/\u5371\u9669\u64CD\u4F5C\u89E6\u53D1\u4E00\u6B21\u6027\u8BE2\u95EE\u3002"
  },
  {
    mode: "workspace-write",
    preset: "workspace-write",
    sandbox: "workspace-write",
    approval: "ask",
    label: "Workspace Write",
    description: "\u5DE5\u4F5C\u533A\u5185\u5199\u5165\u81EA\u52A8\u653E\u884C\uFF1B\u8D8A\u754C\u6216\u5371\u9669\u64CD\u4F5C\u4ECD\u8BE2\u95EE\u3002"
  },
  {
    mode: "danger-full-access",
    preset: "danger-full-access",
    sandbox: "danger-full-access",
    approval: "ask",
    label: "Full Access",
    description: "\u5168\u91CF\u80FD\u529B\uFF0C\u4F46\u5220\u9664/Shell/Push \u7B49\u5371\u9669\u64CD\u4F5C\u4ECD\u987B\u786E\u8BA4\u3002"
  }
];
function permissionSpec(mode) {
  return PERMISSION_MODES.find((p) => p.mode === mode) ?? PERMISSION_MODES[2];
}
var DANGEROUS_TOOLS = /* @__PURE__ */ new Set(["delete", "delete_file", "delete_file_or_dir", "trash", "shell", "bash", "terminal", "pwsh", "git"]);
var DANGEROUS_ARG_HINTS = ["push", "force", "hard reset", "clean -fd", "rm -rf", "drop database"];
function classifyTool(toolName, args) {
  const name = toolName.toLowerCase();
  const argText = (args ?? "").toLowerCase();
  const dangerousByHint = DANGEROUS_ARG_HINTS.some((hint) => argText.includes(hint));
  const isWrite = /(write|edit|create|move|rename|remove|delete|trash|append|patch|apply)/.test(name);
  if (DANGEROUS_TOOLS.has(name) || dangerousByHint) {
    return { level: "danger", label: "\u9700\u786E\u8BA4" };
  }
  if (isWrite) {
    return { level: "warning", label: "\u5199\u64CD\u4F5C" };
  }
  return { level: "normal", label: "\u5E38\u89C4" };
}

// src/agents/mode.ts
var AGENT_MODES = [
  { mode: "direct", label: "Direct", description: "\u76F4\u63A5\u4E0E\u5F53\u524D\u6A21\u578B\u5BF9\u8BDD" },
  { mode: "orchestrated", label: "Orchestrated", description: "Pro \u62C6\u4EFB\u52A1 \u2192 \u591A\u4E2A Flash \u5E76\u884C \u2192 Pro Review" }
];

// src/settings/settingsTab.ts
var ObsidianDshSettingTab = class extends import_obsidian.PluginSettingTab {
  plugin;
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian.Setting(containerEl).setName("DSH \u670D\u52A1").setHeading();
    new import_obsidian.Setting(containerEl).setName("DSH \u53EF\u6267\u884C\u6587\u4EF6").setDesc("\u7559\u7A7A\u81EA\u52A8\u63A2\u6D4B\uFF08PATH / npm \u5168\u5C40 / Node entrypoint\uFF09\u3002").addText(
      (text) => text.setPlaceholder("auto-detect").setValue(this.plugin.settings.dshExecutable).onChange(async (value) => {
        this.plugin.settings.dshExecutable = value.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("DSH web \u7AEF\u53E3").setDesc("\u9ED8\u8BA4 3080\uFF1B\u5DF2\u6709\u670D\u52A1\u4F1A\u76F4\u63A5\u590D\u7528\u3002").addText(
      (text) => text.setValue(String(this.plugin.settings.fixedPort)).onChange(async (value) => {
        const port = Number(value);
        if (Number.isInteger(port) && port > 0 && port < 65536) {
          this.plugin.settings.fixedPort = port;
          await this.plugin.saveSettings();
        }
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u9000\u51FA\u884C\u4E3A").addDropdown(
      (dropdown) => dropdown.addOption("leave-running", "\u4FDD\u7559\u8FD0\u884C").addOption("stop-on-exit", "\u968F Obsidian \u9000\u51FA").setValue(this.plugin.settings.lifecycle).onChange(async (value) => {
        this.plugin.settings.lifecycle = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u89C6\u56FE\u4F4D\u7F6E").addDropdown(
      (dropdown) => dropdown.addOption("right-sidebar", "\u53F3\u4FA7\u680F").addOption("left-sidebar", "\u5DE6\u4FA7\u680F").addOption("tab", "\u6807\u7B7E\u9875").addOption("window", "\u5F39\u51FA\u7A97\u53E3").setValue(this.plugin.settings.viewPlacement).onChange(async (value) => {
        this.plugin.settings.viewPlacement = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u81EA\u52A8\u542F\u52A8").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.autoStart).onChange(async (value) => {
        this.plugin.settings.autoStart = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Agent \u6A21\u5F0F").setHeading();
    new import_obsidian.Setting(containerEl).setName("\u6A21\u5F0F").addDropdown((dropdown) => {
      for (const mode of AGENT_MODES) dropdown.addOption(mode.mode, mode.label);
      dropdown.setValue(this.plugin.settings.agentMode).onChange(async (value) => {
        this.plugin.settings.agentMode = value;
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian.Setting(containerEl).setName("\u6743\u9650\u6A21\u5F0F\uFF08\u65B0\u4F1A\u8BDD\u9ED8\u8BA4\uFF09").addDropdown((dropdown) => {
      for (const spec of PERMISSION_MODES) dropdown.addOption(spec.mode, spec.label);
      dropdown.setValue(this.plugin.settings.permissionMode).onChange(async (value) => {
        this.plugin.settings.permissionMode = value;
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian.Setting(containerEl).setName("Pro / Flash \u7F16\u6392").setHeading();
    new import_obsidian.Setting(containerEl).setName("Pro provider / model").addText((text) => text.setValue(this.plugin.settings.proProvider).onChange(async (value) => {
      this.plugin.settings.proProvider = value.trim();
      await this.plugin.saveSettings();
    })).addText((text) => text.setValue(this.plugin.settings.proModel).onChange(async (value) => {
      this.plugin.settings.proModel = value.trim();
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("Flash provider / model").addText((text) => text.setValue(this.plugin.settings.flashProvider).onChange(async (value) => {
      this.plugin.settings.flashProvider = value.trim();
      await this.plugin.saveSettings();
    })).addText((text) => text.setValue(this.plugin.settings.flashModel).onChange(async (value) => {
      this.plugin.settings.flashModel = value.trim();
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("Orchestrated preset").setDesc("companion DSH bundle \u63D0\u4F9B\u7684 preset id\uFF1B\u4E0D\u5B58\u5728\u65F6\u56DE\u9000\u4E3A Direct + \u7F16\u6392\u6307\u4EE4\u3002").addText(
      (text) => text.setValue(this.plugin.settings.orchestratedPreset).onChange(async (value) => {
        this.plugin.settings.orchestratedPreset = value.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u4E0A\u4E0B\u6587").setHeading();
    new import_obsidian.Setting(containerEl).setName("\u7B14\u8BB0\u5185\u5BB9\u4E0A\u9650\uFF08\u5B57\u8282\uFF09").addText(
      (text) => text.setValue(String(this.plugin.settings.contextMaxNoteBytes)).onChange(async (value) => {
        const n = Number(value);
        if (Number.isInteger(n) && n > 0) {
          this.plugin.settings.contextMaxNoteBytes = n;
          await this.plugin.saveSettings();
        }
      })
    );
  }
};

// src/settings/types.ts
var DEFAULT_SETTINGS = {
  dshExecutable: "",
  fixedPort: 3080,
  lifecycle: "leave-running",
  viewPlacement: "right-sidebar",
  autoStart: true,
  openOnStartup: false,
  agentMode: "direct",
  permissionMode: "workspace-write",
  contextMaxNoteBytes: 2e4,
  mentionMaxChars: 8e3,
  historyPageSize: 50,
  proProvider: "deepseek-official",
  proModel: "deepseek-v4-pro",
  proEffort: "high",
  flashProvider: "deepseek-official",
  flashModel: "deepseek-v4-flash",
  flashEffort: void 0,
  orchestratedPreset: "dsh-obsidian-orchestrated"
};

// src/views/chatView.ts
var import_obsidian5 = require("obsidian");

// src/harness/events.ts
function backoffDelay(attempt, baseMs, maxMs) {
  const n = Math.max(attempt - 1, 0);
  return Math.min(maxMs, baseMs * 2 ** n);
}
var EventStream = class {
  constructor(baseUrl, path2, sink, baseMs = 500, maxMs = 3e4) {
    this.baseUrl = baseUrl;
    this.path = path2;
    this.sink = sink;
    this.baseMs = baseMs;
    this.maxMs = maxMs;
  }
  socket = null;
  stopped = true;
  attempt = 0;
  lastState = null;
  timer = null;
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempt = 0;
    this.lastState = null;
    this.connect();
  }
  stop() {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.socket?.close();
    this.socket = null;
    this.emitState("stopped");
  }
  connect() {
    this.emitState("reconnecting");
    const url = wsUrlFor(this.baseUrl, this.path);
    const socket = new MiniWebSocket(url);
    this.socket = socket;
    socket.on("open", () => {
      this.attempt = 0;
      this.emitState("connected");
    });
    socket.on("message", (text) => {
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (typeof msg?.rpcId !== "string" || !msg?.payload || typeof msg.payload !== "object") return;
      try {
        this.sink.onFrame(msg.rpcId, msg.payload);
      } catch (error) {
        console.error("[obsidian-dsh] frame handler error", error);
      }
    });
    socket.on("error", () => {
    });
    socket.on("close", () => this.scheduleReconnect());
  }
  scheduleReconnect() {
    if (this.stopped) return;
    this.emitState("reconnecting");
    this.attempt += 1;
    const delay = backoffDelay(this.attempt, this.baseMs, this.maxMs);
    this.timer = setTimeout(() => {
      if (!this.stopped) this.connect();
    }, delay);
  }
  emitState(state) {
    if (this.lastState !== state) {
      this.lastState = state;
      this.sink.onState(state);
    }
  }
};

// src/views/eventFold.ts
var EMPTY_FOLD = { items: [], streamingSeq: null };
function cloneItems(state) {
  return state.items.map((item) => item.kind === "assistant" ? { ...item, parts: [...item.parts] } : { ...item });
}
function pushPart(items, seq, part, text) {
  const last = items[items.length - 1];
  if (last?.kind === "assistant" && !last.done) {
    last.parts.push({ part, text });
    last.seq = seq;
    return;
  }
  items.push({ kind: "assistant", parts: [{ part, text }], done: false, seq });
}
function closeStreamingAssistant(items) {
  const last = items[items.length - 1];
  if (last?.kind === "assistant" && !last.done) {
    items[items.length - 1] = { ...last, done: true };
  }
}
function replaceAssistantText(items, seq, text) {
  const last = items[items.length - 1];
  if (last?.kind === "assistant" && !last.done) {
    last.parts = text ? [{ part: "text", text }] : [];
    last.done = true;
    last.seq = seq;
    return;
  }
  if (text) items.push({ kind: "assistant", parts: [{ part: "text", text }], done: true, seq });
}
function isAppendSurface(event) {
  return event.surfaceOp === "append";
}
function stringifyInput(input) {
  try {
    return JSON.stringify(input, null, 2) ?? "{}";
  } catch {
    return String(input);
  }
}
function foldEvent(state, event) {
  const items = cloneItems(state);
  let streamingSeq = state.streamingSeq;
  switch (event.type) {
    case "user/message": {
      if (!isAppendSurface(event)) break;
      const source = (event.data ?? {}).source;
      if (source?.kind !== "user") break;
      const text = extractMessageText(event.data).trim();
      if (text) items.push({ kind: "user", text, seq: event.seq });
      break;
    }
    case "assistant/chunk": {
      const data = event.data ?? {};
      const chunk = data.chunk ?? {};
      const delta = typeof chunk.text === "string" ? chunk.text : "";
      if (chunk.type === "reasoning-delta" && delta) {
        pushPart(items, event.seq, "reasoning", delta);
        streamingSeq = event.seq;
      } else if (chunk.type === "text-delta" && delta) {
        pushPart(items, event.seq, "text", delta);
        streamingSeq = event.seq;
      }
      break;
    }
    case "assistant/message": {
      if (!isAppendSurface(event)) break;
      replaceAssistantText(items, event.seq, extractMessageText(event.data).trim());
      streamingSeq = null;
      break;
    }
    case "tool/call": {
      const data = event.data ?? {};
      const name = data.toolName ?? data.name;
      if (typeof name !== "string") break;
      items.push({
        kind: "tool",
        name,
        args: stringifyInput(data.input ?? data.args ?? {}),
        result: null,
        done: false,
        seq: event.seq,
        callId: typeof data.callId === "string" ? data.callId : null
      });
      break;
    }
    case "tool/result": {
      if (!isAppendSurface(event)) break;
      const data = event.data ?? {};
      const resultText = typeof data.result === "string" ? data.result : stringifyInput(data.result ?? data);
      const callId = typeof data.callId === "string" ? data.callId : null;
      let matched = false;
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        if (item.kind !== "tool" || item.done) continue;
        if (callId !== null && item.callId !== null && item.callId !== callId) continue;
        items[i] = { ...item, result: resultText, done: true, seq: event.seq };
        matched = true;
        break;
      }
      if (!matched) {
        items.push({ kind: "tool", name: "tool", args: "", result: resultText, done: true, seq: event.seq, callId });
      }
      break;
    }
    case "turn/start": {
      streamingSeq = null;
      break;
    }
    case "turn/end": {
      closeStreamingAssistant(items);
      const data = event.data ?? {};
      const reason = data.reason ?? {};
      if (reason.kind === "error") {
        items.push({ kind: "notice", text: `\u26A0 ${typeof reason.message === "string" ? reason.message : "\u56DE\u5408\u51FA\u9519"}`, seq: event.seq });
      } else if (reason.kind === "notice" && typeof reason.message === "string") {
        items.push({ kind: "notice", text: reason.message, seq: event.seq });
      } else if (reason.kind === "aborted" || reason.kind === "interrupted") {
        items.push({ kind: "notice", text: "\u23F9 \u56DE\u7B54\u5DF2\u4E2D\u65AD", seq: event.seq });
      } else if (reason.kind === "blocked") {
        items.push({ kind: "notice", text: "\u26D4 \u56DE\u5408\u88AB\u963B\u6B62", seq: event.seq });
      } else if (reason.kind === "max-tokens") {
        items.push({ kind: "notice", text: "\u23F9 \u8F93\u51FA\u5DF2\u8FBE\u4E0A\u9650", seq: event.seq });
      }
      streamingSeq = null;
      break;
    }
    default:
      break;
  }
  return { items, streamingSeq };
}

// src/views/store.ts
function createSessionView(sessionId) {
  return {
    ...EMPTY_FOLD,
    sessionId,
    title: null,
    running: false,
    lastSeq: -1,
    firstSeq: -1,
    plan: { active: false, pending: false },
    permissions: { preset: null, sandbox: null, approval: null }
  };
}
var SessionStore = class {
  views = /* @__PURE__ */ new Map();
  projections = /* @__PURE__ */ new Map();
  listeners = /* @__PURE__ */ new Set();
  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  notify() {
    for (const listener of this.listeners) listener();
  }
  ensureView(sessionId) {
    let view = this.views.get(sessionId);
    if (!view) {
      view = createSessionView(sessionId);
      this.views.set(sessionId, view);
    }
    return view;
  }
  getView(sessionId) {
    return this.views.get(sessionId);
  }
  dropView(sessionId) {
    this.views.delete(sessionId);
    this.projections.delete(sessionId);
  }
  applyProjection(sessionId, key, value, seq) {
    const cells = this.projections.get(sessionId) ?? /* @__PURE__ */ new Map();
    const prev = cells.get(key);
    if (prev && prev.seq >= seq) return false;
    cells.set(key, { value, seq });
    this.projections.set(sessionId, cells);
    const view = this.ensureView(sessionId);
    if (key === "title") {
      if (typeof value === "string" && value.length > 0) {
        view.title = value;
        return true;
      }
      return false;
    }
    if (key === "plan") {
      if (value && typeof value === "object") {
        const plan = value;
        view.plan = { active: plan.active === true, pending: plan.pending === true };
        return true;
      }
      return false;
    }
    if (key === "permissions") {
      if (value && typeof value === "object") {
        const perm = value;
        view.permissions = {
          preset: typeof perm.preset === "string" ? perm.preset : null,
          sandbox: typeof perm.sandbox === "string" ? perm.sandbox : null,
          approval: typeof perm.approval === "string" ? perm.approval : null
        };
        return true;
      }
      return false;
    }
    return false;
  }
  applyMux(rpcId, frame) {
    switch (frame.type) {
      case "session/event": {
        if (!frame.sessionId || !frame.event) return;
        const view = this.views.get(frame.sessionId);
        if (!view) return;
        this.foldInto(view, frame.event);
        this.notify();
        break;
      }
      case "session/subscribed": {
        if (!frame.sessionId) return;
        const view = this.views.get(frame.sessionId);
        if (!view) return;
        let changed = false;
        if (typeof frame.lastSeq === "number" && frame.lastSeq > view.lastSeq) {
          view.lastSeq = frame.lastSeq;
          changed = true;
        }
        if (view.running) {
          view.running = false;
          changed = true;
        }
        if (changed) this.notify();
        break;
      }
      case "session/projection": {
        if (!frame.sessionId) return;
        if (this.applyProjection(frame.sessionId, String(frame.key ?? ""), frame.value, Number(frame.seq ?? -1))) {
          this.notify();
        }
        break;
      }
      default:
        break;
    }
  }
  foldInto(view, event) {
    const folded = foldEvent(view, event);
    view.items = folded.items;
    view.streamingSeq = folded.streamingSeq;
    if (event.seq > view.lastSeq) view.lastSeq = event.seq;
    if (view.firstSeq < 0 || event.seq < view.firstSeq) view.firstSeq = event.seq;
  }
  seedHistory(sessionId, entries) {
    const view = this.ensureView(sessionId);
    for (const entry of entries) this.foldInto(view, entry.event);
    this.notify();
  }
  prependHistory(sessionId, entries) {
    const current = this.views.get(sessionId);
    const rebuilt = createSessionView(sessionId);
    for (const entry of entries) {
      const folded = foldEvent(rebuilt, entry.event);
      rebuilt.items = folded.items;
      rebuilt.streamingSeq = folded.streamingSeq;
      if (entry.event.seq > rebuilt.lastSeq) rebuilt.lastSeq = entry.event.seq;
      if (rebuilt.firstSeq < 0 || entry.event.seq < rebuilt.firstSeq) rebuilt.firstSeq = entry.event.seq;
    }
    if (current) {
      rebuilt.items = [...rebuilt.items, ...current.items];
      if (current.lastSeq > rebuilt.lastSeq) rebuilt.lastSeq = current.lastSeq;
      if (current.running) rebuilt.running = true;
      rebuilt.title = current.title ?? rebuilt.title;
      rebuilt.plan = current.plan.active || current.plan.pending ? current.plan : rebuilt.plan;
      rebuilt.permissions = current.permissions;
    }
    this.views.set(sessionId, rebuilt);
    this.notify();
  }
  setRunning(sessionId, running) {
    const view = this.views.get(sessionId);
    if (!view || view.running === running) return;
    view.running = running;
    this.notify();
  }
};

// src/views/renderer.ts
var import_obsidian2 = require("obsidian");

// src/obsidian/links.ts
function splitFenced(markdown) {
  const segments = [];
  const fence = /^```[^\n]*$/gm;
  let last = 0;
  let inCode = false;
  let match;
  while ((match = fence.exec(markdown)) !== null) {
    segments.push({ code: inCode, text: markdown.slice(last, match.index) });
    segments.push({ code: inCode, text: match[0] });
    inCode = !inCode;
    last = match.index + match[0].length;
  }
  segments.push({ code: inCode, text: markdown.slice(last) });
  return segments;
}
var TRAILING_PUNCTUATION = /[.,;:!?)\]}"'\u3002\uff0c\uff1b\uff1a\uff01\uff1f\u3001\uff09\u300d\u300f\uff09]+$/u;
var VAULT_PATH_RE = /(?<!\[\[)(?<!\(\()([^\s"'\[\]()<>（）「」『』《》【】、，。；：！？]+?\.[A-Za-z0-9]{1,10}(?:#[\w-]+)?)/g;
function normalizeVaultPath(raw) {
  let value = raw.trim();
  while (value.startsWith("./")) value = value.slice(2);
  return value.replace(/\\/g, "/");
}
function vaultRelativePath(raw, vaultBase) {
  const normalized = normalizeVaultPath(raw);
  if (/^[A-Za-z]:\//.test(normalized)) {
    if (!vaultBase) return null;
    const base = normalizeVaultPath(vaultBase).replace(/\/$/, "").toLowerCase();
    if (!normalized.toLowerCase().startsWith(base + "/")) return null;
    return normalized.slice(base.length + 1);
  }
  if (normalized.startsWith("../") || normalized.startsWith("/")) return null;
  return normalized;
}
function splitAnchor(raw) {
  const match = /^([^#]+)(?:#([\w-]+))?$/.exec(raw);
  if (!match) return { path: raw, anchor: null };
  return { path: match[1], anchor: match[2] ?? null };
}
function linkifyText(text, exists, vaultBase = null) {
  return text.replace(VAULT_PATH_RE, (match) => {
    const trimmed = match.replace(TRAILING_PUNCTUATION, "");
    if (!trimmed) return match;
    const { path: rawPath, anchor } = splitAnchor(trimmed);
    const path2 = vaultRelativePath(rawPath, vaultBase);
    if (!path2 || !exists(path2)) return match;
    const isMarkdown = /\.md$/i.test(path2);
    if (isMarkdown) return anchor ? `[[${path2}#${anchor}]]` : `[[${path2}]]`;
    return `[${path2}](obsidian-dsh-file://${encodeURIComponent(path2)})`;
  });
}
function linkifyVaultPaths(markdown, exists, vaultBase = null) {
  return splitFenced(markdown).map((segment) => segment.code ? segment.text : linkifyText(segment.text, exists, vaultBase)).join("");
}

// src/views/renderer.ts
function markdownForRender(text, exists, vaultBase) {
  return linkifyVaultPaths(text, exists, vaultBase);
}
async function renderMarkdown(app, container, markdown, sourcePath, component) {
  await import_obsidian2.MarkdownRenderer.render(app, markdown, container, sourcePath, component);
}
function createToolCard(container, opts) {
  const details = container.createEl("details", { cls: "odsh-tool" });
  const summary = details.createEl("summary", { cls: "odsh-tool-summary" });
  summary.createSpan({ cls: "odsh-tool-status", text: opts.done ? "\u2713" : "\u2026" });
  summary.createSpan({ cls: "odsh-tool-name", text: opts.name });
  summary.createSpan({ cls: "odsh-tool-risk odsh-tool-risk-" + opts.risk.level, text: opts.risk.label });
  if (opts.args) {
    const pre = details.createEl("pre", { cls: "odsh-tool-args" });
    pre.setText(opts.args);
  }
  if (opts.result !== null) {
    const pre = details.createEl("pre", { cls: "odsh-tool-result" });
    pre.setText(opts.result);
  }
  return details;
}
function createNotice(container, text) {
  return container.createEl("div", { cls: "odsh-notice", text });
}

// src/approval/center.ts
var ApprovalCenter = class {
  constructor(client) {
    this.client = client;
  }
  approvals = /* @__PURE__ */ new Map();
  questions = /* @__PURE__ */ new Map();
  listeners = /* @__PURE__ */ new Set();
  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  notify() {
    for (const listener of this.listeners) listener();
  }
  get pendingApprovals() {
    return [...this.approvals.values()];
  }
  get pendingQuestions() {
    return [...this.questions.values()];
  }
  ingest(rpcId, frame) {
    switch (frame.type) {
      case "approval/requested": {
        if (!frame.sessionId || typeof frame.approvalId !== "string") return;
        this.approvals.set(`${frame.sessionId}/${frame.approvalId}`, {
          rpcId,
          sessionId: frame.sessionId,
          approvalId: frame.approvalId,
          toolName: typeof frame.toolName === "string" ? frame.toolName : "tool",
          callId: typeof frame.callId === "string" ? frame.callId : void 0,
          reason: typeof frame.reason === "string" ? frame.reason : void 0
        });
        this.notify();
        break;
      }
      case "approval/resolved": {
        if (!frame.sessionId || typeof frame.approvalId !== "string") return;
        if (this.approvals.delete(`${frame.sessionId}/${frame.approvalId}`)) this.notify();
        break;
      }
      case "question/requested": {
        if (!frame.sessionId) return;
        this.questions.set(rpcId, { rpcId, sessionId: frame.sessionId, questions: frame.questions ?? [] });
        this.notify();
        break;
      }
      case "question/resolved": {
        if (typeof frame.questionRpcId === "string" && this.questions.delete(frame.questionRpcId)) this.notify();
        break;
      }
      default:
        break;
    }
  }
  async decideApproval(p, outcome) {
    const receipt = await this.client.respond(p.rpcId, { sessionId: p.sessionId, approvalId: p.approvalId, outcome });
    if (receipt.accepted) this.approvals.delete(`${p.sessionId}/${p.approvalId}`);
    this.notify();
    return receipt.accepted;
  }
  async answerQuestion(p, answers) {
    const receipt = await this.client.respond(p.rpcId, { sessionId: p.sessionId, answer: { answers } });
    if (receipt.accepted) this.questions.delete(p.rpcId);
    this.notify();
    return receipt.accepted;
  }
};

// src/approval/modal.ts
var import_obsidian3 = require("obsidian");
var QuestionModal = class extends import_obsidian3.Modal {
  constructor(app, center, pending) {
    super(app);
    this.center = center;
    this.pending = pending;
  }
  onOpen() {
    this.titleEl.setText("\u9700\u8981\u56DE\u7B54");
    for (const question of this.pending.questions) {
      this.renderQuestion(question);
    }
    new import_obsidian3.Setting(this.contentEl).addButton(
      (button) => button.setButtonText("\u63D0\u4EA4").setCta().onClick(() => this.submit())
    );
  }
  renderQuestion(question) {
    if (question.header) this.contentEl.createEl("h4", { text: question.header });
    this.contentEl.createEl("div", { text: question.question, cls: "odsh-question-text" });
    if (question.options && question.options.length > 0) {
      const select = this.contentEl.createEl("select", { cls: "dropdown" });
      for (const option of question.options) select.createEl("option", { text: option.label, value: option.label });
      select.dataset.questionId = question.id;
    } else {
      const input = this.contentEl.createEl("input", { type: "text" });
      input.placeholder = "\u56DE\u7B54";
      input.dataset.questionId = question.id;
    }
  }
  submit() {
    const answers = this.pending.questions.map((question) => {
      const el = this.contentEl.querySelector(`[data-question-id="${question.id}"]`);
      const value = el ? el.value : "";
      return { id: question.id, selected: value ? [value] : [] };
    });
    this.close();
    void this.center.answerQuestion(this.pending, answers);
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/agents/orchestrator.ts
var ORCHESTRATION_SYSTEM_HINT = [
  "You are the DeepSeek Pro orchestrator.",
  "1. Break the request into small independent tasks.",
  "2. Dispatch each task in parallel to DeepSeek Flash subagents using the official subagent/workflow tools.",
  "3. Review every result, fix or re-dispatch failures.",
  "4. Integrate the results into one final answer (and apply changes only when the user asked for them)."
].join("\n");
function buildOrchestratedPrompt(goal) {
  const trimmed = goal.trim();
  return `\u4EFB\u52A1\uFF1A${trimmed}

${ORCHESTRATION_SYSTEM_HINT}`;
}
function buildDirectPrompt(goal) {
  return goal;
}

// src/obsidian/context.ts
var import_obsidian4 = require("obsidian");

// src/obsidian/contextPure.ts
function budgetText(text, maxBytes) {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return { text, truncated: false };
  let end = 0;
  while (end < text.length && Buffer.byteLength(text.slice(0, end + 1), "utf8") <= maxBytes) end += 1;
  return { text: text.slice(0, end), truncated: true };
}
function formatContextBlock(path2, content, maxBytes) {
  const { text, truncated } = budgetText(content, maxBytes);
  const head = "## \u6587\u4EF6: " + path2;
  if (truncated) {
    return head + "\n\n" + text + "\n\n\uFF08\u5185\u5BB9\u8D85\u8FC7 " + maxBytes + " \u5B57\u8282\u5DF2\u622A\u65AD\uFF0C\u8BF7\u6309\u9700\u8BFB\u53D6\u8BE5\u6587\u4EF6\uFF09";
  }
  return head + "\n\n" + text;
}
function composePrompt(basePrompt, ctx, maxNoteBytes = 2e4) {
  const parts = [];
  const fence = String.fromCharCode(96) + String.fromCharCode(96) + String.fromCharCode(96);
  if (ctx.notePath) parts.push("\u5F53\u524D\u7B14\u8BB0: " + ctx.notePath);
  for (const file of ctx.files) parts.push(formatContextBlock(file.path, file.content, maxNoteBytes));
  if (ctx.selection) {
    parts.push("\u9009\u4E2D\u6587\u672C\uFF08\u6765\u81EA " + (ctx.notePath ?? "\u5F53\u524D\u7B14\u8BB0") + "\uFF09:\n" + fence + "\n" + budgetText(ctx.selection, maxNoteBytes).text + "\n" + fence);
  }
  if (parts.length === 0) return basePrompt;
  return parts.join("\n\n") + "\n\n" + basePrompt;
}

// src/obsidian/context.ts
function getActiveNoteContext(app) {
  const file = app.workspace.getActiveFile();
  return { path: file?.path ?? null, title: file?.basename ?? null };
}
function getActiveSelection(app) {
  const view = app.workspace.getActiveViewOfType(import_obsidian4.MarkdownView);
  if (!view) return null;
  const selection = view.editor.getSelection();
  return selection && selection.trim().length > 0 ? selection : null;
}

// src/views/chatView.ts
var VIEW_TYPE_DSH = "obsidian-dsh-view";
var RENDER_BATCH_MS = 60;
var ObsidianDshView = class extends import_obsidian5.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  hostEl = null;
  headerSelect = null;
  modeSelect = null;
  modelSelect = null;
  effortSelect = null;
  permissionSelect = null;
  statusDot = null;
  statusLabel = null;
  messagesEl = null;
  approvalsEl = null;
  composerEl = null;
  chipsEl = null;
  api = null;
  apiUrl = null;
  mux = null;
  hostStream = null;
  store = new SessionStore();
  center = null;
  sessions = [];
  sessionId = null;
  workspacePath = null;
  modelCatalog = null;
  renderTimer = null;
  unsubscribeServer = null;
  unsubscribeStore = null;
  unsubscribeCenter = null;
  noteContext = null;
  attachedFiles = [];
  getViewType() {
    return VIEW_TYPE_DSH;
  }
  getDisplayText() {
    return "DeepSeek Harness";
  }
  getIcon() {
    return "bot";
  }
  async onOpen() {
    this.hostEl = this.contentEl.createDiv({ cls: "odsh-host" });
    this.buildHeader();
    this.buildToolbar();
    this.messagesEl = this.hostEl.createDiv({ cls: "odsh-messages" });
    this.approvalsEl = this.hostEl.createDiv({ cls: "odsh-approvals" });
    this.buildComposer();
    this.unsubscribeServer = this.plugin.server.onChange(() => this.renderStatus());
    this.unsubscribeStore = this.store.onChange(() => this.scheduleRender());
    this.renderStatus();
    void this.ensureLoaded();
  }
  async onClose() {
    this.unsubscribeServer?.();
    this.unsubscribeStore?.();
    this.unsubscribeCenter?.();
    if (this.renderTimer) clearTimeout(this.renderTimer);
    this.mux?.stop();
    this.hostStream?.stop();
  }
  vaultPath() {
    return this.plugin.getVaultPath();
  }
  async ensureLoaded() {
    const url = await this.plugin.server.ensure(this.workspacePath ?? this.vaultPath());
    if (!url) {
      this.renderStatus();
      return null;
    }
    if (url !== this.apiUrl) {
      this.disconnectStreams();
      this.apiUrl = url;
      this.api = new DshApiClient(url);
      this.center = new ApprovalCenter(this.api);
      this.unsubscribeCenter?.();
      this.unsubscribeCenter = this.center.onChange(() => this.scheduleRender());
      this.connectStreams();
      await this.reloadSessions();
      void this.reloadToolbar();
    }
    this.renderStatus();
    return url;
  }
  disconnectStreams() {
    this.mux?.stop();
    this.hostStream?.stop();
    this.mux = null;
    this.hostStream = null;
  }
  connectStreams() {
    if (!this.apiUrl) return;
    this.mux = new EventStream(this.apiUrl, "/api/events.mux", {
      onFrame: (rpcId, payload) => this.handleMux(rpcId, payload),
      onState: (state) => {
        if (state === "connected") void this.resyncAfterReconnect();
      }
    });
    this.hostStream = new EventStream(this.apiUrl, "/api/events.host", {
      onFrame: (_rpcId, payload) => this.handleHost(payload),
      onState: () => {
      }
    });
    this.mux.start();
    this.hostStream.start();
  }
  handleMux(rpcId, payload) {
    if (payload.type === "approval/requested" || payload.type === "approval/resolved" || payload.type === "question/requested" || payload.type === "question/resolved") {
      this.center?.ingest(rpcId, payload);
      return;
    }
    this.store.applyMux(rpcId, payload);
    if (payload.type === "session/event" && payload.sessionId === this.sessionId) this.scheduleRender();
  }
  handleHost(payload) {
    if (payload.type === "host/session-status" && payload.sessionId) {
      this.store.setRunning(payload.sessionId, payload.running === true);
    }
    if (payload.type === "host/session-added" || payload.type === "host/session-removed") {
      void this.reloadSessions();
    }
  }
  async resyncAfterReconnect() {
    if (!this.sessionId || !this.api) return;
    const result = await this.api.history(this.sessionId, this.plugin.settings.historyPageSize);
    if (!result.error && result.events.length) {
      this.store.dropView(this.sessionId);
      this.store.seedHistory(this.sessionId, result.events);
      this.scheduleRender();
    }
  }
  buildHeader() {
    if (!this.hostEl) return;
    const bar = this.hostEl.createDiv({ cls: "odsh-header" });
    this.statusDot = bar.createSpan({ cls: "odsh-dot" });
    this.statusLabel = bar.createSpan({ cls: "odsh-status", text: "\u672A\u8FD0\u884C" });
    this.headerSelect = bar.createEl("select", { cls: "dropdown odsh-session-select" });
    this.headerSelect.addEventListener("change", () => void this.selectSession(this.headerSelect?.value ?? null));
    const newBtn = bar.createEl("button", { cls: "odsh-iconbtn", text: "\uFF0B" });
    newBtn.setAttribute("aria-label", "\u65B0\u4F1A\u8BDD");
    newBtn.addEventListener("click", () => void this.newSession());
    const archiveBtn = bar.createEl("button", { cls: "odsh-iconbtn", text: "\u{1F5C4}" });
    archiveBtn.setAttribute("aria-label", "\u5F52\u6863\u5F53\u524D\u4F1A\u8BDD");
    archiveBtn.addEventListener("click", () => void this.archiveCurrent());
  }
  buildToolbar() {
    if (!this.hostEl) return;
    const toolbar = this.hostEl.createDiv({ cls: "odsh-toolbar" });
    this.modeSelect = toolbar.createEl("select", { cls: "dropdown odsh-toolbar-select" });
    for (const mode of AGENT_MODES) this.modeSelect.createEl("option", { text: mode.label, value: mode.mode });
    this.modeSelect.value = this.plugin.settings.agentMode;
    this.modeSelect.addEventListener("change", () => {
      this.plugin.settings.agentMode = this.modeSelect?.value;
      void this.plugin.saveSettings();
    });
    this.modelSelect = toolbar.createEl("select", { cls: "dropdown odsh-toolbar-select" });
    this.modelSelect.addEventListener("change", () => void this.applyModelSelection());
    this.effortSelect = toolbar.createEl("select", { cls: "dropdown odsh-toolbar-select" });
    this.effortSelect.addEventListener("change", () => void this.applyModelSelection());
    this.permissionSelect = toolbar.createEl("select", { cls: "dropdown odsh-toolbar-select" });
    for (const spec of PERMISSION_MODES) this.permissionSelect.createEl("option", { text: spec.label, value: spec.mode });
    this.permissionSelect.value = this.plugin.settings.permissionMode;
    this.permissionSelect.addEventListener("change", () => void this.applyPermission());
  }
  buildComposer() {
    if (!this.hostEl) return;
    this.chipsEl = this.hostEl.createDiv({ cls: "odsh-chips" });
    const row = this.hostEl.createDiv({ cls: "odsh-composer" });
    this.composerEl = row.createEl("textarea", { cls: "odsh-textarea" });
    this.composerEl.placeholder = "\u8F93\u5165\u6307\u4EE4\uFF0CEnter \u53D1\u9001\uFF0CShift+Enter \u6362\u884C";
    this.composerEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void this.sendPrompt();
      }
    });
    const send = row.createEl("button", { cls: "odsh-send", text: "\u53D1\u9001" });
    send.addEventListener("click", () => void this.sendPrompt());
  }
  async reloadSessions() {
    if (!this.api) return;
    const result = await this.api.listSessions();
    if (result.error) {
      this.renderStatus();
      return;
    }
    const base = (this.workspacePath ?? this.vaultPath()).replace(/[\\/]+$/, "").toLowerCase();
    this.sessions = result.sessions.filter((s) => !s.origin || s.origin !== "subagent").filter((s) => !s.cwd || s.cwd.toLowerCase() === base || s.cwd.toLowerCase().startsWith(base + "/") || s.cwd.toLowerCase().startsWith(base + "\\")).map((s) => ({ sessionId: s.sessionId, title: s.title, cwd: s.cwd }));
    this.renderSessions();
    if (!this.sessionId && this.sessions.length) void this.selectSession(this.sessions[0].sessionId);
  }
  renderSessions() {
    if (!this.headerSelect) return;
    this.headerSelect.empty();
    this.headerSelect.createEl("option", { text: "\u9009\u62E9\u4F1A\u8BDD\u2026", value: "" });
    for (const session of this.sessions) {
      this.headerSelect.createEl("option", { text: session.title ?? session.sessionId.slice(0, 8), value: session.sessionId });
    }
    if (this.sessionId) this.headerSelect.value = this.sessionId;
  }
  async selectSession(sessionId) {
    if (!this.api || !sessionId) return;
    this.sessionId = sessionId;
    this.renderSessions();
    const result = await this.api.history(sessionId, this.plugin.settings.historyPageSize);
    this.store.dropView(sessionId);
    this.store.seedHistory(sessionId, result.events);
    if (result.projections) {
      for (const [key, value] of Object.entries(result.projections)) this.store.applyProjection(sessionId, key, value, Number.MAX_SAFE_INTEGER);
    }
    void this.refreshModelCatalog();
    this.scheduleRender();
  }
  async newSession() {
    if (!this.api) {
      await this.ensureLoaded();
      if (!this.api) return;
    }
    const cwd = this.workspacePath ?? this.vaultPath();
    const preset = this.plugin.settings.agentMode === "orchestrated" ? this.plugin.settings.orchestratedPreset : void 0;
    const sessionId = await this.api.createSession({ cwd, agentPreset: preset });
    if (!sessionId) {
      new import_obsidian5.Notice("obsidian-dsh\uFF1A\u521B\u5EFA\u4F1A\u8BDD\u5931\u8D25");
      return;
    }
    await this.reloadSessions();
    await this.selectSession(sessionId);
  }
  async archiveCurrent() {
    if (!this.api || !this.sessionId) return;
    await this.api.archiveSession(this.sessionId);
    this.sessionId = null;
    await this.reloadSessions();
  }
  async reloadToolbar() {
    if (!this.api) return;
    void this.refreshModelCatalog();
  }
  async refreshModelCatalog() {
    if (!this.api || !this.sessionId) return;
    const result = await this.api.sessionModels(this.sessionId);
    if (!result.ok) return;
    this.modelCatalog = result.value ? result.value : null;
    this.renderModelCatalog();
  }
  renderModelCatalog() {
    if (!this.modelSelect || !this.effortSelect || !this.modelCatalog) return;
    this.modelSelect.empty();
    for (const group of this.modelCatalog.groups) {
      for (const model of group.models) {
        this.modelSelect.createEl("option", { text: `${group.name ?? group.id} \xB7 ${model.name ?? model.id}`, value: `${group.id}/${model.id}` });
      }
    }
    const current = `${this.modelCatalog.current.provider}/${this.modelCatalog.current.model}`;
    this.modelSelect.value = current;
    this.renderEfforts(current);
  }
  renderEfforts(key) {
    if (!this.effortSelect || !this.modelCatalog) return;
    this.effortSelect.empty();
    const [provider, model] = key.split("/");
    const group = this.modelCatalog.groups.find((g) => g.id === provider);
    const info = group?.models.find((m) => m.id === model);
    const efforts = info?.reasoning?.efforts ?? [];
    this.effortSelect.createEl("option", { text: "\u9ED8\u8BA4 effort", value: "" });
    for (const effort of efforts) this.effortSelect.createEl("option", { text: effort.name, value: effort.id });
    this.effortSelect.value = this.modelCatalog.current.reasoningEffort ?? "";
  }
  async applyModelSelection() {
    if (!this.api || !this.sessionId || !this.modelSelect) return;
    const [provider, model] = this.modelSelect.value.split("/");
    if (!provider || !model) return;
    const effort = this.effortSelect?.value || void 0;
    await this.api.selectModel(this.sessionId, provider, model, effort);
  }
  async applyPermission() {
    if (!this.api || !this.permissionSelect) return;
    const mode = this.permissionSelect.value;
    const spec = permissionSpec(mode);
    this.plugin.settings.permissionMode = mode;
    await this.plugin.saveSettings();
    await this.api.settingsMutate("permission", [{ op: "set", path: ["defaultPreset"], value: spec.preset }]);
  }
  async chooseExternalWorkspace() {
    if (!this.api) {
      await this.ensureLoaded();
      if (!this.api) return;
    }
    const path2 = await this.api.hostPickDirectory();
    if (!path2) return;
    this.workspacePath = path2;
    this.sessionId = null;
    await this.reloadSessions();
    new import_obsidian5.Notice(`obsidian-dsh\uFF1A\u5DE5\u4F5C\u533A\u5DF2\u5207\u6362\u5230 ${path2}`);
  }
  insertContext(text) {
    if (!this.composerEl) return;
    const current = this.composerEl.value;
    this.composerEl.value = current ? `${current}
${text}` : text;
    this.composerEl.focus();
  }
  setNoteContext(path2, selection) {
    this.noteContext = { path: path2, selection };
    this.renderChips();
  }
  attachFile(path2, content) {
    this.attachedFiles = [...this.attachedFiles.filter((f) => f.path !== path2), { path: path2, content }];
    this.renderChips();
  }
  renderChips() {
    if (!this.chipsEl) return;
    this.chipsEl.empty();
    if (this.noteContext) {
      const chip = this.chipsEl.createSpan({ cls: "odsh-chip", text: `\u{1F4C4} ${this.noteContext.path}` });
      const x = chip.createSpan({ text: " \u2715", cls: "odsh-chip-x" });
      x.addEventListener("click", () => {
        this.noteContext = null;
        this.renderChips();
      });
    }
    for (const file of this.attachedFiles) {
      const chip = this.chipsEl.createSpan({ cls: "odsh-chip", text: `\u{1F4CE} ${file.path}` });
      const x = chip.createSpan({ text: " \u2715", cls: "odsh-chip-x" });
      x.addEventListener("click", () => {
        this.attachedFiles = this.attachedFiles.filter((f) => f.path !== file.path);
        this.renderChips();
      });
    }
  }
  async sendPrompt() {
    if (!this.composerEl || !this.api) return;
    const text = this.composerEl.value.trim();
    if (!text) return;
    if (!this.sessionId) {
      await this.newSession();
      if (!this.sessionId) return;
    }
    const collected = {
      notePath: this.noteContext?.path ?? null,
      selection: this.noteContext?.selection ?? null,
      files: this.attachedFiles
    };
    const mode = this.plugin.settings.agentMode;
    const base = mode === "orchestrated" ? buildOrchestratedPrompt(text) : buildDirectPrompt(text);
    const prompt = composePrompt(base, collected, this.plugin.settings.contextMaxNoteBytes);
    this.composerEl.value = "";
    this.noteContext = null;
    this.attachedFiles = [];
    this.renderChips();
    const rpcId = this.api.newPromptRpcId();
    const result = await this.api.prompt(this.sessionId, prompt, "queue", rpcId);
    if (!result.ok) new import_obsidian5.Notice(`obsidian-dsh\uFF1A${result.error ?? "\u53D1\u9001\u5931\u8D25"}`);
  }
  scheduleRender() {
    if (this.renderTimer) return;
    this.renderTimer = setTimeout(() => {
      this.renderTimer = null;
      this.renderMessages();
      this.renderApprovals();
    }, RENDER_BATCH_MS);
  }
  renderMessages() {
    if (!this.messagesEl || !this.sessionId) return;
    const view = this.store.getView(this.sessionId);
    this.messagesEl.empty();
    if (!view || view.items.length === 0) {
      this.messagesEl.createDiv({ cls: "odsh-welcome", text: "\u4F1A\u8BDD\u4E3A\u7A7A\u3002\u8F93\u5165\u6307\u4EE4\u5F00\u59CB\uFF0C\u6216\u4ECE\u547D\u4EE4\u9762\u677F\u53D1\u9001\u5F53\u524D\u7B14\u8BB0/\u9009\u533A\u3002" });
      return;
    }
    const vaultBase = this.vaultPath();
    for (const item of view.items) this.renderItem(item, vaultBase);
    if (view.streamingSeq !== null) this.messagesEl.createDiv({ cls: "odsh-streaming", text: "\u6B63\u5728\u56DE\u7B54\u2026" });
  }
  renderItem(item, vaultBase) {
    if (!this.messagesEl || !this.app) return;
    switch (item.kind) {
      case "user": {
        const wrap = this.messagesEl.createDiv({ cls: "odsh-msg odsh-msg-user" });
        wrap.createDiv({ cls: "odsh-bubble", text: item.text });
        break;
      }
      case "assistant": {
        const wrap = this.messagesEl.createDiv({ cls: "odsh-msg odsh-msg-assistant" });
        const text = item.parts.filter((p) => p.part === "text").map((p) => p.text).join("");
        const reasoning = item.parts.filter((p) => p.part === "reasoning").map((p) => p.text).join("");
        if (reasoning) {
          const details = wrap.createEl("details", { cls: "odsh-reasoning" });
          details.createEl("summary", { text: "\u601D\u8003\u8FC7\u7A0B" });
          details.createEl("pre", { text: reasoning });
        }
        if (!item.done) {
          wrap.createDiv({ cls: "odsh-markdown odsh-markdown-streaming", text });
        } else {
          const md = wrap.createDiv({ cls: "odsh-markdown" });
          const linked = markdownForRender(text, (p) => this.plugin.app.vault.getAbstractFileByPath(p) !== null, vaultBase);
          void renderMarkdown(this.plugin.app, md, linked, "", this).then(() => this.upgradeFileLinks(md));
        }
        break;
      }
      case "tool": {
        const wrap = this.messagesEl.createDiv({ cls: "odsh-msg odsh-msg-tool" });
        createToolCard(wrap, { name: item.name, args: item.args, result: item.result, done: item.done, risk: classifyTool(item.name, item.args) });
        break;
      }
      case "notice":
        createNotice(this.messagesEl, item.text);
        break;
    }
  }
  upgradeFileLinks(container) {
    container.querySelectorAll('a[href^="obsidian-dsh-file://"]').forEach((a) => {
      const path2 = decodeURIComponent(a.getAttribute("href")?.slice("obsidian-dsh-file://".length) ?? "");
      a.addEventListener("click", (event) => {
        event.preventDefault();
        const file = this.plugin.app.vault.getAbstractFileByPath(path2);
        if (file) void this.plugin.app.workspace.getLeaf(false).openFile(file);
      });
    });
  }
  renderApprovals() {
    if (!this.approvalsEl || !this.center) return;
    this.approvalsEl.empty();
    for (const pending of this.center.pendingApprovals) {
      const row = this.approvalsEl.createDiv({ cls: "odsh-approval" });
      row.createSpan({ cls: "odsh-approval-tool", text: pending.toolName });
      if (pending.reason) row.createSpan({ cls: "odsh-approval-reason", text: pending.reason });
      const allow = row.createEl("button", { text: "\u5141\u8BB8\u4E00\u6B21", cls: "odsh-approve" });
      allow.addEventListener("click", () => void this.center?.decideApproval(pending, "allowed-once"));
      const reject = row.createEl("button", { text: "\u62D2\u7EDD", cls: "odsh-reject" });
      reject.addEventListener("click", () => void this.center?.decideApproval(pending, "rejected"));
    }
    for (const pending of this.center.pendingQuestions) {
      const row = this.approvalsEl.createDiv({ cls: "odsh-approval odsh-question" });
      row.createSpan({ text: pending.questions.map((q) => q.question).join(" \xB7 ") });
      const answer = row.createEl("button", { text: "\u56DE\u7B54", cls: "odsh-approve" });
      answer.addEventListener("click", () => new QuestionModal(this.plugin.app, this.center, pending).open());
    }
  }
  renderStatus() {
    if (!this.statusDot || !this.statusLabel) return;
    const snapshot = this.plugin.server.getSnapshot();
    this.statusDot.className = "odsh-dot odsh-state-" + snapshot.state;
    const labels = { stopped: "\u672A\u8FD0\u884C", starting: "\u542F\u52A8\u4E2D\u2026", running: "\u8FD0\u884C\u4E2D", error: "\u9519\u8BEF" };
    this.statusLabel.setText(labels[snapshot.state] ?? snapshot.state);
  }
};

// src/obsidian/vaultPath.ts
var import_obsidian6 = require("obsidian");
function getVaultPath(app) {
  const adapter = app.vault.adapter;
  if (adapter instanceof import_obsidian6.FileSystemAdapter) {
    const base = adapter.getBasePath?.();
    if (base) return base;
  }
  return app.vault.getName();
}

// src/main.ts
var ObsidianDshPlugin = class extends import_obsidian7.Plugin {
  settings = { ...DEFAULT_SETTINGS };
  server = new DshServerManager(() => this.settings);
  pluginData = {};
  async onload() {
    try {
      this.pluginData = await this.loadData() ?? {};
      this.settings = Object.assign({}, DEFAULT_SETTINGS, this.pluginData.settings ?? {});
      this.pluginData.loadedAt = Date.now();
      delete this.pluginData.loadError;
      await this.saveData(this.pluginData);
      this.addSettingTab(new ObsidianDshSettingTab(this.app, this));
      this.registerView(VIEW_TYPE_DSH, (leaf) => new ObsidianDshView(leaf, this));
      this.addRibbonIcon("bot", "\u6253\u5F00 DeepSeek Harness", () => void this.activateView());
      this.addCommand({ id: "open-sidebar", name: "\u6253\u5F00 DeepSeek Harness \u4FA7\u680F", callback: () => void this.activateView() });
      this.addCommand({ id: "send-selection", name: "\u53D1\u9001\u9009\u533A\u5230 DeepSeek Harness", callback: () => void this.sendSelection() });
      this.addCommand({ id: "send-note", name: "\u53D1\u9001\u5F53\u524D\u7B14\u8BB0\u5230 DeepSeek Harness", callback: () => void this.sendNote() });
      this.addCommand({ id: "choose-workspace", name: "\u9009\u62E9\u5916\u90E8\u5DE5\u4F5C\u533A\uFF08Git \u4ED3\u5E93\uFF09", callback: () => void this.chooseWorkspace() });
      this.addCommand({ id: "open-browser", name: "\u5728\u6D4F\u89C8\u5668\u6253\u5F00 DSH", callback: () => void this.openBrowser() });
      this.addCommand({ id: "restart-server", name: "\u91CD\u542F DSH \u670D\u52A1", callback: () => void this.restartServer() });
      if (this.settings.autoStart) void this.server.ensure(getVaultPath(this.app)).catch((e) => this.recordError(String(e)));
      if (this.settings.openOnStartup) {
        this.app.workspace.onLayoutReady(() => {
          void this.activateView().catch((e) => this.recordError(String(e)));
        });
      }
    } catch (error) {
      await this.recordError(error instanceof Error ? error.stack ?? error.message : String(error));
    }
  }
  async recordError(message) {
    this.pluginData.loadError = message;
    try {
      await this.saveData(this.pluginData);
    } catch {
    }
  }
  onunload() {
    this.server.dispose();
  }
  async saveSettings() {
    this.pluginData.settings = this.settings;
    await this.saveData(this.pluginData);
  }
  getVaultPath() {
    return getVaultPath(this.app);
  }
  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_DSH)[0] ?? null;
    if (!leaf) leaf = this.getLeafForPlacement(this.settings.viewPlacement);
    if (!leaf) return null;
    await leaf.setViewState({ type: VIEW_TYPE_DSH, active: true });
    await workspace.revealLeaf(leaf);
    const view = leaf.view instanceof ObsidianDshView ? leaf.view : null;
    if (view) await view.ensureLoaded();
    return view;
  }
  getLeafForPlacement(placement) {
    const { workspace } = this.app;
    switch (placement) {
      case "tab":
        return workspace.getLeaf(true);
      case "left-sidebar":
        return workspace.getLeftLeaf(false);
      case "right-sidebar":
        return workspace.getRightLeaf(false);
      case "window":
        return workspace.getLeaf("window");
      default:
        return workspace.getRightLeaf(false);
    }
  }
  async sendSelection() {
    const selection = getActiveSelection(this.app);
    const context = getActiveNoteContext(this.app);
    if (!selection) {
      new import_obsidian7.Notice("obsidian-dsh\uFF1A\u5F53\u524D\u7B14\u8BB0\u6CA1\u6709\u9009\u4E2D\u6587\u672C");
      return;
    }
    const view = await this.activateView();
    view?.setNoteContext(context.path ?? "", selection);
    view?.insertContext(selection);
  }
  async sendNote() {
    const context = getActiveNoteContext(this.app);
    if (!context.path) {
      new import_obsidian7.Notice("obsidian-dsh\uFF1A\u6CA1\u6709\u6253\u5F00\u7684\u7B14\u8BB0");
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(context.path);
    if (!file) return;
    const content = await this.app.vault.cachedRead(file);
    const view = await this.activateView();
    view?.attachFile(context.path, content);
    view?.insertContext(context.path);
  }
  async chooseWorkspace() {
    const view = await this.activateView();
    await view?.chooseExternalWorkspace();
  }
  async openBrowser() {
    const url = await this.server.ensure(getVaultPath(this.app));
    if (!url) {
      new import_obsidian7.Notice("obsidian-dsh\uFF1ADSH \u670D\u52A1\u672A\u5C31\u7EEA");
      return;
    }
    window.open(url, "_blank");
  }
  async restartServer() {
    const url = await this.server.restart(getVaultPath(this.app));
    new import_obsidian7.Notice(url ? `obsidian-dsh\uFF1A\u5DF2\u91CD\u542F\uFF0C${url}` : "obsidian-dsh\uFF1A\u91CD\u542F\u5931\u8D25");
  }
};
