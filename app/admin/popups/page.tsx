// /admin/popups — review surface for the autonomous pop-up radar.
//
// The radar (scripts/discover-popups.ts) auto-publishes pop-ups to
// public.events (source='popup'). This page is the maintainer's heads-up + control:
// it lists every LIVE pop-up so she can see what the robot added, and a
// one-tap "Hide" pulls any from the app (sets cancelled_at via a Server
// Action, which is sticky against re-discovery).
//
// Gated to admin emails (FL_ADMIN_EMAILS). The per-run additions are also
// printed in the GitHub Actions run summary for each cron tick.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser, isAdminEmail } from "@/lib/auth";
import { hidePopup } from "./actions";

export const dynamic = "force-dynamic";

type PopupRow = {
  id: string;
  name: string;
  venue_name: string;
  area: string;
  category: string;
  starts_at: string;
  ends_at: string | null;
  price: string;
  source_url: string | null;
  description: string | null;
};

function fmt(iso: string | null): string {
  if (!iso) return "TBC";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Europe/London",
  });
}

export default async function AdminPopupsPage() {
  const user = await getAuthUser();
  if (!user) redirect("/sign-in?return=/admin/popups");
  if (!isAdminEmail(user.email)) {
    return <NotAuthorised email={user.email ?? ""} />;
  }

  const supabase = await createClient();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const { data: rows, error } = await supabase
    .from("events")
    .select(
      "id, name, venue_name, area, category, starts_at, ends_at, price, source_url, description",
    )
    .eq("source", "popup")
    .is("cancelled_at", null)
    .gte("ends_at", today.toISOString())
    .order("ends_at", { ascending: true })
    .limit(100);

  if (error) {
    return (
      <Shell>
        <p className="text-sm text-[hsl(0_70%_55%)]">
          Couldn&apos;t load pop-ups: {error.message}
        </p>
      </Shell>
    );
  }

  const popups = (rows ?? []) as PopupRow[];

  return (
    <Shell>
      <header className="mb-6">
        <div className="text-[11px] font-extrabold tracking-[0.14em] uppercase text-primary mb-1">
          Admin · Pop-up radar
        </div>
        <h1 className="text-[24px] font-extrabold tracking-tight text-fg leading-tight mb-1">
          Live pop-ups
        </h1>
        <p className="text-sm text-muted-fg">
          {popups.length} live · auto-published, soonest to end first. Hide
          pulls one from the app (and keeps it off).
        </p>
      </header>

      {popups.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex flex-col gap-3">
          {popups.map((p) => (
            <PopupCard key={p.id} p={p} />
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
      <div className="text-3xl mb-2">🛰️</div>
      <h2 className="text-sm font-extrabold text-heading mb-1">
        No live pop-ups yet
      </h2>
      <p className="text-xs text-muted-fg leading-relaxed">
        The radar runs every 4 hours. Run <code>pnpm discover-popups:dry</code>{" "}
        locally to preview what it would add.
      </p>
    </div>
  );
}

function PopupCard({ p }: { p: PopupRow }) {
  return (
    <article className="rounded-2xl bg-card border border-border p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[17px] font-extrabold text-fg leading-tight">
            {p.name}
          </h2>
          <div className="text-xs text-muted-fg mt-0.5">
            {[p.venue_name, p.area].filter(Boolean).join(" · ")}
          </div>
          <div className="text-[11px] font-semibold text-accent mt-1">
            Ends {fmt(p.ends_at)} · {p.category} · {p.price}
          </div>
        </div>
        <form action={hidePopup} className="shrink-0">
          <input type="hidden" name="id" value={p.id} />
          <button
            type="submit"
            className="h-9 px-4 rounded-full bg-muted text-fg text-xs font-extrabold uppercase tracking-wider"
          >
            Hide
          </button>
        </form>
      </div>

      {p.description ? (
        <p className="text-sm text-muted-fg mt-3 leading-relaxed">
          {p.description}
        </p>
      ) : null}

      {p.source_url ? (
        <a
          href={p.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-[11px] font-bold text-primary underline-offset-2 hover:underline mt-2"
        >
          Official page ↗
        </a>
      ) : null}
    </article>
  );
}
