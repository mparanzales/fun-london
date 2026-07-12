// /admin/candidates — internal review queue.
//
// Two tabs:
//  • Pending — Tier 2 candidate scout queue (publication-sourced candidates).
//  • Needs review — onezone imports the ingest quality-gate held back (a weak or
//    wrong Google match: no rating / not operational / too few reviews). Shows
//    what Google matched each one to so an admin can reject the junk or re-queue.
//
// Gated to admin emails (FL_ADMIN_EMAILS env). Server Component reads
// pending_candidates and mutates via Server Actions (decideCandidate).

import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/admin";
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

type ReviewItem = {
  id: string;
  name: string;
  neighbourhood: string | null;
  type_guess: string | null;
  reviewed_notes: string | null;
  filter_results: {
    reason?: string;
    matched_name?: string;
    matched_address?: string;
    rating?: number | null;
    reviews?: number;
    business_status?: string | null;
    website?: string | null;
  } | null;
};

export default async function AdminCandidatesPage(props: {
  searchParams: Promise<{ status?: string }>;
}) {
  const searchParams = await props.searchParams;
  const user = await getAuthUser();
  if (!user) redirect("/sign-in?return=/admin/candidates");
  if (!isAdminEmail(user.email)) {
    return <NotAuthorised email={user.email ?? ""} />;
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return (
      <Shell>
        <p className="text-sm text-[hsl(0_70%_55%)]">
          Service role key not configured.
        </p>
      </Shell>
    );
  }

  const tab =
    searchParams.status === "needs_review" ? "needs_review" : "pending";

  // Counts for the tab labels.
  const [{ count: pendingCount }, { count: reviewCount }] = await Promise.all([
    supabase
      .from("pending_candidates")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase
      .from("pending_candidates")
      .select("id", { count: "exact", head: true })
      .eq("status", "needs_review"),
  ]);

  let body: React.ReactNode;

  if (tab === "needs_review") {
    const { data, error } = await supabase
      .from("pending_candidates")
      .select(
        "id, name, neighbourhood, type_guess, reviewed_notes, filter_results",
      )
      .eq("status", "needs_review")
      .order("reviewed_at", { ascending: false })
      .limit(100);
    if (error) {
      body = <LoadError message={error.message} />;
    } else {
      const items = (data ?? []) as ReviewItem[];
      body =
        items.length === 0 ? (
          <EmptyReview />
        ) : (
          <div className="flex flex-col gap-4">
            {items.map((it) => (
              <ReviewCard key={it.id} it={it} />
            ))}
          </div>
        );
    }
  } else {
    const { data, error } = await supabase
      .from("pending_candidates")
      .select(
        "id, name, neighbourhood, type_guess, vibe_draft, long_description_draft, sources_count, chain_risk_score, sources",
      )
      .eq("status", "pending")
      .order("sources_count", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) {
      body = <LoadError message={error.message} />;
    } else {
      const candidates = (data ?? []) as Candidate[];
      body =
        candidates.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="flex flex-col gap-4">
            {candidates.map((c) => (
              <CandidateCard key={c.id} c={c} />
            ))}
          </div>
        );
    }
  }

  return (
    <Shell>
      <header className="mb-6">
        <div className="text-[11px] font-extrabold tracking-[0.14em] uppercase text-primary mb-1">
          Admin · candidate review
        </div>
        <h1 className="text-[24px] font-extrabold tracking-tight text-fg leading-tight mb-3">
          Candidate queue
        </h1>
        <Tabs tab={tab} pending={pendingCount ?? 0} review={reviewCount ?? 0} />
      </header>
      {body}
    </Shell>
  );
}

