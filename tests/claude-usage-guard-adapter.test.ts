import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { initProject } from "../src/init/init.js";
import { updateProject } from "../src/update/update.js";
import { doctor } from "../src/doctor/doctor.js";
import { loadOrganization } from "../src/organization/load.js";
import { claudeCodeAdapter } from "../src/adapters/claude.js";
import { analyzeProject } from "../src/analyzer/analyze.js";
import { workspaceTempDir } from "./helpers.js";
import { spawnSync } from "node:child_process";
import { templatesRoot } from "../src/paths.js";

function tempDir(): string {
  return workspaceTempDir();
}

function setUsageGuard(
  root: string,
  opts: { enabled: boolean; pauseAtPercent?: number },
) {
  const teamPath = join(root, "apdt/organization/team.yaml");
  const team = YAML.parse(readFileSync(teamPath, "utf8")) as {
    harnesses: Record<string, unknown>;
  };
  team.harnesses.claudeCode = {
    usageGuard: {
      enabled: opts.enabled,
      pauseAtPercent: opts.pauseAtPercent ?? 90,
    },
  };
  writeFileSync(teamPath, YAML.stringify(team));
}

describe("claude usage guard adapter", () => {
  it("emits hooks and settings by default when Claude Code is enabled", () => {
    const root = tempDir();
    initProject(root, {
      yes: true,
      createdAt: "2026-11-25T00:00:00.000Z",
      projectName: "guard-default-on",
      harnesses: ["claude-code"],
    });
    expect(existsSync(join(root, ".claude/hooks/apdt-usage-guard/guard.mjs"))).toBe(
      true,
    );
    expect(existsSync(join(root, ".claude/settings.json"))).toBe(true);
    const team = YAML.parse(
      readFileSync(join(root, "apdt/organization/team.yaml"), "utf8"),
    ) as { harnesses: { claudeCode?: { usageGuard?: { enabled?: boolean } } } };
    expect(team.harnesses.claudeCode?.usageGuard?.enabled).toBe(true);
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toContain(
      "Usage guard is **on**",
    );
    expect(doctor(root).exitCode).toBe(0);
  });

  it("does not emit hooks or settings when usageGuard is explicitly off", () => {
    const root = tempDir();
    initProject(root, {
      yes: true,
      createdAt: "2026-11-25T00:00:00.000Z",
      projectName: "guard-off",
      harnesses: ["claude-code"],
    });
    setUsageGuard(root, { enabled: false });
    const updated = updateProject(root, {});
    expect(updated.ok).toBe(true);
    expect(existsSync(join(root, ".claude/settings.json"))).toBe(false);
    expect(existsSync(join(root, ".claude/hooks/apdt-usage-guard/guard.mjs"))).toBe(
      false,
    );
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toContain(
      "Usage guard is **off**",
    );
  });

  it("emits hook pack with custom pauseAtPercent", () => {
    const root = tempDir();
    initProject(root, {
      yes: true,
      createdAt: "2026-11-25T00:00:00.000Z",
      projectName: "guard-on",
      harnesses: ["claude-code"],
    });
    setUsageGuard(root, { enabled: true, pauseAtPercent: 90 });
    const updated = updateProject(root, {});
    expect(updated.ok).toBe(true);
    const config = JSON.parse(
      readFileSync(join(root, ".claude/hooks/apdt-usage-guard/config.json"), "utf8"),
    );
    expect(config.pauseAtPercent).toBe(90);
    const settings = JSON.parse(
      readFileSync(join(root, ".claude/settings.json"), "utf8"),
    );
    expect(settings.autoContinueAtUsageLimit).toBe(true);
    expect(settings.hooks.PreToolUse[0].matcher).toBeUndefined();
    expect(settings.hooks.PreToolUse[0].hooks[0].command).toContain(" gate");
    expect(settings.statusLine.command).toContain(" record");
    expect(settings.statusLine.refreshInterval).toBe(30);
  });

  it("skips unmanaged settings.json and doctor warns", () => {
    const root = tempDir();
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(
      join(root, ".claude/settings.json"),
      JSON.stringify({ permissions: { allow: ["Bash"] } }, null, 2),
    );
    initProject(root, {
      yes: true,
      createdAt: "2026-11-25T00:00:00.000Z",
      projectName: "guard-collision",
      harnesses: ["claude-code"],
    });
    expect(
      readFileSync(join(root, ".claude/settings.json"), "utf8"),
    ).toContain("permissions");
    expect(existsSync(join(root, ".claude/hooks/apdt-usage-guard/guard.mjs"))).toBe(
      true,
    );
    const d = doctor(root);
    expect(
      d.findings.some((f) => f.code === "USAGE_GUARD_SETTINGS_INCOMPLETE"),
    ).toBe(true);
  });

  it("preserves custom pauseAtPercent across harness-list update override", () => {
    const root = tempDir();
    initProject(root, {
      yes: true,
      createdAt: "2026-11-25T00:00:00.000Z",
      projectName: "guard-preserve",
      harnesses: ["claude-code"],
    });
    setUsageGuard(root, { enabled: true, pauseAtPercent: 92 });
    updateProject(root, { harnesses: ["claude-code", "cursor"] });
    const loaded = loadOrganization(root);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.organization.harnesses.claudeCode?.usageGuard?.enabled).toBe(
      true,
    );
    expect(loaded.organization.harnesses.claudeCode?.usageGuard?.pauseAtPercent).toBe(
      92,
    );
  });

  it("plans no guard files when org disables the feature", () => {
    const root = tempDir();
    initProject(root, {
      yes: true,
      createdAt: "2026-11-25T00:00:00.000Z",
      projectName: "guard-plan",
      harnesses: ["claude-code"],
    });
    setUsageGuard(root, { enabled: false });
    const loaded = loadOrganization(root);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const planned = claudeCodeAdapter.plan({
      repoRoot: root,
      analysis: analyzeProject(root),
      organization: loaded.organization,
    });
    expect(planned.some((f) => f.path === ".claude/settings.json")).toBe(false);
  });

  it("turns the guard on for an existing Claude install with one update", () => {
    const root = tempDir();
    initProject(root, {
      yes: true,
      createdAt: "2026-11-25T00:00:00.000Z",
      projectName: "guard-upgrade",
      harnesses: ["claude-code"],
    });
    // Simulate a pre-0.1.4 install: no claudeCode block, no hooks.
    const teamPath = join(root, "apdt/organization/team.yaml");
    const team = YAML.parse(readFileSync(teamPath, "utf8")) as {
      harnesses: Record<string, unknown>;
    };
    delete team.harnesses.claudeCode;
    writeFileSync(teamPath, YAML.stringify(team));
    unlinkSync(join(root, ".claude/settings.json"));
    rmSync(join(root, ".claude/hooks"), { recursive: true, force: true });

    // team.yaml was edited out of band; force so the default-on block is written back.
    const updated = updateProject(root, { force: true });
    expect(updated.ok).toBe(true);
    expect(existsSync(join(root, ".claude/settings.json"))).toBe(true);
    expect(existsSync(join(root, ".claude/hooks/apdt-usage-guard/guard.mjs"))).toBe(
      true,
    );
    const reloaded = loadOrganization(root);
    expect(reloaded.ok && reloaded.organization.harnesses.claudeCode?.usageGuard?.enabled).toBe(
      true,
    );
  });
});

