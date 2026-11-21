import type { FileDecision } from "../inventory/manifest.js";
import type { PlannedFile } from "../schemas/plan.js";

function groupOf(path: string): "core" | "knowledge" | "skills" | "harness" {
  if (path === "AGENTS.md") return "core";
  if (path.startsWith("apdt/")) return "knowledge";
  if (path.startsWith(".agents/skills/")) return "skills";
  return "harness";
}

const GROUP_LABEL: Record<ReturnType<typeof groupOf>, string> = {
  core: "Core",
  knowledge: "Shared knowledge (apdt/**)",
  skills: "Shared skills (.agents/skills/**)",
  harness: "Harness files",
};

export function formatPlanPreview(
  files: PlannedFile[],
  decisions: FileDecision[],
): string {
  const byPath = new Map(decisions.map((d) => [d.planned.path, d]));
  const lines: string[] = [];

  for (const group of ["core", "knowledge", "skills", "harness"] as const) {
    const members = files
      .filter((f) => groupOf(f.path) === group)
      .sort((a, b) => a.path.localeCompare(b.path));
    const writes = members.filter((f) => byPath.get(f.path)?.action === "write");
    if (!writes.length) continue;
    lines.push(GROUP_LABEL[group]);
    for (const file of writes) {
      const decision = byPath.get(file.path);
      const kind = decision?.action === "write" ? decision.planned.kind : "create";
      lines.push(`  + ${file.path} (${kind})`);
    }
    lines.push("");
  }

  const skips = decisions
    .filter((d) => d.action === "skip")
    .sort((a, b) => a.planned.path.localeCompare(b.planned.path));
  lines.push("Skips");
  if (!skips.length) {
    lines.push("  (none)");
  } else {
    for (const skip of skips) {
      lines.push(`  ~ ${skip.planned.path} [${skip.code}] ${skip.reason}`);
    }
  }

  return lines.join("\n").trimEnd();
}
