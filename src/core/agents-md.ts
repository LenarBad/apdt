import type { OrganizationConfig } from "../schemas/organization.js";
import type { PlannedFile } from "../schemas/plan.js";

function harnessNotes(org: OrganizationConfig): string {
  const lines = org.harnesses.enabled.map((id) => {
    if (id === "cursor") return "- Cursor agents: `.cursor/agents/`";
    if (id === "claude-code") {
      return "- Claude Code agents: `.claude/agents/`. Skills also mirrored at `.claude/skills/`. Entrypoint: `CLAUDE.md`.";
    }
    return "- Codex agents: `.codex/agents/*.toml`. Skills: shared `.agents/skills/`. APDT does not write `.codex/config.toml`.";
  });
  return lines.join("\n");
}

/** Core-owned thin root AGENTS.md (ADR 003 D2). */
export function planRootAgentsMd(org: OrganizationConfig): PlannedFile {
  const content = `# AGENTS.md

This repository is managed by **APDT** (Autonomous Product Development Team).

## Start here

1. Read \`apdt/product/overview.md\`
2. Read \`apdt/organization/team.yaml\` and \`apdt/organization/responsibilities.yaml\`
3. Read \`apdt/execution/current-status.md\`
4. Read the latest file in \`apdt/sessions/handoffs/\` if present
5. Run the \`session-start\` skill before substantive work
6. Run \`session-handoff\` before ending a session

## Team (summary)

${org.team.agents.map((a) => `- **${a.id}** — ${a.displayName}: ${a.role}`).join("\n")}

## Rules

- Files under \`apdt/\` are the source of truth across sessions.
- Do not assume subagents continue after the parent session ends.
- Respect autonomy gates in \`apdt/organization/autonomy.yaml\` (advisory unless harness-enforced).
- Independent evaluation must not simply accept implementer claims.

## Harness notes

${harnessNotes(org)}
Shared skills live under \`.agents/skills/\`.
`;

  return {
    path: "AGENTS.md",
    content,
    kind: "create",
    managed: true,
    templateId: "core/agents-md",
  };
}
