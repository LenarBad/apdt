#!/usr/bin/env node
/**
 * APDT Claude Code usage guard.
 * Commands: gate | prompt | resume
 *
 * Reads Pro/Max plan usage via Anthropic OAuth usage endpoint.
 * At pauseAtPercent (config): blocks Agent/Task/Workflow and pauses prompts.
 * On Stop / rate_limit StopFailure: waits for reset then asyncRewake (exit 2).
 * Fail-open when usage cannot be read.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_RESUME_WAIT_MS = 24 * 60 * 60 * 1000;
const RESUME_BUFFER_MS = 4 * 60 * 1000;

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve(chunks.join("")));
    process.stdin.on("error", reject);
  });
}

function loadConfig() {
  const path = join(__dirname, "config.json");
  const defaults = { pauseAtPercent: 90 };
  if (!existsSync(path)) return defaults;
  try {
    return { ...defaults, ...JSON.parse(readFileSync(path, "utf8")) };
  } catch {
    return defaults;
  }
}

function projectRoot() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

function cachePath() {
  const key = createHash("sha256").update(projectRoot()).digest("hex").slice(0, 16);
  return join(tmpdir(), `apdt-usage-guard-${key}.json`);
}

function windowFrom(raw) {
  if (!raw || typeof raw !== "object") return null;
  const utilization =
    typeof raw.utilization === "number"
      ? raw.utilization
      : typeof raw.used_percentage === "number"
        ? raw.used_percentage
        : null;
  if (utilization === null || Number.isNaN(utilization)) return null;
  const resetsAt =
    typeof raw.resets_at === "string"
      ? raw.resets_at
      : typeof raw.resets_at === "number"
        ? new Date(raw.resets_at * 1000).toISOString()
        : null;
  return { utilization, resetsAt };
}

function parseOAuthUsagePayload(body, now = new Date()) {
  const obj = body ?? {};
  return {
    fiveHour: windowFrom(obj.five_hour),
    sevenDay: windowFrom(obj.seven_day),
    fetchedAt: now.toISOString(),
    source: "api",
  };
}

function decidePause(snapshot, pauseAtPercent) {
  if (!snapshot || snapshot.source === "unavailable") {
    return {
      pause: false,
      reason: snapshot?.warning ?? "usage unavailable; fail open",
      peakPercent: 0,
      resetsAt: null,
      window: null,
    };
  }
  const candidates = [];
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
  const peak = candidates[0];
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

function usageContextLine(snapshot, decision) {
  const five = snapshot.fiveHour
    ? `5h ${snapshot.fiveHour.utilization.toFixed(0)}%`
    : "5h n/a";
  const week = snapshot.sevenDay
    ? `wk ${snapshot.sevenDay.utilization.toFixed(0)}%`
    : "wk n/a";
  return `APDT usage guard: ${five}, ${week} (peak ${decision.peakPercent.toFixed(0)}%).`;
}

function resumeWaitMs(resetsAt, nowMs = Date.now()) {
  if (!resetsAt) return { waitMs: 0, skipReason: "no resets_at" };
  const resetMs = Date.parse(resetsAt);
  if (Number.isNaN(resetMs)) return { waitMs: 0, skipReason: "invalid resets_at" };
  const waitMs = Math.max(0, resetMs + RESUME_BUFFER_MS - nowMs);
  if (waitMs > MAX_RESUME_WAIT_MS) {
    return { waitMs: 0, skipReason: "reset is more than 24h away" };
  }
  return { waitMs };
}

function readAccessToken() {
  const credPath = join(homedir(), ".claude", ".credentials.json");
  if (!existsSync(credPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(credPath, "utf8"));
    const token =
      raw?.claudeAiOauth?.accessToken ||
      raw?.claudeAiOauth?.access_token ||
      raw?.accessToken ||
      null;
    return typeof token === "string" && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

function readCache() {
  const path = cachePath();
  if (!existsSync(path)) return null;
  try {
    const cached = JSON.parse(readFileSync(path, "utf8"));
    const age = Date.now() - Date.parse(cached.fetchedAt || 0);
    if (Number.isNaN(age) || age > CACHE_TTL_MS) return null;
    return { ...cached, source: "cache" };
  } catch {
    return null;
  }
}

function writeCache(snapshot) {
  try {
    writeFileSync(cachePath(), JSON.stringify(snapshot), "utf8");
  } catch {
    // ignore cache write failures
  }
}

async function fetchUsage() {
  const fixture = process.env.APDT_USAGE_GUARD_FIXTURE;
  if (fixture && existsSync(fixture)) {
    const body = JSON.parse(readFileSync(fixture, "utf8"));
    const snap = parseOAuthUsagePayload(body);
    snap.source = "fixture";
    return snap;
  }

  const cached = readCache();
  if (cached) return cached;

  const token = readAccessToken();
  if (!token) {
    return {
      fiveHour: null,
      sevenDay: null,
      fetchedAt: new Date().toISOString(),
      source: "unavailable",
      warning: "no Claude OAuth token; fail open",
    };
  }

  try {
    const res = await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
        Accept: "application/json",
      },
    });
    if (res.status === 429) {
      return {
        fiveHour: null,
        sevenDay: null,
        fetchedAt: new Date().toISOString(),
        source: "unavailable",
        warning: "usage API rate-limited; fail open",
      };
    }
    if (!res.ok) {
      return {
        fiveHour: null,
        sevenDay: null,
        fetchedAt: new Date().toISOString(),
        source: "unavailable",
        warning: `usage API HTTP ${res.status}; fail open`,
      };
    }
    const body = await res.json();
    const snap = parseOAuthUsagePayload(body);
    writeCache(snap);
    return snap;
  } catch (e) {
    return {
      fiveHour: null,
      sevenDay: null,
      fetchedAt: new Date().toISOString(),
      source: "unavailable",
      warning: `usage fetch failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

function printJson(obj) {
  process.stdout.write(JSON.stringify(obj));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function cmdGate(pauseAtPercent) {
  const snapshot = await fetchUsage();
  const decision = decidePause(snapshot, pauseAtPercent);
  if (!decision.pause) {
    if (snapshot.source === "unavailable" && snapshot.warning) {
      process.stderr.write(`APDT usage guard: ${snapshot.warning}\n`);
    }
    process.exit(0);
  }
  printJson({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `APDT usage guard paused spawning: ${decision.reason}.${
        decision.resetsAt ? ` Resets at ${decision.resetsAt}.` : ""
      } Wait for the limit to reset, then continue.`,
    },
  });
  process.exit(0);
}

async function cmdPrompt(pauseAtPercent) {
  const snapshot = await fetchUsage();
  const decision = decidePause(snapshot, pauseAtPercent);
  if (decision.pause) {
    const msg = `APDT usage guard paused work: ${decision.reason}.${
      decision.resetsAt ? ` Resets at ${decision.resetsAt}.` : ""
    }`;
    process.stderr.write(`${msg}\n`);
    printJson({
      continue: false,
      stopReason: msg,
    });
    process.exit(2);
  }
  if (snapshot.source !== "unavailable") {
    process.stdout.write(usageContextLine(snapshot, decision));
  } else if (snapshot.warning) {
    process.stderr.write(`APDT usage guard: ${snapshot.warning}\n`);
  }
  process.exit(0);
}

async function cmdResume(pauseAtPercent) {
  const snapshot = await fetchUsage();
  const decision = decidePause(snapshot, pauseAtPercent);

  // Still under threshold: nothing to wait for
  if (!decision.pause && decision.peakPercent < 100) {
    process.exit(0);
  }

  const resetsAt =
    decision.resetsAt ||
    snapshot.fiveHour?.resetsAt ||
    snapshot.sevenDay?.resetsAt ||
    null;
  const { waitMs, skipReason } = resumeWaitMs(resetsAt);
  if (skipReason) {
    process.stderr.write(`APDT usage guard resume skipped: ${skipReason}\n`);
    process.exit(0);
  }
  if (waitMs > 0) {
    await sleep(waitMs);
  }
  process.stderr.write(
    "APDT usage guard: usage window should have reset. Resume the paused work now.\n",
  );
  process.exit(2);
}

async function main() {
  const cmd = process.argv[2] || "gate";
  const config = loadConfig();
  const pauseAtPercent = Number(config.pauseAtPercent) || 90;
  // Consume stdin so Claude Code does not hang; payload unused for decisions.
  await readStdin();

  if (cmd === "gate") return cmdGate(pauseAtPercent);
  if (cmd === "prompt") return cmdPrompt(pauseAtPercent);
  if (cmd === "resume") return cmdResume(pauseAtPercent);
  process.stderr.write(`Unknown command: ${cmd}\n`);
  process.exit(1);
}

main().catch((e) => {
  process.stderr.write(
    `APDT usage guard error: ${e instanceof Error ? e.message : String(e)}\n`,
  );
  process.exit(0); // fail open
});
