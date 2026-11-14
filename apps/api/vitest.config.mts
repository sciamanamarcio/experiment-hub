import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false, // the tests share one database
    testTimeout: 15_000,
  },
});
