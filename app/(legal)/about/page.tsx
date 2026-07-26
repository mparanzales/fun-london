import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About",
  description:
    "Fun London helps people plan a night out in London, then hands them to the place that takes the booking.",
};

// MAINTAINER NOTE. Audience: booking-platform partnerships teams, investors,
// press. NOT end users, who want venues, not company copy. That is why this
// page lives in (legal) (chrome-free, no bottom nav, has its own exit) and is
// reachable from the sitemap and a direct link, never from the app nav. A slot
// in the bottom nav is attention taken from "plan the night".
//
// 🧨 TWO HARD RULES FOR THIS PAGE.
// 1. Never describe where the venue data came from. Provenance is
//    legally sensitive and was deliberately scrubbed from the public repo.
//    Talk about the product and the user, never the data supply chain.
// 2. Never invent traction. Every number below is queried from prod and is
//    defensible. User-side counts (accounts, saves, bookings) are deliberately
//    ABSENT: as of 2026-07-27 they are 16 / 25 / 3, which would actively harm
//    a partnerships conversation. Add them when they are real, not before.
//
// [NEEDS DETAIL] markers are Maria's to fill. Do not guess them, and do not
// quietly delete them to make the page look finished.
export default function AboutPage() {
  return (
    <>
      <h1>About Fun London</h1>
      <p className="text-muted-fg">London, 2026</p>

      <p>
        Fun London helps people decide what to actually do tonight. Not another
        list of places: a plan for the night, in the order you would walk it.
      </p>

      <h2>What we have built</h2>
      <p>
        A curated guide to <strong>2,114 London venues</strong> across{" "}
        <strong>67 neighbourhoods</strong>, every one with real photography, and
        a planner that turns a mood, an area and a budget into a walkable night
        out. It runs as a web app at funldn.com.
      </p>

      <h2>For booking platforms</h2>
      <p>
        Our users arrive at a decision, not a search box. By the time someone
        has picked a place in Fun London they have chosen the area, the mood,
        the budget and the time. We do not take the booking ourselves. We hand
        that person to the platform the venue already uses, at the moment they
        are ready.
      </p>
      <p>
        That is the partnership we are interested in: qualified, high intent
        arrivals rather than another listing. If you run partnerships at a
        booking platform and that sounds useful, we would like to talk.
      </p>
      <p>
        [NEEDS DETAIL] The specific ask: what integration you want (affiliate
        link, deep link with attribution, API), and what you can offer a
        partner. One or two sentences, in your words.
      </p>

      <h2>Who is behind it</h2>
      <p>
        [NEEDS DETAIL] One or two lines. Founders, and the programme or company
        status you are happy to state publicly. Keep it short; nobody needs a
        team page.
      </p>

      <h2>Get in touch</h2>
      <p>
        Partnerships, press or anything else:{" "}
        <a href="mailto:hello@funldn.com">hello@funldn.com</a>.
      </p>
    </>
  );
}
