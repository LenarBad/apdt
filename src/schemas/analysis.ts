import { z } from "zod";

export const MaturitySchema = z.enum([
  "greenfield",
  "early",
  "intermediate",
  "production",
]);
export type Maturity = z.infer<typeof MaturitySchema>;

export const PresetSchema = z.enum(["minimal", "standard", "full-stack-split"]);
export type Preset = z.infer<typeof PresetSchema>;

export const HarnessIdSchema = z.enum(["cursor", "claude-code", "codex"]);
export type HarnessId = z.infer<typeof HarnessIdSchema>;

export const ProjectAnalysisSchema = z.object({
  apdtAnalysisVersion: z.string(),
  root: z.string(),
  analyzedAt: z.string(),
  isEmpty: z.boolean(),
  isGitRepo: z.boolean(),
  maturity: MaturitySchema,
  stack: z.object({
    languages: z.array(z.string()),
    frameworks: z.array(z.string()),
    packageManagers: z.array(z.string()),
    manifests: z.array(z.string()),
  }),
  testing: z.object({
    frameworks: z.array(z.string()),
    hasTests: z.boolean(),
    evidence: z.array(z.string()),
  }),
  ci: z.object({
    systems: z.array(z.string()),
    evidence: z.array(z.string()),
  }),
  documentation: z.object({
    hasReadme: z.boolean(),
    evidence: z.array(z.string()),
  }),
  existingHarnesses: z.array(
    z.object({
      id: HarnessIdSchema,
      present: z.boolean(),
      paths: z.array(z.string()),
    }),
  ),
  signals: z.array(z.string()),
  recommendedPreset: PresetSchema,
  missingCapabilities: z.array(z.string()),
  warnings: z.array(z.string()),
  summary: z.string(),
});
export type ProjectAnalysis = z.infer<typeof ProjectAnalysisSchema>;
