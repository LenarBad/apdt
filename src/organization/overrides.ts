import type { AutonomyLevel, OrganizationConfig } from "../schemas/organization.js";
import type { HarnessId, Preset } from "../schemas/analysis.js";

export type OrgOverrideOptions = {
  harnesses?: HarnessId[];
  preset?: Preset;
  autonomy?: AutonomyLevel;
};

/** Apply CLI harness / preset / autonomy overrides onto an installed organization. */
export function applyOrgOverrides(
  org: OrganizationConfig,
  options: OrgOverrideOptions,
): OrganizationConfig {
  let next = org;
  if (options.harnesses?.length) {
    next = {
      ...next,
      harnesses: {
        primary: options.harnesses[0]!,
        enabled: options.harnesses,
        ...(next.harnesses.claudeCode
          ? { claudeCode: next.harnesses.claudeCode }
          : {}),
      },
    };
  }
  if (options.autonomy) {
    next = {
      ...next,
      autonomy: {
        ...next.autonomy,
        level: options.autonomy,
      },
    };
  }
  if (options.preset && options.preset !== next.preset) {
    next = { ...next, preset: options.preset };
  }
  return next;
}
