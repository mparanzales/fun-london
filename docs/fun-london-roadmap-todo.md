# Fun London — Prioritised Roadmap & Todo List

Companion to [`fun-london-product-audit.md`](./fun-london-product-audit.md) (full evidence) and [`fun-london-executive-summary.md`](./fun-london-executive-summary.md).
Sorted by priority × impact, not by file order. Effort scale XS–XL. Priority P0 (before showing anyone) → P3 (later).

---

## Phased roadmap

| Phase | Goal | Headline tasks | Effort |
|---|---|---|---|
| **0 — Before showing anyone** (1–3 days) | Remove trust/safety seams | Fail-closed chain check · kill fake booking "Ref"/"confirmed" · remove anon pre-seed · wire/remove 3 dead profile buttons · fix onboarding step count · close `return` open-redirect · fail-closed admin default · remove `maximumScale:1` · optimise+conditionalise splash · add error boundaries · validate booking params · guard zero-step plans | mostly XS/S |
| **1 — MVP readiness** (2–3 wks) | Legal, measurable, resilient | Funnel analytics · photo→Storage + key rotation · privacy/terms/cookies + consent + deletion · per-page SEO/OG · honest personalisation · sign-in nudge · server-side write path · Vitest + engine specs · server-side theme · contrast fixes | S–L |
| **2 — Strong launch** (3–6 wks) | Shareable, discoverable, retentive, first revenue | sitemap/robots/JSON-LD + landing page · affiliate tagging + click logging · custom SMTP + Google OAuth · Eventbrite/Skiddle adapters · un-throttle discovery + voice pass + curation-tier · broaden geography · weekly retention email · cron alerting · ISR/edge caching · brand + UI-primitive pass · save-for-events/remove-booking/plan re-open | M–L |
| **3 — Investor/demo** (ongoing) | Defensible, fundable narrative with numbers | `/admin/prospects` cockpit + sign a partner · first-party taste signal · partner dashboard + Stripe Connect · behavioural recommender · multi-city architecture · RLS tests in CI · metrics dashboard + single-number 12-month thesis | L–XL |

---

## Todo list

### P0 — Before showing anyone

[ ] **Fix fail-open chain detection**
- Category: Data integrity · Priority: P0
- Why: an API error makes the location count return 1 (below threshold), so chains auto-publish into a "no chains" catalogue — breaks the core thesis.
- Evidence: `scripts/discover-venues.ts:301-303` (`catch{return 1}`), threshold `:77`, gate `:608`, auto-publish `:18`.
- Suggested implementation: on error return `Infinity`/throw and `continue` at the call site (fail closed, matching source validation at `:621-624`).
- Files: `scripts/discover-venues.ts` · Effort: XS · Dependencies: none

[ ] **Stop presenting a fabricated booking as "confirmed" with a fake "Ref"**
- Category: Trust/QA · Priority: P0
- Why: the ref is `Math.random()`; a user could quote a meaningless code at the venue — contradicts the app's honesty.
- Evidence: `app/booking/[slug]/confirmed/did-you-book.tsx:56-72`; rendered as "Ref {b.id}" in `app/(main)/saved/saved-list.tsx:63-65`.
- Suggested implementation: relabel "Planning to go"/"self-added"; drop the random code or mark it "your note, not a booking confirmation".
- Files: `did-you-book.tsx`, `saved-list.tsx` · Effort: S · Dependencies: none

[ ] **Move Google Places photos to Supabase Storage and rotate the key**
- Category: Security · Priority: P0
- Why: the live Places API key is embedded in every public photo URL (billing-DoS; confirmed 49× in `/explore` source).
- Evidence: `scripts/ingest-venues.ts:211-219`, `scripts/discover-venues.ts:306-307`, `scripts/refresh-venues.ts:112-113`; `venues.img_url` is public-read.
- Suggested implementation: at ingest/refresh download the photo bytes server-side → upload to a Storage bucket → store the public URL; backfill rows; rotate the GCP key; cap quota.
- Files: ingestion scripts · Effort: M · Dependencies: Supabase Storage bucket, GCP

