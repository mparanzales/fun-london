// /admin/candidates — internal review queue for Tier 2 candidate scout.
//
// Gated to admin emails (FL_ADMIN_EMAILS env, defaults to Maria). Anyone
// else gets a polite "not authorised" landing.
//
// Server Component reads pending_candidates with status='pending' and
// renders a card stack. Each card uses Server Actions (decideCandidate)
// to mutate status without client-side state. Approve/reject/snooze
// re-revalidate the page so the decided card disappears.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser, isAdminEmail } from "@/lib/auth";
import { decideCandidate } from "./actions";

export const dynamic = "force-dynamic";

type Candidate = {
  id: string;
  name: string;
  neighbourhood: string | null;
  type_guess: string | null;
  vibe_draft: string | null;
  long_description_draft: string | null;
  sources_count: number;
  chain_risk_score: number | null;
  sources: { publication: string; url: string; title: string; date: string }[];
};

export default async function AdminCandidatesPage() {
  const user = await getAuthUser();
  if (!user) redirect("/sign-in?return=/admin/candidates");
  if (!isAdminEmail(user.email)) {
    return <NotAuthorised email={user.email ?? ""} />;
  }

  const supabase = createClient();
  const { data: rows, error } = await supabase
    .from("pending_candidates")
    .select(
      "id, name, neighbourhood, type_guess, vibe_draft, long_description_draft, sources_count, chain_risk_score, sources",
    )
    .eq("status", "pending")
    .order("sources_count", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return (
      <Shell>
        <p className="text-sm text-[hsl(0_70%_55%)]">
          Couldn&apos;t load the queue: {error.message}
        </p>
      </Shell>
    );
  }

  const candidates = (rows ?? []) as Candidate[];

  return (
    <Shell>
      <header className="mb-6">
        <div className="text-[11px] font-extrabold tracking-[0.14em] uppercase text-primary mb-1">
          Admin · Tier 2 scout
        </div>
        <h1 className="text-[24px] font-extrabold tracking-tight text-fg leading-tight mb-1">
          Candidate queue
        </h1>
        <p className="text-sm text-muted-fg">
          {candidates.length} pending · sorted by source count
        </p>
      </header>

      {candidates.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex flex-col gap-4">
          {candidates.map((c) => (
            <CandidateCard key={c.id} c={c} />
          ))}
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="max-w-2xl mx-auto px-5 pt-10 pb-16">{children}</div>;
}

function NotAuthorised({ email }: { email: string }) {
  return (
    <Shell>
      <h1 className="text-[24px] font-extrabold tracking-tight text-fg mb-2">
        Not authorised
      </h1>
      <p className="text-sm text-muted-fg">
        Your account ({email}) isn&apos;t on the admin allowlist for this
        internal tool.
      </p>
    </Shell>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl bg-card border border-border p-6 text-center">
      <div className="text-3xl mb-2">🎉</div>
      <h2 className="text-sm font-extrabold text-heading mb-1">Queue clear</h2>
      <p className="text-xs text-muted-fg leading-relaxed">
        No candidates waiting. The scout is currently scaffold-only —
        publication adapters land in Phase 2B, autonomous cron in Phase 2B+. Run{" "}
        <code>pnpm scout-candidates:dry</code> locally to test the pipeline
        shape.
      </p>
    </div>
  );
}

function CandidateCard({ c }: { c: Candidate }) {
  const chainBadge =
    c.chain_risk_score && c.chain_risk_score >= 0.5
      ? `🚨 chain risk ${(c.chain_risk_score * 100).toFixed(0)}%`
      : null;

  return (
    <article className="rounded-2xl bg-card border border-border p-5">
      <header className="mb-3">
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <h2 className="text-[18px] font-extrabold text-fg leading-tight">
            {c.name}
          </h2>
          <div className="text-[11px] font-bold text-muted-fg shrink-0">
            {c.sources_count} sources
          </div>
        </div>
        <div className="text-xs text-muted-fg">
          {[c.type_guess, c.neighbourhood].filter(Boolean).join(" · ")}
          {chainBadge ? ` · ${chainBadge}` : ""}
        </div>
      </header>

      {c.vibe_draft ? (
        <p className="text-sm text-fg italic mb-3">{c.vibe_draft}</p>
      ) : (
        <p className="text-xs text-muted-fg/70 italic mb-3">
          (no AI vibe draft yet)
        </p>
      )}

      {c.long_description_draft ? (
        <p className="text-sm text-muted-fg mb-4 leading-relaxed">
          {c.long_description_draft}
        </p>
      ) : null}

      <details className="mb-4">
        <summary className="text-[11px] font-extrabold tracking-[0.14em] uppercase text-primary cursor-pointer">
          Why this is here ({c.sources.length})
        </summary>
        <ul className="mt-2 flex flex-col gap-1">
          {c.sources.map((s, i) => (
            <li key={i} className="text-xs text-muted-fg leading-snug">
              <span className="font-bold text-fg">{s.publication}</span> —{" "}
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline-offset-2 hover:underline"
              >
                {s.title}
              </a>{" "}
              <span className="text-muted-fg/60">({s.date})</span>
            </li>
          ))}
        </ul>
      </details>

      <div className="flex flex-wrap gap-2">
        <form action={decideCandidate}>
          <input type="hidden" name="id" value={c.id} />
          <input type="hidden" name="decision" value="approve" />
          <button
            type="submit"
            className="h-9 px-4 rounded-full text-primary-fg text-xs font-extrabold uppercase tracking-wider"
            style={{
              background:
                "linear-gradient(135deg, var(--fl-primary), var(--fl-accent))",
            }}
          >
            Approve
          </button>
        </form>
        <form action={decideCandidate}>
          <input type="hidden" name="id" value={c.id} />
          <input type="hidden" name="decision" value="snooze" />
          <input type="hidden" name="snoozeMonths" value="6" />
          <button
            type="submit"
            className="h-9 px-4 rounded-full bg-muted text-fg text-xs font-extrabold uppercase tracking-wider"
          >
            Snooze 6mo
          </button>
        </form>
        <form action={decideCandidate}>
          <input type="hidden" name="id" value={c.id} />
          <input type="hidden" name="decision" value="reject" />
          <button
            type="submit"
            className="h-9 px-4 rounded-full bg-card border border-border text-fg text-xs font-extrabold uppercase tracking-wider"
          >
            Reject
          </button>
        </form>
      </div>
    </article>
  );
}
