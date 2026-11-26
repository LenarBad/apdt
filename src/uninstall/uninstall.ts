import { lstatSync, readdirSync, rmdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { contentHash } from "../hash.js";
import { copyPath, isDir, listFilesRecursive, pathExists, readText, removeFile, writeText } from "../fsutil.js";
import { loadManifest } from "../inventory/manifest.js";
import { BACKUP_ROOT, MANIFEST_PATH } from "../paths.js";

const USAGE_GUARD_MARKER = "apdt-usage-guard";
const SETTINGS_PATH = ".claude/settings.json";

export type UninstallOptions = {
  /** Required to delete. Omit it and the command refuses. */
  yes?: boolean;
  /** Print the plan and leave the tree unchanged. */
  dryRun?: boolean;
  now?: string;
};

export type UninstallResult = {
  exitCode: number;
  report: string;
  removed: string[];
  kept: string[];
  rewritten: string[];
  backedUp: string[];
};

type SettingsDecision =
  | { action: "delete" }
  | { action: "keep" }
  | { action: "rewrite"; text: string };

/** Drop usage-guard hooks from a Claude settings object. */
export function decideSettings(text: string, manifestHash: string | undefined): SettingsDecision {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    if (manifestHash !== undefined && contentHash(text) === manifestHash) return { action: "delete" };
    return { action: "keep" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return contentHash(text) === manifestHash ? { action: "delete" } : { action: "keep" };
  }

  const next: Record<string, unknown> = { ...(parsed as Record<string, unknown>) };
  if (mentionsGuard(next.statusLine)) delete next.statusLine;

  if (next.hooks && typeof next.hooks === "object" && !Array.isArray(next.hooks)) {
    const hooks: Record<string, unknown> = { ...(next.hooks as Record<string, unknown>) };
    for (const [event, groups] of Object.entries(hooks)) {
      if (!Array.isArray(groups)) {
        if (mentionsGuard(groups)) delete hooks[event];
        continue;
      }
      const kept = groups
        .map((group) => {
          if (!group || typeof group !== "object" || Array.isArray(group)) {
            return mentionsGuard(group) ? null : group;
          }
          const record = group as { hooks?: unknown };
          if (!Array.isArray(record.hooks)) return mentionsGuard(group) ? null : group;
          const hooksKept = record.hooks.filter((hook) => !mentionsGuard(hook));
          if (hooksKept.length === 0) return null;
          return { ...record, hooks: hooksKept };
        })
        .filter((group) => group !== null);
      if (kept.length === 0) delete hooks[event];
      else hooks[event] = kept;
    }
    if (Object.keys(hooks).length === 0) delete next.hooks;
    else next.hooks = hooks;
  } else if (mentionsGuard(next.hooks)) {
    delete next.hooks;
  }

  for (const [key, value] of Object.entries(next)) {
    if (key === "hooks" || key === "statusLine" || key === "autoContinueAtUsageLimit") continue;
    if (mentionsGuard(value)) delete next[key];
  }

  if (Object.keys(next).length === 1 && "autoContinueAtUsageLimit" in next) {
    delete next.autoContinueAtUsageLimit;
  }

  if (Object.keys(next).length === 0) return { action: "delete" };
  const rewritten = `${JSON.stringify(next, null, 2)}\n`;
  if (rewritten === text || JSON.stringify(next) === JSON.stringify(parsed)) return { action: "keep" };
  return { action: "rewrite", text: rewritten };
}

function mentionsGuard(value: unknown): boolean {
  if (value === undefined) return false;
  return JSON.stringify(value).includes(USAGE_GUARD_MARKER);
}

/** Relative path that stays inside the project. Rejects absolute paths and `..`. */
export function safeProjectPath(repoRoot: string, relPath: string): string | null {
  if (typeof relPath !== "string" || relPath.length === 0 || relPath.includes("\0")) return null;
  const normalized = relPath.replace(/\\/g, "/");
  if (normalized.startsWith("/") || normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
    return null;
  }
  const root = resolve(repoRoot);
  const abs = resolve(root, normalized);
  const rel = relative(root, abs);
  if (rel === "" || rel.startsWith("..") || rel.split(/[/\\]/).includes("..")) return null;
  return rel.split("\\").join("/");
}

function isRealDir(path: string): boolean {
  try {
    const stat = lstatSync(path);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function pruneEmptyDirs(dir: string): void {
  if (!isRealDir(dir)) return;
  for (const name of readdirSync(dir)) {
    const child = join(dir, name);
    if (isRealDir(child)) pruneEmptyDirs(child);
  }
  if (readdirSync(dir).length === 0) rmdirSync(dir);
}

export function uninstallProject(repoRoot: string, options: UninstallOptions = {}): UninstallResult {
  const root = resolve(repoRoot);
  const manifest = loadManifest(root);
  if (!manifest) {
    return finish(2, ["APDT uninstall", `No install found at ${MANIFEST_PATH}. Nothing removed.`], empty());
  }

  const known = new Set(manifest.files.map((entry) => entry.path));
  const remove: string[] = [];
  const keep: string[] = [];
  const rewrite: Array<{ path: string; text: string }> = [];
  const skipped: string[] = [];

  for (const entry of manifest.files) {
    const rel = safeProjectPath(root, entry.path);
    if (!rel) {
      skipped.push(entry.path);
      continue;
    }
    if (entry.pinContent) {
      if (pathExists(join(root, rel))) keep.push(rel);
      continue;
    }
    if (rel === SETTINGS_PATH) {
      if (!pathExists(join(root, rel))) continue;
      const decision = decideSettings(readText(join(root, rel)), entry.hash);
      if (decision.action === "delete") remove.push(rel);
      else if (decision.action === "rewrite") rewrite.push({ path: rel, text: decision.text });
      else keep.push(rel);
      continue;
    }
    if (pathExists(join(root, rel))) remove.push(rel);
  }

  const extras: string[] = [];
  const apdtRoot = join(root, "apdt");
  if (isDir(apdtRoot)) {
    for (const relInside of listFilesRecursive(apdtRoot)) {
      const rel = `apdt/${relInside}`;
      if (rel === MANIFEST_PATH || known.has(rel)) continue;
      if (safeProjectPath(root, rel)) extras.push(rel);
    }
  }
  if (pathExists(join(root, MANIFEST_PATH))) extras.push(MANIFEST_PATH);

  const lines = ["APDT uninstall", `Project: ${root}`];
  if (skipped.length > 0) {
    lines.push("", "Skipped unsafe manifest paths:");
    lines.push(...skipped.map((path) => `  ! ${path}`));
  }

  if (!options.yes && !options.dryRun) {
    lines.push("", "Refusing to remove files without --yes.");
    return finish(2, lines, { ...empty(), kept: keep });
  }

  const removed = [...remove, ...extras].sort();
  const rewritten = rewrite.map((item) => item.path);

  if (options.dryRun) {
    lines.push(
      "",
      `Would remove (${removed.length}):`,
      ...removed.map((path) => `  - ${path}`),
      `Would rewrite (${rewritten.length}):`,
      ...rewritten.map((path) => `  ~ ${path}`),
      `Would keep (${keep.length}):`,
      ...keep.map((path) => `  = ${path}`),
      "",
      "Dry run. No files changed.",
    );
    return finish(0, lines, { removed, kept: keep, rewritten, backedUp: [] });
  }

  const stamp = (options.now ?? new Date().toISOString()).replace(/[:.]/g, "-");
  const backedUp: string[] = [];
  const errors: string[] = [];

  const backupAnd = (rel: string, write: () => void): boolean => {
    const abs = join(root, rel);
    try {
      if (pathExists(abs)) {
        copyPath(abs, join(root, BACKUP_ROOT, stamp, rel));
        backedUp.push(rel);
      }
      write();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${rel}: ${message}`);
      return false;
    }
  };

  let applyOk = true;
  for (const rel of remove) {
    if (!backupAnd(rel, () => removeFile(join(root, rel)))) {
      applyOk = false;
      break;
    }
  }
  if (applyOk) {
    for (const item of rewrite) {
      if (!backupAnd(item.path, () => writeText(join(root, item.path), item.text))) {
        applyOk = false;
        break;
      }
    }
  }
  if (applyOk) {
    for (const rel of extras) {
      if (!backupAnd(rel, () => removeFile(join(root, rel)))) {
        applyOk = false;
        break;
      }
    }
  }

  if (applyOk) {
    for (const dir of [join(root, "apdt"), join(root, ".cursor"), join(root, ".claude"), join(root, ".agents"), join(root, ".codex")]) {
      pruneEmptyDirs(dir);
    }
  }

  lines.push(
    "",
    `Removed (${errors.length === 0 ? removed.length : remove.length}):`,
    ...(errors.length === 0 ? removed : remove).map((path) => `  - ${path}`),
    `Rewritten (${rewritten.length}):`,
    ...rewritten.map((path) => `  ~ ${path} [stripped usage-guard hooks]`),
    `Kept (${keep.length}):`,
    ...keep.map((path) => `  = ${path}`),
  );
  if (backedUp.length > 0) {
    lines.push("", `Backup: ${BACKUP_ROOT}/${stamp}/`);
  }
  if (!applyOk) {
    lines.push("", "Errors:", ...errors.map((error) => `  ! ${error}`));
    lines.push("The manifest was left in place.");
    return finish(1, lines, { removed: remove, kept: keep, rewritten, backedUp });
  }
  return finish(0, lines, { removed, kept: keep, rewritten, backedUp });
}

function empty(): Pick<UninstallResult, "removed" | "kept" | "rewritten" | "backedUp"> {
  return { removed: [], kept: [], rewritten: [], backedUp: [] };
}

function finish(
  exitCode: number,
  lines: string[],
  body: Pick<UninstallResult, "removed" | "kept" | "rewritten" | "backedUp">,
): UninstallResult {
  return { exitCode, report: lines.join("\n"), ...body };
}
