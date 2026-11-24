import { describe, expect, it } from "vitest";
import { analyzeProject } from "../src/analyzer/analyze.js";
import { composeTeam } from "../src/composer/compose.js";
import { OrganizationConfigSchema } from "../src/schemas/organization.js";
import { workspaceTempDir } from "./helpers.js";

function ownerOf(
  org: ReturnType<typeof composeTeam>,
  id: string,
): string {
  const row = org.responsibilities.find((r) => r.id === id);
  if (!row) throw new Error(`missing responsibility ${id}`);
  return row.ownerAgentId;
}

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

  it("keeps code-review on qa when no reviewer is emitted", () => {
    const root = workspaceTempDir();
    const analysis = analyzeProject(root);
    const org = composeTeam(analysis, { preset: "minimal", projectName: "demo" });
    expect(OrganizationConfigSchema.safeParse(org).success).toBe(true);
    expect(ownerOf(org, "code-review")).toBe("qa");
    expect(org.responsibilities.map((r) => r.id)).not.toContain("security-review");
  });

  it("gives emitted specialists their own responsibilities", () => {
    const root = workspaceTempDir();
    const analysis = analyzeProject(root);
    const org = composeTeam(analysis, { preset: "full-stack-split", projectName: "demo" });
    expect(OrganizationConfigSchema.safeParse(org).success).toBe(true);

    const byId = new Map(org.team.agents.map((agent) => [agent.id, agent.responsibilities]));
    expect(byId.get("reviewer")).toEqual(["code-review"]);
    expect(byId.get("security")).toEqual(["security-review"]);
    expect(byId.get("backend")).toEqual(["backend-implementation"]);
    expect(byId.get("frontend")).toEqual(["frontend-implementation"]);
    expect(byId.get("qa")).toEqual(["verification"]);
    expect(byId.get("qa")).not.toContain("code-review");

    expect(ownerOf(org, "code-review")).toBe("reviewer");
    expect(ownerOf(org, "security-review")).toBe("security");
    expect(ownerOf(org, "backend-implementation")).toBe("backend");
    expect(ownerOf(org, "frontend-implementation")).toBe("frontend");
    expect(ownerOf(org, "verification")).toBe("qa");
    expect(ownerOf(org, "implementation")).toBe("eng-lead");
  });

  it("lets the standard reviewer own code-review", () => {
    const root = workspaceTempDir();
    const analysis = analyzeProject(root);
    const org = composeTeam(analysis, { preset: "standard", projectName: "demo" });
    const qa = org.team.agents.find((agent) => agent.id === "qa");
    expect(qa?.responsibilities).toEqual(["verification"]);
    expect(ownerOf(org, "code-review")).toBe("reviewer");
    expect(org.responsibilities.map((r) => r.id)).not.toContain("backend-implementation");
  });
});
