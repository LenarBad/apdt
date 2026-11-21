import { existsSync } from "node:fs";
import { join } from "node:path";
import { getAdapter } from "../adapters/index.js";
import { untriagedEvaluationBasenames } from "../continuity/evaluations.js";
import { pathExists, readText } from "../fsutil.js";
import { contentHash } from "../hash.js";
import { loadManifest } from "../inventory/manifest.js";
import { loadOrganization } from "../organization/load.js";
import { MANIFEST_PATH } from "../paths.js";
import type { HarnessId } from "../schemas/analysis.js";
import type { DoctorFinding } from "../schemas/plan.js";

const AGENT_SPEC: Record<
  HarnessId,
  { root: string; ext: string } | null
> = {
  cursor: { root: ".cursor/agents", ext: ".md" },
  "claude-code": { root: ".claude/agents", ext: ".md" },
  codex: { root: ".codex/agents", ext: ".toml" },
};

function enabledHarnesses(repoRoot: string): HarnessId[] {
  const loaded = loadOrganization(repoRoot);
  return loaded.ok ? loaded.organization.harnesses.enabled : [];
}

function loadOrgFromDisk(repoRoot: string): DoctorFinding[] {
  const findings: DoctorFinding[] = [];

  for (const p of [
    "apdt/organization/team.yaml",
    "apdt/organization/responsibilities.yaml",
    "apdt/organization/autonomy.yaml",
    "apdt/product/overview.md",
    "apdt/execution/current-status.md",
    "apdt/ONBOARDING.md",
    "AGENTS.md",
  ]) {
    if (!pathExists(join(repoRoot, p))) {
      findings.push({
        severity: "error",
        code: "MISSING_FILE",
        message: `Missing required file: ${p}`,
        path: p,
      });
    }
  }

  const loaded = loadOrganization(repoRoot);
  if (!loaded.ok) {
    if (findings.some((f) => f.code === "MISSING_FILE" && f.path?.startsWith("apdt/organization/"))) {
      return findings;
    }
    findings.push({
      severity: "error",
      code: loaded.code,
      message: loaded.error,
      path: "apdt/organization",
    });
    return findings;
  }

  const org = loaded.organization;
  for (const harness of org.harnesses.enabled) {
    const spec = AGENT_SPEC[harness];
    if (!spec) continue;
    for (const agent of org.team.agents) {
      const agentPath = `${spec.root}/${agent.id}${spec.ext}`;
      if (!existsSync(join(repoRoot, agentPath))) {
        findings.push({
          severity: "error",
          code: "MISSING_AGENT",
          message: `Missing ${harness} agent definition for ${agent.id}`,
          path: agentPath,
        });
      }
    }
  }

  const agentsMd = pathExists(join(repoRoot, "AGENTS.md"))
    ? readText(join(repoRoot, "AGENTS.md"))
    : "";
  if (agentsMd && !agentsMd.includes("apdt/")) {
    findings.push({
      severity: "error",
      code: "BROKEN_POINTER",
      message: "AGENTS.md does not reference apdt/ knowledge",
      path: "AGENTS.md",
    });
  }

  if (!org.team.agents.some((a) => a.id === org.team.coordination.evaluatorAgentId)) {
    findings.push({
      severity: "error",
      code: "MISSING_EVALUATOR",
      message: "Evaluator agent missing from team",
    });
  }

  return findings;
}

export function doctor(repoRoot: string): {
  findings: DoctorFinding[];
  exitCode: number;
} {
  const findings: DoctorFinding[] = [];
  findings.push(...loadOrgFromDisk(repoRoot));

  const manifest = loadManifest(repoRoot);
  if (!manifest) {
    findings.push({
      severity: "error",
      code: "MISSING_MANIFEST",
      message: "Missing APDT manifest",
      path: MANIFEST_PATH,
    });
  } else {
    for (const entry of manifest.files) {
      const abs = join(repoRoot, entry.path);
      if (!pathExists(abs)) {
        findings.push({
          severity: "error",
          code: "INVENTORY_OUT_OF_SYNC",
          message: `Manifest lists missing file: ${entry.path}`,
          path: entry.path,
        });
        continue;
      }
      const hash = contentHash(readText(abs));
      if (hash !== entry.hash) {
        findings.push({
          severity: "warning",
          code: "DIRTY_MANAGED",
          message: `Managed file differs from inventory hash: ${entry.path}`,
          path: entry.path,
        });
      }
    }
  }

  // Required skills
  for (const skill of ["session-start", "session-handoff", "evaluate-product"]) {
    const p = `.agents/skills/${skill}/SKILL.md`;
    if (!pathExists(join(repoRoot, p))) {
      findings.push({
        severity: "error",
        code: "MISSING_SKILL",
        message: `Missing skill: ${skill}`,
        path: p,
      });
    }
  }

  for (const id of enabledHarnesses(repoRoot)) {
    findings.push(...getAdapter(id).validate(repoRoot));
  }

  for (const name of untriagedEvaluationBasenames(repoRoot)) {
    const path = `apdt/product/evaluations/${name}`;
    findings.push({
      severity: "warning",
      code: "UNTRIAGED_EVALUATION",
      path,
      message:
        "Evaluation is untriaged; PM should run plan-improvements to add a ## Triage section with Status: triaged",
    });
  }

  const hasError = findings.some((f) => f.severity === "error");
  return { findings, exitCode: hasError ? 1 : 0 };
}

export function formatFindings(findings: DoctorFinding[]): string {
  if (!findings.length) return "No issues found.";
  return findings
    .map((f) => `[${f.severity}] ${f.code}${f.path ? ` (${f.path})` : ""}: ${f.message}`)
    .join("\n");
}
