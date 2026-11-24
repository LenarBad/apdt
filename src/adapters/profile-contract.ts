import { readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { templatesRoot } from "../paths.js";

type RawProfile = {
  id: string;
  inputs?: unknown;
  outputs?: unknown;
};

function asLines(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

/** Inputs and outputs declared on the agent's profiles, in profile order, deduped. */
export function profileContract(profileIds: string[]): { inputs: string[]; outputs: string[] } {
  const raw = readFileSync(join(templatesRoot(), "agents/profiles.yaml"), "utf8");
  const parsed = YAML.parse(raw) as { profiles?: RawProfile[] };
  const byId = new Map((parsed.profiles ?? []).map((profile) => [profile.id, profile]));
  const inputs: string[] = [];
  const outputs: string[] = [];
  for (const id of profileIds) {
    const profile = byId.get(id);
    if (!profile) continue;
    for (const line of asLines(profile.inputs)) {
      if (!inputs.includes(line)) inputs.push(line);
    }
    for (const line of asLines(profile.outputs)) {
      if (!outputs.includes(line)) outputs.push(line);
    }
  }
  return { inputs, outputs };
}

/** Markdown block for an agent body. Empty when the profiles declare neither list. */
export function profileContractSection(profileIds: string[]): string {
  const { inputs, outputs } = profileContract(profileIds);
  const blocks: string[] = [];
  if (inputs.length > 0) {
    blocks.push(`## Inputs\n\n${inputs.map((line) => `- ${line}`).join("\n")}`);
  }
  if (outputs.length > 0) {
    blocks.push(`## Outputs\n\n${outputs.map((line) => `- ${line}`).join("\n")}`);
  }
  if (blocks.length === 0) return "";
  return `${blocks.join("\n\n")}\n\n`;
}
