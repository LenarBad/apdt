import { describe, expect, it } from "vitest";
import { analyzeProject } from "../src/analyzer/analyze.js";
import { composeTeam } from "../src/composer/compose.js";
import { workspaceTempDir } from "./helpers.js";

describe("composeTeam", () => {
  it("builds minimal team with evaluator and full responsibility coverage", () => {
    const root = workspaceTempDir();
    const analysis = analyzeProject(root);
    const org = composeTeam(analysis, { preset: "minimal", projectName: "demo" });
    expect(org.preset).toBe("minimal");
    expect(org.team.agents.map((a) => a.id).sort()).toEqual([
      "eng-lead",
      "evaluator",
      "pm",
      "qa",
    ]);
    expect(org.team.coordination.evaluatorAgentId).toBe("evaluator");
    const owned = new Set(org.responsibilities.map((r) => r.id));
    for (const id of [
      "product-vision",
      "requirements",
      "prioritization",
      "architecture",
      "implementation",
      "verification",
      "code-review",
      "independent-evaluation",
    ]) {
      expect(owned.has(id as never)).toBe(true);
    }
    for (const r of org.responsibilities) {
      expect(org.team.agents.some((a) => a.id === r.ownerAgentId)).toBe(true);
    }
  });

  it("builds standard and full-stack-split teams without empty agents", () => {
    const root = workspaceTempDir();
    const analysis = analyzeProject(root);
    for (const preset of ["standard", "full-stack-split"] as const) {
      const org = composeTeam(analysis, { preset, projectName: "demo" });
      expect(org.preset).toBe(preset);
      expect(org.team.agents.length).toBeGreaterThan(4);
      for (const agent of org.team.agents) {
        expect(agent.responsibilities.length).toBeGreaterThan(0);
      }
      expect(org.team.agents.some((a) => a.id === "evaluator")).toBe(true);
    }
  });
});