describe("claude usage guard script", () => {
  it("gate denies when fixture usage is over threshold", () => {
    const root = tempDir();
    const fixture = join(root, "usage.json");
    writeFileSync(
      fixture,
      JSON.stringify({
        five_hour: { utilization: 93, resets_at: "2026-11-25T20:00:00Z" },
        seven_day: { utilization: 10, resets_at: "2026-12-01T00:00:00Z" },
      }),
    );
    const configDir = join(root, "hook");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({ pauseAtPercent: 90 }),
    );
    const guardSrc = readFileSync(
      join(templatesRoot(), "claude/usage-guard/guard.mjs"),
      "utf8",
    );
    const guardPath = join(configDir, "guard.mjs");
    writeFileSync(guardPath, guardSrc);

    const result = spawnSync(process.execPath, [guardPath, "gate"], {
      input: "{}",
      encoding: "utf8",
      env: {
        ...process.env,
        APDT_USAGE_GUARD_FIXTURE: fixture,
        CLAUDE_PROJECT_DIR: root,
      },
    });
    expect(result.status).toBe(0);
    const out = JSON.parse(result.stdout || "{}");
    expect(out.continue).toBe(false);
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("gate allows when fixture usage is under threshold", () => {
    const root = tempDir();
    const fixture = join(root, "usage.json");
    writeFileSync(
      fixture,
      JSON.stringify({
        five_hour: { utilization: 20, resets_at: "2026-11-25T20:00:00Z" },
      }),
    );
    const configDir = join(root, "hook");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({ pauseAtPercent: 90 }),
    );
    const guardSrc = readFileSync(
      join(templatesRoot(), "claude/usage-guard/guard.mjs"),
      "utf8",
    );
    const guardPath = join(configDir, "guard.mjs");
    writeFileSync(guardPath, guardSrc);

    const result = spawnSync(process.execPath, [guardPath, "gate"], {
      input: "{}",
      encoding: "utf8",
      env: {
        ...process.env,
        APDT_USAGE_GUARD_FIXTURE: fixture,
        CLAUDE_PROJECT_DIR: root,
      },
    });
    expect(result.status).toBe(0);
    expect(result.stdout || "").toBe("");
  });

  it("prompt blocks with exit 2 when over threshold", () => {
    const root = tempDir();
    const fixture = join(root, "usage.json");
    writeFileSync(
      fixture,
      JSON.stringify({
        five_hour: { utilization: 95, resets_at: "2026-11-25T20:00:00Z" },
      }),
    );
    const configDir = join(root, "hook");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({ pauseAtPercent: 90 }),
    );
    writeFileSync(
      join(configDir, "guard.mjs"),
      readFileSync(join(templatesRoot(), "claude/usage-guard/guard.mjs"), "utf8"),
    );

    const result = spawnSync(
      process.execPath,
      [join(configDir, "guard.mjs"), "prompt"],
      {
        input: "{}",
        encoding: "utf8",
        env: {
          ...process.env,
          APDT_USAGE_GUARD_FIXTURE: fixture,
          CLAUDE_PROJECT_DIR: root,
        },
      },
    );
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout).continue).toBe(false);
  });

  it("records status-line usage and the next gate pauses", () => {
    const root = tempDir();
    const configDir = join(root, "hook");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({ pauseAtPercent: 90 }),
    );
    const guardPath = join(configDir, "guard.mjs");
    writeFileSync(
      guardPath,
      readFileSync(join(templatesRoot(), "claude/usage-guard/guard.mjs"), "utf8"),
    );
    const env = {
      ...process.env,
      CLAUDE_PROJECT_DIR: root,
    };
    delete env.APDT_USAGE_GUARD_FIXTURE;
    const recorded = spawnSync(process.execPath, [guardPath, "record"], {
      input: JSON.stringify({
        rate_limits: {
          five_hour: { used_percentage: 91, resets_at: 1732536000 },
          seven_day: { used_percentage: 76, resets_at: 1733000000 },
        },
      }),
      encoding: "utf8",
      env,
    });
    expect(recorded.status).toBe(0);
    expect(recorded.stdout).toContain("91%");

    const gate = spawnSync(process.execPath, [guardPath, "gate"], {
      input: "{}",
      encoding: "utf8",
      env,
    });
    expect(gate.status).toBe(0);
    expect(JSON.parse(gate.stdout).continue).toBe(false);
  });
});
