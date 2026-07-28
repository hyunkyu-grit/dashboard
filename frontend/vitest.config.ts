import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  // `@/…` must resolve here exactly as it does in the app (tsconfig paths).
  // Until the calendar (strip session, Pass D) every `@/…` inside src was a
  // TYPE import, erased before the resolver ever saw it; the first RUNTIME
  // one (calendar.json) would not resolve under vitest without this.
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["guards/**/*.test.ts", "src/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
