import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { OrganizationConfig } from "../schemas/organization.js";
import {
  claudeUsageGuardPauseAt,
  isClaudeUsageGuardEnabled,
} from "../schemas/organization.js";
import type { PlannedFile } from "../schemas/plan.js";
import { templatesRoot } from "../paths.js";

/** Resolve usage-guard template directory. */
export function usageGuardTemplateDir(): string {
  return join(templatesRoot(), "claude/usage-guard");
}

export function usageGuardHookCommand(subcommand: string): string {
  return `node "\${CLAUDE_PROJECT_DIR}/.claude/hooks/apdt-usage-guard/guard.mjs" ${subcommand}`;
}

export function buildUsageGuardSettings(): Record<string, unknown> {
  const cmd = (sub: string) => ({
    type: "command",
    command: usageGuardHookCommand(sub),
  });
  return {
    autoContinueAtUsageLimit: true,
    hooks: {
      PreToolUse: [
        {
          matcher: "Agent|Task|Workflow",
          hooks: [cmd("gate")],
        },
      ],
      UserPromptSubmit: [
        {
          hooks: [cmd("prompt")],
        },
      ],
      Stop: [
        {
          hooks: [{ ...cmd("resume"), asyncRewake: true }],
        },
      ],
      StopFailure: [
        {
          matcher: "rate_limit",
          hooks: [{ ...cmd("resume"), asyncRewake: true }],
        },
      ],
    },
  };
}

function planned(
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

/** Planned files for the usage guard when opted in; empty when disabled. */
export function planUsageGuardFiles(org: OrganizationConfig): PlannedFile[] {
  if (!isClaudeUsageGuardEnabled(org)) return [];
  if (!org.harnesses.enabled.includes("claude-code")) return [];

  const pauseAtPercent = claudeUsageGuardPauseAt(org);
  const templateDir = usageGuardTemplateDir();
  const guardSrc = readFileSync(join(templateDir, "guard.mjs"), "utf8");
  const config = JSON.stringify({ pauseAtPercent }, null, 2);
  const settings = JSON.stringify(buildUsageGuardSettings(), null, 2);
  const readme = `# APDT Claude usage guard

Opt-in Claude Code hooks that pause work and block Agent/Task/Workflow spawning
when plan usage reaches ${pauseAtPercent}% (5-hour or weekly window).

- Config: \`config.json\` (\`pauseAtPercent\`)
- Requires a Claude.ai subscription OAuth login (not API-key-only)
- Fail-open if usage cannot be read
- Managed by APDT when \`harnesses.claudeCode.usageGuard.enabled\` is true
`;

  return [
    planned(
      ".claude/hooks/apdt-usage-guard/guard.mjs",
      guardSrc,
      "claude/usage-guard/guard",
    ),
    planned(
      ".claude/hooks/apdt-usage-guard/config.json",
      config,
      "claude/usage-guard/config",
    ),
    planned(
      ".claude/hooks/apdt-usage-guard/README.md",
      readme,
      "claude/usage-guard/readme",
    ),
    planned(
      ".claude/settings.json",
      settings,
      "claude/usage-guard/settings",
    ),
  ];
}