[ ] **Add funnel analytics (save / reserve-click / plan-generate / room-join / booking)**
- Category: Measurement · Priority: P0
- Why: only pageviews are tracked; activation, retention, CTR, K-factor and conversion are all unmeasurable, and affiliate revenue can't be attributed.
- Evidence: `<Analytics/>` `app/layout.tsx:69`; no `track()` anywhere (recon).
- Suggested implementation: a typed `lib/analytics.ts` wrapper (Vercel custom events or a `public.events_log` table) called from contexts + CTAs.
- Files: `lib/analytics.ts` (new), `saved-context.tsx`, `bookings-context.tsx`, reserve/share/plan components · Effort: S · Dependencies: none

[ ] **Add error boundaries**
- Category: Resilience · Priority: P0
- Why: every query throws on Supabase failure; with no boundary the whole page drops to Next's raw error screen.
- Evidence: no `app/global-error.tsx` / route `error.tsx`; throws at `lib/queries.ts:157,169,199,241`; boundary only on `(main)`.
- Suggested implementation: `app/global-error.tsx` + segment `error.tsx` (explore/events/venue/event/plan/booking) with branded copy + `reset()` retry.
- Files: `app/global-error.tsx`, segment `error.tsx` · Effort: S · Dependencies: none

[ ] **Remove the anon pre-saved seed**
- Category: UX/QA · Priority: P0
- Why: anon users start with 2 "saved" venues they never chose, pointing at hidden demo slugs that don't render → "2 saved / nothing shown" on the first screen.
- Evidence: `lib/mock-data.ts:24-27`; hidden by the `google_place_id` filter; `saved-list.tsx:39,82`.
- Suggested implementation: delete `MOCK_SAVED_IDS` (or point at live, catalogue-visible slugs).
- Files: `mock-data.ts`, `saved-context.tsx` · Effort: XS · Dependencies: none

[ ] **Wire or remove the 3 dead profile buttons; fix the onboarding step count**
- Category: UX/Trust · Priority: P0
- Why: "Give Feedback", "Notification prefs", "Theme: Auto" have no handlers; the progress bar shows "1/4","2/4" for a 2-step flow.
- Evidence: `app/(main)/profile/profile-body.tsx:103-107,158-169`; `onboarding-flow.tsx:28,37-38`.
- Suggested implementation: make Theme a real toggle, Feedback a mailto/form; set `TOTAL_STEPS=2` or add the budget/area steps.
- Files: `profile-body.tsx`, `onboarding-flow.tsx` · Effort: S · Dependencies: none

[ ] **Close the `return` open-redirect, fail-closed admin default, restore pinch-zoom**
- Category: Security/A11y · Priority: P0
- Why: `?return=//evil.com` produces a protocol-relative redirect after sign-in; an unset env silently grants admin to a hardcoded Gmail; `maximumScale:1` fails WCAG 1.4.4.
- Evidence: `app/(auth)/sign-in/page.tsx:33`, `app/(auth)/auth/callback/route.ts:24,47`, `lib/auth.ts:32`, `app/layout.tsx:28`.
- Suggested implementation: guard `startsWith("/")&&!startsWith("//")`; default `FL_ADMIN_EMAILS` to empty + throw if unset in prod; remove the `maximumScale` cap.
- Files: those four · Effort: XS each · Dependencies: none

[ ] **Optimise the splash logo and make the splash conditional + reduced-motion-aware**
- Category: Performance · Priority: P0
- Why: a 2 MB PNG is the LCP element and a 1.7s blocking hold fires on every visit (including returning users and reduced-motion users).
- Evidence: `public/logo-fun.png` (2,089,385 B); `app/splash-client.tsx:21,33,55`; `app/page.tsx:16-17,25`.
- Suggested implementation: ship the logo as inline SVG/optimised WebP (~<30 kB); skip/shorten the splash for already-onboarded + reduced-motion users; match the splash background to the theme.
- Files: `splash-client.tsx`, `app/page.tsx`, `logo.tsx` · Effort: S · Dependencies: none

