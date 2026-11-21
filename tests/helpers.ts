import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const testsDir = fileURLToPath(new URL(".", import.meta.url));

/** Temp dirs inside the workspace so sandbox can write harness paths like `.cursor/`. */
export function workspaceTempDir(prefix = "case-"): string {
  const base = join(testsDir, ".tmp");
  mkdirSync(base, { recursive: true });
  return mkdtempSync(join(base, prefix));
}
