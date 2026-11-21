#!/usr/bin/env node
import { defineCommand, runMain } from "citty";
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { analyzeProject, formatAnalysis, recommendPreset } from "./analyzer/analyze.js";
import { doctor, formatFindings } from "./doctor/doctor.js";
import { exportOrganization } from "./export/export.js";
import { initProject } from "./init/init.js";
import { buildWorkspacePlan } from "./init/build-plan.js";
import { collectInitAnswers } from "./init/prompts.js";
import { formatPlanPreview } from "./init/preview.js";
import { decideFileActions } from "./inventory/manifest.js";
import { updateProject } from "./update/update.js";
import { statusReport, teamReport } from "./continuity/report.js";
import { APDT_VERSION } from "./version.js";
import type { AutonomyLevel } from "./schemas/organization.js";
import type { HarnessId, Maturity, Preset } from "./schemas/analysis.js";
import { composeTeam } from "./composer/compose.js";

function parseHarnesses(value: string): HarnessId[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as HarnessId[];
}

function parsePreset(value: string | undefined): Preset | undefined {
  if (!value) return undefined;
  return String(value) as Preset;
}

const analyzeCmd = defineCommand({
  meta: { name: "analyze", description: "Analyze a repository without modifying it" },
  args: {
    path: { type: "positional", required: false, description: "Repository path" },
    json: { type: "boolean", description: "Print JSON", default: false },
  },
  run({ args }) {
    const root = resolve(String(args.path ?? "."));
    const analysis = analyzeProject(root);
    if (args.json) {
      console.log(JSON.stringify(analysis, null, 2));
    } else {
      console.log(formatAnalysis(analysis));
    }
  },
});

const initCmd = defineCommand({
  meta: { name: "init", description: "Initialize an APDT-managed workspace" },
  args: {
    path: { type: "positional", required: false, description: "Repository path" },
    yes: { type: "boolean", description: "Noninteractive defaults", default: false, alias: "y" },
    force: { type: "boolean", description: "Overwrite dirty managed files (with backup)", default: false },
    recompose: {
      type: "boolean",
      description: "Rebuild team from preset instead of preserving a valid installed organization",
      default: false,
    },
    harness: {
      type: "string",
      description: "Comma-separated harnesses (default: cursor)",
      default: "cursor",
    },
    preset: { type: "string", description: "Team preset: minimal|standard|full-stack-split" },
    autonomy: {
      type: "string",
      description: "autonomous|supervised|conservative",
      default: "supervised",
    },
    name: { type: "string", description: "Project name override" },
  },
  async run({ args }) {
    const root = resolve(String(args.path ?? "."));
    const harnesses = parseHarnesses(String(args.harness));
    const preset = parsePreset(args.preset ? String(args.preset) : undefined);
    const autonomy = String(args.autonomy) as AutonomyLevel;
    const projectName = args.name ? String(args.name) : undefined;
    const force = Boolean(args.force);
    const recompose = Boolean(args.recompose);

    let maturity: Maturity | undefined;
    let chosenHarnesses = harnesses;
    let chosenPreset = preset;
    let chosenAutonomy = autonomy;

    if (!args.yes) {
      if (!input.isTTY || !output.isTTY) {
        console.error(
          "Interactive init needs a terminal. Re-run with --yes for noninteractive defaults.",
        );
        process.exitCode = 2;
        return;
      }
      const analysis = analyzeProject(root);
      const rl = createInterface({ input, output });
      try {
        const choice = await collectInitAnswers(
          {
            write: (text) => output.write(`${text}\n`),
            ask: (question) => rl.question(question),
          },
          {
            analysis,
            defaults: {
              harnesses,
              preset,
              autonomy,
            },
            recommendedPreset: (maturity) => recommendPreset(maturity, analysis.signals),
            describeTeam(nextPreset) {
              const org = composeTeam(analysis, {
                preset: nextPreset,
                autonomy,
                harnesses,
                projectName,
              });
              return [
                `Preset ${org.preset}: ${org.team.agents.length} agents`,
                ...org.team.agents.map((a) => `  - ${a.id}: ${a.displayName}`),
              ].join("\n");
            },
            preview(choice) {
              const recommended = recommendPreset(choice.maturity, analysis.signals);
              const plan = buildWorkspacePlan(root, {
                maturity: choice.maturity,
                harnesses: choice.harnesses,
                preset: choice.preset ?? recommended,
                autonomy: choice.autonomy,
                projectName,
              });
              const decisions = decideFileActions(root, plan.files, { force });
              const warnings = plan.warnings.map((w) => `  ! ${w}`).join("\n");
              return [warnings ? `Warnings:\n${warnings}` : "", formatPlanPreview(plan.files, decisions)]
                .filter(Boolean)
                .join("\n\n");
            },
          },
        );
        if (!choice) {
          console.error("Init aborted. No files written.");
          process.exitCode = 2;
          return;
        }
        maturity = choice.maturity;
        chosenHarnesses = choice.harnesses;
        chosenPreset = choice.preset;
        chosenAutonomy = choice.autonomy;
      } finally {
        rl.close();
      }
    }

    const result = initProject(root, {
      yes: true,
      force,
      recompose,
      harnesses: chosenHarnesses,
      preset: chosenPreset,
      autonomy: chosenAutonomy,
      projectName,
      maturity,
    });
    console.log(result.report);
    process.exitCode = result.doctor.exitCode;
  },
});

