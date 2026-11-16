import { describe, expect, it } from "vitest";
import { BUCKETS, bucketFor, isInRollout } from "../src/bucketing";

describe("bucketFor", () => {
  it("always gives the same bucket to the same subject and salt", () => {
    expect(bucketFor("user-42", "checkout-button")).toBe(bucketFor("user-42", "checkout-button"));
  });

  it("stays inside the range 0 to 9999", () => {
    for (let i = 0; i < 2000; i++) {
      const bucket = bucketFor(`user-${i}`, "any-salt");
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThan(BUCKETS);
    }
  });

  it("buckets the same subject differently under different salts", () => {
    const sameBucket = Array.from({ length: 500 }, (_, i) => `user-${i}`).filter(
      (subject) => bucketFor(subject, "flag-a") === bucketFor(subject, "flag-b"),
    );

    // Independent salts would collide about 1 time in 10,000
    expect(sameBucket.length).toBeLessThan(5);
  });

  // Fixed values: any SDK that reimplements the algorithm must produce exactly these
  it.each([
    ["user-1", "checkout-button", 5459],
    ["user-2", "checkout-button", 1076],
    ["user-1", "new-search", 5910],
    ["maria@example.com", "new-search", 2932],
    ["", "x", 6652],
  ])("matches the reference value for %j under %j", (subject, salt, expected) => {
    expect(bucketFor(subject, salt)).toBe(expected);
  });
});

describe("isInRollout", () => {
  it("includes nobody at 0% and everybody at 100%", () => {
    for (let i = 0; i < 500; i++) {
      expect(isInRollout(`user-${i}`, "flag", 0)).toBe(false);
      expect(isInRollout(`user-${i}`, "flag", 100)).toBe(true);
    }
  });
});
