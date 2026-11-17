import { describe, expect, it } from "vitest";
import { assignVariant, type AssignableExperiment } from "../src/assignment/assign";
import { CRITICAL_VALUE_P001, chiSquare } from "./stats";

const SUBJECTS = Array.from({ length: 20_000 }, (_, i) => `user-${i}`);

const experiment = (overrides: Partial<AssignableExperiment> = {}): AssignableExperiment => ({
  key: "checkout-button",
  status: "running",
  trafficPercentage: 100,
  variants: [
    { key: "control", weight: 1 },
    { key: "treatment", weight: 1 },
  ],
  ...overrides,
});

/** How many subjects landed on each variant, in the order of `variantKeys`. */
function countByVariant(exp: AssignableExperiment, variantKeys: string[]): number[] {
  const counts = new Map<string, number>(variantKeys.map((key) => [key, 0]));
  for (const subject of SUBJECTS) {
    const { variant } = assignVariant(exp, subject);
    if (variant) counts.set(variant, (counts.get(variant) ?? 0) + 1);
  }
  return variantKeys.map((key) => counts.get(key) ?? 0);
}

describe("assignVariant", () => {
  describe("who gets a variant", () => {
    it.each(["draft", "paused", "completed"] as const)("gives nothing while the experiment is %s", (status) => {
      expect(assignVariant(experiment({ status }), "user-1")).toEqual({ variant: null, reason: "not_running" });
    });

    it("gives nothing when there are no variants", () => {
      expect(assignVariant(experiment({ variants: [] }), "user-1")).toEqual({
        variant: null,
        reason: "no_variants",
      });
    });

    it("leaves everybody out at 0% of the traffic", () => {
      for (const subject of SUBJECTS.slice(0, 500)) {
        expect(assignVariant(experiment({ trafficPercentage: 0 }), subject).reason).toBe("not_in_traffic");
      }
    });

    it("puts everybody in at 100% of the traffic", () => {
      for (const subject of SUBJECTS.slice(0, 500)) {
        expect(assignVariant(experiment(), subject).reason).toBe("assigned");
      }
    });

    it("includes roughly the requested share of the traffic", () => {
      const exp = experiment({ trafficPercentage: 20 });
      const included = SUBJECTS.filter((s) => assignVariant(exp, s).variant !== null).length;

      expect(included / SUBJECTS.length).toBeGreaterThan(0.19);
      expect(included / SUBJECTS.length).toBeLessThan(0.21);
    });
  });

  describe("stability", () => {
    it("always gives the same variant to the same subject", () => {
      const first = assignVariant(experiment(), "user-77");

      for (let i = 0; i < 20; i++) expect(assignVariant(experiment(), "user-77")).toEqual(first);
    });

    it("does not depend on the order the variants arrive in", () => {
      const forward = experiment();
      const backward = experiment({ variants: [...forward.variants].reverse() });

      for (const subject of SUBJECTS.slice(0, 1000)) {
        expect(assignVariant(backward, subject)).toEqual(assignVariant(forward, subject));
      }
    });

    it("keeps every subject in the same variant when the traffic grows", () => {
      const at20 = experiment({ trafficPercentage: 20 });
      const at60 = experiment({ trafficPercentage: 60 });

      const assignedAt20 = SUBJECTS.filter((s) => assignVariant(at20, s).variant !== null);

      expect(assignedAt20.length).toBeGreaterThan(0);
      for (const subject of assignedAt20) {
        expect(assignVariant(at60, subject).variant).toBe(assignVariant(at20, subject).variant);
      }
    });

    // Fixed values: any SDK that reimplements the algorithm must produce exactly these
    it("matches the reference assignments", () => {
      const at100 = ["user-1", "user-2", "user-3", "user-4", "user-5", "user-6"].map(
        (s) => assignVariant(experiment(), s).variant,
      );
      const at30 = ["user-1", "user-2", "user-3", "user-4", "user-5", "user-6", "user-7", "user-8"].map(
        (s) => assignVariant(experiment({ trafficPercentage: 30 }), s).variant,
      );

      expect(at100).toEqual(["control", "control", "treatment", "treatment", "treatment", "treatment"]);
      expect(at30).toEqual([null, null, "treatment", null, null, "treatment", "treatment", "treatment"]);
    });
  });

  describe("distribution (chi-square goodness of fit, p = 0.001)", () => {
    it.each([
      { name: "50/50", weights: [1, 1] },
      { name: "25/75", weights: [1, 3] },
      { name: "25/25/50", weights: [1, 1, 2] },
    ])("follows the weights $name", ({ weights }) => {
      const variants = weights.map((weight, i) => ({ key: `variant-${i}`, weight }));
      const total = weights.reduce((a, b) => a + b, 0);
      const exp = experiment({ variants });

      const observed = countByVariant(
        exp,
        variants.map((v) => v.key),
      );

      const statistic = chiSquare(
        observed,
        weights.map((w) => w / total),
      );
      expect(statistic).toBeLessThan(CRITICAL_VALUE_P001[weights.length - 1]);
    });

    it("keeps the split inside a partial traffic slice (the gate does not bias the draw)", () => {
      const exp = experiment({ trafficPercentage: 20 });

      const observed = countByVariant(exp, ["control", "treatment"]);

      expect(observed[0] + observed[1]).toBeGreaterThan(3000);
      expect(chiSquare(observed, [0.5, 0.5])).toBeLessThan(CRITICAL_VALUE_P001[1]);
    });

    it("assigns independently across experiments", () => {
      const a = experiment({ key: "experiment-a" });
      const b = experiment({ key: "experiment-b" });
      // cells: [control/control, control/treatment, treatment/control, treatment/treatment]
      const cells = [0, 0, 0, 0];
      for (const subject of SUBJECTS) {
        const first = assignVariant(a, subject).variant === "control" ? 0 : 2;
        const second = assignVariant(b, subject).variant === "control" ? 0 : 1;
        cells[first + second] += 1;
      }

      expect(chiSquare(cells, [0.25, 0.25, 0.25, 0.25])).toBeLessThan(CRITICAL_VALUE_P001[3]);
    });
  });
});
