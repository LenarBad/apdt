import { readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { templatesRoot } from "../paths.js";
import type { ProjectAnalysis, Preset, HarnessId } from "../schemas/analysis.js";
import {
  type AutonomyLevel,
  type ComposedAgent,
  type OrganizationConfig,
  type ResponsibilityId,
  ResponsibilityIdSchema,
} from "../schemas/organization.js";
import { TEMPLATE_VERSION } from "../version.js";

type RawProfile = {
  id: string;
  name: string;
  role: string;
  mission: string;
  responsibilities: string[];
  tools?: { readonly?: boolean; deny?: string[] };
  reportsTo?: string;
  combinableWith?: string[];
};

type ProfilesFile = {
  version: string;
  profiles: RawProfile[];
  presets: Record<
    string,
    { description: string; agents: Array<{ id: string; profiles: string[] }> }
  >;
};

const DEFAULT_GATES = [
  {
    id: "destructive-fs",
    description: "Destructive filesystem or irreversible git operations",
    requiresApproval: true,
  },
  {
    id: "publish-release",
    description: "Publishing packages or creating public releases",
    requiresApproval: true,
  },
  {
    id: "dependency-add",
    description: "Adding new production dependencies",
    requiresApproval: true,
  },
  {
    id: "security-config",
    description: "Changes to security-sensitive configuration",
    requiresApproval: true,
  },
  {
    id: "architecture-shift",
    description: "Major architecture changes after acceptance",
    requiresApproval: true,
  },
];

const RESP_DESCRIPTIONS: Record<ResponsibilityId, string> = {
  "product-vision": "Own vision, goals, non-goals, and product framing",
  requirements: "Specify requirements and acceptance criteria",
  prioritization: "Prioritize roadmap and backlog",
  architecture: "Own technical architecture and ADRs",
  implementation: "Implement application changes",
  verification: "Test strategy and verification evidence",
  "code-review": "Independent review of changes",
  "independent-evaluation": "Independently evaluate product vs objectives",
  "backend-implementation": "Implement server, API, data, and integration logic",
  "frontend-implementation": "Implement user interfaces and client-side behavior",
  "security-review": "Identify security and abuse risks in design and changes",
};

/** Always present. Specialist ids are added only when that agent is emitted. */
const CORE_RESPONSIBILITIES: ResponsibilityId[] = [
  "product-vision",
  "requirements",
  "prioritization",
  "architecture",
  "implementation",
  "verification",
  "code-review",
  "independent-evaluation",
];

function loadProfiles(): ProfilesFile {
  const raw = readFileSync(join(templatesRoot(), "agents/profiles.yaml"), "utf8");
  return YAML.parse(raw) as ProfilesFile;
}

/**
 * Draft profile IDs mapped onto the core catalog when the specialist is merged
 * into an agent that already owns the target. Emitted specialists keep their
 * own id (ADR 007).
 */
const RESPONSIBILITY_ALIASES: Record<string, ResponsibilityId> = {
  "backend-implementation": "implementation",
  "frontend-implementation": "implementation",
  "test-automation": "verification",
  "security-review": "code-review",
  "ux-evaluation": "independent-evaluation",
  "problem-analysis": "requirements",
  "requirements-quality": "requirements",
  "user-research": "requirements",
  "market-research": "requirements",
};

function mapResponsibilities(ids: string[]): ResponsibilityId[] {
  const native = new Set(ids.filter((id) => !RESPONSIBILITY_ALIASES[id]));
  const out: ResponsibilityId[] = [];
  for (const id of ids) {
    const alias = RESPONSIBILITY_ALIASES[id];
    const keepDistinct = alias !== undefined && !native.has(alias);
    const mapped = keepDistinct ? id : (alias ?? id);
    const parsed = ResponsibilityIdSchema.safeParse(mapped);
    if (parsed.success && !out.includes(parsed.data)) out.push(parsed.data);
  }
  return out;
}

function mergeProfiles(profiles: RawProfile[]): {
  displayName: string;
  role: string;
  mission: string;
  responsibilities: ResponsibilityId[];
  readonly: boolean;
  reportsTo?: string;
  profileIds: string[];
} {
  const primary = profiles[0]!;
  const responsibilities = mapResponsibilities(
    profiles.flatMap((p) => p.responsibilities),
  );
  const readonly = profiles.some((p) => p.tools?.readonly === true);
  const displayName =
    profiles.length === 1
      ? primary.name
      : profiles.map((p) => p.name).join(" / ");
  return {
    displayName,
    role: primary.role,
    mission: profiles.map((p) => p.mission).join(" "),
    responsibilities,
    readonly,
    reportsTo: primary.reportsTo,
    profileIds: profiles.map((p) => p.id),
  };
}

export type ComposeOptions = {
  preset?: Preset;
  autonomy?: AutonomyLevel;
  harnesses?: HarnessId[];
  projectName?: string;
};

export function composeTeam(
  analysis: ProjectAnalysis,
  options: ComposeOptions = {},
): OrganizationConfig {
  const catalog = loadProfiles();
  const byId = new Map(catalog.profiles.map((p) => [p.id, p]));

  // Phase 2: default path uses minimal; other presets opt-in
  const requested = options.preset ?? analysis.recommendedPreset;
  const preset: Preset =
    requested === "minimal" || options.preset
      ? requested
      : analysis.maturity === "greenfield" || analysis.maturity === "early"
        ? "minimal"
        : requested;

  const presetDef = catalog.presets[preset] ?? catalog.presets.minimal;
  if (!presetDef) throw new Error("minimal preset missing from profiles.yaml");

  const agents: ComposedAgent[] = presetDef.agents.map((a) => {
    const profiles = a.profiles.map((id) => {
      const p = byId.get(id);
      if (!p) throw new Error(`Unknown profile: ${id}`);
      return p;
    });
    const merged = mergeProfiles(profiles);
    return {
      id: a.id,
      profileIds: merged.profileIds,
      displayName: merged.displayName,
      role: merged.role,
      mission: merged.mission,
      responsibilities: merged.responsibilities,
      readonly: merged.readonly,
      reportsTo: merged.reportsTo,
    };
  });

  // Invariants
  if (!agents.some((a) => a.id === "evaluator" || a.responsibilities.includes("independent-evaluation"))) {
    throw new Error("Composer invariant failed: evaluator required");
  }

  const ownerFor = (resp: ResponsibilityId): string => {
    const owner = agents.find((a) => a.responsibilities.includes(resp));
    if (!owner) {
      // Assign to eng-lead or pm as fallback for coverage
      if (resp === "independent-evaluation") return "evaluator";
      if (["product-vision", "requirements", "prioritization"].includes(resp)) return "pm";
      if (resp === "code-review" || resp === "verification") {
        return agents.find((a) => a.id === "qa")?.id ?? "eng-lead";
      }
      return agents.find((a) => a.id === "eng-lead")?.id ?? agents[0]!.id;
    }
    return owner.id;
  };

  const required: ResponsibilityId[] = [
    ...CORE_RESPONSIBILITIES,
    ...(["backend-implementation", "frontend-implementation", "security-review"] as const).filter(
      (id) => agents.some((agent) => agent.responsibilities.includes(id)),
    ),
  ];

  // Ensure agents carry required responsibilities via assignment even if merge dropped some
  for (const agent of agents) {
    if (agent.id === "pm") {
      for (const r of ["product-vision", "requirements", "prioritization"] as ResponsibilityId[]) {
        if (!agent.responsibilities.includes(r)) agent.responsibilities.push(r);
      }
    }
    if (agent.id === "eng-lead") {
      for (const r of ["architecture", "implementation"] as ResponsibilityId[]) {
        if (!agent.responsibilities.includes(r)) agent.responsibilities.push(r);
      }
    }
    if (agent.id === "qa") {
      if (!agent.responsibilities.includes("verification")) {
        agent.responsibilities.push("verification");
      }
      const reviewerOwnsCodeReview = agents.some(
        (other) => other.id !== "qa" && other.responsibilities.includes("code-review"),
      );
      if (!reviewerOwnsCodeReview && !agent.responsibilities.includes("code-review")) {
        agent.responsibilities.push("code-review");
      }
    }
    if (agent.id === "evaluator") {
      if (!agent.responsibilities.includes("independent-evaluation")) {
        agent.responsibilities.push("independent-evaluation");
      }
    }
  }

  const responsibilities = required.map((id) => ({
    id,
    description: RESP_DESCRIPTIONS[id],
    ownerAgentId: ownerFor(id),
  }));

  const harnesses = options.harnesses?.length
    ? options.harnesses
    : (["cursor"] as HarnessId[]);

  return {
    version: TEMPLATE_VERSION,
    projectName: options.projectName ?? basenameName(analysis.root),
    autonomy: {
      level: options.autonomy ?? "supervised",
      gates: DEFAULT_GATES,
    },
    responsibilities,
    team: {
      agents,
      coordination: {
        productOwnerAgentId: "pm",
        engineeringLeadAgentId: "eng-lead",
        evaluatorAgentId: "evaluator",
        notes:
          preset === "minimal"
            ? "Minimal team: responsibilities merged for small projects."
            : undefined,
      },
    },
    harnesses: {
      primary: harnesses[0]!,
      enabled: harnesses,
      ...(harnesses.includes("claude-code")
        ? {
            claudeCode: {
              usageGuard: {
                enabled: true,
                pauseAtPercent: 90,
              },
            },
          }
        : {}),
    },
    preset,
  };
}

function basenameName(root: string): string {
  const parts = root.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || "project";
}
