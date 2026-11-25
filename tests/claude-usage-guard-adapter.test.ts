import {
  existsSync,
  mkdirSync,
  readFileSync,
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

function enableUsageGuard(root: string, pauseAtPercent = 90) {
  const teamPath = join(root, "apdt/organization/team.yaml");
  const team = YAML.parse(readFileSync(teamPath, "utf8")) as {
    harnesses: Record<string, unknown>;
  };
  team.harnesses.claudeCode = {
    usageGuard: { enabled: true, pauseAtPercent },
  };
  writeFileSync(teamPath, YAML.stringify(team));
}

describe("claude usage guard adapter", () => {
  it("does not emit hooks or settings when usageGuard is off", () => {
    const root = tempDir();
    initProject(root, {
      yes: true,
      createdAt: "2026-11-25T00:00:00.000Z",
      projectName: "guard-off",
      harnesses: ["claude-code"],
    });
    expect(existsSync(join(root, ".claude/settings.json"))).toBe(false);
    expect(existsSync(join(root, ".claude/hooks/apdt-usage-guard/guard.mjs"))).toBe(
      false,
    );
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toContain(
      "usageGuard.enabled",
    );
  });

  it("emits hook pack and settings when usageGuard is enabled", () => {
    const root = tempDir();
    initProject(root, {
      yes: true,
      createdAt: "2026-11-25T00:00:00.000Z",
      projectName: "guard-on",
      harnesses: ["claude-code"],
    });
    enableUsageGuard(root, 90);
    const updated = updateProject(root, {});
    expect(updated.ok).toBe(true);
    expect(existsSync(join(root, ".claude/hooks/apdt-usage-guard/guard.mjs"))).toBe(
      true,
    );
    expect(existsSync(join(root, ".claude/hooks/apdt-usage-guard/config.json"))).toBe(
      true,
    );
    const config = JSON.parse(
      readFileSync(join(root, ".claude/hooks/apdt-usage-guard/config.json"), "utf8"),
    );
    expect(config.pauseAtPercent).toBe(90);
    const settings = JSON.parse(
      readFileSync(join(root, ".claude/settings.json"), "utf8"),
    );
    expect(settings.autoContinueAtUsageLimit).toBe(true);
    expect(JSON.stringify(settings.hooks)).toContain("apdt-usage-guard");
    expect(JSON.stringify(settings.hooks)).toContain("Agent|Task|Workflow");
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toContain(
      "usage guard is **on**",
    );
    const d = doctor(root);
    expect(d.findings.some((f) => f.code.startsWith("MISSING_USAGE_GUARD"))).toBe(
      false,
    );
    expect(d.exitCode).toBe(0);
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
    enableUsageGuard(root);
    const updated = updateProject(root, {});
    expect(updated.ok).toBe(true);
    expect(
      updated.applyResult.skipped.some(
        (s) => s.path === ".claude/settings.json" && s.code === "UNMANAGED_COLLISION",
      ),
    ).toBe(true);
    // User settings preserved
    expect(readFileSync(join(root, ".claude/settings.json"), "utf8")).toContain(
      "permissions",
    );
    // Hook scripts still installed
    expect(existsSync(join(root, ".claude/hooks/apdt-usage-guard/guard.mjs"))).toBe(
      true,
    );
    const d = doctor(root);
    expect(
      d.findings.some((f) => f.code === "USAGE_GUARD_SETTINGS_INCOMPLETE"),
    ).toBe(true);
  });

  it("preserves usageGuard across harness-list update override", () => {
    const root = tempDir();
    initProject(root, {
      yes: true,
      createdAt: "2026-11-25T00:00:00.000Z",
      projectName: "guard-preserve",
      harnesses: ["claude-code"],
    });
    enableUsageGuard(root, 92);
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
});
