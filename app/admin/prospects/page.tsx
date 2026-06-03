// /admin/prospects — the partner-BD cockpit (P2 #5).
//
// Surfaces public.partner_prospects (venues that passed curation but have no
// major booking platform — the highest-likelihood BD targets) so they can be
// progressed through the bd_status lifecycle and annotated. Admin-gated;
// reads/writes via the service-role client because the table is RLS-locked to
// service_role.

import { redirect } from "next/navigation";
import { getAuthUser, isAdminEmail } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/admin";
import { updateProspect } from "./actions";
import { BD_STATUSES } from "./constants";

export const dynamic = "force-dynamic";

type Prospect = {
  id: string;
  name: string;
  type: string | null;
  neighbourhood: string | null;
  why_qualified: string | null;
  current_booking_method: string | null;
  website_url: string | null;
  phone: string | null;
  instagram_handle: string | null;
  bd_status: string;
  notes: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  prospect: "Prospect",
  contacted: "Contacted",
  in_conversation: "In conversation",
  partnered: "Partnered",
  declined: "Declined",
  passed: "Passed",
};
// Active pipeline first, dead stages last.
const STATUS_ORDER: Record<string, number> = {
  in_conversation: 0,
  contacted: 1,
  prospect: 2,
  partnered: 3,
  declined: 4,
  passed: 5,
};

export default async function AdminProspectsPage() {
  const user = await getAuthUser();
  if (!user) redirect("/sign-in?return=/admin/prospects");
  if (!isAdminEmail(user.email))
    return <NotAuthorised email={user.email ?? ""} />;

  const supabase = createServiceClient();
  if (!supabase) {
    return (
      <Shell>
        <p className="text-sm text-muted-fg">
          Service role key not configured (`SUPABASE_SERVICE_ROLE_KEY`), so the
          BD table can&apos;t be read here.
        </p>
      </Shell>
    );
  }

  const { data, error } = await supabase
    .from("partner_prospects")
    .select(
      "id, name, type, neighbourhood, why_qualified, current_booking_method, website_url, phone, instagram_handle, bd_status, notes",
    )
    .order("updated_at", { ascending: false })
    .limit(500);

  if (error) {
    return (
      <Shell>
        <p className="text-sm text-red-500">
          Couldn&apos;t load prospects: {error.message}
        </p>
      </Shell>
    );
  }

  const prospects = ((data ?? []) as Prospect[]).sort(
    (a, b) =>
      (STATUS_ORDER[a.bd_status] ?? 9) - (STATUS_ORDER[b.bd_status] ?? 9),
  );

  const counts = prospects.reduce<Record<string, number>>((acc, p) => {
    acc[p.bd_status] = (acc[p.bd_status] ?? 0) + 1;
    return acc;
  }, {});
  const summary =
    BD_STATUSES.filter((s) => counts[s])
      .map((s) => `${counts[s]} ${STATUS_LABEL[s].toLowerCase()}`)
      .join(" · ") || "none yet";

  return (
    <Shell>
      <header className="mb-6">
        <div className="text-[11px] font-extrabold tracking-[0.14em] uppercase text-primary mb-1">
          Admin · Partner BD
        </div>
        <h1 className="text-[24px] font-extrabold tracking-tight text-fg leading-tight mb-1">
          Prospect pipeline
        </h1>
        <p className="text-sm text-muted-fg">
          {prospects.length} venues · {summary}
        </p>
        <p className="text-xs text-muted-fg/80 mt-1 leading-relaxed">
          Curated independents with no major booking platform. Move each through
          the pipeline as you reach out.
        </p>
      </header>

      {prospects.length === 0 ? (
        <div className="rounded-2xl bg-card border border-border p-6 text-center text-sm text-muted-fg">
          No prospects yet.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {prospects.map((p) => (
            <ProspectCard key={p.id} p={p} />
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

function ProspectCard({ p }: { p: Prospect }) {
  const meta = [p.type, p.neighbourhood].filter(Boolean).join(" · ");
  return (
    <article className="rounded-2xl bg-card border border-border p-5">
      <header className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-[18px] font-extrabold text-fg leading-tight">
          {p.name}
        </h2>
        <span className="text-[10px] font-extrabold uppercase tracking-wider bg-muted text-muted-fg rounded-full px-2 py-1 shrink-0">
          {STATUS_LABEL[p.bd_status] ?? p.bd_status}
        </span>
      </header>
      {meta && <div className="text-xs text-muted-fg mb-2">{meta}</div>}

      {p.why_qualified && (
        <p className="text-sm text-muted-fg mb-2 leading-relaxed">
          {p.why_qualified}
        </p>
      )}
      {p.current_booking_method && (
        <p className="text-xs text-muted-fg/80 mb-3">
          Books via: <span className="text-fg">{p.current_booking_method}</span>
        </p>
      )}

      <div className="flex flex-wrap gap-3 mb-4 text-xs font-bold">
        {p.website_url && (
          <a
            href={p.website_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline-offset-2 hover:underline"
          >
            🌐 Website
          </a>
        )}
        {p.phone && (
          <a href={`tel:${p.phone}`} className="text-fg">
            📞 {p.phone}
          </a>
        )}
        {p.instagram_handle && (
          <a
            href={`https://instagram.com/${p.instagram_handle.replace("@", "")}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline-offset-2 hover:underline"
          >
            📸 {p.instagram_handle}
          </a>
        )}
      </div>

      <form action={updateProspect} className="flex flex-col gap-2.5">
        <input type="hidden" name="id" value={p.id} />
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-[11px] font-extrabold uppercase tracking-wider text-muted-fg">
            Stage
          </label>
          <select
            name="status"
            defaultValue={p.bd_status}
            className="h-9 rounded-xl bg-bg border border-border px-2.5 text-sm text-fg"
          >
            {BD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <textarea
          name="notes"
          defaultValue={p.notes ?? ""}
          rows={2}
          maxLength={4000}
          placeholder="BD notes (who you spoke to, next step, terms)…"
          className="w-full rounded-xl bg-bg border border-border px-3 py-2 text-sm text-fg placeholder:text-muted-fg/70 resize-none"
        />
        <button
          type="submit"
          className="self-start h-9 px-4 rounded-full bg-primary text-white text-xs font-extrabold uppercase tracking-wider"
        >
          Save
        </button>
      </form>
    </article>
  );
}
