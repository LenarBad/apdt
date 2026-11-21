import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { analyzeProject, formatAnalysis } from "../analyzer/analyze.js";
import { composeTeam } from "../composer/compose.js";
import { isDir, pathExists, readText } from "../fsutil.js";
import { loadManifest } from "../inventory/manifest.js";
import { loadOrganization } from "../organization/load.js";
import type { OrganizationConfig } from "../schemas/organization.js";
import { APDT_VERSION } from "../version.js";
import { formatUntriagedEvaluations } from "./evaluations.js";

const MARKDOWN_HEADING = /^\s*#{1,6}(?:\s+|$)/;

export type HandoffFile = {
  name: string;
  mtimeMs: number;
};

/**
 * Newest `*.md` by mtime. Equal mtimes fall back to the lexicographically last name.
 * Ignores `.gitkeep` and non-markdown. `none` when nothing remains.
 */
export function latestHandoffFilename(files: readonly HandoffFile[]): string {
  const markdown = files.filter(
    (file) => file.name !== ".gitkeep" && file.name.endsWith(".md"),
  );
  if (markdown.length === 0) return "none";
  const ranked = [...markdown].sort((a, b) => {
    if (a.mtimeMs !== b.mtimeMs) return a.mtimeMs - b.mtimeMs;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  return ranked.at(-1)?.name ?? "none";
}

/** Body of `## Active` until the next `##` heading. `unknown` if the file or heading is missing. */
export function readActiveSection(markdown: string | null | undefined): string {
  if (markdown == null) return "unknown";
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => /^## Active\s*$/.test(line));
  if (start < 0) return "unknown";
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s+/.test(line)) break;
    body.push(line);
  }
  return body.join("\n").trim();
}

/**
 * `none recorded` when the file is missing.
 * `none` when the body is empty or only says none (case-insensitive; headings ignored).
 * Otherwise the trimmed file body.
 */
export function summarizeBlockers(content: string | null | undefined): string {
  if (content == null) return "none recorded";
  const withoutHeadings = content
    .split(/\r?\n/)
    .filter((line) => !MARKDOWN_HEADING.test(line))
    .join("\n")
    .trim();
  const said = withoutHeadings.replace(/[.!]$/, "");
  if (withoutHeadings.length === 0 || /^none$/i.test(said)) {
    return "none";
  }
  return content.trim();
}

export function listHandoffFilenames(repoRoot: string): HandoffFile[] {
  const dir = join(repoRoot, "apdt/sessions/handoffs");
  if (!isDir(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => ({
        name: entry.name,
        mtimeMs: statSync(join(dir, entry.name)).mtimeMs,
      }));
  } catch {
    return [];
  }
}

function readOptional(path: string): string | null {
  if (!pathExists(path)) return null;
  try {
    return readText(path);
  } catch {
    return null;
  }
}

export function formatTeam(
  org: OrganizationConfig,
  source: "installed" | "recommended",
): string {
  return [
    `Source: ${source}`,
    `Preset: ${org.preset}`,
    `Autonomy: ${org.autonomy.level}`,
    ...org.team.agents.map(
      (agent) =>
        `- ${agent.id}: ${agent.displayName} [${agent.responsibilities.join(", ")}]`,
    ),
  ].join("\n");
}

export function organizationLine(org: OrganizationConfig | null): string {
  if (!org) return "Organization: not installed";
  const harnesses = org.harnesses.enabled.join(", ");
  return `Organization: installed harnesses ${harnesses}; preset ${org.preset}`;
}

/** Text printed by `apdt team`. Installed org wins; otherwise the analyzer preset. */
export function teamReport(repoRoot: string): string {
  const loaded = loadOrganization(repoRoot);
  if (loaded.ok) return formatTeam(loaded.organization, "installed");
  const analysis = analyzeProject(repoRoot);
  const org = composeTeam(analysis, { preset: analysis.recommendedPreset });
  return formatTeam(org, "recommended");
}

/** Text printed by `apdt status`. */
export function statusReport(repoRoot: string): string {
  const analysis = analyzeProject(repoRoot);
  const manifest = loadManifest(repoRoot);
  const loaded = loadOrganization(repoRoot);
  const active = readActiveSection(
    readOptional(join(repoRoot, "apdt/execution/current-status.md")),
  );
  const blockers = summarizeBlockers(
    readOptional(join(repoRoot, "apdt/execution/blockers.md")),
  );
  const handoff = latestHandoffFilename(listHandoffFilenames(repoRoot));
  return [
    `APDT version: ${APDT_VERSION}`,
    `Root: ${repoRoot}`,
    `Maturity: ${analysis.maturity}`,
    `Recommended preset: ${analysis.recommendedPreset}`,
    `Manifest: ${
      manifest
        ? `${manifest.files.length} managed files (created ${manifest.createdAt})`
        : "not installed"
    }`,
    organizationLine(loaded.ok ? loaded.organization : null),
    `Latest handoff: ${handoff}`,
    `Active: ${active}`,
    `Blockers: ${blockers}`,
    formatUntriagedEvaluations(repoRoot),
    formatAnalysis(analysis),
  ].join("\n");
}