[ ] **Validate booking query params and guard zero-step plans**
- Category: QA · Priority: P0/P1
- Why: a malformed `?d=`/`?t=` makes `.toISOString()` throw on a route with no error boundary; an empty catalogue yields "Chill Night in undefined" with no stops.
- Evidence: `did-you-book.tsx:52,64`; `plan-flow.tsx:65,92,340`.
- Suggested implementation: validate/parse params with a safe fallback; add a "couldn't build a plan" guard on the solo path (mirroring the group path).
- Files: `did-you-book.tsx`, `plan-flow.tsx` · Effort: S · Dependencies: none

### P1 — MVP readiness

[ ] **Privacy / terms / cookie pages + consent banner + account deletion & export**
- Category: Legal · Priority: P1
- Why: live UK product collecting personal data with analytics running and no notices — UK GDPR Art.13/14 + PECR breach; blocks UK marketing.
- Evidence: no such pages exist; `<Analytics/>` unconditional `app/layout.tsx:69`.
- Suggested implementation: `/privacy`, `/terms`, `/cookies`; gate analytics behind consent; deletion/export are cheap given `on delete cascade` FKs.
- Files: `app/(legal)/*`, `app/layout.tsx`, a profile data-rights action · Effort: M · Dependencies: legal copy

[ ] **Per-page SEO metadata + OG images on venue & event detail**
- Category: Growth/SEO · Priority: P1
- Why: every Share renders a blank preview; detail pages are invisible/duplicated to Google (all share `<title>Fun London</title>`).
- Evidence: `app/layout.tsx:19-23` is the entire metadata surface; no `generateMetadata` on detail routes.
- Suggested implementation: `generateMetadata` (title/description/OG) + `next/og` `ImageResponse` per page.
- Files: `app/venue/[slug]/page.tsx`, `app/event/[id]/page.tsx` · Effort: M · Dependencies: none

[ ] **Make personalisation real (or drop the claim)**
- Category: Product · Priority: P1
- Why: 1 mood + 1 vibe with budget/areas hard-coded empty produces a trivial re-sort labelled "✨ Sorted around your taste" — a trust-eroding overclaim.
- Evidence: `onboarding-flow.tsx:32-46`; `lib/ranking.ts`; `explore-feed.tsx:189-193`.
- Suggested implementation: multi-select moods/vibes + budget + area (types already support it), or remove the label until the signal justifies it.
- Files: `onboarding-flow.tsx`, `ranking.ts`, `explore-feed.tsx` · Effort: M · Dependencies: none

[ ] **Server-side write path for saves/bookings + revert-on-error**
- Category: Architecture/Reliability · Priority: P1
- Why: client anon-key writes have no validation/rate-limit and fail silently (fire-and-forget) — saves and revenue-bearing bookings can be lost with no warning.
- Evidence: `components/saved-context.tsx:188-205`, `components/bookings-context.tsx:233-249`.
- Suggested implementation: Server Actions with Zod validation + ownership checks; revert optimistic state + retry toast on failure; keep RLS as defence-in-depth.
- Files: contexts + new `actions.ts` · Effort: M · Dependencies: Zod

[ ] **Sign-in nudge + data-loss warning for anon users**
- Category: UX · Priority: P1
- Why: anon saves/bookings live only in localStorage; clearing the browser destroys them with no warning, and there is no sign-in door on the browsing surface.
- Evidence: `explore-feed.tsx` greeting fallback; sign-in only in `/profile` and a Plan CTA.
- Suggested implementation: persistent low-friction "saving locally — sign in to keep across devices" nudge.
- Files: `explore-feed.tsx`, `saved-list.tsx` · Effort: S · Dependencies: none

