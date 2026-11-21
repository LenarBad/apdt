import type { ProjectAnalysis } from "../schemas/analysis.js";
import type { OrganizationConfig } from "../schemas/organization.js";
import type {
  CapabilityReport,
  DoctorFinding,
  PlannedFile,
} from "../schemas/plan.js";

export type AdapterContext = {
  repoRoot: string;
  analysis: ProjectAnalysis;
  organization: OrganizationConfig;
};

export interface HarnessAdapter {
  readonly id: "cursor" | "claude-code" | "codex";
  readonly displayName: string;
  readonly version: string;
  capabilities(): CapabilityReport[];
  detect(repoRoot: string): { present: boolean; paths: string[] };
  plan(ctx: AdapterContext): PlannedFile[];
  validate(repoRoot: string): DoctorFinding[];
}
