import { describe, expect, it } from "vitest";
import type { ProjectAnalysis } from "../src/schemas/analysis.js";
import {
  collectInitAnswers,
  parseAutonomy,
  parseConfirm,
  parseHarnessList,
  parsePreset,
  type PromptIO,
} from "../src/init/prompts.js";

function analysis(overrides: Partial<ProjectAnalysis> = {}): ProjectAnalysis {
  return {
    apdtAnalysisVersion: "1",
    root: "/tmp/demo",
    analyzedAt: "2026-11-21T00:00:00.000Z",
    isEmpty: true,
    isGitRepo: false,
    maturity: "greenfield",
    stack: {
      languages: [],
      frameworks: [],
      packageManagers: [],
      manifests: [],
    },
    testing: { frameworks: [], hasTests: false, evidence: [] },
    ci: { systems: [], evidence: [] },
    documentation: { hasReadme: false, evidence: [] },
    existingHarnesses: [],
    signals: [],
    recommendedPreset: "minimal",
    missingCapabilities: [],
    warnings: [],
    summary: "empty",
    ...overrides,
  };
}

function scripted(answers: string[]): PromptIO & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    write(text) {
      lines.push(text);
    },
    ask() {
      const next = answers.shift();
      if (next === undefined) throw new Error("unexpected prompt");
      return Promise.resolve(next);
    },
  };
}

describe("init prompt parsers", () => {
  it("accepts defaults and named choices", () => {
    expect(parseConfirm("")).toBe("yes");
    expect(parseConfirm("e")).toBe("edit");
    expect(parseConfirm("abort")).toBe("abort");
    expect(parseHarnessList("", ["cursor"])).toEqual({ ok: true, value: ["cursor"] });
    expect(parseHarnessList("cursor, claude-code", ["cursor"])).toEqual({
      ok: true,
      value: ["cursor", "claude-code"],
    });
    expect(parseHarnessList("nope", ["cursor"]).ok).toBe(false);
    expect(parsePreset("", "minimal")).toBe("minimal");
    expect(parsePreset("f", "minimal")).toBe("full-stack-split");
    expect(parseAutonomy("", "supervised")).toBe("supervised");
    expect(parseAutonomy("autonomous", "supervised")).toBe("autonomous");
  });
});

describe("collectInitAnswers", () => {
  it("accepts detected defaults", async () => {
    const io = scripted(["", "", "", "", ""]);
    const choice = await collectInitAnswers(io, {
      analysis: analysis(),
      defaults: { harnesses: ["cursor"], autonomy: "supervised" },
      recommendedPreset: () => "minimal",
      describeTeam: () => "team",
      preview: () => "preview",
    });
    expect(choice).toEqual({
      maturity: "greenfield",
      harnesses: ["cursor"],
      preset: "minimal",
      autonomy: "supervised",
      write: true,
    });
    expect(io.lines.some((l) => l.includes("preview"))).toBe(true);
  });

  it("aborts before writing", async () => {
    const io = scripted(["a"]);
    const choice = await collectInitAnswers(io, {
      analysis: analysis(),
      defaults: { harnesses: ["cursor"], autonomy: "supervised" },
      recommendedPreset: () => "minimal",
      describeTeam: () => "team",
      preview: () => "preview",
    });
    expect(choice).toBeNull();
  });

  it("applies maturity, harness, preset, and autonomy edits", async () => {
    const io = scripted([
      "edit",
      "intermediate",
      "claude-code",
      "s",
      "a",
      "y",
    ]);
    const seen: string[] = [];
    const choice = await collectInitAnswers(io, {
      analysis: analysis(),
      defaults: { harnesses: ["cursor"], autonomy: "supervised" },
      recommendedPreset: (maturity) => (maturity === "intermediate" ? "standard" : "minimal"),
      describeTeam: (preset) => {
        seen.push(preset);
        return `team ${preset}`;
      },
      preview: (partial) => `plan ${partial.harnesses.join(",")}`,
    });
    expect(choice).toMatchObject({
      maturity: "intermediate",
      harnesses: ["claude-code"],
      preset: "standard",
      autonomy: "autonomous",
    });
    expect(seen).toEqual(["standard"]);
    expect(io.lines.some((l) => l.includes("stub"))).toBe(false);
    expect(io.lines.some((l) => l.includes("plan claude-code"))).toBe(true);
  });
});
