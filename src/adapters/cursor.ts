import { existsSync } from "node:fs";
import { join } from "node:path";
import type { HarnessAdapter } from "./types.js";
import type { CapabilityReport, DoctorFinding, PlannedFile } from "../schemas/plan.js";
import type { OrganizationConfig } from "../schemas/organization.js";

function agentMarkdown(org: OrganizationConfig, agentId: string): string {
  const agent = org.team.agents.find((a) => a.id === agentId);
  if (!agent) throw new Error(`Missing agent ${agentId}`);
  const readonly = agent.readonly ? "\nreadonly: true" : "";
  return `---
name: ${agent.id}
description: ${agent.displayName} — ${agent.mission.slice(0, 160)}
model: inherit${readonly}
---

# ${agent.displayName}

## Mission

${agent.mission}

## Role

${agent.role}

## Responsibilities

${agent.responsibilities.map((r) => `- ${r}`).join("\n")}

## Collaboration

- Product owner agent: \`${org.team.coordination.productOwnerAgentId}\`
- Engineering lead agent: \`${org.team.coordination.engineeringLeadAgentId}\`
- Evaluator agent: \`${org.team.coordination.evaluatorAgentId}\`

## Protocols

1. Read \`apdt/execution/current-status.md\` and latest handoff before starting.
2. Update persistent \`apdt/\` knowledge when meaningful changes occur.
3. Escalate per \`apdt/organization/autonomy.yaml\` for gated operations.
4. Do not assume sibling subagents survive session end.

## Quality

Differentiate verified facts from assumptions. Keep changes scoped to acceptance criteria.
`;
}

function alwaysApplyRule(): string {
  return `---
description: APDT organization pointer
alwaysApply: true
---

# APDT

This project uses APDT. Follow \`AGENTS.md\` and the shared knowledge under \`apdt/\`.

Before substantive work, run the \`session-start\` skill. Before ending, run \`session-handoff\`.

Autonomy gates in \`apdt/organization/autonomy.yaml\` are advisory unless harness approvals are configured.
`;
}

export const cursorAdapter: HarnessAdapter = {
  id: "cursor",
  displayName: "Cursor",
  version: "0.1.0",

  capabilities(): CapabilityReport[] {
    return [
      {
        capability: "project-rules",
        support: "native",
        notes: ".cursor/rules/*.mdc",
      },
      {
        capability: "subagents",
        support: "native",
        notes: ".cursor/agents/*.md; tools inherited from parent",
      },
      {
        capability: "per-agent-tool-allowlist",
        support: "unavailable",
        notes: "Encode constraints in agent prompt; not a Cursor frontmatter field",
      },
      {
        capability: "skills",
        support: "native",
        notes: "Uses shared .agents/skills",
      },
      {
        capability: "approvals",
        support: "partial",
        notes: "Runtime Run Modes; APDT gates are advisory",
      },
      {
        capability: "parallel-delegation",
        support: "runtime",
      },
    ];
  },

  detect(repoRoot: string) {
    const paths = [".cursor"].filter((p) => existsSync(join(repoRoot, p)));
    return { present: paths.length > 0, paths };
  },

  plan(ctx): PlannedFile[] {
    const files: PlannedFile[] = [
      {
        path: ".cursor/rules/apdt.mdc",
        content: alwaysApplyRule(),
        kind: "create",
        managed: true,
        templateId: "cursor/rule-apdt",
      },
    ];
    for (const agent of ctx.organization.team.agents) {
      files.push({
        path: `.cursor/agents/${agent.id}.md`,
        content: agentMarkdown(ctx.organization, agent.id),
        kind: "create",
        managed: true,
        templateId: `cursor/agent/${agent.id}`,
      });
    }
    return files;
  },

  validate(repoRoot: string): DoctorFinding[] {
    const findings: DoctorFinding[] = [];
    const rule = join(repoRoot, ".cursor/rules/apdt.mdc");
    if (!existsSync(rule)) {
      findings.push({
        severity: "error",
        code: "MISSING_CURSOR_RULE",
        message: "Missing Cursor APDT rule",
        path: ".cursor/rules/apdt.mdc",
      });
    }
    return findings;
  },
};
