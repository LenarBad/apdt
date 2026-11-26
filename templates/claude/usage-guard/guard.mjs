#!/usr/bin/env node
/**
 * APDT Claude Code usage guard.
 * Commands: gate | prompt | resume
 *
 * Reads Pro/Max plan usage via Anthropic OAuth usage endpoint.
 * At pauseAtPercent (config): denies the next tool call and stops the turn.
 * On Stop / rate_limit StopFailure: waits for reset then asyncRewake (exit 2).
 * Fail-open when usage cannot be read.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CACHE_TTL_MS = 5 * 60 * 1000;
const NEAR_THRESHOLD_TTL_MS = 60 * 1000;
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

function snapshotFromRateLimits(raw) {
  if (!raw || typeof raw !== "object") return null;
  const limits =
    raw.rate_limits && typeof raw.rate_limits === "object" ? raw.rate_limits : null;
  if (!limits) return null;
  const five = windowFrom(limits.five_hour);
  const seven = windowFrom(limits.seven_day);
  if (!five && !seven) return null;
  return {
    fiveHour: five,
    sevenDay: seven,
    fetchedAt: new Date().toISOString(),
    source: "statusline",
  };
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

function tokenFromCredentials(raw) {
  const token =
    raw?.claudeAiOauth?.accessToken ||
    raw?.claudeAiOauth?.access_token ||
    raw?.accessToken ||
    null;
  return typeof token === "string" && token.length > 0 ? token : null;
}

function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
}

function keychainService(dir) {
  const homeDefault = join(homedir(), ".claude");
  if (!dir || dir === homeDefault) return "Claude Code-credentials";
  const suffix = createHash("sha256").update(dir).digest("hex").slice(0, 8);
  return `Claude Code-credentials-${suffix}`;
}

function readCredentialsFile() {
  const credPath = join(configDir(), ".credentials.json");
  if (!existsSync(credPath)) return null;
  try {
    return tokenFromCredentials(JSON.parse(readFileSync(credPath, "utf8")));
  } catch {
    return null;
  }
}

function readKeychainToken() {
  if (process.platform !== "darwin") return null;
  const services = [keychainService(process.env.CLAUDE_CONFIG_DIR)];
  if (services[0] !== "Claude Code-credentials") {
    services.push("Claude Code-credentials");
  }
  let account = "";
  try {
    account = userInfo().username;
  } catch {
    account = "";
  }
  const attempts = [];
  for (const service of services) {
    if (account) {
      attempts.push(["find-generic-password", "-s", service, "-a", account, "-w"]);
    }
    attempts.push(["find-generic-password", "-s", service, "-w"]);
  }
  for (const args of attempts) {
    try {
      const out = execFileSync("/usr/bin/security", args, {
        encoding: "utf8",
        timeout: 3000,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      const token = tokenFromCredentials(JSON.parse(out));
      if (token) return token;
    } catch {
      // try the next lookup; never print keychain output
    }
  }
  return null;
}

function readAccessToken() {
  const fromEnv = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv;
  return readKeychainToken() || readCredentialsFile();
}

function readCache() {
  const path = cachePath();
  if (!existsSync(path)) return null;
  try {
    const cached = JSON.parse(readFileSync(path, "utf8"));
    const age = Date.now() - Date.parse(cached.fetchedAt || 0);
    if (Number.isNaN(age)) return null;
    return { ...cached, source: "cache", ageMs: age };
  } catch {
    return null;
  }
}

function cacheIsFresh(cached, pauseAtPercent) {
  if (!cached || cached.ageMs > CACHE_TTL_MS) return false;
  const decision = decidePause(cached, pauseAtPercent);
  const near = decision.peakPercent >= Math.max(0, pauseAtPercent - 10);
  if (near && cached.ageMs > NEAR_THRESHOLD_TTL_MS) return false;
  return true;
}

function writeCache(snapshot) {
  try {
    writeFileSync(cachePath(), JSON.stringify(snapshot), "utf8");
  } catch {
    // ignore cache write failures
  }
}

function unavailable(warning) {
  return {
    fiveHour: null,
    sevenDay: null,
    fetchedAt: new Date().toISOString(),
    source: "unavailable",
    warning,
  };
}

async function fetchUsage(pauseAtPercent, input) {
  const fromStatus = snapshotFromRateLimits(input);
  if (fromStatus) {
    writeCache(fromStatus);
    return fromStatus;
  }

  const fixture = process.env.APDT_USAGE_GUARD_FIXTURE;
  if (fixture && existsSync(fixture)) {
    const body = JSON.parse(readFileSync(fixture, "utf8"));
    const snap = parseOAuthUsagePayload(body);
    snap.source = "fixture";
    return snap;
  }

  const cached = readCache();
  if (cacheIsFresh(cached, pauseAtPercent)) return cached;

  const token = readAccessToken();
  if (!token) {
    if (cached && decidePause(cached, pauseAtPercent).pause) return cached;
    return unavailable(
      "no Claude OAuth token (keychain or credentials file); fail open",
    );
  }

  try {
    const res = await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
        Accept: "application/json",
        "User-Agent": "claude-code/2.1.0",
      },
    });
    if (!res.ok) {
      if (cached && decidePause(cached, pauseAtPercent).pause) return cached;
      const warning =
        res.status === 429
          ? "usage API rate-limited; fail open"
          : `usage API HTTP ${res.status}; fail open`;
      return unavailable(warning);
    }
    const body = await res.json();
    const snap = parseOAuthUsagePayload(body);
    writeCache(snap);
    return snap;
  } catch (e) {
    if (cached && decidePause(cached, pauseAtPercent).pause) return cached;
    return unavailable(
      `usage fetch failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

function printJson(obj) {
  process.stdout.write(JSON.stringify(obj));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function cmdRecord(input) {
  const snap = snapshotFromRateLimits(input);
  if (!snap) process.exit(0);
  writeCache(snap);
  const config = loadConfig();
  const pauseAtPercent = Number(config.pauseAtPercent) || 90;
  process.stdout.write(`${usageContextLine(snap, decidePause(snap, pauseAtPercent))}\n`);
  process.exit(0);
}

async function cmdGate(pauseAtPercent, input) {
  const snapshot = await fetchUsage(pauseAtPercent, input);
  const decision = decidePause(snapshot, pauseAtPercent);
  if (!decision.pause) {
    if (snapshot.source === "unavailable" && snapshot.warning) {
      process.stderr.write(`APDT usage guard: ${snapshot.warning}\n`);
    }
    process.exit(0);
  }
  const reason = `APDT usage guard paused work: ${decision.reason}.${
    decision.resetsAt ? ` Resets at ${decision.resetsAt}.` : ""
  } Wait for the limit to reset, then continue.`;
  process.stderr.write(`${reason}\n`);
  printJson({
    continue: false,
    stopReason: reason,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  });
  process.exit(0);
}

async function cmdPrompt(pauseAtPercent, input) {
  const snapshot = await fetchUsage(pauseAtPercent, input);
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

async function cmdResume(pauseAtPercent, input) {
  const snapshot = await fetchUsage(pauseAtPercent, input);
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
  const raw = await readStdin();
  let input = null;
  if (typeof raw === "string" && raw.trim()) {
    try {
      input = JSON.parse(raw);
    } catch {
      input = null;
    }
  }

  if (cmd === "record") return cmdRecord(input);
  if (cmd === "gate") return cmdGate(pauseAtPercent, input);
  if (cmd === "prompt") return cmdPrompt(pauseAtPercent, input);
  if (cmd === "resume") return cmdResume(pauseAtPercent, input);
  process.stderr.write(`Unknown command: ${cmd}\n`);
  process.exit(1);
}

main().catch((e) => {
  process.stderr.write(
    `APDT usage guard error: ${e instanceof Error ? e.message : String(e)}\n`,
  );
  process.exit(0); // fail open
});
