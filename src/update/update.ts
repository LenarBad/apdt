import { applyPlan } from "../apply/apply.js";
import { doctor, formatFindings } from "../doctor/doctor.js";
import { formatPlanPreview } from "../init/preview.js";
import { buildWorkspacePlan } from "../init/build-plan.js";
import { loadManifest } from "../inventory/manifest.js";
import {
  resolveInstalledTemplateVersion,
  runPendingMigrations,
} from "../migrations/index.js";
import { loadOrganization } from "../organization/load.js";
import { applyOrgOverrides } from "../organization/overrides.js";
import type { AutonomyLevel, OrganizationConfig } from "../schemas/organization.js";
import type { HarnessId, Preset } from "../schemas/analysis.js";
import { composeTeam } from "../composer/compose.js";
import { analyzeProject } from "../analyzer/analyze.js";
import { MANIFEST_PATH } from "../paths.js";
import { TEMPLATE_VERSION } from "../version.js";

export type UpdateOptions = {
  force?: boolean;
  /** Rebuild team from presets instead of preserving installed team.yaml. */
  recompose?: boolean;
  harnesses?: HarnessId[];
  preset?: Preset;
  autonomy?: AutonomyLevel;
};

export function updateProject(repoRoot: string, options: UpdateOptions = {}) {
  const manifest = loadManifest(repoRoot);
  if (!manifest) {
    return {
      ok: false as const,
      exitCode: 1,
      report: [
        "APDT update",
        "",
        `No installation found (missing ${MANIFEST_PATH}).`,
        "Run `apdt init` first.",
      ].join("\n"),
    };
  }

  const loaded = loadOrganization(repoRoot);
  if (!loaded.ok) {
    return {
      ok: false as const,
      exitCode: 1,
      report: ["APDT update", "", `${loaded.code}: ${loaded.error}`].join("\n"),
    };
  }

  const now = new Date().toISOString();
  const fromVersion = resolveInstalledTemplateVersion(manifest);
  const migrations = runPendingMigrations(
    repoRoot,
    fromVersion,
    TEMPLATE_VERSION,
    { now },
  );

  const analysis = analyzeProject(repoRoot);
  let organization: OrganizationConfig;

  if (options.recompose || (options.preset && options.preset !== loaded.organization.preset)) {
    organization = composeTeam(analysis, {
      preset: options.preset ?? loaded.organization.preset,
      autonomy: options.autonomy ?? loaded.organization.autonomy.level,
      harnesses: options.harnesses ?? loaded.organization.harnesses.enabled,
      projectName: loaded.organization.projectName,
    });
  } else {
    organization = applyOrgOverrides(loaded.organization, options);
  }

  const plan = buildWorkspacePlan(repoRoot, {
    createdAt: manifest.createdAt,
    organization,
    harnesses: organization.harnesses.enabled,
    preset: organization.preset,
    autonomy: organization.autonomy.level,
    projectName: organization.projectName,
  });

  const applyResult = applyPlan(repoRoot, plan.files, {
    force: options.force,
    now,
  });
  const preview = formatPlanPreview(plan.files, applyResult.decisions);
  const doc = doctor(repoRoot);

  return {
    ok: true as const,
    plan,
    applyResult,
    migrations,
    doctor: doc,
    exitCode: doc.exitCode,
    report: [
      "APDT update",
      `Project: ${plan.organization.projectName}`,
      `Preset: ${plan.organization.preset}`,
      `Harnesses: ${plan.organization.harnesses.enabled.join(", ")}`,
      `Autonomy: ${plan.organization.autonomy.level}`,
      options.recompose ? "Mode: recompose from preset" : "Mode: preserve installed organization",
      migrations.applied.length
        ? `Migrations applied: ${migrations.applied.join(", ")} (${migrations.fromVersion} → ${migrations.currentVersion})`
        : "",
      "",
      plan.warnings.length ? "Warnings:" : "",
      ...plan.warnings.map((w) => `  ! ${w}`),
      "",
      "Plan:",
      preview,
      "",
      `Written (${applyResult.written.length}):`,
      ...applyResult.written.map((p) => `  + ${p}`),
      `Removed (${applyResult.removed.length}):`,
      ...applyResult.removed.map((p) => `  - ${p}`),
      `Skipped (${applyResult.skipped.length}):`,
      ...applyResult.skipped.map((s) => `  ~ ${s.path} [${s.code}] ${s.reason}`),
      applyResult.backedUp.length
        ? `Backed up: ${applyResult.backedUp.join(", ")}`
        : "",
      "",
      "Doctor:",
      formatFindings(doc.findings),
    ]
      .filter(Boolean)
      .join("\n"),
  };
}
