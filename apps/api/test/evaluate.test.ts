import { describe, expect, it } from "vitest";
import { evaluateFlag, type FlagRules } from "../src/flags/evaluate";

const flag = (overrides: Partial<FlagRules> = {}): FlagRules => ({
  key: "new-checkout",
  enabled: true,
  rolloutPercentage: 50,
  ...overrides,
});

const subjects = (count: number) => Array.from({ length: count }, (_, i) => `user-${i}`);

describe("evaluateFlag", () => {
  it("is off for everyone when the flag is disabled, whatever the rollout", () => {
    const result = evaluateFlag(flag({ enabled: false, rolloutPercentage: 100 }), "user-1", undefined);

    expect(result).toEqual({ enabled: false, reason: "disabled" });
  });

  it("lets the kill switch beat an override", () => {
    const result = evaluateFlag(flag({ enabled: false }), "user-1", true);

    expect(result).toEqual({ enabled: false, reason: "disabled" });
  });

  it("lets an override beat the rollout, in both directions", () => {
    const off = evaluateFlag(flag({ rolloutPercentage: 100 }), "user-1", false);
    const on = evaluateFlag(flag({ rolloutPercentage: 0 }), "user-1", true);

    expect(off).toEqual({ enabled: false, reason: "override" });
    expect(on).toEqual({ enabled: true, reason: "override" });
  });

  it("is off for everyone at 0% and on for everyone at 100%", () => {
    for (const subject of subjects(300)) {
      expect(evaluateFlag(flag({ rolloutPercentage: 0 }), subject, undefined)).toEqual({
        enabled: false,
        reason: "not_in_rollout",
      });
      expect(evaluateFlag(flag({ rolloutPercentage: 100 }), subject, undefined)).toEqual({
        enabled: true,
        reason: "rollout",
      });
    }
  });

  it("gives the same answer to the same subject every time", () => {
    const first = evaluateFlag(flag(), "user-7", undefined);

    for (let i = 0; i < 20; i++) {
      expect(evaluateFlag(flag(), "user-7", undefined)).toEqual(first);
    }
  });

  it("keeps everyone who was on when the percentage grows", () => {
    const at10 = subjects(2000).filter((s) => evaluateFlag(flag({ rolloutPercentage: 10 }), s, undefined).enabled);
    const at30 = new Set(
      subjects(2000).filter((s) => evaluateFlag(flag({ rolloutPercentage: 30 }), s, undefined).enabled),
    );

    expect(at10.length).toBeGreaterThan(0);
    expect(at10.every((s) => at30.has(s))).toBe(true);
  });

  it("reaches roughly the requested share of subjects", () => {
    const total = 10_000;
    const on = subjects(total).filter((s) => evaluateFlag(flag({ rolloutPercentage: 30 }), s, undefined).enabled);

    expect(on.length / total).toBeGreaterThan(0.27);
    expect(on.length / total).toBeLessThan(0.33);
  });
});
