import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  type HarnessId,
  type Maturity,
  type Preset,
  type ProjectAnalysis,
} from "../schemas/analysis.js";
import { APDT_VERSION } from "../version.js";

const APP_MANIFESTS = [
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "Gemfile",
  "composer.json",
];

const IGNORE_NAMES = new Set([
  ".git",
  ".DS_Store",
  ".apdt-backup",
  "node_modules",
  "dist",
  ".cursor",
  ".claude",
  ".codex",
  ".agents",
]);

function safeRead(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

function hasPath(root: string, rel: string): boolean {
  return existsSync(join(root, rel));
}

function classifyEmptiness(root: string): { isEmpty: boolean; entries: string[] } {
  if (!existsSync(root)) return { isEmpty: true, entries: [] };
  const entries = readdirSync(root).filter((n) => !IGNORE_NAMES.has(n) && n !== "apdt");
  // Ignore only VCS / APDT / harness dirs for emptiness
  const meaningful = entries.filter((n) => {
    if (n === "AGENTS.md" || n === "CLAUDE.md" || n === ".gitignore") return false;
    return true;
  });
  return { isEmpty: meaningful.length === 0, entries: meaningful };
}

function detectHarnesses(root: string): ProjectAnalysis["existingHarnesses"] {
  const checks: Array<{ id: HarnessId; paths: string[] }> = [
    {
      id: "cursor",
      paths: [".cursor", "AGENTS.md"].filter((p) => hasPath(root, p)),
    },
    {
      id: "claude-code",
      paths: [".claude", "CLAUDE.md"].filter((p) => hasPath(root, p)),
    },
    {
      id: "codex",
      paths: [".codex", "AGENTS.md"].filter((p) => hasPath(root, p)),
    },
  ];
  return checks.map((c) => ({
    id: c.id,
    present: c.paths.length > 0 && (c.id !== "codex" || hasPath(root, ".codex")),
    paths: c.paths,
  })).map((c) => {
    if (c.id === "cursor") {
      const paths = [".cursor", "AGENTS.md"].filter((p) => hasPath(root, p));
      // Cursor present if .cursor exists (AGENTS.md alone is shared)
      return { id: c.id, present: hasPath(root, ".cursor"), paths };
    }
    if (c.id === "claude-code") {
      const paths = [".claude", "CLAUDE.md"].filter((p) => hasPath(root, p));
      return { id: c.id, present: paths.length > 0, paths };
    }
    const paths = [".codex"].filter((p) => hasPath(root, p));
    return { id: c.id, present: paths.length > 0, paths };
  });
}

function detectStack(root: string): ProjectAnalysis["stack"] & {
  hasAppManifest: boolean;
} {
  const languages: string[] = [];
  const frameworks: string[] = [];
  const packageManagers: string[] = [];
  const manifests: string[] = [];

  const pkgPath = join(root, "package.json");
  if (existsSync(pkgPath)) {
    manifests.push("package.json");
    packageManagers.push(
      hasPath(root, "pnpm-lock.yaml")
        ? "pnpm"
        : hasPath(root, "yarn.lock")
          ? "yarn"
          : hasPath(root, "bun.lockb")
            ? "bun"
            : "npm",
    );
    languages.push("javascript");
    const raw = safeRead(pkgPath);
    if (raw) {
      try {
        const pkg = JSON.parse(raw) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps.typescript || hasPath(root, "tsconfig.json")) {
          languages.push("typescript");
        }
        if (deps.react || deps.next) frameworks.push("react");
        if (deps.next) frameworks.push("next");
        if (deps.vue) frameworks.push("vue");
        if (deps.express || deps.fastify || deps.hono) frameworks.push("node-server");
        if (deps.vitest || deps.jest || deps.mocha) {
          // recorded in testing
        }
      } catch {
        // ignore invalid package.json
      }
    }
    if (hasPath(root, "tsconfig.json") && !languages.includes("typescript")) {
      languages.push("typescript");
      manifests.push("tsconfig.json");
    }
  }

  for (const m of ["pyproject.toml", "requirements.txt", "Pipfile"]) {
    if (hasPath(root, m)) {
      manifests.push(m);
      if (!languages.includes("python")) languages.push("python");
      packageManagers.push(m === "Pipfile" ? "pipenv" : "pip");
    }
  }
  if (hasPath(root, "Cargo.toml")) {
    manifests.push("Cargo.toml");
    languages.push("rust");
  }
  if (hasPath(root, "go.mod")) {
    manifests.push("go.mod");
    languages.push("go");
  }

  const hasAppManifest = APP_MANIFESTS.some((m) => hasPath(root, m));
  return {
    languages: [...new Set(languages)],
    frameworks: [...new Set(frameworks)],
    packageManagers: [...new Set(packageManagers)],
    manifests: [...new Set(manifests)],
    hasAppManifest,
  };
}

