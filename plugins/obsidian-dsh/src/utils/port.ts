export const DEFAULT_DSH_URL = "http://127.0.0.1:3080";

export function urlFor(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export function safeParseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

export function normalizeBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, "");
}
