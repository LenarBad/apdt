import { mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  isEvaluationTriaged,
  untriagedEvaluationBasenames,
} from "../src/continuity/evaluations.js";
import {
  latestHandoffFilename,
  readActiveSection,
  statusReport,
  summarizeBlockers,
  teamReport,
} from "../src/continuity/report.js";
import { doctor } from "../src/doctor/doctor.js";
import { contentHash } from "../src/hash.js";
import { buildWorkspacePlan } from "../src/init/build-plan.js";
import { initProject } from "../src/init/init.js";
import { loadManifest } from "../src/inventory/manifest.js";
import { loadOrganization } from "../src/organization/load.js";
import { planSharedSkills } from "../src/workflows/skills.js";
import { workspaceTempDir } from "./helpers.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function writeInvalidOrg(root: string): void {
  const org = join(root, "apdt/organization");
  mkdirSync(org, { recursive: true });
  writeFileSync(
    join(org, "team.yaml"),
    [
      "version: 0.2.0",
      "projectName: broken",
      "preset: minimal",
      "harnesses:",
      "  primary: cursor",
      "  enabled: [cursor]",
      "team:",
      "  agents: []",
      "",
    ].join("\n"),
  );
  writeFileSync(join(org, "responsibilities.yaml"), "responsibilities: []\n");
  writeFileSync(join(org, "autonomy.yaml"), "level: supervised\ngates: []\n");
}

function intermediateRepo(root: string): void {
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "demo" }));
  mkdirSync(join(root, "tests"));
}

