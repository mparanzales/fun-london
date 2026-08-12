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
import { sizedImageUrl } from "@/lib/img";
import { computePlan, planRationale, type Plan } from "@/lib/plan-engine";
import {
  briefForWeek,
  upcomingFriday19,
  fmtLondonTime,
} from "@/lib/digest-night";
import type { Venue, VenueType, PriceTier, TimeOfDay } from "@/lib/types";

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

// Number(undefined) is NaN and NaN || 7 falls through, so the override is
// opt-in and typo-safe. Used to preview the venues section in weeks that
// shipped no new venues; the cron never sets it.
const NEW_VENUE_DAYS = Number(process.env.FL_DIGEST_VENUE_DAYS) || 7;
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

// One string for the <title> and the sent subject. They were declared
// separately and had already drifted.
const SUBJECT = "Where the night starts this week";

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
  const horizon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("events")
    .select(
      "id, name, venue_name, area, date_label, time_label, img_url, starts_at",
    )
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

// ── The night of the week ─────────────────────────────────────────────────
//
// The one thing this email can carry that no places newsletter can: a REAL
// night, built by the same computePlan the app runs, with real walking
// minutes and real arrival times, every stop checked open at its own arrival.
// Nothing is mocked; if the engine cannot fill a night the section is
// omitted entirely rather than faked (honest-copy rule).

// Mirrors lib/queries.ts mapVenuePlan. Duplicated deliberately: queries.ts
// imports the Next server runtime (next/headers via supabase/server), which
// does not exist under tsx, so this script cannot import the original. Keep
// the two in step if VENUE_PLAN_COLUMNS grows.
const VENUE_PLAN_COLUMNS =
  "id, slug, name, type, vibe, vibe_tags, neighbourhood, price, time_of_day, rating, review_count, lat, lng, opening_hours, plan_note, img_url, curation_tier, created_at";

type PlanRow = {
  id: string;
  slug: string;
  name: string;
  type: string;
  vibe: string;
  vibe_tags: string[] | null;
  neighbourhood: string;
  price: string;
  time_of_day: string;
  rating: number;
  review_count: number;
  lat: number;
  lng: number;
  opening_hours: Venue["openingHours"];
  plan_note: string | null;
  img_url: string;
  curation_tier: string | null;
  created_at: string;
};

function rowToVenue(r: PlanRow): Venue {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    type: r.type as VenueType,
    vibe: tidyText(r.vibe),
    longDescription: "",
    neighbourhood: r.neighbourhood,
    address: "",
    lat: r.lat,
    lng: r.lng,
    price: (r.price as PriceTier | null) ?? null,
    timeOfDay: r.time_of_day as TimeOfDay,
    rating: Number(r.rating),
    reviewCount: r.review_count,
    walkingMins: 0,
    tablesFree: 0,
    nextSlotLabel: "",
    imgUrl: r.img_url,
    photoUrls: [],
    moodTags: [],
    vibeTags: r.vibe_tags ?? [],
    googlePlaceId: null,
    bookingLinks: null,
    websiteUrl: null,
    phone: null,
    instagramHandle: null,
    editorialSources: null,
    creatorCoverage: null,
    criticalFlags: null,
    openingHours: r.opening_hours,
    mapUrl: null,
    reviews: null,
    planNote: r.plan_note ?? null,
    menuUrl: null,
    curationTier: r.curation_tier === "curated" ? "curated" : "discovered",
    createdAt: r.created_at,
  } as Venue;
}

