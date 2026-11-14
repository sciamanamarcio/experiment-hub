import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

describe("loadConfig", () => {
  it("applies defaults", () => {
    const config = loadConfig({ DATABASE_URL: "postgres://localhost/db" });

    expect(config).toEqual({
      NODE_ENV: "development",
      PORT: 4000,
      DATABASE_URL: "postgres://localhost/db",
    });
  });

  it("converts PORT to a number", () => {
    expect(loadConfig({ DATABASE_URL: "x", PORT: "8080" }).PORT).toBe(8080);
  });

  it("fails fast when DATABASE_URL is missing", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it("fails on an invalid PORT", () => {
    expect(() => loadConfig({ DATABASE_URL: "x", PORT: "abc" })).toThrow(/PORT/);
  });
});