describe("continuity readback", () => {
  it("picks the newest markdown handoff, then the lexicographically last name", () => {
    expect(
      latestHandoffFilename([
        { name: ".gitkeep", mtimeMs: 300 },
        { name: "notes.txt", mtimeMs: 400 },
        { name: "2026-11-21-brownfield-dogfood.md", mtimeMs: 200 },
        { name: "2026-11-21-update-export.md", mtimeMs: 100 },
        { name: "2026-11-20-foundation-complete.md", mtimeMs: 50 },
      ]),
    ).toBe("2026-11-21-brownfield-dogfood.md");
    expect(
      latestHandoffFilename([
        { name: "2026-11-21-brownfield-dogfood.md", mtimeMs: 100 },
        { name: "2026-11-21-update-export.md", mtimeMs: 100 },
      ]),
    ).toBe("2026-11-21-update-export.md");
    expect(
      latestHandoffFilename([
        { name: ".gitkeep", mtimeMs: 1 },
        { name: "notes.txt", mtimeMs: 2 },
      ]),
    ).toBe("none");
    expect(latestHandoffFilename([])).toBe("none");
  });

  it("uses filesystem mtime, with a lexicographic tie-break", () => {
    const root = workspaceTempDir();
    const handoffs = join(root, "apdt/sessions/handoffs");
    mkdirSync(handoffs, { recursive: true });
    const brownfield = join(handoffs, "2026-11-21-brownfield-dogfood.md");
    const updateExport = join(handoffs, "2026-11-21-update-export.md");
    const notes = join(handoffs, "notes.txt");
    writeFileSync(brownfield, "# brownfield\n");
    writeFileSync(updateExport, "# update\n");
    writeFileSync(join(handoffs, ".gitkeep"), "");
    writeFileSync(notes, "ignore");

    utimesSync(updateExport, 1_700_000_000, 1_700_000_000);
    utimesSync(brownfield, 1_700_000_100, 1_700_000_100);
    utimesSync(notes, 1_700_000_200, 1_700_000_200);
    expect(statusReport(root)).toContain(
      "Latest handoff: 2026-11-21-brownfield-dogfood.md",
    );

    utimesSync(brownfield, 1_700_000_300, 1_700_000_300);
    utimesSync(updateExport, 1_700_000_300, 1_700_000_300);
    expect(statusReport(root)).toContain(
      "Latest handoff: 2026-11-21-update-export.md",
    );
  });

  it("reads the Active section until the next heading", () => {
    expect(readActiveSection(null)).toBe("unknown");
    expect(readActiveSection("# Status\n\n## Summary\n\nno active\n")).toBe("unknown");
    expect(
      readActiveSection(
        "# Status\n\n## Active\n\nShip continuity\nand keep the body\n\n## Next\n\nlater\n",
      ),
    ).toBe("Ship continuity\nand keep the body");
  });

  it("summarizes blockers", () => {
    expect(summarizeBlockers(null)).toBe("none recorded");
    expect(summarizeBlockers("")).toBe("none");
    expect(summarizeBlockers("   \n")).toBe("none");
    expect(summarizeBlockers("# Blockers\n\n")).toBe("none");
    expect(summarizeBlockers("# Blockers\n\nNone")).toBe("none");
    expect(summarizeBlockers("# Blockers\n\nNone.\n")).toBe("none");
    expect(summarizeBlockers("NONE")).toBe("none");
    expect(summarizeBlockers("  API down  \n")).toBe("API down");
    expect(summarizeBlockers("# Blockers\n\nAPI down\n")).toBe(
      "# Blockers\n\nAPI down",
    );
  });

  it("prints the installed organization", () => {
    const root = workspaceTempDir();
    initProject(root, {
      yes: true,
      createdAt: "2026-11-21T00:00:00.000Z",
      projectName: "installed-demo",
      harnesses: ["cursor"],
      preset: "standard",
      autonomy: "conservative",
    });
    const text = teamReport(root);
    expect(text).toContain("Source: installed");
    expect(text).not.toContain("Source: recommended");
    expect(text).toContain("Preset: standard");
    expect(text).toContain("Autonomy: conservative");
    expect(text).toContain("- engineer:");
    expect(text).toContain("- evaluator:");
  });

  it("prints the analyzer recommendation when organization is missing", () => {
    const root = workspaceTempDir();
    intermediateRepo(root);
    const text = teamReport(root);
    expect(text).toContain("Source: recommended");
    expect(text).not.toContain("Source: installed");
    expect(text).toContain("Preset: standard");
    expect(text).toContain("Autonomy:");
    expect(text).toContain("- engineer:");
  });

  it("prints the analyzer recommendation when organization is invalid", () => {
    const root = workspaceTempDir();
    intermediateRepo(root);
    writeInvalidOrg(root);
    expect(loadOrganization(root).ok).toBe(false);
    const text = teamReport(root);
    expect(text).toContain("Source: recommended");
    expect(text).toContain("Preset: standard");
    expect(text).not.toContain("Preset: minimal");
    expect(text).toContain("- pm:");
  });

  it("status reports handoff, Active, and blockers", () => {
    const root = workspaceTempDir();
    initProject(root, {
      yes: true,
      createdAt: "2026-11-21T00:00:00.000Z",
      projectName: "status-demo",
      harnesses: ["cursor", "claude-code"],
      preset: "minimal",
    });
    const handoffs = join(root, "apdt/sessions/handoffs");
    mkdirSync(handoffs, { recursive: true });
    writeFileSync(join(handoffs, ".gitkeep"), "");
    writeFileSync(join(handoffs, "notes.txt"), "ignore");
    writeFileSync(join(handoffs, "2026-11-01-early.md"), "# early\n");
    writeFileSync(join(handoffs, "2026-11-21-later.md"), "# later\n");
    utimesSync(join(handoffs, "notes.txt"), 1_700_000_300, 1_700_000_300);
    utimesSync(join(handoffs, "2026-11-21-later.md"), 1_700_000_200, 1_700_000_200);
    utimesSync(join(handoffs, "2026-11-01-early.md"), 1_700_000_100, 1_700_000_100);
    writeFileSync(
      join(root, "apdt/execution/current-status.md"),
      "# Current Status\n\n## Summary\n\nhello\n\n## Active\n\nShip continuity\nand keep the body\n\n## Next\n\nlater\n",
    );
    writeFileSync(
      join(root, "apdt/execution/blockers.md"),
      "# Blockers\n\nwaiting on review\n",
    );

    const text = statusReport(root);
    expect(text).toContain("APDT version:");
    expect(text).toContain(`Root: ${root}`);
    expect(text).toContain("Maturity:");
    expect(text).toContain("Recommended preset:");
    expect(text).toContain("Manifest:");
    expect(text).toContain(
      "Organization: installed harnesses cursor, claude-code; preset minimal",
    );
    expect(text).toContain("Latest handoff: 2026-11-21-later.md");
    expect(text).toContain("Active: Ship continuity\nand keep the body");
    expect(text).not.toContain("\nlater\n");
    expect(text).toContain("Blockers: # Blockers\n\nwaiting on review");
    expect(text).toContain("Untriaged evaluations: none");
  });

  it("status reports none when handoff, Active, and blockers are absent", () => {
    const root = workspaceTempDir();
    const text = statusReport(root);
    expect(text).toContain("Organization: not installed");
    expect(text).toContain("Latest handoff: none");
    expect(text).toContain("Active: unknown");
    expect(text).toContain("Blockers: none recorded");
    expect(text).toContain("Untriaged evaluations: none");
    expect(text).toContain("Manifest: not installed");

    const partial = workspaceTempDir();
    mkdirSync(join(partial, "apdt/sessions/handoffs"), { recursive: true });
    writeFileSync(join(partial, "apdt/sessions/handoffs/.gitkeep"), "");
    writeFileSync(join(partial, "apdt/sessions/handoffs/notes.txt"), "nope");
    mkdirSync(join(partial, "apdt/execution"), { recursive: true });
    writeFileSync(
      join(partial, "apdt/execution/current-status.md"),
      "# Current Status\n\n## Summary\n\nno active heading\n",
    );
    writeFileSync(
      join(partial, "apdt/execution/blockers.md"),
      "# Blockers\n\nNone\n",
    );
    const partialText = statusReport(partial);
    expect(partialText).toContain("Latest handoff: none");
    expect(partialText).toContain("Active: unknown");
    expect(partialText).toContain("Blockers: none");
    expect(partialText).not.toContain("Blockers: none recorded");
    expect(partialText).toContain("Untriaged evaluations: none");
  });

  it("detects triage status from ## Triage Status: triaged", () => {
    expect(isEvaluationTriaged("# Eval\n\n## Findings\n\n- x\n")).toBe(false);
    expect(
      isEvaluationTriaged("# Eval\n\n## Triage\n\n**Status:** pending\n"),
    ).toBe(false);
    expect(
      isEvaluationTriaged("# Eval\n\n## Triage\n\nStatus: triaged\n"),
    ).toBe(true);
    expect(
      isEvaluationTriaged("# Eval\n\n## Triage\n\n**Status:** triaged\n\n- Accept A\n"),
    ).toBe(true);
    expect(
      isEvaluationTriaged(
        "# Eval\n\n## Triage\n\n**STATUS:** TRIAGED\n\n## Other\n\nStatus: triaged\n",
      ),
    ).toBe(true);
    expect(
      isEvaluationTriaged(
        "# Eval\n\n## Other\n\nStatus: triaged\n\n## Triage\n\nnot yet\n",
      ),
    ).toBe(false);
  });

  it("status reports untriaged evaluation basenames", () => {
    const root = workspaceTempDir();
    expect(untriagedEvaluationBasenames(root)).toEqual([]);
    expect(statusReport(root)).toContain("Untriaged evaluations: none");

    const evals = join(root, "apdt/product/evaluations");
    mkdirSync(evals, { recursive: true });
    writeFileSync(join(evals, ".gitkeep"), "");
    writeFileSync(join(evals, "notes.txt"), "ignore");
    writeFileSync(join(evals, "2026-11-01-alpha.md"), "# Alpha\n");
    writeFileSync(
      join(evals, "2026-11-02-beta.md"),
      "# Beta\n\n## Triage\n\nStatus: triaged\n\n- Accept X → BL-1\n",
    );
    writeFileSync(
      join(evals, "2026-11-03-gamma.md"),
      "# Gamma\n\n## Triage\n\n**Status:** triaged\n",
    );
    expect(untriagedEvaluationBasenames(root)).toEqual([
      "2026-11-01-alpha.md",
    ]);
    expect(statusReport(root)).toContain(
      "Untriaged evaluations: 2026-11-01-alpha.md",
    );

    writeFileSync(join(evals, "2026-11-04-delta.md"), "# Delta\n");
    expect(statusReport(root)).toContain(
      "Untriaged evaluations: 2026-11-01-alpha.md, 2026-11-04-delta.md",
    );
  });

  it("doctor warns on untriaged evaluations without failing exit", () => {
    const root = workspaceTempDir();
    initProject(root, {
      yes: true,
      createdAt: "2026-11-21T00:00:00.000Z",
      projectName: "eval-doctor",
      harnesses: ["cursor"],
      preset: "minimal",
    });
    const evals = join(root, "apdt/product/evaluations");
    mkdirSync(evals, { recursive: true });
    writeFileSync(join(evals, "2026-11-01-open.md"), "# Open\n");
    writeFileSync(
      join(evals, "2026-11-02-done.md"),
      "# Done\n\n## Triage\n\nStatus: triaged\n",
    );

    const d = doctor(root);
    const untriaged = d.findings.filter((f) => f.code === "UNTRIAGED_EVALUATION");
    expect(untriaged).toHaveLength(1);
    expect(untriaged[0]?.severity).toBe("warning");
    expect(untriaged[0]?.path).toBe(
      "apdt/product/evaluations/2026-11-01-open.md",
    );
    expect(untriaged[0]?.message).toMatch(/plan-improvements/i);
    expect(
      d.findings.some(
        (f) =>
          f.code === "UNTRIAGED_EVALUATION" &&
          f.path === "apdt/product/evaluations/2026-11-02-done.md",
      ),
    ).toBe(false);
    expect(d.findings.some((f) => f.severity === "error")).toBe(false);
    expect(d.exitCode).toBe(0);
  });

  it("plans continuity.md and omits empty backlog and blockers", () => {
    const root = workspaceTempDir();
    const plan = buildWorkspacePlan(root, {
      preset: "minimal",
      harnesses: ["cursor"],
      projectName: "continuity-plan",
      createdAt: "2026-11-21T00:00:00.000Z",
    });
    const paths = plan.files.map((file) => file.path);
    expect(paths).toContain("apdt/execution/continuity.md");
    expect(paths).not.toContain("apdt/execution/backlog.md");
    expect(paths).not.toContain("apdt/execution/blockers.md");
    const continuity = plan.files.find(
      (file) => file.path === "apdt/execution/continuity.md",
    );
    expect(continuity?.managed).toBe(true);
    const body = continuity?.content ?? "";
    expect(body).toContain("Resume from files only");
    expect(body).toContain("Do not assume subagents are still running");
    expect(body).toContain("apdt/product/overview.md");
    expect(body).toContain("apdt/organization/");
    expect(body).toContain("apdt/execution/current-status.md");
    expect(body).toContain("latest handoff");
    expect(body).toContain("apdt/execution/blockers.md");
    expect(body).toContain("when that file exists");
    expect(body).toContain("apdt/sessions/handoffs/<date>-<slug>.md");
    expect(body).toContain("apdt/engineering/technical-decisions/");
    expect(body).toContain("only when a decision is made");
    expect(body).toContain("Do not create empty backlog.md or blockers.md");
    expect(body).toContain("apdt/product/evaluations/");
    expect(body).toContain("Status: triaged");
  });

  it("installed session skills match the catalog and manifest hashes", () => {
    const skills = planSharedSkills();
    const manifest = loadManifest(repoRoot);
    expect(manifest).toBeTruthy();
    for (const name of ["session-start", "session-handoff"]) {
      const planned = skills.find(
        (file) => file.path === `.agents/skills/${name}/SKILL.md`,
      );
      expect(planned?.content).toContain("apdt/execution/continuity.md");
      expect(planned?.content).toContain("apdt/engineering/technical-decisions/");
      const installed = readFileSync(join(repoRoot, planned!.path), "utf8");
      expect(installed).toBe(planned?.content);
      const entry = manifest!.files.find((file) => file.path === planned!.path);
      expect(entry?.hash).toBe(contentHash(installed));
    }
  });

  it("evaluate-product and plan-improvements skills match catalog closed-loop steps", () => {
    const skills = planSharedSkills();
    const manifest = loadManifest(repoRoot);
    expect(manifest).toBeTruthy();

    const evaluate = skills.find(
      (file) => file.path === ".agents/skills/evaluate-product/SKILL.md",
    );
    expect(evaluate?.content).toContain("Write evaluation under apdt/product/evaluations/");
    expect(evaluate?.content).toContain(
      "Note that triage is incomplete until PM runs plan-improvements",
    );

    const planImp = skills.find(
      (file) => file.path === ".agents/skills/plan-improvements/SKILL.md",
    );
    expect(planImp?.content).toContain(
      "Append or update a ## Triage section in the evaluation file with Status: triaged",
    );
    expect(planImp?.content).toContain(
      "Create/update backlog items for accepted findings (record backlog ID, or n/a with rationale)",
    );
    expect(planImp?.content).toContain(
      "Leave triage visible in the evaluation file",
    );

    for (const planned of [evaluate, planImp]) {
      const installed = readFileSync(join(repoRoot, planned!.path), "utf8");
      expect(installed).toBe(planned?.content);
      const entry = manifest!.files.find((file) => file.path === planned!.path);
      expect(entry?.hash).toBe(contentHash(installed));
    }
  });
});
