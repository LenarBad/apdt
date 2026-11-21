import YAML from "yaml";
import type { HarnessId, ProjectAnalysis } from "../schemas/analysis.js";
import type { OrganizationConfig } from "../schemas/organization.js";
import type { PlannedFile } from "../schemas/plan.js";
import { TEMPLATE_VERSION } from "../version.js";

function harnessLabel(id: HarnessId): string {
  if (id === "cursor") return "Cursor";
  if (id === "claude-code") return "Claude Code";
  return "Codex";
}

function capabilityDigest(org: OrganizationConfig): string {
  const lines = [
    "- Approval gates in `apdt/organization/autonomy.yaml` are **advisory** unless you configure harness-native approvals.",
    "- Parallel subagent execution is a **runtime** harness capability, not enforced by APDT files.",
    "- Shared skills are installed under `.agents/skills/`.",
  ];
  if (org.harnesses.enabled.includes("cursor")) {
    lines.push(
      "- Cursor: per-agent tool allowlists are **Unavailable**. Constraints live in the agent prompt.",
    );
  }
  if (org.harnesses.enabled.includes("claude-code")) {
    lines.push(
      "- Claude Code: per-agent `tools` and `permissionMode` are **Native**. Skills are mirrored under `.claude/skills/`. APDT does not write `.claude/settings.json`.",
    );
  }
  if (org.harnesses.enabled.includes("codex")) {
    lines.push(
      "- Codex: agents are **Native** TOML under `.codex/agents/`. Per-agent tool allowlists are **Partial** (prompt constraints). APDT does not write `.codex/config.toml`. Keep `AGENTS.md` under 32 KiB.",
    );
  }
  return lines.join("\n");
}

function file(
  path: string,
  content: string,
  templateId: string,
): PlannedFile {
  return {
    path,
    content: content.endsWith("\n") ? content : `${content}\n`,
    kind: "create",
    managed: true,
    templateId,
  };
}

export function planKnowledgeFiles(
  analysis: ProjectAnalysis,
  org: OrganizationConfig,
): PlannedFile[] {
  const maturity = analysis.maturity;
  // Phase 2: greenfield/early share core allowlist (ADR 003 D12)
  const core = true;
  void maturity;
  void core;

  const teamYaml = {
    version: org.version,
    projectName: org.projectName,
    harnesses: org.harnesses,
    preset: org.preset,
    team: org.team,
  };

  const autonomyYaml = {
    version: org.version,
    level: org.autonomy.level,
    gates: org.autonomy.gates,
    notes:
      "Approval gates are advisory unless mapped into harness-native settings. APDT does not enforce them at runtime.",
  };

  const responsibilitiesYaml = {
    version: org.version,
    responsibilities: org.responsibilities,
  };

  const overview = `# ${org.projectName}

## Summary

APDT-managed project. Maturity: **${analysis.maturity}**. Recommended preset: **${org.preset}**.

## Stack

- Languages: ${analysis.stack.languages.join(", ") || "n/a"}
- Frameworks: ${analysis.stack.frameworks.join(", ") || "n/a"}
- Package managers: ${analysis.stack.packageManagers.join(", ") || "n/a"}

## Team

${org.team.agents.map((a) => `- **${a.displayName}** (\`${a.id}\`): ${a.mission}`).join("\n")}

## Autonomy

Level: **${org.autonomy.level}** (gates are advisory unless enforced by the harness).

## Source of truth

Persistent knowledge lives under \`apdt/\`. Sessions are disposable; update files when meaningful work happens.
`;

  const status = `# Current Status

**Updated:** ${analysis.analyzedAt.slice(0, 10)}  
**Maturity:** ${analysis.maturity}  
**Preset:** ${org.preset}

## Summary

Initialized by APDT. Next: open the project in your harness, read \`AGENTS.md\`, and run the \`session-start\` skill.

## Active

- (none yet)

## Next

1. Run \`/session-start\` (or \`$session-start\` / harness equivalent)
2. Confirm product overview and fill gaps
3. Plan the first increment
`;

  const continuity = `# Continuity

Resume from files only. Do not assume subagents are still running.

Read apdt/product/overview.md, apdt/organization/, apdt/execution/current-status.md, the latest handoff, and apdt/execution/blockers.md when that file exists.

Handoffs live in apdt/sessions/handoffs/<date>-<slug>.md.

Decisions are written under apdt/engineering/technical-decisions/ only when a decision is made.

Do not create empty backlog.md or blockers.md.

Evaluations live under apdt/product/evaluations/. They stay untriaged until plan-improvements adds a \`## Triage\` section with \`Status: triaged\`.
`;

  const onboarding = `# APDT Onboarding

## Installed

- Harnesses: ${org.harnesses.enabled.map(harnessLabel).join(", ")} (primary: ${harnessLabel(org.harnesses.primary)})
- Team: ${org.team.agents.length} agents (${org.preset} preset)
- Autonomy: ${org.autonomy.level}

## Next steps

1. Open this repository in **${harnessLabel(org.harnesses.primary)}**
2. Read \`AGENTS.md\` (points at shared \`apdt/\` knowledge)
3. Run skill **\`session-start\`**
4. Before ending work, run **\`session-handoff\`**

## Capability digest

${capabilityDigest(org)}

## Template version

${TEMPLATE_VERSION}
`;

  return [
    file(
      "apdt/organization/team.yaml",
      YAML.stringify(teamYaml),
      "organization/team",
    ),
    file(
      "apdt/organization/responsibilities.yaml",
      YAML.stringify(responsibilitiesYaml),
      "organization/responsibilities",
    ),
    file(
      "apdt/organization/autonomy.yaml",
      YAML.stringify(autonomyYaml),
      "organization/autonomy",
    ),
    file("apdt/product/overview.md", overview, "product/overview"),
    file("apdt/execution/current-status.md", status, "execution/current-status"),
    file("apdt/execution/continuity.md", continuity, "execution/continuity"),
    file("apdt/sessions/handoffs/.gitkeep", "", "sessions/handoffs-gitkeep"),
    file("apdt/ONBOARDING.md", onboarding, "onboarding"),
  ];
}