[ ] **Introduce Vitest + first specs on the pure engines**
- Category: Quality · Priority: P1
- Why: zero tests; the high-value logic (plan/booking/ranking/hours) is unverified.
- Evidence: recon (no test tooling).
- Suggested implementation: Vitest; specs for `lib/plan-engine.ts`, `lib/booking-link.ts`, `lib/ranking.ts`, `lib/opening-hours.ts`; add to `pnpm check`.
- Files: new `*.test.ts`, `package.json` · Effort: M · Dependencies: none

[ ] **Kill the day→night theme flash + fix contrast**
- Category: Frontend/A11y · Priority: P1
- Why: theme is applied only after hydration (every evening visitor sees a day→night flash); `--fl-muted-fg` is 4.46:1 and primary-as-text on night is 2.99:1 (sub-AA).
- Evidence: `theme-provider.tsx:4-17`, `app/layout.tsx:55`; `globals.css` tokens.
- Suggested implementation: set `data-theme` server-side or via an inline pre-paint script; darken `--fl-muted-fg`; stop using primary as text on night.
- Files: `theme-provider.tsx`, `app/layout.tsx`, `globals.css` · Effort: S · Dependencies: none

### P2 — Strong launch

[ ] **Sitemap / robots / JSON-LD + public indexable landing page**
- Category: Growth · Priority: P2
- Why: `/sitemap.xml` and `/robots.txt` 404; word-of-mouth "funldn.com" dead-ends in the onboarding quiz.
- Evidence: recon live probe; `app/page.tsx:9-17`.
- Suggested implementation: `app/sitemap.ts`/`app/robots.ts` from `fetchVenues`/`fetchEvents`; `Restaurant`/`Event` JSON-LD on detail; skip-splash landing showing real venues.
- Files: `app/sitemap.ts`, `app/robots.ts`, detail pages, `app/page.tsx` · Effort: M · Dependencies: none

[ ] **Affiliate/attribution tagging on booking deep-links + click logging**
- Category: Revenue · Priority: P2
- Why: the affiliate thesis (named primary revenue) is 0% built — every reserve click monetises at £0.
- Evidence: `lib/booking-link.ts:17-47` (date/party only); no `affiliate`/`utm`/`partner_id` in repo.
- Suggested implementation: per-platform ref params (start OpenTable, restaurant-heavy catalogue) + a reserve-click event.
- Files: `lib/booking-link.ts`, reserve components · Effort: S · Dependencies: affiliate accounts

[ ] **Custom SMTP (Resend) + finish Google OAuth**
- Category: Auth/Growth · Priority: P2
- Why: magic-link throttled to ~3–4/hr and Google flow unproven (0 google users) — the top of the funnel is throttled and partly broken.
- Evidence: STATE.md:20-25,346.
- Suggested implementation: Resend SMTP in Supabase; complete the OAuth consent/client config; client cooldown + friendly 429 copy on magic-link.
- Files: Supabase config, `sign-in-form.tsx` · Effort: M · Dependencies: Resend, Google console

[ ] **Un-throttle discovery (paid Gemini Flash) + overnight voice pass + curation-tier; broaden geography**
- Category: Data/Brand · Priority: P2
- Why: templated editorial dominates and dilutes the "curated" catalogue; the discovery grid is east/south-east heavy.
- Evidence: `discover-venues.ts:442-478` (templated), `:82-99` (grid); ~51 templated vs 9 curated phrasings live.
- Suggested implementation: enable paid Flash + raise TARGET; overnight "brat voice" pass; add `curation_tier` column + rank curated first; add West/North/SW neighbourhoods.
- Files: `discover-venues.ts`, `lib/queries.ts`, `supabase/schema.sql` · Effort: M · Dependencies: Gemini billing

