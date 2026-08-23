// Downlink event streams (events.mux / events.host) with exponential-backoff
// reconnect. Each frame is a server-request envelope; approval/question frames
// are answerable (rpcId is the correlation key), pure pushes are fire-and-forget.
import { MiniWebSocket, wsUrlFor } from "./transport";
import type { HostFrameRaw, MuxFrameRaw } from "./types";

export type StreamState = "connected" | "reconnecting" | "stopped";

export interface StreamSink {
  onFrame(rpcId: string, payload: MuxFrameRaw["payload"] | HostFrameRaw["payload"]): void;
  onState(state: StreamState): void;
}

export function backoffDelay(attempt: number, baseMs: number, maxMs: number): number {
  const n = Math.max(attempt - 1, 0);
  return Math.min(maxMs, baseMs * 2 ** n);
}

export class EventStream {
  private socket: MiniWebSocket | null = null;
  private stopped = true;
  private attempt = 0;
  private lastState: StreamState | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly path: string,
    private readonly sink: StreamSink,
    private readonly baseMs = 500,
    private readonly maxMs = 30000,
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempt = 0;
    this.lastState = null;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.socket?.close();
    this.socket = null;
    this.emitState("stopped");
  }

  private connect(): void {
    this.emitState("reconnecting");
    const url = wsUrlFor(this.baseUrl, this.path);
    const socket = new MiniWebSocket(url);
    this.socket = socket;
    socket.on("open", () => {
      this.attempt = 0;
      this.emitState("connected");
    });
    socket.on("message", (text: string) => {
      let msg: { rpcId?: string; payload?: MuxFrameRaw["payload"] | HostFrameRaw["payload"] };
      try {
        msg = JSON.parse(text) as { rpcId?: string; payload?: MuxFrameRaw["payload"] | HostFrameRaw["payload"] };
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
      /* close follows; reconnect happens there to avoid double scheduling */
    });
    socket.on("close", () => this.scheduleReconnect());
    // START the connection — without this the stream never opens and no frames arrive.
    socket.connect();
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.emitState("reconnecting");
    this.attempt += 1;
    const delay = backoffDelay(this.attempt, this.baseMs, this.maxMs);
    this.timer = setTimeout(() => {
      if (!this.stopped) this.connect();
    }, delay);
  }

  private emitState(state: StreamState): void {
    if (this.lastState !== state) {
      this.lastState = state;
      this.sink.onState(state);
    }
  }
}
