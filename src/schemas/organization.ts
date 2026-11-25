import { z } from "zod";
import { HarnessIdSchema, PresetSchema } from "./analysis.js";

export const ResponsibilityIdSchema = z.enum([
  "product-vision",
  "requirements",
  "prioritization",
  "architecture",
  "implementation",
  "verification",
  "code-review",
  "independent-evaluation",
  "backend-implementation",
  "frontend-implementation",
  "security-review",
]);
export type ResponsibilityId = z.infer<typeof ResponsibilityIdSchema>;

export const AutonomyLevelSchema = z.enum([
  "autonomous",
  "supervised",
  "conservative",
]);
export type AutonomyLevel = z.infer<typeof AutonomyLevelSchema>;

export const ApprovalGateSchema = z.object({
  id: z.string(),
  description: z.string(),
  requiresApproval: z.boolean(),
});

export const ComposedAgentSchema = z.object({
  id: z.string(),
  profileIds: z.array(z.string()).min(1),
  displayName: z.string(),
  role: z.string(),
  mission: z.string(),
  responsibilities: z.array(ResponsibilityIdSchema),
  readonly: z.boolean().default(false),
  reportsTo: z.string().optional(),
});
export type ComposedAgent = z.infer<typeof ComposedAgentSchema>;

export const ClaudeUsageGuardSchema = z.object({
  /** Default on when Claude Code is enabled; set false to disable. */
  enabled: z.boolean().default(true),
  pauseAtPercent: z.number().min(1).max(100).default(90),
});
export type ClaudeUsageGuard = z.infer<typeof ClaudeUsageGuardSchema>;

export const ClaudeCodeHarnessOptionsSchema = z.object({
  usageGuard: ClaudeUsageGuardSchema.optional(),
});
export type ClaudeCodeHarnessOptions = z.infer<
  typeof ClaudeCodeHarnessOptionsSchema
>;

export const OrganizationConfigSchema = z.object({
  version: z.string(),
  projectName: z.string(),
  autonomy: z.object({
    level: AutonomyLevelSchema,
    gates: z.array(ApprovalGateSchema),
  }),
  responsibilities: z.array(
    z.object({
      id: ResponsibilityIdSchema,
      description: z.string(),
      ownerAgentId: z.string(),
    }),
  ),
  team: z.object({
    agents: z.array(ComposedAgentSchema),
    coordination: z.object({
      productOwnerAgentId: z.string(),
      engineeringLeadAgentId: z.string(),
      evaluatorAgentId: z.string(),
      notes: z.string().optional(),
    }),
  }),
  harnesses: z.object({
    primary: HarnessIdSchema,
    enabled: z.array(HarnessIdSchema),
    claudeCode: ClaudeCodeHarnessOptionsSchema.optional(),
  }),
  preset: PresetSchema,
});
export type OrganizationConfig = z.infer<typeof OrganizationConfigSchema>;

/**
 * Usage guard is on whenever Claude Code is enabled, unless
 * `harnesses.claudeCode.usageGuard.enabled` is explicitly false.
 */
export function isClaudeUsageGuardEnabled(org: OrganizationConfig): boolean {
  if (!org.harnesses.enabled.includes("claude-code")) return false;
  return org.harnesses.claudeCode?.usageGuard?.enabled !== false;
}

/** Pause threshold percent (default 90). */
export function claudeUsageGuardPauseAt(org: OrganizationConfig): number {
  return org.harnesses.claudeCode?.usageGuard?.pauseAtPercent ?? 90;
}

/**
 * Ensure team.yaml / plans show an explicit usageGuard block when Claude Code
 * is enabled (default on). Preserves an explicit `enabled: false`.
 */
export function withDefaultClaudeUsageGuard(
  org: OrganizationConfig,
): OrganizationConfig {
  if (!org.harnesses.enabled.includes("claude-code")) {
    return org;
  }
  const existing = org.harnesses.claudeCode?.usageGuard;
  const enabled = existing?.enabled !== false;
  return {
    ...org,
    harnesses: {
      ...org.harnesses,
      claudeCode: {
        usageGuard: {
          enabled,
          pauseAtPercent: existing?.pauseAtPercent ?? 90,
        },
      },
    },
  };
}