async function weeklyNight(): Promise<Plan | null> {
  try {
    const PAGE = 1000;
    const rows: PlanRow[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("venues")
        .select(VENUE_PLAN_COLUMNS)
        .not("google_place_id", "is", null)
        .is("hidden_at", null)
        .not("img_url", "ilike", "%unsplash%")
        .neq("img_url", "")
        .order("rating", { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const page = (data ?? []) as PlanRow[];
      rows.push(...page);
      if (page.length < PAGE) break;
    }
    const brief = briefForWeek(new Date());
    const plan = computePlan(rows.map(rowToVenue), {
      area: { kind: "neighbourhood", name: brief.area },
      vibe: brief.vibe,
      budget: "Any",
      daypart: "evening",
      when: upcomingFriday19(),
    });
    if (plan.steps.length < 2) return null; // never send a one-stop "night"
    return plan;
  } catch (err) {
    // The digest still goes out without the night; it never fails the send.
    console.error("weeklyNight failed (section omitted):", err);
    return null;
  }
}

// ── Email HTML ────────────────────────────────────────────────────────────

// Shares lib/text.ts with the website, so a title reads the same in the inbox
// as it does on the page: mojibake repair + the no-dashes brand rule. Quotes
// are escaped because several values land inside HTML attributes.
// URLs: escape for an HTML attribute WITHOUT running the prose tidier.
// tidyText replaces a dash with ", ", and a space injected into an href is an
// unrecoverable broken link. Everything the digest links to is ASCII today,
// so this is a guard rather than a bug fix, but it costs nothing and the
// failure would be invisible until a subscriber clicked.
function escAttr(u: string): string {
  return (u ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function esc(s: string): string {
  return tidyText(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const INK = "#1a1409";
const INK_SOFT = "#2a2419";
const CREAM = "#f0eee9";
const LINE = "#e3ddd2";
// Night theme, verbatim from globals.css [data-theme="night"]: the night of
// the week renders in the app's own night mode. The clock is product.
const NIGHT_BG = "#14121a";
const NIGHT_FG = "#ece6d9";
const NIGHT_MUTED = "#9c9385";
// Canon accent (hsl(266 78% 58%)) as hex for the Word engine; the dashed
// connector law is 2px dashed ACCENT violet, not an invented tint.
const ACCENT = "#8940E7";
const VIOLET_PALE = "#C9BFF2"; // eyebrows on violet/night surfaces only
const VIOLET_WASH = "#EDE9FE";
// The signature gradient, canon recipe hsl(240 84% 60%) -> hsl(266 78% 58%),
// rationed to ONE hero moment: the masthead. bgcolor carries Outlook.
const GRADIENT = "linear-gradient(135deg,#4343EF 0%,#8940E7 100%)";

// Outlook's Word engine does not inherit font-family into tables, so the
// stack rides inline on every text-bearing block, not just <body>.
const FONT =
  "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;";

function sectionHead(eyebrow: string, headline: string): string {
  return `<div style="${FONT}font-size:11px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:${BRAND_VIOLET};">${eyebrow}</div>
    <div style="${FONT}font-size:24px;font-weight:800;color:${INK};margin-top:3px;">${headline}</div>`;
}

// ── The night line ────────────────────────────────────────────────────────
// Large editorial numerals, a CONTINUOUS dashed spine (background-image
// repeat-y on the numeral column, so it spans chip to chip whatever the row
// height — a fixed-height connector row is how it degraded to a timeline
// component), real walk minutes, real arrival times. Outlook drops
// background-image and degrades to numerals without the spine.

const ROLE_LABEL: Record<string, string> = {
  Start: "START",
  Then: "THEN",
  Finish: "FINISH",
};

function spine(offsetTop: number): string {
  return `background-image:linear-gradient(${ACCENT} 50%,transparent 50%);background-size:2px 8px;background-repeat:repeat-y;background-position:21px ${offsetTop}px;`;
}

function nightStop(
  step: Plan["steps"][number],
  n: number,
  last: boolean,
): string {
  const v = step.venue;
  const arrive = step.arriveAt
    ? ` &middot; arrive ${fmtLondonTime(step.arriveAt)}`
    : "";
  return `<tr><td width="44" valign="top" align="left" style="${last ? "" : spine(46)}">
      <div style="${FONT}font-size:34px;font-weight:800;line-height:1;color:${ACCENT};width:44px;text-align:left;">${n}</div>
    </td>
    <td valign="top" style="padding:2px 0 22px 4px;">
      <div style="${FONT}font-size:10px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:${VIOLET_PALE};">${ROLE_LABEL[step.role] ?? step.role}${arrive}</div>
      <a href="${SITE_URL}/venue/${escAttr(v.slug)}" style="${FONT}color:#ffffff;font-weight:800;font-size:17px;line-height:1.3;text-decoration:none;">${esc(v.name)}</a>
      <div style="${FONT}color:${NIGHT_MUTED};font-size:12px;margin-top:2px;">${esc(v.neighbourhood)} &middot; ${esc(v.type)}${v.price ? ` &middot; ${esc(v.price)}` : ""}</div>
      <div style="${FONT}color:${NIGHT_FG};font-size:13px;font-style:italic;margin-top:4px;">${esc(v.vibe)}</div>${
        step.walkToNextMins != null && !last
          ? `<div style="${FONT}color:${NIGHT_MUTED};font-size:12px;margin-top:10px;">&darr; ${step.walkToNextMins} min walk</div>`
          : ""
      }
    </td>
    <td width="72" valign="top" align="right" style="padding-bottom:22px;">
      <img src="${escAttr(sizedImageUrl(v.imgUrl, 144))}" width="60" height="60" alt="${esc(v.name)}"
        style="border-radius:12px;object-fit:cover;display:block;">
    </td>
  </tr>`;
}

function nightBlock(plan: Plan): string {
  const stops = plan.steps
    .map((step, i) => nightStop(step, i + 1, i === plan.steps.length - 1))
    .join("");
  const hours = Math.floor(plan.totalMins / 60);
  const mins = plan.totalMins % 60;
  const span = `${hours ? `${hours}h ` : ""}${mins ? `${mins}m` : ""}`.trim();
  return `<tr><td style="padding:30px 0 0;">
    <table width="100%" cellpadding="0" cellspacing="0" bgcolor="${NIGHT_BG}" style="background:${NIGHT_BG};border-radius:20px;">
      <tr><td style="padding:24px 22px 22px;">
        <img src="${SITE_URL}/email/night-line.gif" width="396" height="44" alt=""
          style="width:100%;height:auto;display:block;margin-bottom:14px;">
        <div style="${FONT}font-size:11px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:${VIOLET_PALE};">Friday &middot; ${esc(plan.area)} &middot; ${span} on the night</div>
        <div style="${FONT}font-size:26px;font-weight:800;color:#ffffff;margin-top:3px;">one night, drawn.</div>
        <div style="${FONT}font-size:13px;font-style:italic;color:${NIGHT_FG};margin-top:5px;margin-bottom:20px;">${esc(planRationale(plan))}</div>
        <table width="100%" cellpadding="0" cellspacing="0">${stops}</table>
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td bgcolor="#ffffff" style="background:#ffffff;border-radius:14px;">
            <a href="${SITE_URL}/plan"
              style="${FONT}display:block;text-align:center;color:${BRAND_VIOLET};
              font-weight:800;font-size:15px;line-height:1;text-decoration:none;
              padding:16px 20px;">Draw my own night</a>
          </td>
        </tr></table>
      </td></tr>
    </table>
  </td></tr>`;
}

// ── Photo grid: places and events as cards, two up, air between ──────────

type GridCell = {
  href: string;
  img: string;
  title: string;
  metaStrong: string;
  meta: string;
};

// Width ATTRIBUTES must match the real slot, not the CSS. Outlook's Word
// engine ignores width:100% and object-fit and draws the ATTRIBUTE size, so
// these numbers ARE the Windows layout. The card is 440px and the section
// tds carry no horizontal padding, so with a 16px gutter each cell is
// exactly (440 - 16) / 2 = 212. They were left at 188/392 from the earlier
// padded layout, which squashed every photo about 11% and left a hole down
// the right of every cell on Windows.
function gridCellHtml(c: GridCell | null): string {
  if (!c) return `<td width="212"></td>`;
  return `<td width="212" valign="top" style="padding-bottom:26px;">
    <a href="${c.href}" style="text-decoration:none;">
      <img src="${c.img}" width="212" height="132" alt="${c.title}"
        style="width:100%;height:132px;border-radius:16px;object-fit:cover;display:block;">
      <div style="${FONT}color:${INK};font-weight:800;font-size:14px;line-height:1.3;margin-top:9px;min-height:36px;">${c.title}</div>
      <div style="${FONT}color:${MUTED_FG};font-size:11px;margin-top:2px;"><span style="color:${INK_SOFT};font-weight:600;">${c.metaStrong}</span> &middot; ${c.meta}</div>
    </a>
  </td>`;
}

function grid(cells: GridCell[]): string {
  let out = "";
  for (let i = 0; i < cells.length; i += 2) {
    out += `<tr>${gridCellHtml(cells[i])}<td width="16"></td>${gridCellHtml(
      cells[i + 1] ?? null,
    )}</tr>`;
  }
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">${out}</table>`;
}

function venueCell(v: VenueLite): GridCell {
  return {
    href: `${SITE_URL}/venue/${escAttr(v.slug)}`,
    img: escAttr(sizedImageUrl(v.img_url, 512)),
    title: esc(v.name),
    metaStrong: esc(v.neighbourhood),
    meta: esc(v.type),
  };
}

function eventCell(e: EventLite): GridCell {
  return {
    href: `${SITE_URL}/event/${escAttr(e.id)}`,
    img: escAttr(sizedImageUrl(e.img_url, 512)),
    title: esc(e.name),
    metaStrong: esc(e.venue_name),
    meta: `${esc(e.date_label)} &middot; ${esc(e.time_label)}`,
  };
}

function heroEvent(e: EventLite): string {
  // The lead story: full-width photography, then the same information order
  // as the app card. Outlook cannot object-fit; alt is the WebP fallback.
  return `<div style="padding-top:16px;">
    <a href="${SITE_URL}/event/${escAttr(e.id)}" style="text-decoration:none;">
      <img src="${escAttr(sizedImageUrl(e.img_url, 800))}" width="440" height="240"
        alt="${esc(e.name)}"
        style="width:100%;height:240px;border-radius:16px;object-fit:cover;display:block;">
      <div style="${FONT}color:${INK};font-weight:800;font-size:20px;line-height:1.25;margin-top:12px;">${esc(e.name)}</div>
      <div style="${FONT}color:${MUTED_FG};font-size:12px;margin-top:3px;">
        <span style="color:${INK_SOFT};font-weight:600;">${esc(e.venue_name)}</span>
        &middot; ${esc(e.area)} &middot; ${esc(e.date_label)} &middot; ${esc(e.time_label)}</div>
    </a>
  </div>`;
}

function buildHtml(
  plan: Plan | null,
  venues: VenueLite[],
  events: EventLite[],
  unsubUrl: string,
): string {
  const nightSection = plan ? nightBlock(plan) : "";

  const venuesSection = venues.length
    ? `<tr><td style="padding:34px 0 0;">
        ${sectionHead("New this week", "first stop material.")}
        ${grid(venues.map(venueCell))}
      </td></tr>`
    : "";

  const [lead, ...allBriefs] = events;
  // An odd brief count leaves a dangling half-row; show an even number.
  const briefs = allBriefs.slice(0, allBriefs.length - (allBriefs.length % 2));
  const eventsSection = events.length
    ? `<tr><td style="padding:26px 0 0;">
        ${sectionHead("On this week", "worth leaving the house for.")}
        ${lead ? heroEvent(lead) : ""}
        ${briefs.length ? grid(briefs.map(eventCell)) : ""}
      </td></tr>`
    : "";

  // <head> is load bearing: no charset means Latin-1 fallback and mojibake on
  // the 97 accented venue names. format-detection + x-apple-data-detectors
  // stop iOS Mail auto-linking times and addresses. supported-color-schemes
  // opts out of Apple Mail's forced dark, which would collapse the cream page
  // and flatten the night panel's contrast.
  return `<!doctype html><html lang="en"><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light">
  <meta name="format-detection" content="telephone=no,date=no,address=no,email=no">
  <title>${SUBJECT}</title>
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
  </head><body style="margin:0;background:${CREAM};${FONT}">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">plan the night, not the place. One drawn night, new places, and what is on.</div>
  <!-- Frameless: the sections sit straight on the cream canvas, like the app.
       bgcolor attributes carry Outlook, whose Word engine drops CSS
       backgrounds and gradients (it gets solid violet). -->
  <table width="100%" cellpadding="0" cellspacing="0" bgcolor="${CREAM}" style="background:${CREAM};padding:28px 0;">
    <tr><td align="center" style="padding:0 14px;">
      <table width="440" cellpadding="0" cellspacing="0" style="width:100%;max-width:440px;">
        <tr><td bgcolor="${BRAND_VIOLET}" style="background:${BRAND_VIOLET};background-image:${GRADIENT};border-radius:20px;padding:30px 26px;">
          <div style="${FONT}font-size:11px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:${VIOLET_PALE};">London &middot; this week</div>
          <div style="${FONT}font-size:30px;font-weight:800;color:#ffffff;margin-top:6px;">Fun London</div>
          <div style="${FONT}font-size:17px;font-style:italic;color:${VIOLET_WASH};margin-top:8px;">plan the night, not the place.</div>
        </td></tr>
        ${nightSection}
        ${venuesSection}
        ${eventsSection}
        <tr><td style="padding:32px 0 0;">
          <div style="${FONT}font-size:11px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:${BRAND_VIOLET};margin-bottom:10px;">Tonight, in three stops</div>
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td bgcolor="${BRAND_VIOLET}" style="background:${BRAND_VIOLET};border-radius:16px;">
              <a href="${SITE_URL}/plan"
                style="${FONT}display:block;text-align:center;color:#ffffff;
                font-weight:800;font-size:15px;line-height:1;text-decoration:none;
                padding:17px 22px;">Build my night</a>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:26px 0 8px;">
          <div style="border-top:1px solid ${LINE};padding-top:14px;${FONT}font-size:11px;color:${MUTED_FG};line-height:1.5;">
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
    console.error(
      `  ! send to ${to} failed ${res.status}: ${await res.text()}`,
    );
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

  const [venues, events, plan] = await Promise.all([
    newVenues(),
    eventsThisWeek(),
    weeklyNight(),
  ]);
  console.log(
    plan
      ? `Night of the week: ${planRationale(plan)}`
      : "Night of the week: none (engine returned no night)",
  );
  console.log(
    `Content: ${venues.length} new venues, ${events.length} events this week`,
  );

  if (venues.length === 0 && events.length === 0) {
    console.log("Nothing new this week. Not sending an empty digest.");
    return;
  }

  const subject = SUBJECT;

  if (PREVIEW) {
    const html = buildHtml(
      plan,
      venues,
      events,
      `${SITE_URL}/api/email/unsubscribe?token=PREVIEW`,
    );
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
    const html = buildHtml(plan, venues, events, unsubUrl);
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
        `Every send was rejected. Check the per-recipient errors above ` +
        `(a 422 "domain is invalid" means the EMAIL_FROM domain is not verified in Resend).`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
