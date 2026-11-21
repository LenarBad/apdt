import { join } from "node:path";
import YAML from "yaml";
import { contentHash } from "../hash.js";
import { pathExists, readText, writeText } from "../fsutil.js";
import { MANIFEST_PATH } from "../paths.js";
import type { Manifest, ManifestEntry } from "../schemas/manifest.js";
import type { PlannedFile } from "../schemas/plan.js";
import { APDT_VERSION, TEMPLATE_VERSION } from "../version.js";

export function manifestAbs(repoRoot: string): string {
  return join(repoRoot, MANIFEST_PATH);
}

export function loadManifest(repoRoot: string): Manifest | null {
  const path = manifestAbs(repoRoot);
  if (!pathExists(path)) return null;
  const parsed = YAML.parse(readText(path)) as Manifest;
  return parsed;
}

export function emptyManifest(createdAt: string): Manifest {
  return {
    version: 1,
    apdtVersion: APDT_VERSION,
    createdAt,
    updatedAt: createdAt,
    templateVersion: TEMPLATE_VERSION,
    files: [],
  };
}

export type FileDecision =
  | { action: "write"; planned: PlannedFile }
  | { action: "skip"; planned: PlannedFile; reason: string; code: string };

export function decideFileActions(
  repoRoot: string,
  planned: PlannedFile[],
  options: { force?: boolean; repairOrg?: boolean } = {},
): FileDecision[] {
  const manifest = loadManifest(repoRoot);
  const byPath = new Map(manifest?.files.map((f) => [f.path, f]) ?? []);

  return planned.map((file) => {
    const abs = join(repoRoot, file.path);
    const exists = pathExists(abs);
    const entry = byPath.get(file.path);

    if (!exists) {
      return { action: "write", planned: { ...file, kind: "create" } };
    }

    const onDisk = readText(abs);
    const diskHash = contentHash(onDisk);

    if (entry) {
      const dirty = entry.hash !== diskHash;
      if (dirty && !options.force) {
        return {
          action: "skip",
          planned: { ...file, kind: "skip", reason: "dirty managed file" },
          reason: "dirty managed file",
          code: "DIRTY_SKIPPED",
        };
      }
      if (
        entry.pinContent &&
        !options.force &&
        diskHash !== contentHash(file.content)
      ) {
        return {
          action: "skip",
          planned: {
            ...file,
            kind: "skip",
            reason: "pinned adopted content",
          },
          reason: "pinned adopted content",
          code: "PINNED_CONTENT",
        };
      }
      if (!dirty && diskHash === contentHash(file.content)) {
        return {
          action: "skip",
          planned: { ...file, kind: "skip", reason: "unchanged" },
          reason: "unchanged",
          code: "UNCHANGED",
        };
      }
      return { action: "write", planned: { ...file, kind: "update" } };
    }

    // Exists but not in inventory → unmanaged
    if (diskHash === contentHash(file.content)) {
      return {
        action: "skip",
        planned: { ...file, kind: "skip", reason: "unmanaged identical" },
        reason: "unmanaged identical",
        code: "UNMANAGED_IDENTICAL",
      };
    }
    // Repair invalid org YAML without requiring full --force
    if (
      options.repairOrg &&
      !options.force &&
      file.path.startsWith("apdt/organization/")
    ) {
      return { action: "write", planned: { ...file, kind: "update" } };
    }
    if (!options.force) {
      return {
        action: "skip",
        planned: { ...file, kind: "skip", reason: "unmanaged collision" },
        reason: "unmanaged collision",
        code: "UNMANAGED_COLLISION",
      };
    }
    return { action: "write", planned: { ...file, kind: "update" } };
  });
}

export function buildManifestEntries(
  writes: PlannedFile[],
  previous: Manifest | null,
  now: string,
  options: { omitPaths?: ReadonlySet<string> } = {},
): Manifest {
  const prevByPath = new Map(previous?.files.map((f) => [f.path, f]) ?? []);
  const omitPaths = options.omitPaths ?? new Set<string>();
  const files: ManifestEntry[] = writes.map((f) => ({
    path: f.path,
    hash: contentHash(f.content),
    templateId: f.templateId,
    templateVersion: TEMPLATE_VERSION,
    managed: true as const,
    lastAppliedApdtVersion: APDT_VERSION,
  }));

  // Keep prior entries not in this write set, except eligible orphans (omitted)
  for (const [path, entry] of prevByPath) {
    if (files.some((f) => f.path === path)) continue;
    if (omitPaths.has(path)) continue;
    files.push(entry);
  }

  files.sort((a, b) => a.path.localeCompare(b.path));

  return {
    version: 1,
    apdtVersion: APDT_VERSION,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    templateVersion: TEMPLATE_VERSION,
    files,
  };
}

export function writeManifest(repoRoot: string, manifest: Manifest): void {
  writeText(manifestAbs(repoRoot), YAML.stringify(manifest));
}