function detectTesting(root: string): ProjectAnalysis["testing"] {
  const evidence: string[] = [];
  const frameworks: string[] = [];
  const candidates = [
    ["vitest", "vitest.config.ts"],
    ["vitest", "vitest.config.js"],
    ["jest", "jest.config.js"],
    ["jest", "jest.config.ts"],
    ["pytest", "pytest.ini"],
    ["pytest", "pyproject.toml"],
  ] as const;

  for (const [fw, file] of candidates) {
    if (hasPath(root, file)) {
      frameworks.push(fw);
      evidence.push(file);
    }
  }

  const pkg = safeRead(join(root, "package.json"));
  if (pkg) {
    try {
      const parsed = JSON.parse(pkg) as {
        scripts?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const deps = parsed.devDependencies ?? {};
      if (deps.vitest) frameworks.push("vitest");
      if (deps.jest) frameworks.push("jest");
      if (parsed.scripts?.test) evidence.push("package.json#scripts.test");
    } catch {
      /* ignore */
    }
  }

  // Heuristic: tests/ or __tests__ or *.test.ts present at shallow depth
  const shallowTestDirs = ["tests", "test", "__tests__", "spec"];
  for (const d of shallowTestDirs) {
    if (hasPath(root, d) && statSync(join(root, d)).isDirectory()) {
      evidence.push(`${d}/`);
    }
  }

  const uniqFw = [...new Set(frameworks)];
  return {
    frameworks: uniqFw,
    hasTests: uniqFw.length > 0 || evidence.some((e) => e.endsWith("/")),
    evidence: [...new Set(evidence)],
  };
}

function detectCi(root: string): ProjectAnalysis["ci"] {
  const systems: string[] = [];
  const evidence: string[] = [];
  if (hasPath(root, ".github/workflows")) {
    systems.push("github-actions");
    evidence.push(".github/workflows");
  }
  if (hasPath(root, ".gitlab-ci.yml")) {
    systems.push("gitlab-ci");
    evidence.push(".gitlab-ci.yml");
  }
  if (hasPath(root, "Jenkinsfile")) {
    systems.push("jenkins");
    evidence.push("Jenkinsfile");
  }
  return { systems, evidence };
}

function classifyMaturity(input: {
  isEmpty: boolean;
  hasAppManifest: boolean;
  hasTests: boolean;
  hasCi: boolean;
  hasReadme: boolean;
  hasReleaseSignals: boolean;
}): Maturity {
  if (input.isEmpty || !input.hasAppManifest) return "greenfield";
  if (input.hasReleaseSignals) return "production";
  if (input.hasTests || input.hasCi) return "intermediate";
  return "early";
}

export function recommendPreset(
  maturity: Maturity,
  signals: string[],
): Preset {
  if (signals.includes("frontend-backend-split")) return "full-stack-split";
  if (maturity === "greenfield" || maturity === "early") return "minimal";
  if (maturity === "production" && signals.includes("frontend-backend-split")) {
    return "full-stack-split";
  }
  return maturity === "intermediate" || maturity === "production"
    ? "standard"
    : "minimal";
}

export function analyzeProject(root: string): ProjectAnalysis {
  const { isEmpty } = classifyEmptiness(root);
  const isGitRepo = hasPath(root, ".git");
  const stack = detectStack(root);
  const testing = detectTesting(root);
  const ci = detectCi(root);
  const hasReadme = hasPath(root, "README.md") || hasPath(root, "readme.md");
  const hasReleaseSignals =
    hasPath(root, "Dockerfile") ||
    hasPath(root, ".github/workflows") && hasPath(root, "CHANGELOG.md") ||
    Boolean(safeRead(join(root, "package.json"))?.includes('"version"'));

  const signals: string[] = [];
  if (stack.languages.includes("typescript")) signals.push("typescript");
  if (stack.frameworks.includes("react") || stack.frameworks.includes("vue")) {
    signals.push("frontend");
  }
  if (stack.frameworks.includes("node-server") || stack.languages.includes("python")) {
    signals.push("backend");
  }
  if (
    (hasPath(root, "apps/web") || hasPath(root, "packages/web")) &&
    (hasPath(root, "apps/api") || hasPath(root, "packages/api") || hasPath(root, "services"))
  ) {
    signals.push("frontend-backend-split");
  }
  if (testing.hasTests) signals.push("has-tests");
  if (ci.systems.length) signals.push("has-ci");

  const maturity = classifyMaturity({
    isEmpty,
    hasAppManifest: stack.hasAppManifest,
    hasTests: testing.hasTests,
    hasCi: ci.systems.length > 0,
    hasReadme,
    hasReleaseSignals: Boolean(hasReleaseSignals) && stack.hasAppManifest && testing.hasTests,
  });

  const recommendedPreset = recommendPreset(maturity, signals);
  const existingHarnesses = detectHarnesses(root);
  const warnings: string[] = [];
  if (!stack.hasAppManifest && !isEmpty) {
    warnings.push("No known application manifest detected; stack labeled from heuristics only.");
  }

  const missingCapabilities: string[] = [];
  if (!testing.hasTests && stack.hasAppManifest) missingCapabilities.push("automated-tests");
  if (!ci.systems.length && maturity !== "greenfield") missingCapabilities.push("ci");
  if (!hasReadme) missingCapabilities.push("readme");

  const summaryParts = [
    isEmpty ? "Empty/greenfield repository" : "Existing repository",
    `maturity=${maturity}`,
    stack.languages.length
      ? `languages=${stack.languages.join(",")}`
      : "languages=unknown",
    `preset=${recommendedPreset}`,
  ];

  const { hasAppManifest: _, ...stackOut } = stack;

  return {
    apdtAnalysisVersion: APDT_VERSION,
    root,
    analyzedAt: new Date().toISOString(),
    isEmpty,
    isGitRepo,
    maturity,
    stack: stackOut.languages.length
      ? stackOut
      : {
          ...stackOut,
          languages: isEmpty ? [] : ["unknown"],
        },
    testing,
    ci,
    documentation: {
      hasReadme,
      evidence: hasReadme ? [hasPath(root, "README.md") ? "README.md" : "readme.md"] : [],
    },
    existingHarnesses,
    signals,
    recommendedPreset,
    missingCapabilities,
    warnings,
    summary: summaryParts.join("; "),
  };
}

export function formatAnalysis(analysis: ProjectAnalysis): string {
  const lines = [
    `Root: ${analysis.root}`,
    `Empty: ${analysis.isEmpty}`,
    `Git: ${analysis.isGitRepo}`,
    `Maturity: ${analysis.maturity}`,
    `Preset: ${analysis.recommendedPreset}`,
    `Languages: ${analysis.stack.languages.join(", ") || "(none)"}`,
    `Frameworks: ${analysis.stack.frameworks.join(", ") || "(none)"}`,
    `Tests: ${analysis.testing.hasTests ? analysis.testing.frameworks.join(", ") || "yes" : "no"}`,
    `CI: ${analysis.ci.systems.join(", ") || "none"}`,
    `Harnesses: ${
      analysis.existingHarnesses
        .filter((h) => h.present)
        .map((h) => h.id)
        .join(", ") || "none"
    }`,
    `Summary: ${analysis.summary}`,
  ];
  if (analysis.warnings.length) {
    lines.push("Warnings:");
    for (const w of analysis.warnings) lines.push(`  - ${w}`);
  }
  return lines.join("\n");
}
