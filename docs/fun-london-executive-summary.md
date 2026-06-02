# Fun London — Executive Summary

**Date:** 2 June 2026 · **Live:** https://www.funldn.com · **Stack:** Next.js 14 App Router + Supabase
**Method:** recon (build/lint/typecheck/secret-scan/live-probe) + 12 parallel specialist agents. Full detail in [`fun-london-product-audit.md`](./fun-london-product-audit.md); actionable list in [`fun-london-roadmap-todo.md`](./fun-london-roadmap-todo.md).

---

## The one-paragraph verdict

Fun London is an **advanced prototype with an exceptional engineering substrate and two genuine moats** — an autonomous, near-zero-cost venue-discovery robot and a partner-BD insight (the venues hardest to integrate are the easiest to sign) — wrapped in a product that is **pre-measurement, pre-growth and pre-revenue**. The build is honest where it matters (it refuses to fake live availability) and clean (build/lint/typecheck all pass, strict TS, disciplined RLS). But the single best differentiator — verifiable, anti-chain curation — is **invisible to a first-time user**, there is **no retention loop, no funnel analytics, no SEO surface, and £0 of revenue infrastructure**, and a handful of trust seams (a fabricated "confirmed" booking, dead buttons, an exposed API key, missing GDPR pages) would be found before the substance by the first serious user, journalist or investor.

## Readiness

| | Verdict |
|---|---|
| Demo-ready | **Almost** (after ~1–3 days of Phase 0 fixes) |
| User-ready | **No** (no retention, thin catalogue, GDPR pages absent) |
| Investor-ready | **No** (zero users, zero metrics, zero revenue plumbing) |

## Strongest / weakest / biggest risk / biggest opportunity

- **Strongest:** the autonomous discovery robot (real, running, defensible cost structure) and the `partner_prospects` BD overlay (a real, articulable wedge). Plus genuine engineering honesty and hygiene.
- **Weakest:** invisibility of the value proposition; no retention loop; no measurement; templated editorial now diluting the "curated" catalogue.
- **Biggest risk:** a trust cascade — the app earns honesty equity and then spends it (fake booking ref, "✨ Sorted around your taste" theatre, dead buttons, exposed Places key, no privacy/cookie pages on a live UK product).
- **Biggest opportunity:** turn the two supply-side moats into a *behavioural data advantage* via funnel analytics + affiliate tagging + un-throttled discovery + SEO'd venue pages (40+ critic-validated, auto-growing organic-acquisition pages currently shipping `<title>Fun London</title>` only).

## The 12 issues that matter most

| # | Severity | Issue |
|---|---|---|
| 1 | Critical | Google Places API key shipped in plaintext in every public venue photo URL (billing-DoS; confirmed live) |
| 2 | Critical | Discovery chain-detection **fails open** — chains can auto-publish into a "no chains" catalogue |
| 3 | Critical | Fabricated "confirmed" booking with a random "Ref" number presented as a real reservation |
| 4 | Critical | No funnel analytics (pageviews only) — activation/retention/CTR/conversion all unmeasurable |
| 5 | Critical | No revenue infrastructure — affiliate thesis 0% built; every outbound click earns £0 |
| 6 | Critical | No retention loop — nothing brings a user back |
| 7 | Critical | No privacy/terms/cookie pages or consent banner on a live UK product running analytics (GDPR/PECR) |
| 8 | Critical/High | No error boundaries — any Supabase blip crashes whole pages |
| 9 | Critical/High | No SEO surface — shared links render blank; venue pages invisible to Google |
| 10 | High | Templated editorial dominates the live catalogue, reading generic vs the "curated voice" promise |
| 11 | High | Personalisation theatre (1 mood + 1 vibe; budget/areas dead) labelled "Sorted around your taste" |
| 12 | High | `partner_prospects` BD wedge is write-only — no UI, no venue contacted |

*(Full register: 121 issues — 12 Critical, 40 High, 49 Medium, 20 Low.)*

## What to do, in order

- **Phase 0 (1–3 days):** fix the trust/safety seams — fail-closed chain check, kill the fake booking ref, remove the broken anon pre-seed, wire/remove dead buttons, fix the onboarding step count, close the open-redirect, fail-closed admin default, restore pinch-zoom, optimise+conditionalise the splash, add error boundaries.
- **Phase 1 (2–3 weeks) MVP:** funnel analytics; photo→Storage + key rotation; GDPR pages + consent + deletion; per-page SEO/OG; honest personalisation; server-side write path; first tests.
- **Phase 2 (3–6 weeks) launch:** sitemap/robots/JSON-LD + landing page; affiliate tagging; custom SMTP + Google OAuth; more event sources; un-throttle discovery + voice pass; retention email; brand pass.
- **Phase 3 (ongoing) investor:** `/admin/prospects` cockpit + sign one partner; first-party taste signal; partner dashboard + Stripe; multi-city; metrics dashboard + a single-number 12-month thesis.

**Bottom line:** the hard, rare thing (a defensible autonomous supply engine) is built. The comparatively easy things that make it a *product* and a *company* (measurement, growth loops, revenue plumbing, and removing the trust seams) are not. Do Phase 0 before showing anyone; the rest is a clear, mostly low-risk runway.
