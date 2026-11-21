import { getAdapter } from "../adapters/index.js";
import { analyzeProject, recommendPreset } from "../analyzer/analyze.js";
import { composeTeam, type ComposeOptions } from "../composer/compose.js";
import { planRootAgentsMd } from "../core/agents-md.js";
import { planKnowledgeFiles } from "../knowledge/plan.js";
import type { Maturity } from "../schemas/analysis.js";
import type { OrganizationConfig } from "../schemas/organization.js";
import type { WorkspacePlan } from "../schemas/plan.js";
import { planSharedSkills } from "../workflows/skills.js";
import { APDT_VERSION } from "../version.js";

export type BuildPlanOptions = ComposeOptions & {
  createdAt?: string;
  maturity?: Maturity;
  /** When set, skip compose and use this organization as the plan source of truth. */
  organization?: OrganizationConfig;
};

export function buildWorkspacePlan(
  repoRoot: string,
  options: BuildPlanOptions = {},
): WorkspacePlan {
  const analysis = analyzeProject(repoRoot);
  // Freeze analyzedAt for determinism when provided
  if (options.createdAt) {
    analysis.analyzedAt = options.createdAt;
  }
  if (options.maturity) {
    analysis.maturity = options.maturity;
    if (!options.preset) {
      analysis.recommendedPreset = recommendPreset(options.maturity, analysis.signals);
    }
  }

  const organization = options.organization ?? composeTeam(analysis, options);
  const warnings = [...analysis.warnings];

  const files = [
    ...planKnowledgeFiles(analysis, organization),
    planRootAgentsMd(organization),
    ...planSharedSkills(),
  ];

  const capabilities = [];
  for (const id of organization.harnesses.enabled) {
    const adapter = getAdapter(id);
    capabilities.push(...adapter.capabilities());
    files.push(...adapter.plan({ repoRoot, analysis, organization }));
    if (adapter.version.includes("stub")) {
      warnings.push(`${adapter.displayName} adapter is stubbed (Phase 3).`);
    }
  }

  // Deduplicate paths (last wins — should not happen)
  const byPath = new Map(files.map((f) => [f.path, f]));
  const uniqueFiles = [...byPath.values()].sort((a, b) =>
    a.path.localeCompare(b.path),
  );

  return {
    meta: {
      apdtVersion: APDT_VERSION,
      createdAt: options.createdAt ?? analysis.analyzedAt,
      primaryHarness: organization.harnesses.primary,
    },
    project: analysis,
    organization,
    files: uniqueFiles,
    capabilities,
    warnings,
  };
}
