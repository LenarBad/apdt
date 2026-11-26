import { createHash } from "node:crypto";

/** Pure helpers for Claude Code usage guard (testable; mirrored in templates). */

export type UsageWindow = {
  utilization: number;
  resetsAt: string | null;
};

export type UsageSnapshot = {
  fiveHour: UsageWindow | null;
  sevenDay: UsageWindow | null;
  fetchedAt: string;
  source: "api" | "cache" | "fixture" | "statusline" | "unavailable";
  warning?: string;
};

export type PauseDecision = {
  pause: boolean;
  reason: string;
  peakPercent: number;
  resetsAt: string | null;
  window: "five_hour" | "seven_day" | null;
};

const MAX_RESUME_WAIT_MS = 24 * 60 * 60 * 1000;
const RESUME_BUFFER_MS = 4 * 60 * 1000;

/** Claude Code status line stdin: rate_limits.*.used_percentage (0–100). */
export function parseRateLimitsPayload(body: unknown, now = new Date()): UsageSnapshot | null {
  if (!body || typeof body !== "object") return null;
  const obj = body as Record<string, unknown>;
  const limits =
    obj.rate_limits && typeof obj.rate_limits === "object"
      ? (obj.rate_limits as Record<string, unknown>)
      : obj;
  const five = windowFrom(limits.five_hour);
  const seven = windowFrom(limits.seven_day);
  if (!five && !seven) return null;
  return {
    fiveHour: five,
    sevenDay: seven,
    fetchedAt: now.toISOString(),
    source: "statusline",
  };
}

export function parseOAuthUsagePayload(body: unknown, now = new Date()): UsageSnapshot {
  const obj = (body ?? {}) as Record<string, unknown>;
  const five = windowFrom(obj.five_hour);
  const seven = windowFrom(obj.seven_day);
  return {
    fiveHour: five,
    sevenDay: seven,
    fetchedAt: now.toISOString(),
    source: "api",
  };
}

function windowFrom(raw: unknown): UsageWindow | null {
  if (!raw || typeof raw !== "object") return null;
  const w = raw as Record<string, unknown>;
  const utilization =
    typeof w.utilization === "number"
      ? w.utilization
      : typeof w.used_percentage === "number"
        ? w.used_percentage
        : null;
  if (utilization === null || Number.isNaN(utilization)) return null;
  const resetsAt =
    typeof w.resets_at === "string"
      ? w.resets_at
      : typeof w.resets_at === "number"
        ? new Date(w.resets_at * 1000).toISOString()
        : null;
  return { utilization, resetsAt };
}

export function decidePause(
  snapshot: UsageSnapshot | null,
  pauseAtPercent: number,
): PauseDecision {
  if (!snapshot || snapshot.source === "unavailable") {
    return {
      pause: false,
      reason: snapshot?.warning ?? "usage unavailable; fail open",
      peakPercent: 0,
      resetsAt: null,
      window: null,
    };
  }

  const candidates: Array<{
    window: "five_hour" | "seven_day";
    utilization: number;
    resetsAt: string | null;
  }> = [];
  if (snapshot.fiveHour) {
    candidates.push({
      window: "five_hour",
      utilization: snapshot.fiveHour.utilization,
      resetsAt: snapshot.fiveHour.resetsAt,
    });
  }
  if (snapshot.sevenDay) {
    candidates.push({
      window: "seven_day",
      utilization: snapshot.sevenDay.utilization,
      resetsAt: snapshot.sevenDay.resetsAt,
    });
  }

  if (!candidates.length) {
    return {
      pause: false,
      reason: "no usage windows reported; fail open",
      peakPercent: 0,
      resetsAt: null,
      window: null,
    };
  }

  candidates.sort((a, b) => b.utilization - a.utilization);
  const peak = candidates[0]!;
  if (peak.utilization >= pauseAtPercent) {
    return {
      pause: true,
      reason: `${peak.window} at ${peak.utilization.toFixed(1)}% (pause ≥ ${pauseAtPercent}%)`,
      peakPercent: peak.utilization,
      resetsAt: peak.resetsAt,
      window: peak.window,
    };
  }

  return {
    pause: false,
    reason: `peak ${peak.utilization.toFixed(1)}% below ${pauseAtPercent}%`,
    peakPercent: peak.utilization,
    resetsAt: peak.resetsAt,
    window: peak.window,
  };
}

export function usageContextLine(
  snapshot: UsageSnapshot,
  decision: PauseDecision,
): string {
  const five = snapshot.fiveHour
    ? `5h ${snapshot.fiveHour.utilization.toFixed(0)}%`
    : "5h n/a";
  const week = snapshot.sevenDay
    ? `wk ${snapshot.sevenDay.utilization.toFixed(0)}%`
    : "wk n/a";
  return `APDT usage guard: ${five}, ${week} (peak ${decision.peakPercent.toFixed(0)}%).`;
}

export function resumeWaitMs(
  resetsAt: string | null,
  nowMs = Date.now(),
  options: { bufferMs?: number; maxWaitMs?: number } = {},
): { waitMs: number; skipReason?: string } {
  const bufferMs = options.bufferMs ?? RESUME_BUFFER_MS;
  const maxWaitMs = options.maxWaitMs ?? MAX_RESUME_WAIT_MS;
  if (!resetsAt) {
    return { waitMs: 0, skipReason: "no resets_at" };
  }
  const resetMs = Date.parse(resetsAt);
  if (Number.isNaN(resetMs)) {
    return { waitMs: 0, skipReason: "invalid resets_at" };
  }
  const target = resetMs + bufferMs;
  const waitMs = Math.max(0, target - nowMs);
  if (waitMs > maxWaitMs) {
    return {
      waitMs: 0,
      skipReason: `reset is more than ${Math.round(maxWaitMs / 3600000)}h away`,
    };
  }
  return { waitMs };
}

/** macOS login-keychain service Claude Code uses for the OAuth blob. */
export function claudeCodeKeychainService(configDir?: string): string {
  if (!configDir) return "Claude Code-credentials";
  const suffix = createHash("sha256").update(configDir, "utf8").digest("hex").slice(0, 8);
  return `Claude Code-credentials-${suffix}`;
}

export function accessTokenFromCredentials(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const oauth = obj.claudeAiOauth;
  if (oauth && typeof oauth === "object") {
    const token = (oauth as Record<string, unknown>).accessToken;
    const alt = (oauth as Record<string, unknown>).access_token;
    if (typeof token === "string" && token.length > 0) return token;
    if (typeof alt === "string" && alt.length > 0) return alt;
  }
  if (typeof obj.accessToken === "string" && obj.accessToken.length > 0) {
    return obj.accessToken;
  }
  return null;
}

export function gateDenyPayload(decision: PauseDecision): Record<string, unknown> {
  const reset = decision.resetsAt
    ? ` Resets at ${decision.resetsAt}.`
    : "";
  const reason = `APDT usage guard paused work: ${decision.reason}.${reset} Wait for the limit to reset, then continue.`;
  return {
    continue: false,
    stopReason: reason,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

export function promptBlockPayload(decision: PauseDecision): Record<string, unknown> {
  const reset = decision.resetsAt
    ? ` Resets at ${decision.resetsAt}.`
    : "";
  return {
    continue: false,
    stopReason: `APDT usage guard paused work: ${decision.reason}.${reset}`,
  };
}
