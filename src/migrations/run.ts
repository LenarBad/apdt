import type { Manifest } from "../schemas/manifest.js";
import { TEMPLATE_VERSION } from "../version.js";
import { PRODUCTION_MIGRATIONS } from "./registry.js";
import type { Migration, MigrationContext, MigrationResult } from "./types.js";
import { compareVersions, versionLt, versionLte } from "./versions.js";

const FALLBACK_TEMPLATE_VERSION = "0.2.0";

/** Resolve installed template generation from the manifest. */
export function resolveInstalledTemplateVersion(manifest: Manifest): string {
  if (manifest.templateVersion) return manifest.templateVersion;
  let max: string | null = null;
  for (const f of manifest.files) {
    if (!f.templateVersion) continue;
    if (max === null || compareVersions(f.templateVersion, max) > 0) {
      max = f.templateVersion;
    }
  }
  return max ?? FALLBACK_TEMPLATE_VERSION;
}

/**
 * Run migrations whose range sits between `fromVersion` and `toVersion`.
 * Pass `registry` to inject test-only migrations without shipping production mutators.
 */
export function runPendingMigrations(
  repoRoot: string,
  fromVersion: string,
  toVersion: string = TEMPLATE_VERSION,
  ctx: MigrationContext = {},
  registry: Migration[] = PRODUCTION_MIGRATIONS,
): MigrationResult {
  let current = fromVersion;
  const applied: string[] = [];

  if (!versionLt(fromVersion, toVersion)) {
    return { applied, fromVersion, toVersion, currentVersion: current };
  }

  const ordered = [...registry].sort((a, b) => {
    const byTo = compareVersions(a.to, b.to);
    if (byTo !== 0) return byTo;
    return a.id.localeCompare(b.id);
  });

  for (const m of ordered) {
    if (
      versionLte(m.from, current) &&
      versionLt(current, m.to) &&
      versionLte(m.to, toVersion)
    ) {
      m.apply(repoRoot, ctx);
      applied.push(m.id);
      current = m.to;
    }
  }

  return { applied, fromVersion, toVersion, currentVersion: current };
}
