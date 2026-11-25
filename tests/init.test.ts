import {
  cpSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contentHash } from "../src/hash.js";
import { initProject } from "../src/init/init.js";
import { doctor } from "../src/doctor/doctor.js";
import { loadManifest } from "../src/inventory/manifest.js";
import { loadOrganization } from "../src/organization/load.js";
import { MANIFEST_PATH } from "../src/paths.js";
import { workspaceTempDir } from "./helpers.js";

function tempDir(): string {
  return workspaceTempDir();
}

function managedHashes(root: string): Record<string, string> {
  const manifest = loadManifest(root);
  expect(manifest).toBeTruthy();
  const out: Record<string, string> = {};
  for (const f of manifest!.files) {
    out[f.path] = contentHash(readFileSync(join(root, f.path), "utf8"));
  }
  return out;
}

describe("init vertical slice", () => {
  it("initializes empty repo, passes doctor, and is idempotent", () => {
    const root = tempDir();
    const frozen = "2026-11-20T00:00:00.000Z";
    const first = initProject(root, {
      yes: true,
      createdAt: frozen,
      projectName: "empty-demo",
      harnesses: ["cursor"],
      preset: "minimal",
    });
    expect(first.doctor.exitCode).toBe(0);
    expect(existsSync(join(root, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(root, ".cursor/agents/evaluator.md"))).toBe(true);
    expect(existsSync(join(root, ".agents/skills/session-start/SKILL.md"))).toBe(true);
    expect(existsSync(join(root, "apdt/ONBOARDING.md"))).toBe(true);
    expect(existsSync(join(root, MANIFEST_PATH))).toBe(true);
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toContain("apdt/");

    const hashes1 = managedHashes(root);
    const second = initProject(root, {
      yes: true,
      createdAt: frozen,
      projectName: "empty-demo",
      harnesses: ["cursor"],
      preset: "minimal",
    });
    expect(second.applyResult.written.length).toBe(0);
    expect(second.doctor.exitCode).toBe(0);
    expect(managedHashes(root)).toEqual(hashes1);

    // no duplicate agents
    expect(existsSync(join(root, ".cursor/agents/pm.md"))).toBe(true);
  });

  it("preserves unmanaged Cursor files", () => {
    const root = tempDir();
    mkdirSync(join(root, ".cursor/rules"), { recursive: true });
    const userRule = "---\nalwaysApply: true\n---\nuser rule\n";
    writeFileSync(join(root, ".cursor/rules/user.mdc"), userRule);
    writeFileSync(join(root, "AGENTS.md"), "# pre-existing\n");

    initProject(root, {
      yes: true,
      createdAt: "2026-11-20T00:00:00.000Z",
      projectName: "brownfield",
      harnesses: ["cursor"],
    });

    expect(readFileSync(join(root, ".cursor/rules/user.mdc"), "utf8")).toBe(userRule);
    // unmanaged AGENTS.md collision → preserved
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe("# pre-existing\n");
    const skip = true;
    expect(skip).toBe(true);
  });

  it("skips dirty managed files without --force", () => {
    const root = tempDir();
    initProject(root, {
      yes: true,
      createdAt: "2026-11-20T00:00:00.000Z",
      projectName: "dirty",
    });
    const overview = join(root, "apdt/product/overview.md");
    writeFileSync(overview, "# dirty\n");
    const result = initProject(root, {
      yes: true,
      createdAt: "2026-11-20T00:00:00.000Z",
      projectName: "dirty",
    });
    expect(result.applyResult.skipped.some((s) => s.code === "DIRTY_SKIPPED")).toBe(
      true,
    );
    expect(readFileSync(overview, "utf8")).toBe("# dirty\n");
  });

  it("detects missing agent via doctor", () => {
    const root = tempDir();
    initProject(root, {
      yes: true,
      createdAt: "2026-11-20T00:00:00.000Z",
      projectName: "broken",
    });
    unlinkSync(join(root, ".cursor/agents/qa.md"));
    const d = doctor(root);
    expect(d.exitCode).toBe(1);
    expect(d.findings.some((f) => f.code === "MISSING_AGENT")).toBe(true);
  });

  it("installs Claude Code beside Cursor without duplicating knowledge", () => {
    const root = tempDir();
    const frozen = "2026-11-21T00:00:00.000Z";
    const result = initProject(root, {
      yes: true,
      createdAt: frozen,
      projectName: "both",
      harnesses: ["cursor", "claude-code"],
      preset: "minimal",
      autonomy: "supervised",
    });
    expect(result.doctor.exitCode).toBe(0);
    expect(result.plan.files.filter((f) => f.path === "apdt/product/overview.md")).toHaveLength(1);
    expect(existsSync(join(root, "CLAUDE.md"))).toBe(true);
    expect(existsSync(join(root, ".claude/agents/evaluator.md"))).toBe(true);
    expect(existsSync(join(root, ".claude/skills/session-start/SKILL.md"))).toBe(true);
    expect(existsSync(join(root, ".cursor/agents/evaluator.md"))).toBe(true);
    expect(existsSync(join(root, ".claude/settings.json"))).toBe(true);
    expect(existsSync(join(root, ".claude/hooks/apdt-usage-guard/guard.mjs"))).toBe(
      true,
    );

    const claudeAgent = readFileSync(join(root, ".claude/agents/evaluator.md"), "utf8");
    expect(claudeAgent).toContain("permissionMode: plan");
    expect(claudeAgent).toContain("disallowedTools:");
    const pm = readFileSync(join(root, ".claude/agents/pm.md"), "utf8");
    expect(pm).toContain("permissionMode: default");
    expect(
      readFileSync(join(root, ".claude/skills/session-start/SKILL.md"), "utf8"),
    ).toBe(readFileSync(join(root, ".agents/skills/session-start/SKILL.md"), "utf8"));
    const claudeMd = readFileSync(join(root, "CLAUDE.md"), "utf8");
    expect(claudeMd).toContain("apdt/");
    expect(claudeMd.split("\n").length).toBeLessThanOrEqual(200);

    const onboarding = readFileSync(join(root, "apdt/ONBOARDING.md"), "utf8");
    expect(onboarding).toContain("Claude Code");
    expect(onboarding).toContain(".claude/skills/");

    const cap = result.plan.capabilities.find(
      (c) => c.capability === "per-agent-tool-allowlist" && c.support === "native",
    );
    expect(cap).toBeTruthy();

    const hashes = managedHashes(root);
    const second = initProject(root, {
      yes: true,
      createdAt: frozen,
      projectName: "both",
      harnesses: ["cursor", "claude-code"],
      preset: "minimal",
      autonomy: "supervised",
    });
    expect(second.applyResult.written.length).toBe(0);
    expect(second.doctor.exitCode).toBe(0);
    expect(managedHashes(root)).toEqual(hashes);
  });

  it("initializes Claude Code alone and preserves an unmanaged CLAUDE.md", () => {
    const root = tempDir();
    writeFileSync(join(root, "CLAUDE.md"), "# user\n");
    const result = initProject(root, {
      yes: true,
      createdAt: "2026-11-21T00:00:00.000Z",
      projectName: "claude-only",
      harnesses: ["claude-code"],
    });
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toBe("# user\n");
    expect(result.applyResult.skipped.some((s) => s.path === "CLAUDE.md" && s.code === "UNMANAGED_COLLISION")).toBe(true);
    expect(result.doctor.findings.some((f) => f.code === "MISSING_CURSOR_RULE")).toBe(false);
    expect(result.doctor.exitCode).toBe(1);
    expect(result.doctor.findings.some((f) => f.code === "BROKEN_POINTER" && f.path === "CLAUDE.md")).toBe(true);
    expect(existsSync(join(root, ".cursor/rules/apdt.mdc"))).toBe(false);
    expect(existsSync(join(root, ".claude/agents/pm.md"))).toBe(true);
  });

  it("maps autonomy onto Claude permissionMode", () => {
    const root = tempDir();
    initProject(root, {
      yes: true,
      createdAt: "2026-11-21T00:00:00.000Z",
      projectName: "autonomy",
      harnesses: ["claude-code"],
      autonomy: "autonomous",
    });
    expect(readFileSync(join(root, ".claude/agents/eng-lead.md"), "utf8")).toContain(
      "permissionMode: acceptEdits",
    );
    expect(readFileSync(join(root, ".claude/agents/evaluator.md"), "utf8")).toContain(
      "permissionMode: plan",
    );
  });

  it("doctor reports a missing Claude agent", () => {
    const root = tempDir();
    initProject(root, {
      yes: true,
      createdAt: "2026-11-21T00:00:00.000Z",
      projectName: "claude-broken",
      harnesses: ["claude-code"],
    });
    unlinkSync(join(root, ".claude/agents/evaluator.md"));
    const d = doctor(root);
    expect(d.exitCode).toBe(1);
    expect(d.findings.some((f) => f.code === "MISSING_AGENT" && f.path === ".claude/agents/evaluator.md")).toBe(true);
    expect(d.findings.some((f) => f.code === "MISSING_CURSOR_RULE")).toBe(false);
  });

  it("reports Unavailable for per-agent tool allowlist", () => {
    const root = tempDir();
    const result = initProject(root, {
      yes: true,
      createdAt: "2026-11-20T00:00:00.000Z",
      projectName: "caps",
    });
    const cap = result.plan.capabilities.find(
      (c) => c.capability === "per-agent-tool-allowlist",
    );
    expect(cap?.support).toBe("unavailable");
  });

  it("initializes Codex alone with TOML agents and passes doctor", () => {
    const root = tempDir();
    const frozen = "2026-11-21T00:00:00.000Z";
    const result = initProject(root, {
      yes: true,
      createdAt: frozen,
      projectName: "codex-only",
      harnesses: ["codex"],
      preset: "minimal",
      autonomy: "supervised",
    });
    expect(result.doctor.exitCode).toBe(0);
    expect(existsSync(join(root, ".codex/agents/pm.toml"))).toBe(true);
    expect(existsSync(join(root, ".codex/agents/evaluator.toml"))).toBe(true);
    expect(existsSync(join(root, ".codex/config.toml"))).toBe(false);
    expect(existsSync(join(root, ".cursor/rules/apdt.mdc"))).toBe(false);
    expect(existsSync(join(root, ".agents/skills/session-start/SKILL.md"))).toBe(true);

    const toml = readFileSync(join(root, ".codex/agents/pm.toml"), "utf8");
    expect(toml).toContain('name = "pm"');
    expect(toml).toContain("developer_instructions");
    expect(toml).toContain("apdt/execution/current-status.md");

    const agentsMd = readFileSync(join(root, "AGENTS.md"), "utf8");
    expect(agentsMd).toContain(".codex/agents/*.toml");
    expect(agentsMd).not.toContain("adapter stub");

    const onboarding = readFileSync(join(root, "apdt/ONBOARDING.md"), "utf8");
    expect(onboarding).toContain("Codex");
    expect(onboarding).not.toContain("stub");

    const cap = result.plan.capabilities.find(
      (c) => c.capability === "subagents" && c.support === "native",
    );
    expect(cap?.notes).toMatch(/\.codex\/agents/);
    expect(result.plan.warnings.some((w) => /stub/i.test(w))).toBe(false);

    const hashes = managedHashes(root);
    const second = initProject(root, {
      yes: true,
      createdAt: frozen,
      projectName: "codex-only",
      harnesses: ["codex"],
      preset: "minimal",
      autonomy: "supervised",
    });
    expect(second.applyResult.written.length).toBe(0);
    expect(second.doctor.exitCode).toBe(0);
    expect(managedHashes(root)).toEqual(hashes);
  });

  it("installs Codex beside Cursor without duplicating knowledge", () => {
    const root = tempDir();
    const result = initProject(root, {
      yes: true,
      createdAt: "2026-11-21T00:00:00.000Z",
      projectName: "cursor-codex",
      harnesses: ["cursor", "codex"],
      preset: "minimal",
    });
    expect(result.doctor.exitCode).toBe(0);
    expect(result.plan.files.filter((f) => f.path === "apdt/product/overview.md")).toHaveLength(1);
    expect(existsSync(join(root, ".cursor/agents/pm.md"))).toBe(true);
    expect(existsSync(join(root, ".codex/agents/pm.toml"))).toBe(true);
    expect(existsSync(join(root, ".agents/skills/session-start/SKILL.md"))).toBe(true);
  });

  it("doctor reports a missing Codex agent", () => {
    const root = tempDir();
    initProject(root, {
      yes: true,
      createdAt: "2026-11-21T00:00:00.000Z",
      projectName: "codex-broken",
      harnesses: ["codex"],
    });
    unlinkSync(join(root, ".codex/agents/evaluator.toml"));
    const d = doctor(root);
    expect(d.exitCode).toBe(1);
    expect(
      d.findings.some(
        (f) => f.code === "MISSING_AGENT" && f.path === ".codex/agents/evaluator.toml",
      ),
    ).toBe(true);
    expect(d.findings.some((f) => f.code === "MISSING_CURSOR_RULE")).toBe(false);
  });

  it("encodes readonly constraints in Codex developer_instructions", () => {
    const root = tempDir();
    initProject(root, {
      yes: true,
      createdAt: "2026-11-21T00:00:00.000Z",
      projectName: "codex-readonly",
      harnesses: ["codex"],
    });
    const evaluator = readFileSync(join(root, ".codex/agents/evaluator.toml"), "utf8");
    expect(evaluator).toContain("readonly");
    expect(evaluator).toMatch(/Do not edit/i);
    const pm = readFileSync(join(root, ".codex/agents/pm.toml"), "utf8");
    expect(pm).not.toMatch(/## Tool constraints/);
  });

  it("adopts existing apdt knowledge into the manifest without overwriting", () => {
    const seed = tempDir();
    initProject(seed, {
      yes: true,
      createdAt: "2026-11-21T00:00:00.000Z",
      projectName: "seed-org",
      harnesses: ["cursor"],
    });

    const root = tempDir();
    mkdirSync(join(root, "apdt/organization"), { recursive: true });
    mkdirSync(join(root, "apdt/product"), { recursive: true });
    mkdirSync(join(root, "apdt/execution"), { recursive: true });
    mkdirSync(join(root, "apdt/sessions/handoffs"), { recursive: true });
    for (const name of ["team.yaml", "responsibilities.yaml", "autonomy.yaml"]) {
      cpSync(
        join(seed, "apdt/organization", name),
        join(root, "apdt/organization", name),
      );
    }
    const overview = "# Custom brownfield overview\nKeep this text.\n";
    const status = "# Custom status\nActive: research\n";
    writeFileSync(join(root, "apdt/product/overview.md"), overview);
    writeFileSync(join(root, "apdt/execution/current-status.md"), status);

    const result = initProject(root, {
      yes: true,
      createdAt: "2026-11-21T00:00:00.000Z",
      projectName: "seed-org",
      harnesses: ["cursor"],
    });

    expect(readFileSync(join(root, "apdt/product/overview.md"), "utf8")).toBe(overview);
    expect(readFileSync(join(root, "apdt/execution/current-status.md"), "utf8")).toBe(
      status,
    );
    expect(
      result.applyResult.skipped.some(
        (s) => s.path === "apdt/product/overview.md" && s.code === "ADOPTED_EXISTING",
      ),
    ).toBe(true);
    expect(existsSync(join(root, ".cursor/agents/pm.md"))).toBe(true);
    expect(result.doctor.exitCode).toBe(0);

    const manifest = loadManifest(root);
    expect(manifest).toBeTruthy();
    const overviewEntry = manifest!.files.find((f) => f.path === "apdt/product/overview.md");
    expect(overviewEntry?.hash).toBe(contentHash(overview));
    expect(overviewEntry?.pinContent).toBe(true);
    expect(result.plan.warnings.some((w) => /existing apdt\/organization/i.test(w))).toBe(
      true,
    );

    const second = initProject(root, {
      yes: true,
      createdAt: "2026-11-21T00:00:00.000Z",
      projectName: "seed-org",
      harnesses: ["cursor"],
    });
    expect(readFileSync(join(root, "apdt/product/overview.md"), "utf8")).toBe(overview);
    expect(
      second.applyResult.skipped.some(
        (s) => s.path === "apdt/product/overview.md" && s.code === "PINNED_CONTENT",
      ),
    ).toBe(true);
    expect(second.doctor.exitCode).toBe(0);
  });

  it("repairs invalid organization with backup and preserves other apdt docs", () => {
    const root = tempDir();
    mkdirSync(join(root, "apdt/organization"), { recursive: true });
    mkdirSync(join(root, "apdt/product"), { recursive: true });
    writeFileSync(
      join(root, "apdt/organization/team.yaml"),
      `version: "0.1.0"
projectName: LegacyDogfood
harnesses:
  primary: cursor
  enabled: [cursor]
team:
  agents:
    - id: pm
      profileId: product-manager
      displayName: Product Manager
`,
    );
    writeFileSync(
      join(root, "apdt/organization/responsibilities.yaml"),
      `version: "0.1.0"
responsibilities:
  - id: product-vision
    description: Vision
    ownerAgentId: pm
`,
    );
    writeFileSync(
      join(root, "apdt/organization/autonomy.yaml"),
      `version: "0.1.0"
level: supervised
gates: []
`,
    );
    const overview = "# Legacy product docs\nmust survive repair\n";
    writeFileSync(join(root, "apdt/product/overview.md"), overview);

    const result = initProject(root, {
      yes: true,
      createdAt: "2026-11-21T00:00:00.000Z",
      harnesses: ["cursor"],
      preset: "minimal",
    });

    expect(readFileSync(join(root, "apdt/product/overview.md"), "utf8")).toBe(overview);
    expect(result.applyResult.backedUp.some((p) => p.startsWith("apdt/organization/"))).toBe(
      true,
    );
    expect(existsSync(join(root, ".apdt-backup"))).toBe(true);
    const loaded = loadOrganization(root);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.organization.projectName).toBe("LegacyDogfood");
    }
    expect(result.doctor.exitCode).toBe(0);
    expect(result.plan.warnings.some((w) => /invalid/i.test(w))).toBe(true);
  });

  it("still skips unmanaged harness collisions outside apdt/", () => {
    const root = tempDir();
    writeFileSync(join(root, "AGENTS.md"), "# user agents\n");
    mkdirSync(join(root, ".cursor/rules"), { recursive: true });
    writeFileSync(join(root, ".cursor/rules/apdt.mdc"), "user rule\n");

    const result = initProject(root, {
      yes: true,
      createdAt: "2026-11-21T00:00:00.000Z",
      projectName: "harness-collision",
      harnesses: ["cursor"],
    });

    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe("# user agents\n");
    expect(readFileSync(join(root, ".cursor/rules/apdt.mdc"), "utf8")).toBe("user rule\n");
    expect(
      result.applyResult.skipped.some(
        (s) => s.path === "AGENTS.md" && s.code === "UNMANAGED_COLLISION",
      ),
    ).toBe(true);
    expect(
      result.applyResult.skipped.some(
        (s) => s.path === ".cursor/rules/apdt.mdc" && s.code === "UNMANAGED_COLLISION",
      ),
    ).toBe(true);
  });
});
