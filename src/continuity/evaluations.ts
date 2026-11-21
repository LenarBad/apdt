import { readdirSync } from "node:fs";
import { join } from "node:path";
import { isDir, pathExists, readText } from "../fsutil.js";

const TRIAGED_STATUS_LINE =
  /^\s*(?:\*\*Status:\*\*|Status:)\s*triaged\s*$/i;

/**
 * Markdown evaluation basenames under `apdt/product/evaluations/`.
 * Ignores `.gitkeep` and non-markdown. Sorted lexicographically.
 */
export function listEvaluationBasenames(repoRoot: string): string[] {
  const dir = join(repoRoot, "apdt/product/evaluations");
  if (!isDir(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name !== ".gitkeep" &&
          entry.name.endsWith(".md"),
      )
      .map((entry) => entry.name)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  } catch {
    return [];
  }
}

/**
 * True iff markdown has a `## Triage` section whose body includes a line
 * matching `**Status:** triaged` or `Status: triaged` (case-insensitive).
 */
export function isEvaluationTriaged(markdown: string): boolean {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => /^## Triage\s*$/.test(line));
  if (start < 0) return false;
  for (const line of lines.slice(start + 1)) {
    if (/^##\s+/.test(line)) break;
    if (TRIAGED_STATUS_LINE.test(line)) return true;
  }
  return false;
}

/** Basenames of evaluations that are not yet triaged. */
export function untriagedEvaluationBasenames(repoRoot: string): string[] {
  return listEvaluationBasenames(repoRoot).filter((name) => {
    const path = join(repoRoot, "apdt/product/evaluations", name);
    if (!pathExists(path)) return true;
    try {
      return !isEvaluationTriaged(readText(path));
    } catch {
      return true;
    }
  });
}

/** Status line: `Untriaged evaluations: none` or comma-separated basenames. */
export function formatUntriagedEvaluations(repoRoot: string): string {
  const names = untriagedEvaluationBasenames(repoRoot);
  if (names.length === 0) return "Untriaged evaluations: none";
  return `Untriaged evaluations: ${names.join(", ")}`;
}
