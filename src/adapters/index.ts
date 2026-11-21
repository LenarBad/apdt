import { claudeCodeAdapter } from "./claude.js";
import { codexAdapter } from "./codex.js";
import { cursorAdapter } from "./cursor.js";
import type { HarnessAdapter } from "./types.js";
import type { HarnessId } from "../schemas/analysis.js";

const adapters: Record<HarnessId, HarnessAdapter> = {
  cursor: cursorAdapter,
  "claude-code": claudeCodeAdapter,
  codex: codexAdapter,
};

export function getAdapter(id: HarnessId): HarnessAdapter {
  return adapters[id];
}

export function allAdapters(): HarnessAdapter[] {
  return Object.values(adapters);
}

export type { HarnessAdapter } from "./types.js";
