import { createHash } from "node:crypto";

// Same algorithm as the full SDK. The service and saved executions depend on it.
export function hashId(rawId) {
  return createHash("md5").update(rawId).digest("hex").slice(0, 16);
}
