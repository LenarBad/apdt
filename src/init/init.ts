import { join } from "node:path";
import YAML from "yaml";
import { applyPlan } from "../apply/apply.js";
import { doctor, formatFindings } from "../doctor/doctor.js";
import { pathExists, readText } from "../fsutil.js";
import { loadManifest } from "../inventory/manifest.js";
import { loadOrganization } from "../organization/load.js";
import { applyOrgOverrides } from "../organization/overrides.js";
import { buildWorkspacePlan, type BuildPlanOptions } from "./build-plan.js";
import { formatPlanPreview } from "./preview.js";
import type { AutonomyLevel, OrganizationConfig } from "../schemas/organization.js";
import type { HarnessId, Preset } from "../schemas/analysis.js";

export type InitOptions = BuildPlanOptions & {
  yes?: boolean;
  force?: boolean;
  /** Rebuild team from presets even when a valid organization already exists. */
  recompose?: boolean;
  harnesses?: HarnessId[];
  preset?: Preset;
  autonomy?: AutonomyLevel;
  projectName?: string;
};

function peekProjectName(repoRoot: string): string | undefined {
  const teamPath = join(repoRoot, "apdt/organization/team.yaml");
  if (!pathExists(teamPath)) return undefined;
  try {
    const team = YAML.parse(readText(teamPath)) as { projectName?: unknown };
    return typeof team.projectName === "string" ? team.projectName : undefined;
  } catch {
    return undefined;
  }
}

export function initProject(repoRoot: string, options: InitOptions = {}) {
  // Preserve original createdAt so regenerated content stays hash-stable on clean re-init
  const existing = loadManifest(repoRoot);
  const createdAt = options.createdAt ?? existing?.createdAt;

  let organization: OrganizationConfig | undefined = options.organization;
  let repairOrg = false;
  const warnings: string[] = [];

  let recompose = Boolean(options.recompose);

  if (!organization) {
    const loaded = loadOrganization(repoRoot);
    if (loaded.ok && !recompose) {
      const presetChanged =
        Boolean(options.preset) && options.preset !== loaded.organization.preset;
      if (presetChanged) {
        recompose = true;
        repairOrg = true;
        warnings.push(
          `Preset change (${loaded.organization.preset} → ${options.preset}): recomposing team and updating apdt/organization (backup first).`,
        );
      } else {
        organization = applyOrgOverrides(loaded.organization, options);
        const orgChanged =
          JSON.stringify(organization.harnesses) !==
            JSON.stringify(loaded.organization.harnesses) ||
          organization.autonomy.level !== loaded.organization.autonomy.level;
        if (orgChanged) {
          repairOrg = true;
          warnings.push(
            "Updating apdt/organization to match requested harnesses/autonomy (backup first).",
          );
        } else {
          warnings.push(
            "Using existing apdt/organization (preserved; not recomposed).",
          );
        }
      }
    } else if (!loaded.ok && loaded.code === "INVALID_ORG") {
      repairOrg = true;
      warnings.push(
        `Existing organization is invalid (${loaded.error}); repairing apdt/organization/* with backup.`,
      );
    }
  }

  const plan = buildWorkspacePlan(repoRoot, {
    ...options,
    createdAt,
    organization: recompose ? undefined : organization,
    projectName:
      options.projectName ??
      organization?.projectName ??
      peekProjectName(repoRoot),
  });
  plan.warnings.push(...warnings);

  const capabilityDigest = plan.capabilities
    .map((c) => `  - ${c.capability}: ${c.support}${c.notes ? ` (${c.notes})` : ""}`)
    .join("\n");

  const applyResult = applyPlan(repoRoot, plan.files, {
    force: options.force,
    // Unique backup stamps even when createdAt is frozen for determinism
    now: new Date().toISOString(),
    adoptApdt: true,
    repairOrg,
  });
  const preview = formatPlanPreview(plan.files, applyResult.decisions);

  const doc = doctor(repoRoot);

  return {
    plan,
    applyResult,
    doctor: doc,
    report: [
      "APDT init",
      `Project: ${plan.organization.projectName}`,
      `Maturity: ${plan.project.maturity}`,
      `Preset: ${plan.organization.preset}`,
      `Harnesses: ${plan.organization.harnesses.enabled.join(", ")}`,
      `Autonomy: ${plan.organization.autonomy.level}`,
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
      "Capability digest:",
      capabilityDigest,
      "",
      "Doctor:",
      formatFindings(doc.findings),
      "",
      "Next: read apdt/ONBOARDING.md",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}
