import * as crypto from "crypto";

export function mintId(): string {
  return crypto.randomUUID();
}
