import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["guards/**/*.test.ts", "src/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
