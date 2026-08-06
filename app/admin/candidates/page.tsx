// /admin/candidates — internal review queue.
//
// Two tabs:
//  • Pending — Tier 2 candidate scout queue (publication-sourced candidates).
//  • Needs review — bulk imports the ingest quality-gate held back (a weak or
//    wrong Google match: no rating / not operational / too few reviews). Shows
//    what Google matched each one to so an admin can reject the junk or re-queue.
//
// Gated to admin emails (FL_ADMIN_EMAILS env). Server Component reads
// pending_candidates and mutates via Server Actions (decideCandidate).

import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/admin";
import { getAuthUser, isAdminEmail } from "@/lib/auth";
import { decideCandidate } from "./actions";
import { safeExternalHref } from "@/lib/safe-url";

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
  // Two source shapes coexist: scout/press sources carry publication/url/
  // title/date; bulk-import sources (load-bulk-candidates.ts, 2026-08-02)
  // carry {source, import_note} — the CSV's description, internal evidence
  // for THIS approval card only (never published; see the loader's
  // provenance rules).
  sources: {
    publication?: string;
    url?: string;
    title?: string;
    date?: string;
    source?: string;
    import_note?: string | null;
  }[];
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

// Quick filters over the triage line written 2026-08-03 (a second `sources`
// entry, so it lives at sources->1 on bulk-import rows). Matching is a prefix
// ilike on that entry's import_note — deterministic because the triage writer
// used exactly these four prefixes. Rows without a triage entry (old
// discovery candidates) simply never match a pile filter.
const PILES = [
  {
    key: "possibly",
    label: "Possibly visitable",
    prefix: "possibly visitable%",
  },
  { key: "artifact", label: "Artifacts", prefix: "artifact inside%" },
  { key: "statue", label: "Statues & plaques", prefix: "statue/plaque%" },
  { key: "exterior", label: "Exterior only", prefix: "exterior or site only%" },
] as const;

