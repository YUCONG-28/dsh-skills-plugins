import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DshApiClient } from "../src/harness/client";

const PORT = 3099;
const BASE = "http://127.0.0.1:3099";
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "odsh-smoke-home-"));
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "odsh-smoke-work-"));
let child: ChildProcess | null = null;
const client = new DshApiClient(BASE);

async function waitForApi(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await client.hostDescribe();
    if (result.ok) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

describe("live dsh web contract smoke", () => {
  beforeAll(async () => {
    child = spawn("dsh", ["web", "--port", String(PORT), "--no-open"], {
      cwd: WORK,
      env: { ...process.env, DSH_HOME: HOME },
      stdio: "ignore",
      detached: false,
    });
    const ready = await waitForApi(40000);
    if (!ready) {
      child.kill("SIGTERM");
      child = null;
    }
  }, 60000);

  afterAll(() => {
    child?.kill("SIGTERM");
  });

  it("answers host.describe", async () => {
    expect(child).not.toBeNull();
    if (!child) return;
    const result = await client.hostDescribe();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.value.version).toBe("string");
      expect(typeof result.value.home).toBe("string");
    }
  });

  it("lists sessions", async () => {
    expect(child).not.toBeNull();
    if (!child) return;
    const result = await client.listSessions();
    expect(result.error).toBeUndefined();
    expect(Array.isArray(result.sessions)).toBe(true);
  });

  it("creates a session and reads empty history", async () => {
    expect(child).not.toBeNull();
    if (!child) return;
    const sessionId = await client.createSession({ cwd: WORK });
    expect(sessionId).toBeTruthy();
    if (!sessionId) return;
    const history = await client.history(sessionId, 5);
    expect(history.error).toBeUndefined();
    expect(Array.isArray(history.events)).toBe(true);
  });
});
