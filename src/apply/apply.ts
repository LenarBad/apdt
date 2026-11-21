import { join } from "node:path";
import { BACKUP_ROOT } from "../paths.js";
import { copyPath, pathExists, readText, removeFile, writeText } from "../fsutil.js";
import {
  buildManifestEntries,
  decideFileActions,
  loadManifest,
  writeManifest,
  type FileDecision,
} from "../inventory/manifest.js";
import { findOrphanEntries } from "../inventory/orphans.js";
import type { PlannedFile } from "../schemas/plan.js";
import type { ManifestEntry } from "../schemas/manifest.js";
import { contentHash } from "../hash.js";
import { APDT_VERSION, TEMPLATE_VERSION } from "../version.js";

export type ApplyResult = {
  written: string[];
  skipped: Array<{ path: string; reason: string; code: string }>;
  backedUp: string[];
  /** Eligible orphan managed paths backed up and deleted on this apply. */
  removed: string[];
  decisions: FileDecision[];
};

export type ApplyOptions = {
  force?: boolean;
  now?: string;
  /**
   * Preserve existing `apdt/**` files on unmanaged collision and adopt them
   * into the inventory (disk bytes + hash). Default true.
   */
  adoptApdt?: boolean;
  /**
   * When the installed organization is invalid, overwrite
   * `apdt/organization/*` planned files with backup (without full `--force`).
   */
  repairOrg?: boolean;
};

function isApdtPath(path: string): boolean {
  return path === "apdt" || path.startsWith("apdt/");
}

function isOrgPath(path: string): boolean {
  return path.startsWith("apdt/organization/");
}

function shouldAdopt(
  decision: Extract<FileDecision, { action: "skip" }>,
  adoptApdt: boolean,
): boolean {
  if (decision.code === "UNMANAGED_IDENTICAL") return true;
  if (decision.code === "UNMANAGED_COLLISION" && adoptApdt && isApdtPath(decision.planned.path)) {
    return true;
  }
  return false;
}

export function applyPlan(
  repoRoot: string,
  files: PlannedFile[],
  options: ApplyOptions = {},
): ApplyResult {
  const now = options.now ?? new Date().toISOString();
  const adoptApdt = options.adoptApdt !== false;
  const decisions = decideFileActions(repoRoot, files, {
    force: options.force,
    repairOrg: options.repairOrg,
  });
  const written: string[] = [];
  const skipped: ApplyResult["skipped"] = [];
  const backedUp: string[] = [];
  const removed: string[] = [];
  const stamp = now.replace(/[:.]/g, "-");
  const writes: PlannedFile[] = [];
  const adopted: ManifestEntry[] = [];
  const finalDecisions: FileDecision[] = [];

  for (const d of decisions) {
    if (d.action === "skip") {
      if (shouldAdopt(d, adoptApdt)) {
        const abs = join(repoRoot, d.planned.path);
        const disk = readText(abs);
        adopted.push({
          path: d.planned.path,
          hash: contentHash(disk),
          templateId: d.planned.templateId,
          templateVersion: TEMPLATE_VERSION,
          managed: true,
          lastAppliedApdtVersion: APDT_VERSION,
          pinContent: true,
        });
        const remapped: FileDecision = {
          action: "skip",
          planned: {
            ...d.planned,
            kind: "skip",
            reason: "preserved existing file; adopted into inventory",
          },
          reason: "preserved existing file; adopted into inventory",
          code: "ADOPTED_EXISTING",
        };
        finalDecisions.push(remapped);
        skipped.push({
          path: d.planned.path,
          reason: remapped.reason,
          code: remapped.code,
        });
        continue;
      }

      finalDecisions.push(d);
      skipped.push({
        path: d.planned.path,
        reason: d.reason,
        code: d.code,
      });
      continue;
    }

    finalDecisions.push(d);
    const abs = join(repoRoot, d.planned.path);
    if (pathExists(abs) && (options.force || d.planned.kind === "update")) {
      const prev = loadManifest(repoRoot);
      const wasManaged = prev?.files.some((f) => f.path === d.planned.path);
      const repairBackup = Boolean(options.repairOrg && isOrgPath(d.planned.path));
      if (wasManaged || options.force || repairBackup) {
        const dest = join(repoRoot, BACKUP_ROOT, stamp, d.planned.path);
        copyPath(abs, dest);
        backedUp.push(d.planned.path);
      }
    }

    writeText(abs, d.planned.content);
    written.push(d.planned.path);
    writes.push(d.planned);
  }

  const previous = loadManifest(repoRoot);
  const plannedPaths = new Set(files.map((f) => f.path));
  const orphans = findOrphanEntries(previous, plannedPaths);
  const omitPaths = new Set<string>();

  for (const orphan of orphans) {
    const abs = join(repoRoot, orphan.path);
    if (pathExists(abs)) {
      const dest = join(repoRoot, BACKUP_ROOT, stamp, orphan.path);
      copyPath(abs, dest);
      backedUp.push(orphan.path);
      removeFile(abs);
    }
    omitPaths.add(orphan.path);
    removed.push(orphan.path);
  }

  const manifest = buildManifestEntries(writes, previous, now, { omitPaths });

  for (const entry of adopted) {
    if (!manifest.files.some((e) => e.path === entry.path)) {
      manifest.files.push(entry);
    }
  }

  // Keep unchanged / pinned managed files from this plan in the inventory
  for (const f of files) {
    if (manifest.files.some((e) => e.path === f.path)) continue;
    const skip = skipped.find(
      (s) =>
        s.path === f.path &&
        (s.code === "UNCHANGED" || s.code === "PINNED_CONTENT"),
    );
    if (!skip) continue;
    const prevEntry = previous?.files.find((e) => e.path === f.path);
    const abs = join(repoRoot, f.path);
    const hash =
      skip.code === "PINNED_CONTENT" && pathExists(abs)
        ? contentHash(readText(abs))
        : contentHash(f.content);
    manifest.files.push({
      path: f.path,
      hash,
      templateId: f.templateId,
      templateVersion: TEMPLATE_VERSION,
      managed: true,
      lastAppliedApdtVersion: APDT_VERSION,
      ...(prevEntry?.pinContent || skip.code === "PINNED_CONTENT"
        ? { pinContent: true as const }
        : {}),
    });
  }

  manifest.files.sort((a, b) => a.path.localeCompare(b.path));
  const seen = new Set<string>();
  manifest.files = manifest.files.filter((f) => {
    if (seen.has(f.path)) return false;
    seen.add(f.path);
    return true;
  });

  writeManifest(repoRoot, manifest);
  return { written, skipped, backedUp, removed, decisions: finalDecisions };
}