[ ] **`/admin/prospects` BD cockpit + contact ≥5 venues**
- Category: Business · Priority: P2
- Why: the one differentiated wedge (`partner_prospects`) is write-only — no UI, no venue contacted.
- Evidence: `supabase/schema.sql:151-172`; only `/admin/candidates` exists (different table).
- Suggested implementation: status kanban + notes + one-click draft-outreach.
- Files: new `app/admin/prospects/*` · Effort: M · Dependencies: admin auth

[ ] **Wire Eventbrite + Skiddle adapters, de-music the feed, fix UTC day-boundary**
- Category: Data · Priority: P2
- Why: events are single-source (Ticketmaster) and music-skewed; Food/Club/Comedy near-empty; late-night London events dropped during BST.
- Evidence: `ingest-events.ts:230-238,493,501`; `lib/queries.ts:191-192`.
- Suggested implementation: implement adapters (key-gated, Ticketmaster pattern); compute start-of-day in Europe/London.
- Files: `ingest-events.ts`, `lib/queries.ts` · Effort: L · Dependencies: Eventbrite/Skiddle tokens

[ ] **Retention loop: weekly "new in London" email + saved-venue nudges**
- Category: Product · Priority: P2
- Why: there is no reason to return; the venue product is a 1–3-session experience.
- Evidence: Product Strategy / Opportunity lenses; no notifications/digest in repo.
- Suggested implementation: digest job over newly discovered venues + this-week events; "you saved X — it's on this week".
- Files: new digest job, email templates · Effort: L · Dependencies: SMTP, analytics

[ ] **Cron failure alerting + ISR/edge caching + maskable icon**
- Category: Ops/Perf · Priority: P2
- Why: crons fail silently; the catalogue is uncached `no-store` despite changing only ~every 4h; the maskable icon will crop on Android.
- Evidence: `.github/workflows/*.yml`; live `cache-control: no-store`; `public/manifest.json`.
- Suggested implementation: `if:failure()` notification steps; `revalidate` aligned to the cron; pad the maskable icon ≈20% safe zone.
- Files: workflows, route configs, `manifest.json` · Effort: S–M · Dependencies: Slack/email secret

### P3 — Later / differentiation

[ ] **Brand system + shared UI primitives + type scale**
- Category: Design/Frontend · Priority: P3
- Why: the blue→magenta logo gradient never appears in-UI; three-hue identity; 241 arbitrary `text-[…]` utilities; CTA class copied 5×.
- Evidence: Visual + Frontend lenses; `globals.css:21`, `logo.tsx:13-20`.
- Suggested implementation: inline-SVG logo gradient on masthead/CTAs; display typeface; Button/Card/Sheet primitives (focus-trap dialog); type tokens.
- Files: `globals.css`, `tailwind.config.ts`, `logo.tsx`, new primitives · Effort: L · Dependencies: none

[ ] **First-party taste signal + plan persistence + venue→events + save-for-events**
- Category: Differentiation · Priority: P3
- Why: completes half-built flows and starts a taste graph Google/Time Out can't copy.
- Evidence: no `fetchPlans()` in `lib/queries.ts`; unused `events_venue_starts_idx`; events not savable.
- Suggested implementation: "would you go back?" tap → `ranking.ts`; `fetchPlans()` + re-open; venue upcoming-events query; event save control.
- Files: `lib/queries.ts`, `lib/ranking.ts`, detail/saved components · Effort: M–L · Dependencies: analytics

[ ] **Partner dashboard + Stripe Connect; behavioural recommender; multi-city; RLS tests in CI**
- Category: Investor-scale · Priority: P3
- Why: the partner-subscription revenue line, defensible personalisation, the expansion story, and provable security at scale.
- Evidence: `lib/config.ts` (London-hardcoded grid/regions); keyword-only `ranking.ts`; no migration/RLS tests.
- Suggested implementation: partner-side app + Stripe Connect; replace keyword scorer with behavioural model; de-hardcode the grid; add RLS policy tests.
- Files: new partner app, `discover-venues.ts`, CI · Effort: XL · Dependencies: Phase 1–2 foundations
