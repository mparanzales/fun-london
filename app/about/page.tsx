import type { Metadata } from "next";
import Link from "next/link";
import { Footprints } from "lucide-react";
import { LegalLinks } from "@/components/legal-links";
import { fetchVenueCount } from "@/lib/queries";
import { NIGHT_LINE } from "@/lib/config";

export const metadata: Metadata = {
  title: "About",
  description: NIGHT_LINE,
  alternates: { canonical: "/about" },
};

// The company page, done as a design job, not prose in the legal shell.
//
// Audience: booking-platform partnerships teams, investors, press — people
// who type funldn.com before replying to an email. NOT end users. That is why
// it lives outside the (main) shell (no bottom nav), is reachable from the
// sitemap and direct links, and is deliberately absent from the app nav.
//
// Design thesis: the page doesn't describe the product, it IS one plan. The
// centrepiece ("the night line") is three REAL rows from the live catalogue —
// names, types, prices and blurbs verbatim — in a genuinely walkable order.
// The walk connectors reuse the plan screen's own idiom (dashed rule +
// Footprints + "~N min walk", see app/(main)/plan/plan-flow.tsx) so the page
// literally speaks the product's vocabulary.
//
// 🧨 HARD RULES, same as everywhere:
// - Never describe where the venue data came from. Provenance is legally
//   sensitive. Product and user only, never the data supply chain.
// - Never invent. The three stops below are real venues; the blurbs are their
//   live card copy. The walk times are computed from their stored coordinates
//   (~315 m and ~330 m straight-line, Soho blocks): 4–5 minutes on foot. The
//   clock times are the PLAN's times, i.e. when you'd go — they claim nothing
//   about the venues' own hours.
// - No user-side traction numbers (16 accounts / 25 saves / 3 bookings as of
//   2026-07-27 would hurt a partnerships conversation, not help it).
// - The "who is behind it" section is OMITTED until Maria writes it herself.
//   An honest gap beats a designed placeholder.
// - ⚠️ Before this URL goes into any outbound email: freshness-check the
//   French House blurb's named chef (catalogue copy; a stale name on the
//   partnerships page is the exact failure the Cross-checked gate exists
//   to prevent).
//
// The blue→violet gradient is spent exactly once (the partners panel), with
// film grain, per the brand system. Everything else stays quiet.

const NIGHT = [
  {
    time: "18:30",
    name: "The French House",
    meta: "pub · ££",
    blurb:
      "Seven tables above Soho's Frenchest pub; Neil Borthwick on the pans.",
    walkToNext: "~4 min walk",
  },
  {
    time: "20:00",
    name: "Andrew Edmunds",
    meta: "restaurant · £££",
    blurb:
      "Candlelit Georgian booths, daily-changing menu, a wine list out of time.",
    walkToNext: "~5 min walk",
  },
  {
    time: "22:30",
    name: "Ronnie Scott's",
    meta: "live music · £££",
    blurb: "London's oldest jazz club, velvet booths, two sets a night.",
    walkToNext: null,
  },
] as const;

// Static with a daily refresh: the catalogue count must stay true while the
// publish wave adds venues, and the fetch is cookie-free (static anon client)
// so this page stays out of the request path.
export const revalidate = 86400;

