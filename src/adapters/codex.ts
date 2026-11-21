import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { HarnessAdapter } from "./types.js";
import type { CapabilityReport, DoctorFinding, PlannedFile } from "../schemas/plan.js";
import type { OrganizationConfig } from "../schemas/organization.js";

/** Codex default combined project-doc budget (`project_doc_max_bytes`). */
export const CODEX_AGENTS_MD_BUDGET_BYTES = 32 * 1024;

function tomlEscapeBasic(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

function tomlMultilineBasic(value: string): string {
  // Prefer """ ... """ ; if the body contains """, fall back to escaped basic string.
  if (value.includes('"""')) {
    return `"${tomlEscapeBasic(value)}"`;
  }
  const normalized = value.endsWith("\n") ? value : `${value}\n`;
  return `"""\n${normalized}"""`;
}

function agentToml(org: OrganizationConfig, agentId: string): string {
  const agent = org.team.agents.find((a) => a.id === agentId);
  if (!agent) throw new Error(`Missing agent ${agentId}`);

  const description = `${agent.displayName} — ${agent.mission}`
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);

  const readonlyNote = agent.readonly
    ? [
        "",
        "## Tool constraints",
        "",
        "This agent is **readonly**. Do not edit, write, or run mutating shell commands. Prefer read/search tools only.",
      ].join("\n")
    : "";

  const instructions = `# ${agent.displayName}

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

1. Read \`AGENTS.md\`, then \`apdt/execution/current-status.md\` and the latest handoff.
2. Update persistent \`apdt/\` knowledge when meaningful changes occur (unless readonly).
3. Escalate per \`apdt/organization/autonomy.yaml\`. Codex custom agents inherit parent sandbox/approvals and cannot override them.
4. Do not assume sibling subagents survive session end.

## Quality

Differentiate verified facts from assumptions. Keep changes scoped to acceptance criteria.${readonlyNote}
`;

  return `name = "${tomlEscapeBasic(agent.id)}"
description = "${tomlEscapeBasic(description)}"
developer_instructions = ${tomlMultilineBasic(instructions)}
`;
}

export const codexAdapter: HarnessAdapter = {
  id: "codex",
  displayName: "OpenAI Codex",
  version: "0.1.0",

  capabilities(): CapabilityReport[] {
    return [
      {
        capability: "instructions",
        support: "native",
        notes: "Thin core AGENTS.md; doctor enforces 32 KiB combined project-doc budget",
      },
      {
        capability: "subagents",
        support: "native",
        notes: ".codex/agents/*.toml (name, description, developer_instructions)",
      },
      {
        capability: "per-agent-tool-allowlist",
        support: "partial",
        notes: "Feature disable only; APDT encodes readonly constraints in developer_instructions",
      },
      {
        capability: "skills",
        support: "native",
        notes: "Uses shared .agents/skills (Codex also discovers .codex/skills; APDT does not duplicate)",
      },
      {
        capability: "approvals",
        support: "partial",
        notes: "APDT does not write .codex/config.toml; approval_policy stays user/runtime-owned",
      },
      {
        capability: "parallel-delegation",
        support: "runtime",
      },
    ];
  },

  detect(repoRoot: string) {
    const paths = [".codex"].filter((p) => existsSync(join(repoRoot, p)));
    return { present: paths.length > 0, paths };
  },

  plan(ctx): PlannedFile[] {
    const files: PlannedFile[] = [];
    for (const agent of ctx.organization.team.agents) {
      files.push({
        path: `.codex/agents/${agent.id}.toml`,
        content: agentToml(ctx.organization, agent.id),
        kind: "create",
        managed: true,
        templateId: `codex/agent/${agent.id}`,
      });
    }
    return files;
  },

  validate(repoRoot: string): DoctorFinding[] {
    const findings: DoctorFinding[] = [];
    const agentsDir = join(repoRoot, ".codex/agents");
    if (!existsSync(agentsDir)) {
      findings.push({
        severity: "error",
        code: "MISSING_CODEX_AGENTS",
        message: "Missing Codex agents directory",
        path: ".codex/agents",
      });
    } else {
      try {
        const entries = readdirSync(agentsDir);
        if (!entries.some((e) => e.endsWith(".toml"))) {
          findings.push({
            severity: "error",
            code: "MISSING_CODEX_AGENTS",
            message: "No Codex agent TOML files found",
            path: ".codex/agents",
          });
        }
      } catch {
        findings.push({
          severity: "error",
          code: "MISSING_CODEX_AGENTS",
          message: "Cannot read Codex agents directory",
          path: ".codex/agents",
        });
      }
    }

    const agentsMdPath = join(repoRoot, "AGENTS.md");
    if (existsSync(agentsMdPath)) {
      const bytes = Buffer.byteLength(readFileSync(agentsMdPath, "utf8"), "utf8");
      if (bytes > CODEX_AGENTS_MD_BUDGET_BYTES) {
        findings.push({
          severity: "error",
          code: "CODEX_AGENTS_MD_BUDGET",
          message: `AGENTS.md is ${bytes} bytes; Codex default combined project-doc budget is ${CODEX_AGENTS_MD_BUDGET_BYTES}`,
          path: "AGENTS.md",
        });
      }
    }

    if (existsSync(join(repoRoot, ".codex/config.toml"))) {
      findings.push({
        severity: "info",
        code: "CODEX_CONFIG_PRESENT",
        message:
          "Found .codex/config.toml (unmanaged by APDT). Loaded only when the project is trusted; APDT does not write approval_policy.",
        path: ".codex/config.toml",
      });
    }

    return findings;
  },
};
