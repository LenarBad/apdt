import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Resolve package root (contains package.json + templates/). */
export function packageRoot(): string {
  const candidates = [join(here, ".."), join(here, "../..")];
  for (const c of candidates) {
    if (existsSync(join(c, "package.json")) && existsSync(join(c, "templates"))) {
      return c;
    }
  }
  return join(here, "..");
}

export function templatesRoot(): string {
  return join(packageRoot(), "templates");
}

export const MANIFEST_PATH = "apdt/.apdt-manifest.yaml";
export const BACKUP_ROOT = ".apdt-backup";
