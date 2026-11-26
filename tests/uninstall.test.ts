import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { initProject } from "../src/init/init.js";
import { loadManifest } from "../src/inventory/manifest.js";
import { MANIFEST_PATH } from "../src/paths.js";
import { decideSettings, safeProjectPath, uninstallProject } from "../src/uninstall/uninstall.js";
import { workspaceTempDir } from "./helpers.js";

const now = "2026-11-27T00:00:00.000Z";

function initCursor(root: string): void {
  const result = initProject(root, {
    yes: true,
    createdAt: now,
    projectName: "demo",
    harnesses: ["cursor"],
    preset: "minimal",
  });
  expect(result.doctor.exitCode).toBe(0);
}

describe("uninstallProject", () => {
  it("refuses without --yes and removes nothing", () => {
    const root = workspaceTempDir();
    initCursor(root);
    const result = uninstallProject(root, { now });
    expect(result.exitCode).toBe(2);
    expect(result.report).toContain("without --yes");
    expect(existsSync(join(root, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(root, MANIFEST_PATH))).toBe(true);
  });

  it("dry-run lists the install and leaves it in place", () => {
    const root = workspaceTempDir();
    initCursor(root);
    const result = uninstallProject(root, { dryRun: true, now });
    expect(result.exitCode).toBe(0);
    expect(result.report).toContain("Dry run");
    expect(result.removed).toContain("AGENTS.md");
    expect(result.removed).toContain(MANIFEST_PATH);
    expect(existsSync(join(root, ".cursor/agents/pm.md"))).toBe(true);
    expect(existsSync(join(root, MANIFEST_PATH))).toBe(true);
  });

  it("removes a cursor install and keeps unrelated project files", () => {
    const root = workspaceTempDir();
    mkdirSync(join(root, ".cursor/rules"), { recursive: true });
    mkdirSync(join(root, ".agents/skills/local-skill"), { recursive: true });
    const userRule = "---\nalwaysApply: true\n---\nuser rule\n";
    writeFileSync(join(root, ".cursor/rules/user.mdc"), userRule);
    writeFileSync(join(root, ".agents/skills/local-skill/SKILL.md"), "# local\n");
    writeFileSync(join(root, "AGENTS.md"), "# pre-existing\n");
    initProject(root, {
      yes: true,
      createdAt: now,
      projectName: "demo",
      harnesses: ["cursor"],
      preset: "minimal",
    });
    writeFileSync(join(root, "apdt/sessions/handoffs/2026-11-27-note.md"), "# note\n");

    const result = uninstallProject(root, { yes: true, now });
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(root, "apdt"))).toBe(false);
    expect(existsSync(join(root, ".cursor/agents"))).toBe(false);
    expect(existsSync(join(root, ".cursor/rules/apdt.mdc"))).toBe(false);
    expect(existsSync(join(root, ".agents/skills/session-start"))).toBe(false);
    expect(readFileSync(join(root, ".cursor/rules/user.mdc"), "utf8")).toBe(userRule);
    expect(readFileSync(join(root, ".agents/skills/local-skill/SKILL.md"), "utf8")).toBe("# local\n");
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe("# pre-existing\n");
    expect(existsSync(join(root, ".apdt-backup/2026-11-27T00-00-00-000Z/apdt/sessions/handoffs/2026-11-27-note.md"))).toBe(true);
    expect(existsSync(join(root, ".apdt-backup/2026-11-27T00-00-00-000Z", MANIFEST_PATH))).toBe(true);
  });

  it("keeps pinContent files that were adopted and still removes the install", () => {
    const root = workspaceTempDir();
    mkdirSync(join(root, "apdt/product"), { recursive: true });
    const overview = "# Custom overview\nKeep this text.\n";
    writeFileSync(join(root, "apdt/product/overview.md"), overview);
    initProject(root, {
      yes: true,
      createdAt: now,
      projectName: "demo",
      harnesses: ["cursor"],
      preset: "minimal",
    });
    expect(loadManifest(root)?.files.find((file) => file.path === "apdt/product/overview.md")?.pinContent).toBe(true);

    const result = uninstallProject(root, { yes: true, now });
    expect(result.exitCode).toBe(0);
    expect(result.kept).toContain("apdt/product/overview.md");
    expect(readFileSync(join(root, "apdt/product/overview.md"), "utf8")).toBe(overview);
    expect(existsSync(join(root, MANIFEST_PATH))).toBe(false);
    expect(existsSync(join(root, ".cursor/agents/pm.md"))).toBe(false);
    expect(existsSync(join(root, "apdt/organization/team.yaml"))).toBe(false);
  });

  it("strips usage-guard hooks and leaves other Claude settings", () => {
    const root = workspaceTempDir();
    initProject(root, {
      yes: true,
      createdAt: now,
      projectName: "demo",
      harnesses: ["claude-code"],
      preset: "minimal",
    });
    const settingsPath = join(root, ".claude/settings.json");
    const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
    settings.permissions = { allow: ["Bash(npm test)"] };
    writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
    writeFileSync(join(root, ".claude/notes.txt"), "keep\n");

    const result = uninstallProject(root, { yes: true, now });
    expect(result.exitCode).toBe(0);
    expect(result.rewritten).toEqual([".claude/settings.json"]);
    const left = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
    expect(left.permissions).toEqual({ allow: ["Bash(npm test)"] });
    expect(JSON.stringify(left)).not.toContain("apdt-usage-guard");
    expect(left.autoContinueAtUsageLimit).toBe(true);
    expect(existsSync(join(root, ".claude/hooks/apdt-usage-guard/guard.mjs"))).toBe(false);
    expect(existsSync(join(root, "CLAUDE.md"))).toBe(false);
    expect(readFileSync(join(root, ".claude/notes.txt"), "utf8")).toBe("keep\n");
    expect(existsSync(join(root, ".apdt-backup/2026-11-27T00-00-00-000Z/.claude/settings.json"))).toBe(true);
  });

  it("deletes a settings file that only contains the usage guard", () => {
    const root = workspaceTempDir();
    initProject(root, {
      yes: true,
      createdAt: now,
      projectName: "demo",
      harnesses: ["claude-code"],
      preset: "minimal",
    });
    const result = uninstallProject(root, { yes: true, now });
    expect(result.exitCode).toBe(0);
    expect(result.removed).toContain(".claude/settings.json");
    expect(existsSync(join(root, ".claude/settings.json"))).toBe(false);
    expect(existsSync(join(root, ".claude"))).toBe(false);
  });

  it("does not follow a manifest path that escapes the project", () => {
    const root = workspaceTempDir();
    initCursor(root);
    const outside = join(root, "..", "uninstall-escape.txt");
    writeFileSync(outside, "safe\n");
    const manifest = loadManifest(root);
    expect(manifest).toBeTruthy();
    manifest!.files.push({
      path: "../uninstall-escape.txt",
      hash: "abc",
      templateId: "evil",
      templateVersion: "0.2.0",
      managed: true,
      lastAppliedApdtVersion: "0.1.6",
    });
    writeFileSync(join(root, MANIFEST_PATH), YAML.stringify(manifest));

    const result = uninstallProject(root, { yes: true, now });
    expect(result.exitCode).toBe(0);
    expect(result.report).toContain("unsafe");
    expect(readFileSync(outside, "utf8")).toBe("safe\n");
    expect(existsSync(join(root, ".cursor/agents/pm.md"))).toBe(false);
    unlinkSync(outside);
  });

  it("reports a missing install", () => {
    const root = workspaceTempDir();
    writeFileSync(join(root, "README.md"), "app\n");
    const result = uninstallProject(root, { yes: true, now });
    expect(result.exitCode).toBe(2);
    expect(result.report).toContain("No install found");
    expect(readFileSync(join(root, "README.md"), "utf8")).toBe("app\n");
  });
});

describe("decideSettings", () => {
  it("keeps a settings file that does not mention the guard", () => {
    const text = `${JSON.stringify({ permissions: { deny: [] } }, null, 2)}\n`;
    expect(decideSettings(text, "different-hash")).toEqual({ action: "keep" });
  });
});

describe("safeProjectPath", () => {
  it("rejects paths that leave the project", () => {
    const root = workspaceTempDir();
    expect(safeProjectPath(root, "../secret")).toBeNull();
    expect(safeProjectPath(root, "/etc/passwd")).toBeNull();
    expect(safeProjectPath(root, ".cursor/agents/pm.md")).toBe(".cursor/agents/pm.md");
  });
});
