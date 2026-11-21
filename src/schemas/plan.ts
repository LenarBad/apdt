import { z } from "zod";
import { HarnessIdSchema } from "./analysis.js";
import { ProjectAnalysisSchema } from "./analysis.js";
import { OrganizationConfigSchema } from "./organization.js";

export const PlannedFileSchema = z.object({
  path: z.string(),
  content: z.string(),
  kind: z.enum(["create", "update", "skip"]),
  managed: z.literal(true),
  templateId: z.string(),
  reason: z.string().optional(),
});
export type PlannedFile = z.infer<typeof PlannedFileSchema>;

export const CapabilityReportSchema = z.object({
  capability: z.string(),
  support: z.enum(["native", "adapted", "partial", "unavailable", "runtime"]),
  notes: z.string().optional(),
});
export type CapabilityReport = z.infer<typeof CapabilityReportSchema>;

export const DoctorFindingSchema = z.object({
  severity: z.enum(["error", "warning", "info"]),
  code: z.string(),
  message: z.string(),
  path: z.string().optional(),
});
export type DoctorFinding = z.infer<typeof DoctorFindingSchema>;

export const WorkspacePlanSchema = z.object({
  meta: z.object({
    apdtVersion: z.string(),
    createdAt: z.string(),
    primaryHarness: HarnessIdSchema.optional(),
  }),
  project: ProjectAnalysisSchema,
  organization: OrganizationConfigSchema,
  files: z.array(PlannedFileSchema),
  capabilities: z.array(CapabilityReportSchema),
  warnings: z.array(z.string()),
});
export type WorkspacePlan = z.infer<typeof WorkspacePlanSchema>;
