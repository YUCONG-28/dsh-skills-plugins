import { describe, expect, it } from "vitest";
import { encodeClientFrame, findHttpResponseEnd, parseWsFrames } from "../src/harness/transport";

describe("transport websocket framing", () => {
  it("parses an unmasked text frame", () => {
    const payload = Buffer.from("hello", "utf8");
    const frame = Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
    const { frames, rest } = parseWsFrames(frame);
    expect(frames).toHaveLength(1);
    expect(frames[0].opcode).toBe(0x1);
    expect(frames[0].payload.toString("utf8")).toBe("hello");
    expect(rest).toHaveLength(0);
  });

  it("encodes a masked client frame", () => {
    const encoded = encodeClientFrame(0x8, Buffer.from("bye"));
    expect(encoded[0] & 0x80).toBe(0x80);
    expect(encoded[1] & 0x80).toBe(0x80);
    expect(encoded.length).toBe(2 + 4 + 3);
  });

  it("finds the http response head end", () => {
    const buf = Buffer.from("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n\r\nbody");
    const end = findHttpResponseEnd(buf);
    expect(buf.subarray(end).toString()).toBe("body");
  });
});
