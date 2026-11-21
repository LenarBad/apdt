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
  }),
  preset: PresetSchema,
});
export type OrganizationConfig = z.infer<typeof OrganizationConfigSchema>;
