import type { ProjectAnalysis, HarnessId, Maturity, Preset } from "../schemas/analysis.js";
import type { AutonomyLevel } from "../schemas/organization.js";

export type PromptIO = {
  write(text: string): void;
  ask(question: string): Promise<string>;
};

export type InitChoice = {
  maturity: Maturity;
  harnesses: HarnessId[];
  preset: Preset;
  autonomy: AutonomyLevel;
  write: true;
};

const MATURITIES: Maturity[] = ["greenfield", "early", "intermediate", "production"];
const HARNESSES: HarnessId[] = ["cursor", "claude-code", "codex"];
const PRESETS: Preset[] = ["minimal", "standard", "full-stack-split"];

export type InitPromptInput = {
  analysis: ProjectAnalysis;
  defaults: {
    harnesses: HarnessId[];
    preset?: Preset;
    autonomy: AutonomyLevel;
  };
  recommendedPreset: (maturity: Maturity) => Preset;
  describeTeam: (preset: Preset) => string;
  preview: (choice: Omit<InitChoice, "write">) => string;
};

function norm(value: string): string {
  return value.trim().toLowerCase();
}

export function parseConfirm(input: string): "yes" | "edit" | "abort" | "invalid" {
  const value = norm(input);
  if (value === "" || value === "y" || value === "yes") return "yes";
  if (value === "e" || value === "edit") return "edit";
  if (value === "a" || value === "abort" || value === "n" || value === "no") return "abort";
  return "invalid";
}

export function parseMaturity(input: string): Maturity | null {
  const value = norm(input);
  return MATURITIES.find((m) => m === value) ?? null;
}

export function parseHarnessList(
  input: string,
  fallback: HarnessId[],
): { ok: true; value: HarnessId[] } | { ok: false; error: string } {
  const value = norm(input);
  if (!value) return { ok: true, value: fallback };
  const parts = value
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const chosen: HarnessId[] = [];
  for (const part of parts) {
    if (!HARNESSES.includes(part as HarnessId)) {
      return { ok: false, error: `Unknown harness "${part}". Use ${HARNESSES.join(", ")}.` };
    }
    const id = part as HarnessId;
    if (!chosen.includes(id)) chosen.push(id);
  }
  if (!chosen.length) return { ok: false, error: "Select at least one harness." };
  return { ok: true, value: chosen };
}

export function parsePreset(input: string, fallback: Preset): Preset | "invalid" {
  const value = norm(input);
  if (value === "" || value === "a" || value === "accept" || value === "y" || value === "yes") {
    return fallback;
  }
  if (value === "m" || value === "minimal") return "minimal";
  if (value === "s" || value === "standard") return "standard";
  if (value === "f" || value === "full-stack-split" || value === "full") return "full-stack-split";
  if (PRESETS.includes(value as Preset)) return value as Preset;
  return "invalid";
}

export function parseAutonomy(input: string, fallback: AutonomyLevel): AutonomyLevel | "invalid" {
  const value = norm(input);
  if (value === "") return fallback;
  if (value === "s" || value === "supervised") return "supervised";
  if (value === "a" || value === "autonomous") return "autonomous";
  if (value === "c" || value === "conservative") return "conservative";
  return "invalid";
}

export function parseWrite(input: string): "yes" | "abort" | "invalid" {
  const value = norm(input);
  if (value === "" || value === "y" || value === "yes") return "yes";
  if (value === "a" || value === "abort" || value === "n" || value === "no") return "abort";
  return "invalid";
}

async function untilValid<T>(
  io: PromptIO,
  question: string,
  parse: (input: string) => T | null,
  invalidMessage: string,
): Promise<T> {
  for (;;) {
    const raw = await io.ask(question);
    const parsed = parse(raw);
    if (parsed !== null) return parsed;
    io.write(invalidMessage);
  }
}

export async function collectInitAnswers(
  io: PromptIO,
  input: InitPromptInput,
): Promise<InitChoice | null> {
  const { analysis } = input;
  const present = analysis.existingHarnesses
    .filter((h) => h.present)
    .map((h) => h.id);
  io.write(
    [
      `Detected maturity: ${analysis.maturity}`,
      `Stack: ${analysis.stack.languages.join(", ") || "unknown"}`,
      `Existing harnesses: ${present.join(", ") || "none"}`,
      `Recommended preset: ${analysis.recommendedPreset}`,
    ].join("\n"),
  );

  const confirm = await untilValid(
    io,
    "Accept this analysis? [Y]es / [e]dit maturity / [a]bort: ",
    (raw) => {
      const parsed = parseConfirm(raw);
      return parsed === "invalid" ? null : parsed;
    },
    "Enter y, e, or a.",
  );
  if (confirm === "abort") return null;

  const maturity =
    confirm === "yes"
      ? analysis.maturity
      : await untilValid(
          io,
          `Maturity (${MATURITIES.join(", ")}): `,
          parseMaturity,
          `Enter one of: ${MATURITIES.join(", ")}.`,
        );

  let harnesses: HarnessId[] | undefined;
  while (!harnesses) {
    const raw = await io.ask(
      `Harnesses, comma-separated (${HARNESSES.join(", ")}) [default: ${input.defaults.harnesses.join(", ")}]: `,
    );
    const parsed = parseHarnessList(raw, input.defaults.harnesses);
    if (!parsed.ok) {
      io.write(parsed.error);
      continue;
    }
    harnesses = parsed.value;
  }
  if (harnesses.includes("codex")) {
    io.write(
      "Codex: will write .codex/agents/*.toml. APDT does not write .codex/config.toml (approval_policy stays yours).",
    );
  }

  const presetFallback = input.defaults.preset ?? input.recommendedPreset(maturity);
  io.write(input.describeTeam(presetFallback));
  const preset = await untilValid(
    io,
    `Team preset? [A]ccept ${presetFallback} / [m]inimal / [s]tandard / [f]ull-stack-split: `,
    (raw) => {
      const parsed = parsePreset(raw, presetFallback);
      return parsed === "invalid" ? null : parsed;
    },
    "Enter a, m, s, or f.",
  );
  if (preset !== presetFallback) io.write(input.describeTeam(preset));

  const autonomy = await untilValid(
    io,
    `Autonomy? [s]upervised / [a]utonomous / [c]onservative [default: ${input.defaults.autonomy}]: `,
    (raw) => {
      const parsed = parseAutonomy(raw, input.defaults.autonomy);
      return parsed === "invalid" ? null : parsed;
    },
    "Enter s, a, or c.",
  );

  const choice = { maturity, harnesses, preset, autonomy };
  io.write(input.preview(choice));
  const write = await untilValid(
    io,
    "Write these files? [Y]es / [a]bort: ",
    (raw) => {
      const parsed = parseWrite(raw);
      return parsed === "invalid" ? null : parsed;
    },
    "Enter y or a.",
  );
  if (write === "abort") return null;
  return { ...choice, write: true };
}
