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
import { tidyText } from "@/lib/text";

dotenv.config({ path: ".env.local" });

const DRY_RUN = process.argv.includes("--dry");
const PREVIEW = process.argv.includes("--preview");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
// 🧨 These use `||`, NOT `??`, and that is load bearing.
// A workflow that maps `env: X: ${{ secrets.X }}` sets X to an EMPTY STRING
// when the secret does not exist, and `??` only falls back on null/undefined.
// Neither EMAIL_FROM nor NEXT_PUBLIC_SITE_URL is a repo secret, so with `??`
// both silently became "" in CI: every digest posted `from: ""` and Resend
// rejected all of them with 422 "The domain is invalid" for 9 weeks, while
// every link in the body would have been relative and broken. Nothing was
// ever wrong with the Resend domain or the API key.
const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://www.funldn.com"
).replace(/\/$/, "");
const EMAIL_FROM = process.env.EMAIL_FROM || "Fun London <hello@funldn.com>";

const NEW_VENUE_DAYS = 7;
const MAX_VENUES = 6;
const MAX_EVENTS = 6;

// The brand's single violet, matching --fl-primary in app/globals.css.
// This email had drifted to a second, bluer violet (hsl(233 70% 55%)) for its
// section headings and button while the masthead used the real one, so the two
// sat side by side in the same message looking like a mistake. The brand
// system is explicit that there is ONE solid violet.
//
// Written as HEX, not hsl(). Outlook on Windows renders through the Word
// engine, which does not parse hsl() in any form and is riskier still with
// space-separated CSS Color 4 syntax. An unparsed background would leave the
// CTA as unstyled text, which is the same "reads as broken" class of failure
// the <head> work here is fixing. #4426D9 is hsl(250 70% 50%) exactly.
const BRAND_VIOLET = "#4426D9";

