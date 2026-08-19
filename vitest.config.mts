import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // The integration suites share ONE scratch database and every test in them
    // TRUNCATEs it (tests/db/harness.ts). Run in parallel, two files wipe each
    // other's rows halfway through a settlement and fail in ways that look like
    // engine bugs. They are therefore serialised — and only they: the pure unit
    // suites have nothing to share and stay parallel.
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["tests/*.test.ts"] },
      },
      {
        extends: true,
        test: {
          name: "db",
          include: ["tests/db/**/*.test.ts"],
          fileParallelism: false,
        },
      },
    ],
  },
});