function Tabs({
  tab,
  pending,
  review,
}: {
  tab: string;
  pending: number;
  review: number;
}) {
  const base =
    "px-3 py-1.5 rounded-full text-[11px] font-extrabold uppercase tracking-wider";
  const on = " bg-primary text-primary-fg";
  const off = " bg-muted text-muted-fg";
  return (
    <div className="flex gap-2">
      <a
        href="/admin/candidates"
        className={base + (tab === "pending" ? on : off)}
      >
        Pending · {pending}
      </a>
      <a
        href="/admin/candidates?status=needs_review"
        className={base + (tab === "needs_review" ? on : off)}
      >
        Needs review · {review}
      </a>
    </div>
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

function LoadError({ message }: { message: string }) {
  return (
    <p className="text-sm text-[hsl(0_70%_55%)]">
      Couldn&apos;t load the queue: {message}
    </p>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl bg-card border border-border p-6 text-center">
      <div className="text-3xl mb-2">🎉</div>
      <h2 className="text-sm font-extrabold text-heading mb-1">Queue clear</h2>
      <p className="text-xs text-muted-fg leading-relaxed">
        No candidates waiting. The discovery cron (discover-venues, every 4
        hours) queues new Google Places finds here for approval; approved
        candidates are published by <code>pnpm ingest:from-pending</code>. Run{" "}
        <code>pnpm discover-venues:dry</code> locally to preview what the next
        run would queue.
      </p>
    </div>
  );
}

function EmptyReview() {
  return (
    <div className="rounded-2xl bg-card border border-border p-6 text-center">
      <div className="text-3xl mb-2">✅</div>
      <h2 className="text-sm font-extrabold text-heading mb-1">
        Nothing to review
      </h2>
      <p className="text-xs text-muted-fg leading-relaxed">
        No imports were held back by the quality gate.
      </p>
    </div>
  );
}

// ── Needs-review card (onezone imports held by the ingest quality gate) ──────
function ReviewCard({ it }: { it: ReviewItem }) {
  const fr = it.filter_results ?? {};
  return (
    <article className="rounded-2xl bg-card border border-border p-5">
      <header className="mb-3">
        <h2 className="text-[18px] font-extrabold text-fg leading-tight">
          {it.name}
        </h2>
        <div className="text-xs text-muted-fg">
          {[it.type_guess, it.neighbourhood].filter(Boolean).join(" · ")}
        </div>
      </header>

      <div className="rounded-xl bg-muted/40 border border-border p-3 mb-4">
        <div className="text-[12px] font-extrabold text-accent mb-1.5">
          ⏸ Held: {fr.reason ?? it.reviewed_notes ?? "review needed"}
        </div>
        <div className="text-xs text-muted-fg leading-relaxed">
          Google matched to{" "}
          <span className="text-fg font-semibold">
            {fr.matched_name ?? "n/a"}
          </span>
          {fr.matched_address ? (
            <span className="text-muted-fg/70"> · {fr.matched_address}</span>
          ) : null}
        </div>
        <div className="text-xs text-muted-fg mt-1">
          Rating {fr.rating ?? "n/a"} · {fr.reviews ?? 0} reviews ·{" "}
          {fr.business_status ?? "status unknown"}
        </div>
        {fr.website ? (
          <a
            href={fr.website}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary underline-offset-2 hover:underline break-all"
          >
            {fr.website}
          </a>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <form action={decideCandidate}>
          <input type="hidden" name="id" value={it.id} />
          <input type="hidden" name="decision" value="reject" />
          <button
            type="submit"
            className="h-9 px-4 rounded-full bg-card border border-border text-fg text-xs font-extrabold uppercase tracking-wider"
          >
            Reject
          </button>
        </form>
        <form action={decideCandidate}>
          <input type="hidden" name="id" value={it.id} />
          <input type="hidden" name="decision" value="approve" />
          <button
            type="submit"
            className="h-9 px-4 rounded-full bg-muted text-fg text-xs font-extrabold uppercase tracking-wider"
          >
            Re-queue
          </button>
        </form>
      </div>
    </article>
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
              <span className="font-bold text-fg">{s.publication}</span>,{" "}
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
