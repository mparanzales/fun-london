import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit tests for the pure logic engines (lib/**) and ingestion-script
// invariants (scripts/**). Node environment — these are framework-free
// functions, no DOM. The "@/..." alias mirrors tsconfig paths.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      // `server-only` throws when imported outside a React Server Component
      // build (Next sets the react-server condition; vitest/Node does not),
      // so any test that transitively imports a server-only module (e.g.
      // lib/supabase/admin.ts) would fail at import. Alias it to an empty
      // stub for tests; Next still enforces the real client-bundle guard.
      "server-only": fileURLToPath(
        new URL("./test/server-only-stub.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "scripts/**/*.test.ts"],
    // 🧨 PIN THE CLOCK. CI went red on 2026-08-07 (#234) and stayed red
    // through five further merges while every local run passed, because
    // opening-hours tests build dates with the LOCAL-time constructor while
    // the engine reads LONDON wall-clock (lib/opening-hours.ts). On a BST
    // laptop `new Date(2026, 5, 10, 19, 0)` is 19:00 London; on the UTC CI
    // runner it is 20:00 London. Same test, two meanings, and the disagreement
    // was invisible to whoever ran it locally.
    //
    // UTC on purpose, NOT Europe/London: production runs on UTC (Vercel
    // lambdas), so this makes the suite match the runtime it ships to AND
    // keeps the London-conversion path genuinely exercised. Pinning to
    // Europe/London would make the tests pass by hiding the very conversion
    // they exist to check.
    env: { TZ: "UTC" },
  },
});