export default async function AboutPage() {
  const venueCount = await fetchVenueCount();
  return (
    <div className="min-h-[100svh] bg-bg text-fg">
      <div className="mx-auto max-w-2xl px-6 pb-16 pt-6 sm:px-8">
        {/* ── Header: the type wordmark + one exit into the product ────── */}
        <header className="flex items-center justify-between">
          <Link
            href="/"
            aria-label="Fun London home"
            className="text-2xl font-extrabold lowercase tracking-tight"
          >
            <span className="fl-grad-text">fun</span>{" "}
            <span className="text-heading">London</span>
          </Link>
          <Link
            href="/explore"
            className="text-[13px] font-medium lowercase tracking-tight text-muted-fg transition-colors hover:text-fg"
          >
            open fun london →
          </Link>
        </header>

        <main>
          {/* ── Hero: the thesis, in the brand's own words ──────────────── */}
          <section className="pt-20 sm:pt-28">
            <h1 className="text-[40px] font-extrabold lowercase leading-[1.02] tracking-tight text-heading sm:text-[56px]">
              plan the night,
              <br />
              not the place.
            </h1>
            <p className="mt-6 max-w-[36rem] text-[16px] leading-relaxed text-muted-fg sm:text-[17px]">
              Fun London builds you a night out: two or three spots, a short
              walk apart, in the order you&apos;d do them.
            </p>
          </section>

          {/* ── The night line: one real plan, from the live catalogue ──── */}
          <section className="mt-20 sm:mt-24" aria-label="An example night">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-muted-fg">
              one plan · three stops · soho
            </p>

            <ol className="fl-stagger mt-8">
              {NIGHT.map((stop) => (
                <li key={stop.name} className="relative pl-10">
                  {/* the stop dot */}
                  <span
                    aria-hidden
                    className="absolute left-0 top-[5px] block h-[15px] w-[15px] rounded-full bg-primary"
                  />
                  <p className="text-[13px] tabular-nums text-muted-fg">
                    {stop.time} · {stop.meta}
                  </p>
                  <h2 className="mt-0.5 text-[20px] font-extrabold tracking-tight text-heading">
                    {stop.name}
                  </h2>
                  <p className="mt-1 max-w-[32rem] text-[14px] leading-relaxed text-muted-fg">
                    {stop.blurb}
                  </p>
                  {stop.walkToNext && (
                    /* the walk connector — the plan screen's own idiom */
                    <div className="ml-[7px] mb-4 mt-4 border-l-2 border-dashed border-border py-2.5 pl-7 text-[12px] font-medium lowercase tracking-tight text-muted-fg">
                      <Footprints
                        className="inline-block h-3.5 w-3.5 align-[-3px]"
                        strokeWidth={1.75}
                        aria-hidden
                      />{" "}
                      {stop.walkToNext}
                    </div>
                  )}
                </li>
              ))}
            </ol>

            <p className="mt-10 max-w-[36rem] text-[14px] leading-relaxed text-muted-fg">
              Three real stops, live in the app right now, minutes apart on
              foot. Chosen from{" "}
              {venueCount !== null ? (
                <>
                  <strong className="font-bold text-fg">
                    {venueCount.toLocaleString("en-GB")}
                  </strong>{" "}
                  venues across London
                </>
              ) : (
                <>the live catalogue</>
              )}
              , every one photographed.
            </p>
          </section>

          {/* ── The one gradient moment: the partner ask ────────────────── */}
          <section
            className="mt-20 sm:mt-24"
            aria-label="For booking platforms"
          >
            <div className="fl-grad overflow-hidden rounded-3xl p-8 sm:p-10">
              <div className="relative z-10">
                <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-primary-fg">
                  for booking platforms
                </p>
                <h2 className="mt-3 text-[28px] font-extrabold lowercase leading-tight tracking-tight text-primary-fg sm:text-[34px]">
                  diners arrive
                  <br />
                  decided.
                </h2>
                <p className="mt-4 max-w-[30rem] text-[15px] leading-relaxed text-primary-fg/90">
                  By the time someone leaves Fun London for a booking, they have
                  already chosen the place, the night and the time. We
                  don&apos;t take the booking. We hand them over to the platform
                  the venue already uses, ready to confirm.
                </p>
                <a
                  href="mailto:hello@funldn.com?subject=Partnerships"
                  className="mt-7 inline-flex h-12 items-center rounded-2xl bg-primary-fg px-6 text-[15px] font-extrabold lowercase tracking-tight text-primary"
                >
                  talk partnerships →
                </a>
              </div>
            </div>
          </section>
        </main>

        {/* ── Footer: contact + legal ─────────────────────────────────── */}
        <footer className="mt-20 border-t border-border pt-8 sm:mt-24">
          <p className="text-[13px] leading-relaxed text-muted-fg">
            Press or anything else:{" "}
            <a
              href="mailto:hello@funldn.com"
              className="underline underline-offset-2 hover:text-fg"
            >
              hello@funldn.com
            </a>
          </p>
          <LegalLinks className="mt-4" />
        </footer>
      </div>
    </div>
  );
}
