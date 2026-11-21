import { join } from "node:path";
import YAML from "yaml";
import { pathExists, readText } from "../fsutil.js";
import {
  OrganizationConfigSchema,
  type OrganizationConfig,
} from "../schemas/organization.js";

export type LoadOrganizationResult =
  | { ok: true; organization: OrganizationConfig }
  | { ok: false; error: string; code: string };

/** Load and validate the installed organization from `apdt/organization/`. */
export function loadOrganization(repoRoot: string): LoadOrganizationResult {
  const teamPath = join(repoRoot, "apdt/organization/team.yaml");
  const respPath = join(repoRoot, "apdt/organization/responsibilities.yaml");
  const autonomyPath = join(repoRoot, "apdt/organization/autonomy.yaml");

  for (const [path, label] of [
    [teamPath, "apdt/organization/team.yaml"],
    [respPath, "apdt/organization/responsibilities.yaml"],
    [autonomyPath, "apdt/organization/autonomy.yaml"],
  ] as const) {
    if (!pathExists(path)) {
      return {
        ok: false,
        code: "MISSING_ORG_FILE",
        error: `Missing required organization file: ${label}`,
      };
    }
  }

  try {
    const team = YAML.parse(readText(teamPath)) as {
      version?: string;
      projectName?: string;
      team?: unknown;
      harnesses?: unknown;
      preset?: string;
    };
    const responsibilities = YAML.parse(readText(respPath)) as {
      responsibilities?: unknown;
    };
    const autonomy = YAML.parse(readText(autonomyPath)) as {
      level?: unknown;
      gates?: unknown;
    };

    const merged = {
      version: team.version ?? "0.2.0",
      projectName: team.projectName ?? "project",
      autonomy: {
        level: autonomy.level,
        gates: autonomy.gates ?? [],
      },
      responsibilities: responsibilities.responsibilities ?? [],
      team: team.team,
      harnesses: team.harnesses,
      preset: team.preset ?? "minimal",
    };

    const parsed = OrganizationConfigSchema.safeParse(merged);
    if (!parsed.success) {
      return {
        ok: false,
        code: "INVALID_ORG",
        error: `Organization config invalid: ${parsed.error.issues[0]?.message ?? "schema error"}`,
      };
    }
    return { ok: true, organization: parsed.data };
  } catch (e) {
    return {
      ok: false,
      code: "ORG_PARSE_ERROR",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
