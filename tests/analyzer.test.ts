import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeProject } from "../src/analyzer/analyze.js";
import { workspaceTempDir } from "./helpers.js";

function tempDir(): string {
  return workspaceTempDir();
}

describe("analyzeProject", () => {
  it("classifies empty directory as greenfield/minimal", () => {
    const root = tempDir();
    const a = analyzeProject(root);
    expect(a.isEmpty).toBe(true);
    expect(a.maturity).toBe("greenfield");
    expect(a.recommendedPreset).toBe("minimal");
  });

  it("detects Node/TS stack", () => {
    const root = tempDir();
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        name: "demo",
        devDependencies: { typescript: "^5", vitest: "^2" },
      }),
    );
    writeFileSync(join(root, "tsconfig.json"), "{}");
    mkdirSync(join(root, "tests"));
    const a = analyzeProject(root);
    expect(a.stack.languages).toContain("typescript");
    expect(a.testing.hasTests).toBe(true);
    expect(a.maturity).toBe("intermediate");
  });

  it("detects existing Cursor harness", () => {
    const root = tempDir();
    mkdirSync(join(root, ".cursor/rules"), { recursive: true });
    writeFileSync(join(root, ".cursor/rules/user.mdc"), "---\nalwaysApply: true\n---\nx\n");
    const a = analyzeProject(root);
    expect(a.existingHarnesses.find((h) => h.id === "cursor")?.present).toBe(true);
  });

  it("labels unknown non-empty without manifest", () => {
    const root = tempDir();
    writeFileSync(join(root, "notes.txt"), "hi");
    const a = analyzeProject(root);
    expect(a.isEmpty).toBe(false);
    expect(a.stack.languages).toContain("unknown");
  });
});
