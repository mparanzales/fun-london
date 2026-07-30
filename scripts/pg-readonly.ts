/**
 * A direct, READ-ONLY Postgres connection for verification scripts.
 *
 * WHY THIS EXISTS, and what it deliberately is NOT.
 *
 * `scripts/verify-room-security.ts` has to read `pg_policies`, `pg_proc` and
 * the grant catalogs. PostgREST cannot see `pg_catalog`, so the script used to
 * call an `exec_sql_readonly(q text)` RPC — a SECURITY DEFINER function that
 * ran caller-supplied SQL. That helper was REJECTED (see
 * docs/funldn-group-security-staging-evidence/REJECTED-exec_sql_readonly.sql):
 * its "only a SELECT is possible here" defence is false, because
 * `select public.purge_expired_plan_rooms()` is a SELECT that deletes rows, as
 * `postgres`. A permanent primitive that invokes any definer function in the
 * database was a worse hole than the one it was helping to verify.
 *
 * 🧨 THIS MODULE IS NOT A REPLACEMENT FOR THAT RPC. It exposes no way to run
 * caller-supplied SQL. Callers pass a query, but the connection is opened with
 * `default_transaction_read_only = on` at the session level, so the SERVER
 * refuses any write — including a write reached indirectly through a volatile
 * function, which is exactly the case the rejected helper could not stop:
 *
 *     select public.purge_expired_plan_rooms()
 *     ERROR:  cannot execute DELETE in a read-only transaction
 *
 * The guarantee is enforced by Postgres, not by string inspection — and it is
 * verified after being set, not assumed.
 *
 * Scoped honestly: this stops the statements this repo issues, including the
 * volatile-function case that killed the old helper. It is not a sandbox
 * against someone who already holds the connection URL and can simply turn the
 * setting off — but that person has psql anyway. Over-claiming a defence is
 * precisely why the predecessor was rejected, so the claim stays narrow. What
 * it does guarantee absolutely: no SQL-execution surface is added to the
 * DATABASE, and the credential it needs is one the app never holds.
 */
import { Client } from "pg";
import { isLoopback } from "./staging-guard";

/**
 * Opens the connection named by SUPABASE_DB_URL and pins the session read-only.
 *
 * Returns null (rather than throwing) when the variable is absent, so callers
 * can print a single actionable line instead of a stack trace. Verification
 * scripts must FAIL CLOSED when they cannot inspect anything.
 */
export async function connectReadOnly(): Promise<Client | null> {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) return null;
  // A hosted Supabase database requires TLS; a throwaway local container has
  // none, and forcing it there fails with "server does not support SSL".
  // Supabase terminates TLS with its own chain, so full verification would need
  // the CA bundle shipped alongside — noted rather than hidden. This connection
  // performs no writes and carries no secret beyond the URL it was handed.
  const ssl = isLoopback(url) ? false : { rejectUnauthorized: false };
  const client = new Client({
    connectionString: url,
    ssl,
    application_name: "fl-verify-readonly",
    statement_timeout: 30_000,
  });
  await client.connect();
  // Belt and braces: the role SHOULD be read-only, but pin the session too so
  // a mistakenly-privileged credential still cannot write through this path.
  await client.query("set session default_transaction_read_only = on");
  await client.query("set session statement_timeout = '30s'");

  // 🧨 VERIFY THE PIN, do not assume it. On a TRANSACTION-mode pooler (port
  // 6543 — which is what the dashboard's "Connection string -> URI" now hands
  // you, and what this module's own error message tells the operator to copy)
  // each statement runs in its own pooled transaction and `set session` is
  // discarded. The pin would silently become a no-op while this script still
  // reported itself read-only. Setting a guarantee and not checking it is the
  // same class of mistake as the helper this module replaced.
  const { rows } = await client.query<{ v: string }>(
    "select current_setting('default_transaction_read_only') as v",
  );
  if (rows[0]?.v !== "on") {
    await client.end();
    throw new Error(
      "read-only session could not be pinned (got " +
        `${rows[0]?.v ?? "nothing"}). This usually means SUPABASE_DB_URL is a ` +
        "transaction-mode pooler URI, which discards `set session`. Use the " +
        "direct connection (port 5432) or a session-mode pooler.",
    );
  }
  return client;
}

/** The one-line remedy printed when SUPABASE_DB_URL is missing. */
export const MISSING_DB_URL =
  "SUPABASE_DB_URL is not set. This script reads pg_catalog, which PostgREST cannot expose.\n" +
  "  Supabase dashboard -> Project Settings -> Database -> Connection string -> URI.\n" +
  "  Prefer a read-only role. Never commit it; export it for the run only.";
