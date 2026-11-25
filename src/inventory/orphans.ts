import type { Manifest, ManifestEntry } from "../schemas/manifest.js";

/**
 * Paths APDT may delete on recompose/update when no longer planned.
 * Knowledge, entrypoints, shared skills, and pinContent entries are never orphans.
 */
export function isEligibleOrphan(entry: ManifestEntry): boolean {
  if (entry.pinContent) return false;
  const p = entry.path;
  if (p === "AGENTS.md" || p === "CLAUDE.md") return false;
  if (p === "apdt" || p.startsWith("apdt/")) return false;
  if (p.startsWith(".agents/skills/")) return false;
  return (
    p.startsWith(".cursor/agents/") ||
    p.startsWith(".claude/agents/") ||
    p.startsWith(".codex/agents/") ||
    p.startsWith(".claude/skills/") ||
    p === ".claude/settings.json" ||
    p.startsWith(".claude/hooks/apdt-usage-guard/")
  );
}

/** Prior managed paths not in the new plan that are safe to remove. */
export function findOrphanEntries(
  previous: Manifest | null,
  plannedPaths: ReadonlySet<string>,
): ManifestEntry[] {
  if (!previous) return [];
  return previous.files.filter(
    (entry) => !plannedPaths.has(entry.path) && isEligibleOrphan(entry),
  );
}
