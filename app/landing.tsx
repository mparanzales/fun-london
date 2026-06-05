// Public landing page — the server-rendered, indexable face of funldn.com.
//
// Rendered underneath the splash overlay by app/page.tsx. For first-time,
// signed-out visitors the splash fades away to reveal this; returning and
// signed-in users are redirected past it to /explore. Because it is real
// server-rendered HTML (not a JS-only redirect), Google can index it and a
// shared link shows the product instead of dead-ending in the sign-up quiz.
//
// Primary action: "Start exploring" → /explore (lowest friction). The taste
// quiz is offered as an optional secondary link.

import Link from "next/link";
import { ShieldCheck, CheckCheck, Sparkles, ArrowRight } from "lucide-react";
import { Logo } from "@/components/logo";
import { VenueCard } from "@/components/venue-card";
import { CITY, TAGLINE } from "@/lib/config";
import type { Venue } from "@/lib/types";

const TRUST_POINTS = [
  {
    icon: ShieldCheck,
    title: "No chains, ever",
    body: `Independent ${CITY} only. If it's a chain, it doesn't make the cut.`,
  },
  {
    icon: CheckCheck,
    title: "Cross-checked",
    body: "Every spot is verified in at least two trusted sources before it's listed.",
  },
  {
    icon: Sparkles,
    title: "Plan the whole night",
    body: "Build a walkable night out and book a table in a couple of taps.",
  },
];

export function LandingPage({ venues }: { venues: Venue[] }) {
  return (
    <main className="min-h-[100svh] bg-bg">
      {/* Top bar */}
      <header className="max-w-md mx-auto px-5 pt-6 flex items-center justify-between">
        <Logo variant="gradient" size="md" />
        <Link
          href="/sign-in"
          className="text-[13px] font-bold text-muted-fg hover:text-fg"
        >
          Sign in
        </Link>
      </header>

      {/* Hero */}
      <section className="relative max-w-md mx-auto px-5 pt-12 pb-10 text-center overflow-hidden">
        <div
          aria-hidden
          className="absolute left-1/2 -translate-x-1/2 -top-12 w-[420px] h-[420px] rounded-full opacity-[0.16] blur-3xl bg-gradient-to-br from-primary to-accent pointer-events-none"
        />
        <h1 className="relative text-[30px] leading-[1.12] font-extrabold text-heading tracking-tight">
          {TAGLINE}
        </h1>
        <p className="relative mt-4 text-[15px] text-muted-fg leading-relaxed">
          Fun {CITY} is a curated guide to the independent bars, restaurants and
          what&apos;s on tonight. The places worth leaving the house for, never
          a chain.
        </p>
        <div className="relative mt-8 flex flex-col items-center gap-3">
          <Link
            href="/explore"
            className="w-full max-w-[300px] h-[52px] rounded-2xl bg-primary text-primary-fg text-[15px] font-extrabold shadow-soft flex items-center justify-center gap-2"
          >
            Start exploring
            <ArrowRight size={18} strokeWidth={2.5} />
          </Link>
          <Link
            href="/events"
            className="text-[13px] font-semibold text-muted-fg underline underline-offset-4 hover:text-fg"
          >
            or see what&apos;s on
          </Link>
        </div>
      </section>

      {/* Why it's different */}
      <section className="max-w-md mx-auto px-5 pb-10">
        <div className="flex flex-col gap-3">
          {TRUST_POINTS.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="flex items-start gap-3.5 rounded-2xl bg-card border border-border p-4"
            >
              <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Icon size={20} strokeWidth={2.2} className="text-primary" />
              </div>
              <div>
                <div className="text-[14px] font-extrabold text-heading">
                  {title}
                </div>
                <div className="text-[12.5px] text-muted-fg mt-0.5 leading-snug">
                  {body}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Real venues — proof the catalogue is real + content for crawlers */}
      {venues.length > 0 && (
        <section className="pb-10">
          <div className="max-w-md mx-auto px-5 flex items-baseline justify-between">
            <h2 className="text-[17px] font-extrabold text-heading">
              A taste of what&apos;s inside
            </h2>
            <Link
              href="/explore"
              className="text-[12px] font-bold text-primary"
            >
              See all
            </Link>
          </div>
          <div className="mt-4 flex gap-3.5 overflow-x-auto px-5 pb-2 no-scrollbar">
            {venues.map((v, i) => (
              <VenueCard
                key={v.id}
                venue={v}
                variant="tall"
                priority={i === 0}
              />
            ))}
          </div>
        </section>
      )}

      {/* Closing CTA */}
      <section className="max-w-md mx-auto px-5 pb-12">
        <Link
          href="/explore"
          className="block w-full text-center h-[52px] leading-[52px] rounded-2xl bg-heading text-bg text-[15px] font-extrabold"
        >
          Browse all of independent {CITY}
        </Link>
      </section>

      {/* Footer */}
      <footer className="max-w-md mx-auto px-5 pb-10 text-center">
        <div className="flex items-center justify-center gap-4 text-[12px] text-muted-fg">
          <Link href="/privacy" className="hover:text-fg">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-fg">
            Terms
          </Link>
          <Link href="/cookies" className="hover:text-fg">
            Cookies
          </Link>
        </div>
        <p className="mt-4 text-[11px] text-muted-fg/80">{TAGLINE}</p>
      </footer>
    </main>
  );
}