export default async function AdminCandidatesPage(props: {
  searchParams: Promise<{ status?: string; q?: string; pile?: string }>;
}) {
  const searchParams = await props.searchParams;
  const user = await getAuthUser();
  if (!user) redirect("/sign-in?return=/admin/candidates");
  if (!isAdminEmail(user.email)) {
    return <NotAuthorised email={user.email ?? ""} />;
  }

  // Search is a plain GET param so results are linkable/refreshable. Next 15
  // hands back string[] for a repeated key (?q=a&q=b), so type-guard before
  // trim (same defensive pattern as explore/page.tsx). Trimmed and
  // length-capped; used only inside PostgREST ilike filters (parameterised by
  // supabase-js, not string-built SQL).
  const q =
    typeof searchParams.q === "string"
      ? searchParams.q.trim().slice(0, 80)
      : "";
  // LIKE pattern for q: escape %, _ and * so "100%" searches the literal name
  // (PostgREST maps * to % too). The raw q stays for display.
  const qLike = `%${q.replace(/[\\%_*]/g, (m) => `\\${m}`)}%`;
  const pile = PILES.find((p) => p.key === searchParams.pile) ?? null;

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
    let query = supabase
      .from("pending_candidates")
      .select(
        "id, name, neighbourhood, type_guess, reviewed_notes, filter_results",
      )
      .eq("status", "needs_review");
    if (q) query = query.ilike("name", qLike);
    const { data, error } = await query
      .order("reviewed_at", { ascending: false })
      .limit(100);
    if (error) {
      body = <LoadError message={error.message} />;
    } else {
      const items = (data ?? []) as ReviewItem[];
      body =
        items.length === 0 ? (
          q ? (
            <NoMatches q={q} pileLabel={null} />
          ) : (
            <EmptyReview />
          )
        ) : (
          <div className="flex flex-col gap-4">
            {items.map((it) => (
              <ReviewCard key={it.id} it={it} />
            ))}
          </div>
        );
    }
  } else {
    let query = supabase
      .from("pending_candidates")
      .select(
        "id, name, neighbourhood, type_guess, vibe_draft, long_description_draft, sources_count, chain_risk_score, sources",
      )
      .eq("status", "pending");
    if (q) query = query.ilike("name", qLike);
    // Pile filter reads the triage entry appended at sources->1 (see PILES).
    // Index 2 is checked too as drift insurance: a future triage pass would
    // append another entry, and a silently-empty chip would be worse than a
    // slightly wider filter. Prefixes are literals from PILES (no commas), so
    // they are safe inside the .or() filter string.
    if (pile)
      query = query.or(
        `sources->1->>import_note.ilike.${pile.prefix},sources->2->>import_note.ilike.${pile.prefix}`,
      );
    const { data, error } = await query
      .order("sources_count", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) {
      body = <LoadError message={error.message} />;
    } else {
      const candidates = (data ?? []) as Candidate[];
      body =
        candidates.length === 0 ? (
          q || pile ? (
            <NoMatches q={q} pileLabel={pile?.label ?? null} />
          ) : (
            <EmptyState />
          )
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
        <SearchBar tab={tab} q={q} pileKey={pile?.key ?? null} />
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

// Filter-aware empty state, shared by both tabs — a search with no hits must
// never render the celebratory "queue clear" card.
function NoMatches({ q, pileLabel }: { q: string; pileLabel: string | null }) {
  return (
    <p className="text-sm text-muted-fg">
      No candidates match{" "}
      {q ? (
        <>
          &ldquo;<span className="text-fg font-semibold">{q}</span>&rdquo;
        </>
      ) : null}
      {q && pileLabel ? " in " : ""}
      {pileLabel ? (
        <span className="text-fg font-semibold">{pileLabel}</span>
      ) : null}
      .{" "}
      <a
        href="/admin/candidates"
        className="text-primary underline-offset-2 hover:underline"
      >
        Clear filters
      </a>
    </p>
  );
}

// Search + triage-pile filters. A plain GET form: the URL carries the whole
// state (tab, q, pile), so filters are shareable and survive refresh. Pile
// chips only render on the Pending tab — the triage line only exists there.
function SearchBar({
  tab,
  q,
  pileKey,
}: {
  tab: string;
  q: string;
  pileKey: string | null;
}) {
  // Build hrefs via URLSearchParams so "?", "&" and encoding are always right.
  const hrefWith = (nextPile: string | null) => {
    const p = new URLSearchParams();
    if (tab === "needs_review") p.set("status", "needs_review");
    if (q) p.set("q", q);
    if (nextPile) p.set("pile", nextPile);
    const s = p.toString();
    return s ? `?${s}` : "/admin/candidates";
  };
  const chip =
    "px-3 py-1 rounded-full text-[11px] font-bold border transition-colors";
  return (
    <div className="mt-3 flex flex-col gap-2">
      <form method="GET" className="flex gap-2">
        {tab === "needs_review" ? (
          <input type="hidden" name="status" value="needs_review" />
        ) : null}
        {/* pile only applies to the Pending tab's query — don't carry a dead
            param through needs_review submits. */}
        {tab !== "needs_review" && pileKey ? (
          <input type="hidden" name="pile" value={pileKey} />
        ) : null}
        <input
          type="search"
          name="q"
          defaultValue={q}
          maxLength={80}
          placeholder="Search by name…"
          aria-label="Search candidates by name"
          className="flex-1 h-9 px-3.5 rounded-full bg-card border border-border text-sm text-fg placeholder:text-muted-fg/60 focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <button
          type="submit"
          className="h-9 px-4 rounded-full bg-primary text-primary-fg text-xs font-extrabold uppercase tracking-wider"
        >
          Search
        </button>
      </form>
      {tab !== "needs_review" ? (
        <div className="flex flex-wrap gap-1.5">
          {PILES.map((p) => {
            const on = p.key === pileKey;
            return (
              <a
                key={p.key}
                href={hrefWith(on ? null : p.key)}
                className={
                  chip +
                  (on
                    ? " bg-primary text-primary-fg border-primary"
                    : " bg-card text-muted-fg border-border hover:text-fg")
                }
              >
                {p.label}
              </a>
            );
          })}
          {pileKey || q ? (
            <a
              href="/admin/candidates"
              className={chip + " bg-muted text-muted-fg border-border"}
            >
              Clear
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
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

// ── Needs-review card (bulk imports held by the ingest quality gate) ──────
function ReviewCard({ it }: { it: ReviewItem }) {
  const fr = it.filter_results ?? {};
  // Candidate URLs come straight off the ingestion / bulk-import queue and are
  // reviewed by a signed-in ADMIN, so an unchecked scheme here would run in the
  // most privileged session we have. Same rule as every other catalogue href
  // (lib/safe-url.ts).
  const websiteHref = safeExternalHref(fr.website);
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
        {websiteHref ? (
          <a
            href={websiteHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary underline-offset-2 hover:underline break-all"
          >
            {fr.website}
          </a>
        ) : fr.website ? (
          // Show what was actually stored, unlinked. A reviewer deciding on
          // this candidate needs to SEE a rejected URL, not have it vanish.
          <span className="text-xs text-muted-fg break-all">
            {fr.website} (not a usable web link)
          </span>
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
          {c.sources.map((s, i) => {
            const sourceHref = safeExternalHref(s.url);
            return (
              <li key={i} className="text-xs text-muted-fg leading-snug">
                {s.publication ? (
                  <>
                    <span className="font-bold text-fg">{s.publication}</span>,{" "}
                    {sourceHref ? (
                      <a
                        href={sourceHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline-offset-2 hover:underline"
                      >
                        {s.title}
                      </a>
                    ) : (
                      <span>{s.title}</span>
                    )}{" "}
                    <span className="text-muted-fg/60">({s.date})</span>
                  </>
                ) : (
                  <>
                    <span className="font-bold text-fg">
                      {s.source === "bulk-import"
                        ? "Bulk import"
                        : (s.source ?? "import")}
                    </span>
                    {s.import_note ? <> · {s.import_note}</> : null}
                  </>
                )}
              </li>
            );
          })}
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
