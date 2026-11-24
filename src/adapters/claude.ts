import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { HarnessAdapter } from "./types.js";
import type { CapabilityReport, DoctorFinding, PlannedFile } from "../schemas/plan.js";
import type { AutonomyLevel, OrganizationConfig } from "../schemas/organization.js";
import { planSharedSkills } from "../workflows/skills.js";
import { profileContractSection } from "./profile-contract.js";

const CLAUDE_MD_LINE_BUDGET = 200;

function quote(value: string): string {
  return JSON.stringify(value.replace(/\s+/g, " ").trim());
}

function permissionMode(readonly: boolean, level: AutonomyLevel): string {
  if (readonly || level === "conservative") return "plan";
  if (level === "autonomous") return "acceptEdits";
  return "default";
}

function agentMarkdown(org: OrganizationConfig, agentId: string): string {
  const agent = org.team.agents.find((a) => a.id === agentId);
  if (!agent) throw new Error(`Missing agent ${agentId}`);
  const mode = permissionMode(agent.readonly, org.autonomy.level);
  const tools = agent.readonly
    ? "Read, Grep, Glob"
    : "Read, Grep, Glob, Edit, Write, Bash";
  const denied = agent.readonly
    ? "\ndisallowedTools: Edit, Write, Bash, NotebookEdit"
    : "";
  return `---
name: ${agent.id}
description: ${quote(`${agent.displayName} — ${agent.mission}`)}
tools: ${tools}${denied}
permissionMode: ${mode}
---

# ${agent.displayName}

## Mission

${agent.mission}

## Role

${agent.role}

## Responsibilities

${agent.responsibilities.map((r) => `- ${r}`).join("\n")}

${profileContractSection(agent.profileIds)}## Collaboration

- Product owner agent: \`${org.team.coordination.productOwnerAgentId}\`
- Engineering lead agent: \`${org.team.coordination.engineeringLeadAgentId}\`
- Evaluator agent: \`${org.team.coordination.evaluatorAgentId}\`

## Protocols

1. Read \`AGENTS.md\`, then \`apdt/execution/current-status.md\` and the latest handoff.
2. Update persistent \`apdt/\` knowledge when meaningful changes occur.
3. Escalate per \`apdt/organization/autonomy.yaml\`. Those gates are advisory; this file's \`permissionMode\` is the harness mapping.
4. Do not assume sibling subagents survive session end.

## Quality

Differentiate verified facts from assumptions. Keep changes scoped to acceptance criteria.
`;
}

function claudeMd(org: OrganizationConfig): string {
  return `# Claude Code

This repository uses APDT. Follow \`AGENTS.md\`. Product knowledge lives under \`apdt/\` and is the source of truth.

## Start

1. Read \`AGENTS.md\`
2. Read \`apdt/execution/current-status.md\`
3. Run the \`session-start\` skill before substantive work
4. Run \`session-handoff\` before ending

## Team

${org.team.agents.map((a) => `- **${a.id}** — ${a.displayName}`).join("\n")}

Agents: \`.claude/agents/\`. Skills: \`.claude/skills/\` (mirrors of \`.agents/skills/\`).

Autonomy is **${org.autonomy.level}**. Readonly and conservative agents use \`permissionMode: plan\`. APDT does not write \`.claude/settings.json\`.
`;
}

function mirrorSkills(): PlannedFile[] {
  return planSharedSkills().map((file) => ({
    ...file,
    path: file.path.replace(/^\.agents\/skills\//, ".claude/skills/"),
    templateId: file.templateId.replace(/^workflow\//, "claude/skill/"),
  }));
}

export const claudeCodeAdapter: HarnessAdapter = {
  id: "claude-code",
  displayName: "Claude Code",
  version: "0.2.0",

  capabilities(): CapabilityReport[] {
    return [
      {
        capability: "instructions",
        support: "native",
        notes: "Thin CLAUDE.md points at AGENTS.md and apdt/",
      },
      {
        capability: "subagents",
        support: "native",
        notes: ".claude/agents/*.md",
      },
      {
        capability: "per-agent-tool-allowlist",
        support: "native",
        notes: "tools and disallowedTools on each agent",
      },
      {
        capability: "per-agent-permission-mode",
        support: "native",
        notes: "permissionMode from autonomy; readonly and conservative agents use plan. Does not replace Claude's approval UI.",
      },
      {
        capability: "skills",
        support: "native",
        notes: "Mirrored under .claude/skills; canonical copies stay in .agents/skills",
      },
      {
        capability: "approvals",
        support: "partial",
        notes: "APDT does not write .claude/settings.json",
      },
      {
        capability: "worktree-isolation",
        support: "runtime",
        notes: "isolation is not set on generated agents",
      },
      {
        capability: "parallel-delegation",
        support: "runtime",
      },
    ];
  },

  detect(repoRoot: string) {
    const paths = [".claude", "CLAUDE.md"].filter((p) => existsSync(join(repoRoot, p)));
    return { present: paths.length > 0, paths };
  },

  plan(ctx): PlannedFile[] {
    const files: PlannedFile[] = [
      {
        path: "CLAUDE.md",
        content: claudeMd(ctx.organization),
        kind: "create",
        managed: true,
        templateId: "claude/claude-md",
      },
    ];
    for (const agent of ctx.organization.team.agents) {
      files.push({
        path: `.claude/agents/${agent.id}.md`,
        content: agentMarkdown(ctx.organization, agent.id),
        kind: "create",
        managed: true,
        templateId: `claude/agent/${agent.id}`,
      });
    }
    files.push(...mirrorSkills());
    return files;
  },

  validate(repoRoot: string): DoctorFinding[] {
    const findings: DoctorFinding[] = [];
    const claudePath = join(repoRoot, "CLAUDE.md");
    if (!existsSync(claudePath)) {
      findings.push({
        severity: "error",
        code: "MISSING_CLAUDE_MD",
        message: "Missing Claude Code entrypoint",
        path: "CLAUDE.md",
      });
    } else {
      const text = readFileSync(claudePath, "utf8");
      if (!text.includes("apdt/")) {
        findings.push({
          severity: "error",
          code: "BROKEN_POINTER",
          message: "CLAUDE.md does not reference apdt/ knowledge",
          path: "CLAUDE.md",
        });
      }
      const lines = text.split("\n").length;
      if (lines > CLAUDE_MD_LINE_BUDGET) {
        findings.push({
          severity: "warning",
          code: "CLAUDE_MD_LONG",
          message: `CLAUDE.md is ${lines} lines; keep it under ${CLAUDE_MD_LINE_BUDGET}`,
          path: "CLAUDE.md",
        });
      }
    }

    for (const skill of ["session-start", "session-handoff", "evaluate-product"]) {
      const rel = `.claude/skills/${skill}/SKILL.md`;
      if (!existsSync(join(repoRoot, rel))) {
        findings.push({
          severity: "error",
          code: "MISSING_SKILL",
          message: `Missing Claude Code skill mirror: ${skill}`,
          path: rel,
        });
      }
    }
    return findings;
  },
};
