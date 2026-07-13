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
  },
});