const updateCmd = defineCommand({
  meta: {
    name: "update",
    description: "Re-render managed APDT artifacts; preserve dirty user files",
  },
  args: {
    path: { type: "positional", required: false, description: "Repository path" },
    force: {
      type: "boolean",
      description: "Overwrite dirty managed files (with backup)",
      default: false,
    },
    recompose: {
      type: "boolean",
      description: "Rebuild team from preset instead of preserving installed organization",
      default: false,
    },
    harness: {
      type: "string",
      description: "Comma-separated harnesses (default: installed)",
    },
    preset: { type: "string", description: "Team preset override (implies recompose)" },
    autonomy: {
      type: "string",
      description: "autonomous|supervised|conservative",
    },
  },
  run({ args }) {
    const root = resolve(String(args.path ?? "."));
    const result = updateProject(root, {
      force: Boolean(args.force),
      recompose: Boolean(args.recompose),
      harnesses: args.harness ? parseHarnesses(String(args.harness)) : undefined,
      preset: parsePreset(args.preset ? String(args.preset) : undefined),
      autonomy: args.autonomy ? (String(args.autonomy) as AutonomyLevel) : undefined,
    });
    console.log(result.report);
    process.exitCode = result.exitCode;
  },
});

const exportCmd = defineCommand({
  meta: {
    name: "export",
    description: "Export reusable organization template without private project data",
  },
  args: {
    path: { type: "positional", required: false, description: "Repository path" },
    out: {
      type: "string",
      description: "Output directory (default: <repo>/apdt-export)",
    },
  },
  run({ args }) {
    const root = resolve(String(args.path ?? "."));
    const outDir = args.out ? resolve(String(args.out)) : undefined;
    const result = exportOrganization(root, { outDir });
    console.log(result.report);
    process.exitCode = result.exitCode;
  },
});

const doctorCmd = defineCommand({
  meta: { name: "doctor", description: "Validate an APDT installation" },
  args: {
    path: { type: "positional", required: false, description: "Repository path" },
    strict: { type: "boolean", description: "Treat warnings as errors", default: false },
  },
  run({ args }) {
    const root = resolve(String(args.path ?? "."));
    const result = doctor(root);
    console.log(formatFindings(result.findings));
    const warnings = result.findings.some((f) => f.severity === "warning");
    if (args.strict && warnings && result.exitCode === 0) {
      process.exitCode = 1;
      return;
    }
    process.exitCode = result.exitCode;
  },
});

const statusCmd = defineCommand({
  meta: { name: "status", description: "Show APDT installation status" },
  args: {
    path: { type: "positional", required: false },
  },
  run({ args }) {
    const root = resolve(String(args.path ?? "."));
    console.log(statusReport(root));
  },
});

const teamCmd = defineCommand({
  meta: { name: "team", description: "Show recommended or installed team composition" },
  args: {
    path: { type: "positional", required: false },
  },
  run({ args }) {
    const root = resolve(String(args.path ?? "."));
    console.log(teamReport(root));
  },
});

const main = defineCommand({
  meta: {
    name: "apdt",
    version: APDT_VERSION,
    description: "Autonomous Product Development Team — workspace initializer",
  },
  subCommands: {
    analyze: analyzeCmd,
    init: initCmd,
    update: updateCmd,
    export: exportCmd,
    doctor: doctorCmd,
    status: statusCmd,
    team: teamCmd,
  },
});

runMain(main);
