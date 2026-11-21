import { join } from "node:path";
import YAML from "yaml";
import { loadManifest } from "../inventory/manifest.js";
import { loadOrganization } from "../organization/load.js";
import { ensureDir, writeText } from "../fsutil.js";
import { MANIFEST_PATH } from "../paths.js";
import { APDT_VERSION, TEMPLATE_VERSION } from "../version.js";
import type { OrganizationConfig } from "../schemas/organization.js";

export type ExportOptions = {
  /** Destination directory (created if missing). Default: `./apdt-export` */
  outDir?: string;
};

/** Paths that are project-private and must not be copied into an org export. */
const PRIVATE_PATH_MARKERS = [
  "apdt/product/",
  "apdt/execution/",
  "apdt/sessions/",
  "apdt/ONBOARDING.md",
  MANIFEST_PATH,
];

export function isPrivateProjectPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  return PRIVATE_PATH_MARKERS.some(
    (m) => normalized === m || normalized.startsWith(m),
  );
}

export type ExportedOrganization = Omit<OrganizationConfig, "projectName"> & {
  projectName: string;
  export: {
    kind: "apdt-organization";
    apdtVersion: string;
    templateVersion: string;
    excluded: string[];
  };
};

/** Strip project-private fields for a reusable organization template. */
export function toExportableOrganization(org: OrganizationConfig): ExportedOrganization {
  return {
    version: org.version,
    projectName: "exported-org",
    preset: org.preset,
    autonomy: org.autonomy,
    responsibilities: org.responsibilities,
    team: org.team,
    harnesses: org.harnesses,
    export: {
      kind: "apdt-organization",
      apdtVersion: APDT_VERSION,
      templateVersion: TEMPLATE_VERSION,
      excluded: [
        "product knowledge (apdt/product/)",
        "execution status (apdt/execution/)",
        "session handoffs (apdt/sessions/)",
        "onboarding (apdt/ONBOARDING.md)",
        "inventory manifest",
        "harness adapter files",
      ],
    },
  };
}

export function exportOrganization(repoRoot: string, options: ExportOptions = {}) {
  const manifest = loadManifest(repoRoot);
  if (!manifest) {
    return {
      ok: false as const,
      exitCode: 1,
      report: [
        "APDT export",
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
      report: ["APDT export", "", `${loaded.code}: ${loaded.error}`].join("\n"),
    };
  }

  const outDir = options.outDir ?? join(repoRoot, "apdt-export");
  const exported = toExportableOrganization(loaded.organization);
  const orgPath = join(outDir, "organization.yaml");
  const readmePath = join(outDir, "EXPORT.md");

  ensureDir(outDir);
  writeText(orgPath, YAML.stringify(exported));
  writeText(
    readmePath,
    `# APDT organization export

Reusable organization template exported from an APDT-managed repository.

## Included

- Team composition, responsibilities, autonomy gates, harness defaults
- Written as \`organization.yaml\` (single-file form)

## Excluded (private / project-specific)

${exported.export.excluded.map((e) => `- ${e}`).join("\n")}

## Notes

- \`projectName\` is replaced with \`exported-org\`
- This export does not include Cursor/Claude/Codex harness files
- Re-import as a future \`init --from\` source is not yet implemented
`,
  );

  return {
    ok: true as const,
    exitCode: 0,
    outDir,
    files: ["organization.yaml", "EXPORT.md"] as const,
    organization: exported,
    report: [
      "APDT export",
      `Source: ${repoRoot}`,
      `Output: ${outDir}`,
      "",
      "Written:",
      "  + organization.yaml",
      "  + EXPORT.md",
      "",
      "Excluded private project data (product, execution, sessions, onboarding, manifest, harness files).",
    ].join("\n"),
  };
}
