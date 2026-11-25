import { describe, expect, it } from "vitest";
import {
  decidePause,
  parseOAuthUsagePayload,
  resumeWaitMs,
  usageContextLine,
  gateDenyPayload,
  promptBlockPayload,
} from "../src/claude-usage-guard/logic.js";

describe("claude usage guard logic", () => {
  it("parses utilization and used_percentage windows", () => {
    const snap = parseOAuthUsagePayload({
      five_hour: { utilization: 42.5, resets_at: "2026-11-25T12:00:00Z" },
      seven_day: { used_percentage: 88, resets_at: 1732536000 },
    });
    expect(snap.fiveHour?.utilization).toBe(42.5);
    expect(snap.sevenDay?.utilization).toBe(88);
    expect(snap.sevenDay?.resetsAt).toBe(new Date(1732536000 * 1000).toISOString());
  });

  it("fails open when snapshot unavailable", () => {
    const decision = decidePause(
      {
        fiveHour: null,
        sevenDay: null,
        fetchedAt: new Date().toISOString(),
        source: "unavailable",
        warning: "no token",
      },
      90,
    );
    expect(decision.pause).toBe(false);
    expect(decision.reason).toBe("no token");
  });

  it("pauses at threshold on peak window", () => {
    const snap = parseOAuthUsagePayload({
      five_hour: { utilization: 91, resets_at: "2026-11-25T15:00:00Z" },
      seven_day: { utilization: 40, resets_at: "2026-11-30T00:00:00Z" },
    });
    const decision = decidePause(snap, 90);
    expect(decision.pause).toBe(true);
    expect(decision.window).toBe("five_hour");
    expect(decision.resetsAt).toBe("2026-11-25T15:00:00Z");
  });

  it("allows below threshold", () => {
    const snap = parseOAuthUsagePayload({
      five_hour: { utilization: 89.9, resets_at: "2026-11-25T15:00:00Z" },
    });
    expect(decidePause(snap, 90).pause).toBe(false);
  });

  it("builds context and deny payloads", () => {
    const snap = parseOAuthUsagePayload({
      five_hour: { utilization: 95, resets_at: "2026-11-25T15:00:00Z" },
      seven_day: { utilization: 10, resets_at: "2026-11-30T00:00:00Z" },
    });
    const decision = decidePause(snap, 90);
    expect(usageContextLine(snap, decision)).toContain("5h 95%");
    const deny = gateDenyPayload(decision);
    expect(
      (deny.hookSpecificOutput as { permissionDecision: string }).permissionDecision,
    ).toBe("deny");
    expect(promptBlockPayload(decision).continue).toBe(false);
  });

  it("computes resume wait with buffer and caps long waits", () => {
    const now = Date.parse("2026-11-25T10:00:00Z");
    const near = resumeWaitMs("2026-11-25T10:30:00Z", now, {
      bufferMs: 60_000,
      maxWaitMs: 24 * 3600_000,
    });
    expect(near.waitMs).toBe(31 * 60_000);
    const far = resumeWaitMs("2026-12-10T00:00:00Z", now, {
      bufferMs: 0,
      maxWaitMs: 24 * 3600_000,
    });
    expect(far.waitMs).toBe(0);
    expect(far.skipReason).toMatch(/more than/);
  });
});
