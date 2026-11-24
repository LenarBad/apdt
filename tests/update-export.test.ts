import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contentHash } from "../src/hash.js";
import { initProject } from "../src/init/init.js";
import { updateProject } from "../src/update/update.js";
import {
  exportOrganization,
  isPrivateProjectPath,
} from "../src/export/export.js";
import { loadManifest, writeManifest } from "../src/inventory/manifest.js";
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

describe("apdt update", () => {
  it("fails when not installed", () => {
    const root = tempDir();
    const result = updateProject(root);
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.report).toContain("apdt init");
  });

  it("is a no-op on a clean install and preserves hashes", () => {
    const root = tempDir();
    const frozen = "2026-11-21T00:00:00.000Z";
    initProject(root, {
      yes: true,
      createdAt: frozen,
      projectName: "update-clean",
      harnesses: ["cursor"],
      preset: "minimal",
    });
    const hashes = managedHashes(root);
    const result = updateProject(root);
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    if (result.ok) {
      expect(result.applyResult.written.length).toBe(0);
      expect(result.doctor.exitCode).toBe(0);
    }
    expect(managedHashes(root)).toEqual(hashes);
  });

  it("rewrites clean managed files when the template changes and leaves the rest", () => {
    const root = tempDir();
    initProject(root, {
      yes: true,
      createdAt: "2026-11-21T00:00:00.000Z",
      projectName: "upgrade",
      harnesses: ["cursor"],
      preset: "minimal",
    });

    const skillRel = ".agents/skills/review-change/SKILL.md";
    const oldSkill = "# previous review skill\n";
    writeFileSync(join(root, skillRel), oldSkill);

    const overviewRel = "apdt/product/overview.md";
    const customOverview = "# customized product\n";
    writeFileSync(join(root, overviewRel), customOverview);

    const statusRel = "apdt/execution/current-status.md";
    const pinnedStatus = "# pinned status\n";
    writeFileSync(join(root, statusRel), pinnedStatus);

    const manifest = loadManifest(root)!;
    const skillEntry = manifest.files.find((file) => file.path === skillRel);
    const statusEntry = manifest.files.find((file) => file.path === statusRel);
    expect(skillEntry).toBeTruthy();
    expect(statusEntry).toBeTruthy();
    skillEntry!.hash = contentHash(oldSkill);
    statusEntry!.hash = contentHash(pinnedStatus);
    statusEntry!.pinContent = true;
    writeManifest(root, manifest);

    mkdirSync(join(root, "notes"));
    const userNote = join(root, "notes/keep.txt");
    writeFileSync(userNote, "leave this\n");

    const teamRel = "apdt/organization/team.yaml";
    const agentsRel = "AGENTS.md";
    const teamBefore = readFileSync(join(root, teamRel), "utf8");
    const agentsBefore = readFileSync(join(root, agentsRel), "utf8");
    const before = managedHashes(root);

    const result = updateProject(root);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.applyResult.written).toEqual([skillRel]);
    const upgradedSkill = readFileSync(join(root, skillRel), "utf8");
    expect(upgradedSkill).not.toBe(oldSkill);
    expect(upgradedSkill).toContain("owns code-review");

    expect(readFileSync(join(root, overviewRel), "utf8")).toBe(customOverview);
    expect(
      result.applyResult.skipped.some(
        (skip) => skip.path === overviewRel && skip.code === "DIRTY_SKIPPED",
      ),
    ).toBe(true);

    expect(readFileSync(join(root, statusRel), "utf8")).toBe(pinnedStatus);
    expect(
      result.applyResult.skipped.some(
        (skip) => skip.path === statusRel && skip.code === "PINNED_CONTENT",
      ),
    ).toBe(true);

    expect(readFileSync(userNote, "utf8")).toBe("leave this\n");
    expect(readFileSync(join(root, teamRel), "utf8")).toBe(teamBefore);
    expect(readFileSync(join(root, agentsRel), "utf8")).toBe(agentsBefore);
    expect(result.applyResult.written).not.toContain(teamRel);
    expect(result.applyResult.written).not.toContain(agentsRel);
    expect(result.applyResult.removed).toEqual([]);

    const after = managedHashes(root);
    expect(after[skillRel]).toBe(contentHash(upgradedSkill));
    expect(after[skillRel]).not.toBe(before[skillRel]);
    for (const [path, hash] of Object.entries(before)) {
      if (path === skillRel) continue;
      expect(after[path]).toBe(hash);
    }
    const stored = loadManifest(root)!;
    expect(stored.files.find((file) => file.path === skillRel)?.hash).toBe(
      contentHash(upgradedSkill),
    );
    expect(stored.files.find((file) => file.path === overviewRel)?.hash).not.toBe(
      contentHash(customOverview),
    );
    expect(stored.files.find((file) => file.path === statusRel)?.pinContent).toBe(
      true,
    );
  });

  it("skips dirty managed files without --force", () => {
    const root = tempDir();
    initProject(root, {
      yes: true,
      createdAt: "2026-11-21T00:00:00.000Z",
      projectName: "update-dirty",
    });
    const overview = join(root, "apdt/product/overview.md");
    writeFileSync(overview, "# customized product\n");
    const result = updateProject(root);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        result.applyResult.skipped.some((s) => s.code === "DIRTY_SKIPPED"),
      ).toBe(true);
    }
    expect(readFileSync(overview, "utf8")).toBe("# customized product\n");
  });

  it("backs up and overwrites dirty files with --force", () => {
    const root = tempDir();
    initProject(root, {
      yes: true,
      createdAt: "2026-11-21T00:00:00.000Z",
      projectName: "update-force",
    });
    const overview = join(root, "apdt/product/overview.md");
    writeFileSync(overview, "# customized product\n");
    const result = updateProject(root, { force: true });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.applyResult.backedUp).toContain("apdt/product/overview.md");
      expect(result.applyResult.written).toContain("apdt/product/overview.md");
    }
    expect(readFileSync(overview, "utf8")).not.toBe("# customized product\n");
    expect(existsSync(join(root, ".apdt-backup"))).toBe(true);
  });

  it("can add a harness while preserving installed team", () => {
    const root = tempDir();
    initProject(root, {
      yes: true,
      createdAt: "2026-11-21T00:00:00.000Z",
      projectName: "add-claude",
      harnesses: ["cursor"],
      preset: "minimal",
    });
    const result = updateProject(root, {
      harnesses: ["cursor", "claude-code"],
    });
    expect(result.ok).toBe(true);
    expect(existsSync(join(root, "CLAUDE.md"))).toBe(true);
    expect(existsSync(join(root, ".claude/agents/evaluator.md"))).toBe(true);
    if (result.ok) {
      expect(result.doctor.exitCode).toBe(0);
      expect(result.plan.organization.harnesses.enabled).toEqual([
        "cursor",
        "claude-code",
      ]);
    }
  });

  it("removes orphan harness agents on recompose to smaller team/harness set", () => {
    const root = tempDir();
    initProject(root, {
      yes: true,
      createdAt: "2026-11-21T00:00:00.000Z",
      projectName: "recompose-orphan",
      harnesses: ["cursor", "claude-code"],
      preset: "standard",
    });

    const obsolete = [
      ".cursor/agents/engineer.md",
      ".cursor/agents/reviewer.md",
      ".claude/agents/engineer.md",
      ".claude/agents/reviewer.md",
      ".claude/agents/pm.md",
      ".claude/skills/session-start/SKILL.md",
    ];
    for (const p of obsolete) {
      expect(existsSync(join(root, p))).toBe(true);
    }

    const overview = join(root, "apdt/product/overview.md");
    const customOverview = "# customized product knowledge\n";
    writeFileSync(overview, customOverview);

    // pinContent agent must not be deleted even when obsolete for the new team
    const pinnedAgent = ".cursor/agents/engineer.md";
    const pinnedBytes = readFileSync(join(root, pinnedAgent), "utf8");
    const before = loadManifest(root)!;
    const eng = before.files.find((f) => f.path === pinnedAgent);
    expect(eng).toBeTruthy();
    eng!.pinContent = true;
    writeManifest(root, before);

    const sharedSkill = join(root, ".agents/skills/session-start/SKILL.md");
    expect(existsSync(sharedSkill)).toBe(true);

    const result = updateProject(root, {
      recompose: true,
      preset: "minimal",
      harnesses: ["cursor"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.applyResult.removed).toEqual(
      expect.arrayContaining([
        ".cursor/agents/reviewer.md",
        ".claude/agents/engineer.md",
        ".claude/agents/reviewer.md",
        ".claude/agents/pm.md",
        ".claude/agents/eng-lead.md",
        ".claude/agents/qa.md",
        ".claude/agents/evaluator.md",
        ".claude/skills/session-start/SKILL.md",
      ]),
    );
    expect(result.applyResult.removed).not.toContain(pinnedAgent);

    expect(existsSync(join(root, ".cursor/agents/reviewer.md"))).toBe(false);
    expect(existsSync(join(root, ".claude/agents/pm.md"))).toBe(false);
    expect(existsSync(join(root, ".claude/skills/session-start/SKILL.md"))).toBe(
      false,
    );

    // pinContent obsolete agent kept
    expect(existsSync(join(root, pinnedAgent))).toBe(true);
    expect(readFileSync(join(root, pinnedAgent), "utf8")).toBe(pinnedBytes);

    // Remaining cursor agents for minimal preset
    expect(existsSync(join(root, ".cursor/agents/pm.md"))).toBe(true);
    expect(existsSync(join(root, ".cursor/agents/eng-lead.md"))).toBe(true);

    // Not eligible for orphan cleanup
    expect(existsSync(join(root, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(root, "CLAUDE.md"))).toBe(true);
    expect(existsSync(sharedSkill)).toBe(true);
    expect(readFileSync(overview, "utf8")).toBe(customOverview);

    const manifest = loadManifest(root)!;
    const paths = new Set(manifest.files.map((f) => f.path));
    expect(paths.has(pinnedAgent)).toBe(true);
    expect(manifest.files.find((f) => f.path === pinnedAgent)?.pinContent).toBe(
      true,
    );
    expect(paths.has(".cursor/agents/reviewer.md")).toBe(false);
    expect(paths.has(".claude/agents/pm.md")).toBe(false);
    expect(paths.has(".claude/skills/session-start/SKILL.md")).toBe(false);
    expect(paths.has(".agents/skills/session-start/SKILL.md")).toBe(true);
    expect(paths.has("apdt/product/overview.md")).toBe(true);

    expect(existsSync(join(root, ".apdt-backup"))).toBe(true);
    expect(
      result.applyResult.backedUp.some(
        (p) => p.startsWith(".cursor/agents/") || p.startsWith(".claude/"),
      ),
    ).toBe(true);
    expect(result.report).toContain("Removed");
  });
});

describe("apdt export", () => {
  it("fails when not installed", () => {
    const root = tempDir();
    const result = exportOrganization(root);
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it("exports organization.yaml without private project paths", () => {
    const root = tempDir();
    initProject(root, {
      yes: true,
      createdAt: "2026-11-21T00:00:00.000Z",
      projectName: "secret-product",
      harnesses: ["cursor", "claude-code"],
      preset: "minimal",
    });
    writeFileSync(
      join(root, "apdt/product/overview.md"),
      "# Secret roadmap details\n",
    );
    mkdirSync(join(root, "apdt/sessions/handoffs"), { recursive: true });
    writeFileSync(
      join(root, "apdt/sessions/handoffs/private.md"),
      "# private handoff\n",
    );

    const outDir = join(root, "out-export");
    const result = exportOrganization(root, { outDir });
    expect(result.ok).toBe(true);
    expect(existsSync(join(outDir, "organization.yaml"))).toBe(true);
    expect(existsSync(join(outDir, "EXPORT.md"))).toBe(true);

    const yaml = readFileSync(join(outDir, "organization.yaml"), "utf8");
    expect(yaml).toContain("exported-org");
    expect(yaml).not.toContain("secret-product");
    expect(yaml).not.toContain("Secret roadmap");
    expect(yaml).not.toContain("private handoff");
    expect(yaml).toContain("apdt-organization");
    expect(yaml).toContain("evaluator");

    expect(isPrivateProjectPath("apdt/product/overview.md")).toBe(true);
    expect(isPrivateProjectPath("apdt/organization/team.yaml")).toBe(false);
    expect(existsSync(join(outDir, "apdt/product/overview.md"))).toBe(false);
    expect(existsSync(join(outDir, ".cursor"))).toBe(false);
    expect(existsSync(join(outDir, "CLAUDE.md"))).toBe(false);
  });
});
