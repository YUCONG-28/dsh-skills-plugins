// Node-native transport for the dsh web /api surface. Obsidian's renderer
// fetch/WebSocket carry an app://obsidian.md Origin that the DSH browser-trust
// fence rejects, so we talk to loopback with node:http / node:net primitives
// (no Origin header, loopback Host) exactly like the reference clients.
import * as crypto from "crypto";
import { EventEmitter } from "events";
import * as http from "http";
import * as net from "net";

export interface PostResult {
  status: number;
  body: string;
}

export function postJson(baseUrl: string, path: string, body: unknown, timeoutMs = 15000): Promise<PostResult> {
  return new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(baseUrl);
    } catch (error) {
      reject(error);
      return;
    }
    const payload = Buffer.from(JSON.stringify(body), "utf8");
    const request = http.request(
      {
        host: url.hostname,
        port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
        path,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(payload.length),
        },
        timeout: timeoutMs,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    request.on("timeout", () => request.destroy(new Error(`dsh api timeout after ${timeoutMs}ms`)));
    request.on("error", reject);
    request.write(payload);
    request.end();
  });
}

export interface WsFrame {
  fin: boolean;
  opcode: number;
  payload: Buffer;
}

const CRLFCRLF = Buffer.from("\r\n\r\n");
const MAX_HANDSHAKE_BYTES = 64 * 1024;

export function findHttpResponseEnd(buffer: Buffer): number {
  const index = buffer.indexOf(CRLFCRLF);
  return index < 0 ? -1 : index + CRLFCRLF.length;
}

function unmask(payload: Buffer, mask: Buffer): Buffer {
  const out = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) out[i] = payload[i] ^ mask[i % 4];
  return out;
}

export function parseWsFrames(buffer: Buffer): { frames: WsFrame[]; rest: Buffer } {
  const frames: WsFrame[] = [];
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const b0 = buffer[offset];
    const b1 = buffer[offset + 1];
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let length = b1 & 0x7f;
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

export function encodeClientFrame(opcode: number, payload: Buffer): Buffer {
  if (payload.length > 125) throw new Error("dsh ws: client frame too large");
  const mask = crypto.randomBytes(4);
  const header = Buffer.from([0x80 | opcode, 0x80 | payload.length]);
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

/**
 * Minimal RFC6455 client for the server→client downlinks. Sends no Origin and
 * understands text/close/ping frames; upstream application data stays on HTTP.
 */
export class MiniWebSocket extends EventEmitter {
  readonly url: string;
  private socket: net.Socket | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private handshaken = false;
  private handshakeBuffer: Buffer = Buffer.alloc(0);
  private closed = false;

  constructor(url: string) {
    super();
    this.url = url;
  }

  connect(): void {
    let parsed: URL;
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
      const path = `${parsed.pathname}${parsed.search}`;
      socket.write(
        `GET ${path} HTTP/1.1\r\n` +
          `Host: ${host}:${port}\r\n` +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          `Sec-WebSocket-Key: ${key}\r\n` +
          "Sec-WebSocket-Version: 13\r\n" +
          "\r\n",
      );
    });

    socket.on("data", (chunk: Buffer) => {
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

  private drain(): void {
    if (this.closed) return;
    try {
      const { frames, rest } = parseWsFrames(this.buffer);
      this.buffer = rest;
      for (const frame of frames) this.handleFrame(frame);
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private handleFrame(frame: WsFrame): void {
    if (frame.opcode === 0x9) {
      this.socket?.write(encodeClientFrame(0xa, frame.payload));
      return;
    }
    if (frame.opcode === 0x8) {
      this.close();
      return;
    }
    if (frame.opcode === 0x1) {
      this.emit("message", frame.payload.toString("utf8"));
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.socket?.end();
    } catch {
      // already torn down
    }
    this.socket = null;
    this.emit("close");
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.socket?.destroy();
    } catch {
      // ignore
    }
    this.socket = null;
    this.emit("error", error);
    this.emit("close");
  }
}

export function wsUrlFor(baseUrl: string, path: string): string {
  return baseUrl.replace(/\/+$/, "").replace(/^http/, "ws") + path;
}