// The DAY muted foreground. This email was using #9c9385, which is the NIGHT
// token, on a white card: about 2.9:1, failing AA. globals.css records that
// #645c50 was darkened specifically to clear AA.
const MUTED_FG = "#645c50";

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
// Belt and braces for the bug above: refuse to post a malformed sender to
// Resend rather than burning a whole weekly run discovering it recipient by
// recipient. Accepts "you@example.com" or "Name <you@example.com>".
const FROM_ADDRESS = EMAIL_FROM.includes("<")
  ? EMAIL_FROM.slice(EMAIL_FROM.indexOf("<") + 1, EMAIL_FROM.lastIndexOf(">"))
  : EMAIL_FROM;
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(FROM_ADDRESS.trim())) {
  console.error(
    `EMAIL_FROM is not a usable sender: ${JSON.stringify(EMAIL_FROM)}. ` +
      'Resend rejects this with 422 "The domain is invalid". Expected ' +
      '"Name <you@yourdomain.com>" or "you@yourdomain.com". An empty value ' +
      "usually means a workflow maps a secret that does not exist.",
  );
  process.exit(1);
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
    // Mirror the visibility gate every other catalogue read applies. Without
    // it a venue hidden this week is emailed to subscribers with a link that
    // fetchVenueBySlug then resolves to a 404, and an empty img_url renders a
    // broken-image icon in every inbox. This was the only catalogue read in
    // the repo missing hidden_at.
    .is("hidden_at", null)
    .neq("img_url", "")
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
    .neq("img_url", "")
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

// Shares lib/text.ts with the website, so a title reads the same in the inbox
// as it does on the page. That helper applies the no-dashes brand rule AND
// repairs provider mojibake: this digest is where the Ticketmaster corruption
// actually surfaced, going out to real subscribers as a row of boxes.
//
// Quotes are escaped too. Several of these values land inside HTML attributes
// (img src, anchor href) and one stray quote in a provider image URL would
// break out of the attribute.
function esc(s: string): string {
  return tidyText(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
      text-transform:uppercase;color:${BRAND_VIOLET};">${title}</div>
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
  // <head> is load bearing, and its absence was a live bug waiting on the
  // calendar. With no charset declared, mail clients fall back to Latin-1 and
  // render every multi-byte character as mojibake. 97 venue names carry
  // accents (Abraco, ALAIA, Cafe Kitsune, Berbere, Blabar, Arome), so the
  // first week one of those was new, every subscriber would have seen
  // gibberish. It had simply never fired: the run that exposed this shipped
  // 0 new venues.
  //
  // format-detection + the x-apple-data-detectors rules stop iOS Mail
  // auto-linking times and street addresses. Left alone it underlines
  // "7:00 PM" and "64 Brick Lane" in its own blue, which is what made the
  // layout read as broken and unstyled.
  return `<!doctype html><html lang="en"><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light only">
  <meta name="format-detection" content="telephone=no,date=no,address=no,email=no">
  <title>This week in independent London</title>
  <style>
    a[x-apple-data-detectors] {
      color: inherit !important;
      text-decoration: none !important;
      font-size: inherit !important;
      font-family: inherit !important;
      font-weight: inherit !important;
      line-height: inherit !important;
    }
    img { border: 0; outline: none; text-decoration: none; }
  </style>
  </head><body style="margin:0;background:#f0eee9;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <!-- bgcolor attributes are load bearing for Outlook on Windows: it renders
       through the Word engine, which drops the CSS background shorthand and
       would leave the cream page white. The width attribute is there for the
       same reason, since max-width alone is ignored and the card would become
       a full-window slab. Modern clients take the inline width:100%. -->
  <table width="100%" cellpadding="0" cellspacing="0" bgcolor="#f0eee9" style="background:#f0eee9;padding:24px 0;">
    <tr><td align="center" style="padding:0 12px;">
      <table width="440" cellpadding="0" cellspacing="0" bgcolor="#ffffff"
        style="width:100%;max-width:440px;background:#ffffff;border-radius:18px;
        padding:24px;border:1px solid #e3ddd2;">
        <tr><td>
          <div style="font-size:11px;font-weight:800;letter-spacing:0.10em;text-transform:uppercase;color:${BRAND_VIOLET};">This week in independent London</div>
          <div style="font-size:22px;font-weight:800;color:#1a1409;margin-top:4px;">Fun London</div>
          <div style="font-size:14px;color:#645c50;margin-top:4px;">
            No chains. No sponsored slots. Here is what is new this week.</div>
        </td></tr>
        ${venuesBlock}
        ${eventsBlock}
        <tr><td style="padding-top:24px;">
          <a href="${SITE_URL}/explore"
            style="display:inline-block;background:${BRAND_VIOLET};color:#fff;
            font-weight:800;font-size:14px;text-decoration:none;
            padding:12px 22px;border-radius:12px;">Open Fun London</a>
        </td></tr>
        <tr><td style="padding-top:24px;border-top:1px solid #e3ddd2;margin-top:16px;">
          <div style="font-size:11px;color:${MUTED_FG};padding-top:12px;line-height:1.5;">
            You are getting this because you turned on weekly emails in your Fun
            London profile.<br>
            <a href="${unsubUrl}" style="color:${MUTED_FG};">Unsubscribe</a>
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

  // FAIL LOUDLY when nothing got through.
  //
  // This script sent 0 emails every week from 2026-06-11 to 2026-07-23 — every
  // recipient 422'd ("The domain is invalid", because funldn.com was never
  // verified as a Resend sending domain) — and still exited 0. So the workflow
  // reported `conclusion: success` 10 weeks running and the Alert-on-failure
  // step never fired. A digest that delivers nothing is a FAILURE, not a quiet
  // Thursday: with recipients on the list, zero sends must be non-zero exit.
  //
  // A genuinely empty list (nobody opted in) is NOT an error and exits 0.
  if (list.length > 0 && sent === 0) {
    console.error(
      `\nFAILED: 0 of ${list.length} digests were delivered. ` +
        `Every send was rejected — check the per-recipient errors above ` +
        `(a 422 "domain is invalid" means the EMAIL_FROM domain is not verified in Resend).`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
