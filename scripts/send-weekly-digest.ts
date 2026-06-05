// Weekly "new in London" digest.
//
// Emails everyone who opted in (profiles.email_weekly_opt_in = true) a short
// branded round-up of newly added venues + events happening this week. Sent
// via the Resend HTTP API. Runs from .github/workflows/weekly-digest.yml on a
// weekly cron, or locally:
//
//   pnpm send-weekly-digest --dry     # build + print, send nothing
//   pnpm send-weekly-digest --preview # write digest-preview.html and open-able
//   pnpm send-weekly-digest           # real send (needs RESEND_API_KEY)
//
// Consent + unsubscribe: opt-in is explicit (default off), every email carries
// a one-click unsubscribe link + RFC 8058 headers, and we never send an empty
// digest. Nothing here uses em/en dashes (brand rule — see check-no-dashes).

import * as dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });

const DRY_RUN = process.argv.includes("--dry");
const PREVIEW = process.argv.includes("--preview");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.funldn.com"
).replace(/\/$/, "");
const EMAIL_FROM = process.env.EMAIL_FROM ?? "Fun London <hello@funldn.com>";

const NEW_VENUE_DAYS = 7;
const MAX_VENUES = 6;
const MAX_EVENTS = 6;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!RESEND_API_KEY && !DRY_RUN && !PREVIEW) {
  // Match the event-adapter pattern: exit cleanly so the cron is green until
  // the key lands, rather than failing loudly.
  console.log(
    "RESEND_API_KEY not set. Skipping send (this is expected until the key " +
      "is added as a GitHub Actions secret). Run with --dry to build anyway.",
  );
  process.exit(0);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── Content ───────────────────────────────────────────────────────────────

type VenueLite = {
  slug: string;
  name: string;
  neighbourhood: string;
  type: string;
  vibe: string;
  img_url: string;
};
type EventLite = {
  id: string;
  name: string;
  venue_name: string;
  area: string;
  date_label: string;
  time_label: string;
  img_url: string;
};

async function newVenues(): Promise<VenueLite[]> {
  const since = new Date(
    Date.now() - NEW_VENUE_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { data, error } = await supabase
    .from("venues")
    .select("slug, name, neighbourhood, type, vibe, img_url, created_at")
    .not("google_place_id", "is", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(MAX_VENUES);
  if (error) throw new Error(`newVenues: ${error.message}`);
  return (data ?? []) as VenueLite[];
}

async function eventsThisWeek(): Promise<EventLite[]> {
  const now = new Date().toISOString();
  const horizon = new Date(
    Date.now() + 7 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { data, error } = await supabase
    .from("events")
    .select("id, name, venue_name, area, date_label, time_label, img_url, starts_at")
    .is("cancelled_at", null)
    .gte("starts_at", now)
    .lte("starts_at", horizon)
    .order("starts_at", { ascending: true })
    .limit(MAX_EVENTS);
  if (error) throw new Error(`eventsThisWeek: ${error.message}`);
  return (data ?? []) as EventLite[];
}

// ── Recipients ──────────────────────────────────────────────────────────────

type Recipient = { email: string; unsubToken: string };

async function recipients(): Promise<Recipient[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email_unsub_token")
    .eq("email_weekly_opt_in", true);
  if (error) throw new Error(`recipients: ${error.message}`);
  const optedIn = (data ?? []) as { id: string; email_unsub_token: string }[];
  if (optedIn.length === 0) return [];

  // profiles has no email column — resolve id -> email via the auth admin API.
  const emailById = new Map<string, string>();
  for (let page = 1; page <= 20; page++) {
    const { data: list, error: listErr } = await supabase.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (listErr) throw new Error(`listUsers: ${listErr.message}`);
    for (const u of list.users) if (u.email) emailById.set(u.id, u.email);
    if (list.users.length < 1000) break;
  }

  return optedIn
    .map((p) => {
      const email = emailById.get(p.id);
      return email ? { email, unsubToken: p.email_unsub_token } : null;
    })
    .filter((r): r is Recipient => r !== null);
}

// ── Email HTML ────────────────────────────────────────────────────────────

// em/en dash + " -- " → ", ", mirroring tidyDashes in lib/queries.ts so the
// no-dashes brand rule holds in email too (DB editorial copy can contain them).
const DASH_RE = /\s*[—–]\s*/g;
const DBL_HYPHEN_RE = / -{2} /g;

function esc(s: string): string {
  return s
    .replace(DASH_RE, ", ")
    .replace(DBL_HYPHEN_RE, ", ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function venueCard(v: VenueLite): string {
  return `<tr><td style="padding:8px 0;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="84" valign="top">
        <img src="${esc(v.img_url)}" width="72" height="72" alt=""
          style="border-radius:12px;object-fit:cover;display:block;">
      </td>
      <td valign="top" style="padding-left:12px;">
        <a href="${SITE_URL}/venue/${esc(v.slug)}"
          style="color:#1a1409;font-weight:800;font-size:15px;text-decoration:none;">
          ${esc(v.name)}</a>
        <div style="color:#645c50;font-size:12px;margin-top:2px;">
          ${esc(v.type)} &middot; ${esc(v.neighbourhood)}</div>
        <div style="color:#2a2419;font-size:13px;font-style:italic;margin-top:4px;">
          ${esc(v.vibe)}</div>
      </td>
    </tr></table>
  </td></tr>`;
}

function eventRow(e: EventLite): string {
  return `<tr><td style="padding:8px 0;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="84" valign="top">
        <img src="${esc(e.img_url)}" width="72" height="72" alt=""
          style="border-radius:12px;object-fit:cover;display:block;">
      </td>
      <td valign="top" style="padding-left:12px;">
        <a href="${SITE_URL}/event/${esc(e.id)}"
          style="color:#1a1409;font-weight:800;font-size:15px;text-decoration:none;">
          ${esc(e.name)}</a>
        <div style="color:#645c50;font-size:12px;margin-top:2px;">
          ${esc(e.date_label)} &middot; ${esc(e.time_label)}</div>
        <div style="color:#645c50;font-size:12px;margin-top:2px;">
          ${esc(e.venue_name)} &middot; ${esc(e.area)}</div>
      </td>
    </tr></table>
  </td></tr>`;
}

function section(title: string, rows: string): string {
  if (!rows) return "";
  return `<tr><td style="padding-top:20px;">
    <div style="font-size:12px;font-weight:800;letter-spacing:0.08em;
      text-transform:uppercase;color:hsl(233 70% 55%);">${title}</div>
    <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>
  </td></tr>`;
}

function buildHtml(
  venues: VenueLite[],
  events: EventLite[],
  unsubUrl: string,
): string {
  const venuesBlock = section(
    "New on Fun London",
    venues.map(venueCard).join(""),
  );
  const eventsBlock = section(
    "On this week",
    events.map(eventRow).join(""),
  );
  return `<!doctype html><html><body style="margin:0;background:#f0eee9;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0eee9;padding:24px 0;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0"
        style="max-width:440px;background:#ffffff;border-radius:18px;
        padding:24px;border:1px solid #e3ddd2;">
        <tr><td>
          <div style="font-size:11px;font-weight:800;letter-spacing:0.10em;text-transform:uppercase;color:hsl(250 70% 50%);">This week in independent London</div>
          <div style="font-size:22px;font-weight:800;color:#1a1409;margin-top:4px;">Fun London</div>
          <div style="font-size:14px;color:#645c50;margin-top:4px;">
            No chains. No sponsored slots. Here is what is new this week.</div>
        </td></tr>
        ${venuesBlock}
        ${eventsBlock}
        <tr><td style="padding-top:24px;">
          <a href="${SITE_URL}/explore"
            style="display:inline-block;background:hsl(233 70% 55%);color:#fff;
            font-weight:800;font-size:14px;text-decoration:none;
            padding:12px 22px;border-radius:12px;">Open Fun London</a>
        </td></tr>
        <tr><td style="padding-top:24px;border-top:1px solid #e3ddd2;margin-top:16px;">
          <div style="font-size:11px;color:#9c9385;padding-top:12px;line-height:1.5;">
            You are getting this because you turned on weekly emails in your Fun
            London profile.<br>
            <a href="${unsubUrl}" style="color:#9c9385;">Unsubscribe</a>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
  </body></html>`;
}

// ── Send ────────────────────────────────────────────────────────────────────

async function sendOne(
  to: string,
  subject: string,
  html: string,
  unsubUrl: string,
): Promise<boolean> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to,
      subject,
      html,
      // Native one-click unsubscribe (Gmail/Apple Mail). POSTs unsubUrl.
      headers: {
        "List-Unsubscribe": `<${unsubUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    }),
  });
  if (!res.ok) {
    console.error(`  ! send to ${to} failed ${res.status}: ${await res.text()}`);
    return false;
  }
  return true;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(
    `Fun London weekly digest${DRY_RUN ? " (dry run)" : PREVIEW ? " (preview)" : ""}`,
  );

  const [venues, events] = await Promise.all([newVenues(), eventsThisWeek()]);
  console.log(`Content: ${venues.length} new venues, ${events.length} events this week`);

  if (venues.length === 0 && events.length === 0) {
    console.log("Nothing new this week. Not sending an empty digest.");
    return;
  }

  const subject = "This week in independent London";

  if (PREVIEW) {
    const html = buildHtml(venues, events, `${SITE_URL}/api/email/unsubscribe?token=PREVIEW`);
    const { writeFileSync } = await import("node:fs");
    writeFileSync("digest-preview.html", html);
    console.log("Wrote digest-preview.html (open it in a browser to review).");
    return;
  }

  const list = await recipients();
  console.log(`Recipients (opted in, with email): ${list.length}`);
  if (list.length === 0) {
    console.log("No opted-in recipients. Done.");
    return;
  }

  if (DRY_RUN) {
    console.log("[dry run] would send to:");
    for (const r of list) console.log(`  - ${r.email}`);
    return;
  }

  let sent = 0;
  for (const r of list) {
    const unsubUrl = `${SITE_URL}/api/email/unsubscribe?token=${encodeURIComponent(r.unsubToken)}`;
    const html = buildHtml(venues, events, unsubUrl);
    if (await sendOne(r.email, subject, html, unsubUrl)) sent++;
    await sleep(120); // stay well under Resend's rate limit
  }
  console.log(`\nSent ${sent}/${list.length} digests.`);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
