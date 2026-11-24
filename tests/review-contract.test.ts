import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { initProject } from "../src/init/init.js";
import { planSharedSkills } from "../src/workflows/skills.js";
import { workspaceTempDir } from "./helpers.js";

describe("review contract", () => {
  it("tells review-change and evaluate-product to delegate", () => {
    const skills = planSharedSkills();
    const review = skills.find((file) => file.path === ".agents/skills/review-change/SKILL.md");
    expect(review?.content).toContain(
      "Delegate to the readonly agent that owns code-review in apdt/organization/responsibilities.yaml",
    );
    expect(review?.content).toContain("Do not review in the implementer's context");
    expect(review?.content).toContain("apdt/quality/reviews/<date>-<slug>-<agent>.md");
    expect(review?.content).toContain("Return a 2-3 line summary and the review path");
    expect(review?.content).toContain("project checks under apdt/quality/");
    expect(review?.content).toContain("Do not copy project checks into generated agent files");
    expect(review?.content).toContain("Prefer git diff");

    const evaluate = skills.find(
      (file) => file.path === ".agents/skills/evaluate-product/SKILL.md",
    );
    expect(evaluate?.content).toContain(
      "Delegate to the readonly agent that owns independent-evaluation in apdt/organization/responsibilities.yaml",
    );
    expect(evaluate?.content).toContain("Do not evaluate in the implementer's context");
    expect(evaluate?.content).toContain("Write evaluation under apdt/product/evaluations/");
    expect(evaluate?.content).toContain(
      "Note that triage is incomplete until PM runs plan-improvements",
    );
    expect(evaluate?.content).toContain("Return a 2-3 line summary and the evaluation path");
    expect(evaluate?.content).not.toContain("apdt/quality/reviews/");
  });

  it("renders profile inputs and outputs into each harness agent", () => {
    const root = workspaceTempDir();
    initProject(root, {
      yes: true,
      createdAt: "2026-11-21T00:00:00.000Z",
      projectName: "review-contract",
      harnesses: ["cursor", "claude-code", "codex"],
      preset: "minimal",
    });

    const cursor = readFileSync(join(root, ".cursor/agents/qa.md"), "utf8");
    const claude = readFileSync(join(root, ".claude/agents/qa.md"), "utf8");
    const codex = readFileSync(join(root, ".codex/agents/qa.toml"), "utf8");
    for (const body of [cursor, claude, codex]) {
      expect(body).toContain("## Inputs");
      expect(body).toContain("- diffs");
      expect(body).toContain("- acceptance criteria");
      expect(body).toContain("## Outputs");
      expect(body).toContain("- review reports");
      expect(body).not.toContain("project checks");
    }

    const evaluator = readFileSync(join(root, ".cursor/agents/evaluator.md"), "utf8");
    expect(evaluator).toContain("- vision");
    expect(evaluator).toContain("- evaluation reports with evidence; improvement opportunities");
  });
});
