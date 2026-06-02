# Fun London (Fun LDN) — End-to-End Product Development Audit

**Product:** Fun London / Fun LDN — a curated London going-out discovery + booking-deep-link product
**Live:** https://www.funldn.com (publicly reachable, HTTP 200, no SSO wall)
**Repository audited:** `project/fun-london-app` (Next.js 14.2.15 App Router + Supabase)
**Audit date:** 2 June 2026
**Standard applied:** senior product team review prior to public launch, accelerator interview or investor demo. The goal is to expose weaknesses, not to validate. British English throughout.

## How this audit was produced

A recon pass first established ground truth on the live codebase — it ran a production build, type-check and lint, scanned for secrets, tests, SEO and analytics surfaces, and probed the live domain. Twelve specialist agents then audited in parallel against that shared evidence pack, each reading the relevant source files and returning structured findings (working well / not working / missing / confusing / risky / recommendations, plus evidenced issues, missing-features and todos). Their findings were collated, de-duplicated and synthesised into the master plan below.

**Verified ground-truth facts (recon):**

- **Build / type-check / lint:** all PASS. `pnpm build` compiles 17 routes, shared JS 87.2 kB, middleware bundle 80.9 kB. `tsc --noEmit` clean, `next lint` clean, zero TypeScript `any`.
- **Tests:** **zero**. No test runner, no `*.test.*`/`*.spec.*`, no CI test step beyond build/lint/typecheck.
- **SEO:** no `openGraph`, no Twitter cards, no `generateMetadata` on any dynamic route, no JSON-LD, no `sitemap.ts`/`robots.ts`. Live `/sitemap.xml` and `/robots.txt` both 404. Total metadata surface is `title` + `description` + `manifest` in `app/layout.tsx:19-23`.
- **Analytics:** Vercel Analytics pageviews only. **Zero** custom event instrumentation on saves, reserves, swipes, plan-generation or bookings.
- **Secrets:** no hardcoded keys in tracked source; `.env.local` correctly git-ignored; service-role key isolated to offline `scripts/*`. **However**, the Google Places API key is embedded in plaintext in every venue photo URL persisted to the public `venues.img_url` column and rendered to anonymous browsers (confirmed live: the key appears 49+ times in `/explore` page source).
- **Error handling:** no `error.tsx` / `global-error.tsx` anywhere; the only error boundary wraps the `(main)` route group, leaving venue/event/booking/auth routes on Next's default error screen.
- **Catalogue:** live DB has grown to ~49 venues (39 documented in STATE.md; the 4-hourly discovery cron adds more) and ~17–27 events (almost all Ticketmaster gigs). **Zero real users** (Google sign-in unfinished, magic-link throttled to ~3–4 emails/hour).

**Severity tally across all twelve lenses:** 121 distinct issues — **12 Critical, 40 High, 49 Medium, 20 Low**. Missing features: 33 MVP must-have, 37 strong-launch should-have, 18 differentiation, 11 investor-scale.

---

# Part 1 — Specialist agent reviews

Twelve expert lenses, each reviewing the live codebase independently. Findings are evidence-based with file:line references; recurring themes across lenses indicate consensus.

### 1. Product Strategy Agent

## Product Strategy lens — Fun London

**Working well**

The product has a genuinely defensible *editorial* thesis, and — unusually for a side-project — it is honestly implemented rather than faked. The "2+ independent sources" provenance promise is real, encoded as a typed `EditorialSource[]` (`lib/types.ts:54-59`) and surfaced to the user in a collapsible "Why this is here" panel with clickable source links (`app/venue/[slug]/venue-detail.tsx:255-363`). This is the single strongest differentiator: nobody else shows their working. "Real Talk" critical flags (`venue-detail.tsx:219-249`) reinforce a credible, magazine-style "honest signal, never buried" voice.

Crucially, the team resisted the temptation to fake the hard part. `venue-detail.tsx:92-98` explicitly *removes* tables-free / next-slot / walk-time because "a booking product can't afford fake signals," and the Reserve CTA branches honestly across four real states — deep-link, `tel:` call-to-book, "Booking via the venue," and "No booking needed. Just walk in." (`venue-detail.tsx:390-426`). The booking-link builder (`lib/booking-link.ts`) is candid in its own header comment that it is an *aggregator/deep-link*, not a live-availability product. That intellectual honesty is the right posture for trust and is rare.

The catalog is real and self-growing (39 venues, autonomous discovery cron, daily refresh), and the chain-exclusion rule is implemented as a location-count heuristic rather than a brittle denylist — faithful to the "curated independents only" thesis.

**Not working**

The value proposition is **not legible in 5 seconds**. The first-run path is Splash (`splash-client.tsx`, 1.7s of logo) → Onboarding (two mood/vibe taps) → Explore. At no point does the user read a sentence telling them what Fun London *is* or *why it is different*. The onboarding asks "What are you in the mood for tonight?" (`onboarding-flow.tsx:123`) but never states the promise — no "curated London independents, cross-checked in 2+ places, no chains." The only positioning copy that exists anywhere is the `<meta description>` "Your curated guide to London's best hidden gems" — which the user never sees. A first-timer cannot distinguish this from Time Out, Google Maps, or any other listings app in the first screen. **The single best differentiator (verifiable, anti-chain curation) is invisible until you tap into an individual venue and expand a collapsed accordion.**

The "agent" framing in the thesis is **aspirational, not delivered**. There is no agent. "Reserve" opens the venue's own OpenTable/Resy page in a new tab pre-filled with date/party (`reserve-sheet.tsx:32-44`), then routes to a manual "Did you book?" self-report screen (`did-you-book.tsx`). That is a competent deep-link aggregator — but calling it a "booking-aggregator agent" oversells it. The booking is entirely off-platform and unverified; Fun London never confirms a table, holds no inventory, and captures no transaction.

**Missing**

The biggest strategic gap is **a retention loop**. The honest assessment: there is none. "Saved" / "Coming up" (`saved-list.tsx`) is a passive bookmark list populated only by a manual self-reported "Did you book?" tap — there is no reason to return. There are no notifications, no "new this week" digest, no re-engagement, no streaks, no follow-up after a visit ("how was it?"), no personalised weekly drop. Analytics is pageview-only with **zero** event instrumentation on saves/reserves/plans (per recon), so the team cannot even *measure* whether anyone comes back. For a "where shall we go" utility, the natural cadence is roughly weekly, and **39 venues is too thin to sustain weekly use**: a typical engaged Londoner exhausts an interesting 39-venue list within a few visits, and the auto-discovery cron is deliberately throttled to ~3 venues/run on a free Gemini tier (per recon) — catalog growth is real but slow. Without a freshness loop (events are the one genuinely recurring surface — 17 live Ticketmaster events), the core venue product is a one-to-three-session experience, not a habit.

**Confusing/weak**

The personalisation is theatre. Onboarding collects exactly **one** mood and **one** vibe (`onboarding-flow.tsx:32-34,42-47` — single-select state, arrays of length ≤1), and the "For You" scorer (`lib/ranking.ts`) is keyword-substring matching: +3 per mood-tag, +1.5 per vibe keyword, +1 budget, with `(rating-4)*0.5` as a tie-break. With one mood + one vibe and 39 venues, this produces a near-trivial re-sort, yet the UI proudly announces "✨ Sorted around your taste" (`explore-feed.tsx:189-193`). Budget and areas are collected in the type (`UserPreferences`) but onboarding hard-codes `budget: null, areas: []` (`onboarding-flow.tsx:45-46`), so two of four personalisation dimensions are dead. This is a credibility risk: a user who picks "Dinner / Chill" and sees a barely-reordered list will correctly conclude the personalisation is cosmetic.

The mood/vibe taxonomy is also semantically muddled — `culture` mood is labelled "Live Music" and `activity` is labelled "Comedy" in the quiz (`onboarding-flow.tsx:16-18`), then re-mapped again in ranking (`ranking.ts:13-18`). The enum names and the user-facing labels have drifted apart, which will make future iteration error-prone.

**Risky**

1. **Positioning invisibility is an existential growth risk.** A discovery product whose differentiation only appears two taps deep, behind a collapsed accordion, will read as "yet another listings app" to every first-time visitor and to every press/word-of-mouth describer. The thesis is good; the *surfacing* of the thesis is absent.
2. **No measurement of the core funnel** (recon: no `track()` on save/reserve/plan) means the team is flying blind on the exact retention question being asked here. You cannot improve a loop you cannot see.
3. **The "agent" / booking narrative risks a trust gap** if marketed as more than deep-linking — the moment a user expects Fun London to *hold* their booking and it doesn't, the honesty equity built up elsewhere is spent.
4. **Catalog thinness vs. claim.** Marketing "your curated guide to London" on 39 venues invites the obvious "where's [my favourite]?" disappointment; coverage gaps in a discovery product read as the product being broken, not curated.

**Recommendations**

1. **Put the thesis on screen in the first 5 seconds.** Add one positioning line to onboarding step 0 and/or a one-card intro: "Independent London only. No chains. Every spot checked in 2+ places." Promote "Why this is here" from a collapsed accordion to a visible trust badge on the card and an always-open strip on detail. The differentiator must be the *first* thing seen, not the last.
2. **Build one real retention loop before adding any feature.** Cheapest high-leverage option: a weekly "New in London" surface driven by the events feed + newly-discovered venues, plus a "you saved X — it's on this week" nudge. Tie it to email (magic-link addresses already exist) since push needs a PWA story.
3. **Instrument the funnel now** (save, reserve-click, did-you-book-yes, plan-generate). Without this, the "do people repeatedly use it" question is unanswerable — and it is the question that matters most.
4. **Either make personalisation real or stop claiming it.** Move onboarding to multi-select moods/vibes + budget + area (the types already support it), or drop the "✨ Sorted around your taste" label until the signal justifies it. Right now it is a small lie that undermines the honesty brand.
5. **Be precise in language: "discovery + deep-link booking," not "agent."** Reserve the "agent" claim for when there is real availability/transaction. Under-promising here protects the trust that is the whole moat.

---

### 2. UX Research / Real-User Agent

I walked the whole product as a Londoner trying to find something to do tonight: splash → onboarding → explore → filters/search → venue detail → save → reserve → "did you book?" → plan → plan-together → events → profile. The bones are genuinely good — the team has been unusually honest about *not* faking signals (venue-detail.tsx:92-98 deliberately omits fake "tables free"/"X min walk", and the reserve/booking flow never invents a confirmation). But several flows still confuse, mislead, or dead-end, and the first-run experience quietly undermines the trust the rest of the app works hard to build.

**Working well**
- The reserve path is honest and well-branched: venue-detail.tsx:390-426 picks the lowest-priority booking link, deep-links the right platform with pre-filled date/time/party (booking-link.ts:17-47), and degrades gracefully to "Call to book" (tel:) or "No booking needed. Just walk in." rather than a fake confirm. The "Did you book?" follow-up (did-you-book.tsx) only logs a booking if the user confirms — no phantom records.
- Event detail is similarly trustworthy: the ticket CTA names the real provider from the outbound host (event-detail.tsx:172-186) and shows "No ticket link yet" instead of a dead button (event-detail.tsx:159-163). "Add to calendar" is a real .ics download and Share is a real Web Share/clipboard action (event-actions.tsx) — the comment even notes these "were dead visual stubs before".
- Search is instant and forgiving: client-side over the in-memory catalog, sensible match ranking (starts-with > contains > tag), good empty/no-result copy (search-overlay.tsx:122-158).
- "Why this is here" + "Real Talk" on venue detail (venue-detail.tsx:213-363) is a strong, differentiated trust feature — external editorial links + creator coverage the user can fact-check.
- Plan My Night is a real recommender with genuine walk-time computation and a "Try another combination" reshuffle (plan-flow.tsx:111-114, 385-394). Saved-plan re-open is a nice repeat-usage hook.

**Not working**
- The onboarding progress bar lies. TOTAL_STEPS = 4 (onboarding-flow.tsx:28) and the indicator renders "1/4" then "2/4" (line 37-38), but there are only two real steps (mood, vibe) — after step 2 the user is dumped straight to /explore. A first-time user is told they are 50% through a journey that actually ends two taps later. It reads as broken or truncated.
- Anonymous users start with two venues "already saved" they never chose: MOCK_SAVED_IDS = ["dishoom-shoreditch","borough-market"] (mock-data.ts:24-27) seed the saved set (saved-context.tsx:50-52). Worse, those exact slugs are demo-seed rows that lib/queries.ts hides from the live catalog (the google_place_id IS NOT NULL filter). So on /saved the SavedList filters by `allVenues.find(...)` (saved-list.tsx:39, 82) and these two likely won't render at all — the user is told "2 saved" with nothing (or stale demo content) to show, and the heart counts can disagree with the list. This is a self-inflicted trust wound on the very first screen after onboarding.
- For anonymous users there is no sign-in entry point anywhere on the main browsing surface. Explore greets "Hi there," (explore-feed.tsx:158 + explore/page.tsx greeting fallback) with no prompt to sign in; the only sign-in doors are buried in /profile and the Plan "Save this night" CTA. A user who saves 10 venues anonymously, clears their browser, and loses everything was never warned.

**Missing**
- No way to revisit or change onboarding answers without an account. Anonymous prefs live only in localStorage (onboarding-flow.tsx:52-59); /profile/edit requires sign-in (profile-body.tsx:29-39). The anon user who mis-taps "drinks" is stuck with it and has no visible control.
- No saved-events. You can heart a venue but not an event (event-card.tsx and event-detail.tsx have no save control) — yet /saved is framed as "Your spots". A user planning a night around a gig can't keep the gig.
- No "remove booking" affordance in the UI despite removeBooking existing (bookings-context.tsx:255). A self-reported booking that was actually a mistake is permanent from the user's point of view.
- No empty/guidance state for Plan when the catalog is thin: computePlan can silently return fewer/odd stops; only Plan-Together surfaces "Couldn't find an open spot…" (result.tsx:240-246). Solo Plan has no equivalent reassurance.
- No location/permission step anywhere, so every walk-time and "near you" implication is area-chip based, not real proximity (acknowledged in venue-detail.tsx:92-98). Fine as a stated limitation, but the product never tells the user "we don't use your location", which can read as either creepy or inaccurate depending on expectation.

**Confusing/weak**
- Label/value drift across the taste model. Onboarding shows a 🎵 card labelled "Live Music" whose value is `culture`, and a 😂 "Comedy" card whose value is `activity` (onboarding-flow.tsx:14-19). The "drinks" mood maps to event category "Club" (ranking.ts:13-18), but Explore has no Club chip and Events has no Club category (events-feed.tsx:30-40 only Music/Food/Art/Comedy) — so a "drinks" picker's personalization can match nothing in the events surface. The taxonomy is incoherent end-to-end.
- "Plan" vs "Plan Together" vs "For You" overlap with no explanation of when to use which. The bottom-nav "Plan" tab (bottom-nav.tsx:9) opens a page whose top card is "Plan with friends" (plan-together-card.tsx) above a solo planner — two different mental models stacked with no framing.
- Plan-Together lets a single person "Start swiping (1)" while still showing "Waiting for someone to join…" (lobby.tsx:111-124). A solo user can run the entire group-voting flow alone, which makes the whole "balance everyone's votes" promise feel like theatre. The deck/swipe is mood cards over a backdrop venue photo (swipe.tsx:103-120) — a user could reasonably think they are swiping *on that venue*, not on an abstract mood; the only cue is a small "{emoji} mood" pill.
- The fabricated booking reference "DIS-4821" (did-you-book.tsx:57) is shown as "Ref {b.id}" in Saved (saved-list.tsx:64-65). It looks like a real reservation number from the venue but is a random local string — a user could quote it at the door and be told it means nothing.
- Filter chip labels are terse to the point of ambiguity: "Eats" maps to type "Restaurant" only (explore-feed.tsx:117-120, 249) so cafés/markets/street-food are excluded from "Eats" despite being food. "Bars" silently bundles Wine Bar/Pub/Listening Bar (explore-feed.tsx:42) which a user filtering for "a pub" wouldn't predict.

**Risky**
- Dead buttons in /profile erode trust precisely where a logged-in (more invested) user looks for control: "Give Feedback", "Notification prefs", and "Theme: Auto" are rendered as `<button>` with no onClick at all (profile-body.tsx:103-107, 158-169). "Theme: Auto" especially implies a working theme toggle that does nothing. These are textbook fake buttons.
- Booking persistence for anon users is localStorage-only with a fabricated ref; clearing storage silently destroys "Coming up" with no warning (bookings-context.tsx:213-221).
- Plan-Together is Presence+Broadcast with no DB persistence and no replay; the host re-broadcasts on join (per room.ts). A late joiner, a host disconnect, or a refresh mid-session can desync the room with no recovery UI — the user just sees a stuck "Waiting" or an empty result and no error.
- No App Router error.tsx covers venue/event/booking/plan-together routes (per recon pack). A thrown query error (lib/queries.ts throws) on a venue page shows Next's raw default error screen, not a branded fallback — jarring in a polished consumer app.

**Recommendations**
1. Fix the onboarding step count immediately: set TOTAL_STEPS = 2 (onboarding-flow.tsx:28) or add the two missing steps (budget, areas) so the bar tells the truth. P0, trivial.
2. Remove the anon pre-saved seed, or seed only slugs that are actually catalog-visible. MOCK_SAVED_IDS (mock-data.ts:24) currently points at hidden demo rows — either delete it or point it at live venues, otherwise "2 saved / nothing shown" is the first thing a new user sees.
3. Wire or remove the three dead profile rows (profile-body.tsx:103-107). At minimum make "Theme: Auto" a real toggle (theme-provider already exists) and link "Give Feedback" to a mailto/form.
4. Add a persistent, low-friction sign-in nudge on Explore/Saved for anon users with a "saving locally — sign in to keep across devices" line, before they lose data.
5. Reconcile the taste taxonomy end-to-end: align onboarding labels with their values and ensure every onboarding mood maps to something that actually exists in both Explore filters and Events categories (ranking.ts:13-18 vs events-feed.tsx:30-40). Drop or implement "Club".
6. Gate Plan-Together "Start swiping" behind ≥2 present members, or reframe it honestly as "solo or group" so the single-user experience isn't misleading (lobby.tsx:118-124).
7. Stop labelling the random local string as "Ref" (did-you-book.tsx:57, saved-list.tsx:64) — call it "Your note" or drop it, so users don't mistake it for a venue confirmation number.
8. Add save-for-events and a remove-booking control to round out /saved as a real "your spots" hub.

---

### 3. Frontend Engineering Agent

**Working well**

The server-vs-client split is genuinely sound and the strongest part of the frontend. Pages are server components that fetch via `lib/queries.ts` and hand plain data to thin `"use client"` views — `app/(main)/explore/page.tsx` does `Promise.all([fetchVenues, fetchEvents, fetchProfile])` then passes results to `ExploreFeed` (explore-feed.tsx:56). Providers are correctly lifted to the root so they span routes outside the `(main)` shell, with a clear rationale comment (app/layout.tsx:57-61). The colour design-token layer is disciplined: `tailwind.config.ts:7-19` maps every semantic colour to a `--fl-*` CSS variable, day/night themes invert surfaces while keeping brand colours stable (globals.css:24-34), and components use `bg-card`/`text-muted-fg` rather than raw hex almost everywhere (only 18 colour literals across all tsx, most legitimately theme-chrome or the Google logo). Focus-visible rings are handled globally and theme-aware (globals.css:54-58), and `prefers-reduced-motion` zeroes all animation (globals.css:107-116) — a genuine accessibility win. The realtime room hook (lib/realtime/room.ts) is well-documented, handles the StrictMode double-invoke trap (together-flow.tsx:41-58) and the Broadcast-has-no-replay late-join problem (room.ts:164-189) thoughtfully. `cn`/`clsx` is a tidy zero-dependency helper (lib/clsx.ts).

**Not working**

There is **no App Router `error.tsx` or `global-error.tsx` anywhere**. `lib/queries.ts` throws raw `Error` on any Supabase failure, and the only error boundary (`components/error-boundary.tsx`) is wired solely around the `(main)` group (app/(main)/layout.tsx:17-19). So a transient DB error on `/venue/[slug]`, `/event/[id]`, `/booking/[slug]/confirmed`, `/sign-in` or `/onboarding` drops the user to Next's raw default error screen — on a live, publicly-reachable production site (www.funldn.com). The `ThemeProvider` (components/theme-provider.tsx:4-17) sets `data-theme` only inside a `useEffect` after hydration, with no inline pre-paint script and no `data-theme` on the server-rendered `<html>` (app/layout.tsx:55). Every first paint therefore renders in the **day theme then flips to night after JS loads** — a guaranteed flash-of-wrong-theme for every evening visitor, which is the app's whole "tonight in funLondon" identity. Three plan surfaces bypass `next/image` entirely and inject photos as CSS backgrounds: plan-flow.tsx:353, result.tsx:170, swipe.tsx:105 (`style={{ background: \`url(${...}) center/cover\` }}`) — no optimisation, no lazy-loading, no `alt`, and these are the largest hero images in the product.

**Missing**

No focus management on either modal. `SearchOverlay` and `ReserceSheet` set `role="dialog"` + `aria-modal="true"` (search-overlay.tsx:82-86, reserve-sheet.tsx:49-53) but neither **traps focus**, neither **returns focus to the trigger on close**, and `ReserveSheet` has **no Escape-to-close** (only the search overlay wires Escape, search-overlay.tsx:50-54). The reserve-sheet backdrop is a bare `<div onClick={onClose}>` (reserve-sheet.tsx:55) with no keyboard equivalent. There is no skip-link, no `<main>` landmark in the `(main)` layout (it renders a plain `<div>`, app/(main)/layout.tsx:16), and no shared Button/Card primitives — the primary-CTA class string `h-[52px] rounded-2xl text-primary-fg text-[15px] font-extrabold shadow-[0_6px_14px_rgba(0,0,0,0.12)]` is hand-copied in at least five files (plan-flow.tsx:280, profile-body.tsx:58, event-detail.tsx:148, sign-in-form.tsx:157, reserve-sheet.tsx:130). No typography scale: there are **241 arbitrary Tailwind bracket utilities** including `text-[11px]` 44 times and `h-[52px]` 13 times — the colour tokens are disciplined but the type/spacing scale is entirely ad-hoc.

**Confusing/weak**

`plan-flow.tsx` is the largest and most fragile file at 463 lines: it interleaves a multi-chip setup form, the pure-engine call, Supabase save/load of plans, a re-opened-saved-plan code path (the `openedSaved` vs `computed` branching at plan-flow.tsx:99-116, 163-196), and two full screen renders in one component. The `editInputs` wrapper (plan-flow.tsx:192-196) is a smell — invalidation logic threaded through every input handler because state isn't normalised. Heading hierarchy is inconsistent: several screens render an `<h2>` with no `<h1>` ancestor (swipe.tsx:115, result, venue-detail.tsx uses `<h1>` then the reserve-sheet injects another `<h2>` into the same page, reserve-sheet.tsx:73). The `useRoom` effect lists `me` in its dependency array (room.ts:234) — it survives only because `together-flow.tsx` pins identity in a ref; any caller passing a fresh `me` object each render would tear down and rebuild the realtime channel on every render. The dual-mode localStorage↔Supabase hydrate/migrate/persist logic is **duplicated almost line-for-line** between `saved-context.tsx` and `bookings-context.tsx` (both ~250-300 lines, same three-step migrate pattern, same `slugToUuidRef`, same fire-and-forget write comments) — a clear extraction candidate.

**Risky**

Fire-and-forget DB writes never surface failure to the user: `toggleSaved` (saved-context.tsx:188-206) and `addBooking` (bookings-context.tsx:233-249) only `console.error` on failure while keeping the optimistic UI, so a save/booking can silently fail to persist — and there is **zero analytics instrumentation** on these core actions (recon pack confirms pageviews only) so you'd never know. The `pickQuestionVenues` fallback chain (together-flow.tsx:145-157) can hand `undefined` to the Swipe card when the catalog is thin; `swipe.tsx:95` guards with `?? questionVenues[0]` but if the whole array is empty `venue` is `undefined` and `venue.imgUrl` (swipe.tsx:105) throws — straight into the missing error boundary. Realtime votes/swaps are pure Broadcast with no DB persistence (room.ts), so a host disconnect mid-session loses the entire plan with no recovery. `maximumScale: 1` in the viewport (app/layout.tsx:28) **disables pinch-zoom**, a WCAG 1.4.4 failure.

**Recommendations**

Priority order: (1) add `app/global-error.tsx` + per-segment `error.tsx` for at least venue/event/booking/auth, and widen the error boundary or rely on App Router error files. (2) Render `data-theme` server-side (read time on the server, or an inline pre-hydration script) to kill the night-theme flash. (3) Extract the dual-mode persistence into one `useSyncedCollection(authUserId, …)` hook shared by both contexts. (4) Build shared `Button`, `Card`, `Sheet`/`Dialog` primitives (the Dialog one gaining a focus-trap + return-focus + Escape) and a small typography token set to retire the 241 arbitrary values. (5) Convert the three CSS-background hero photos to `next/image`. (6) Split `plan-flow.tsx` into `PlanSetup`, `PlanResult`, and a `useSavedPlans` hook. (7) Remove `maximumScale: 1`.

---

### 4. Backend Engineering Agent

## Backend audit — Fun London (Next.js 14 App Router + Supabase)

**Working well**

The read-side catalog layer is genuinely well-built. `lib/queries.ts` is a clean, server-only data access layer (`createClient` from `lib/supabase/server.ts:6` enforces cookie-scoped server usage), with disciplined snake_case→camelCase mapping (`mapVenue` at queries.ts:91, `mapEvent` at :126) and a sensible visibility contract — only Google-ingested venues surface (`fetchVenues` at queries.ts:150-159, `.not("google_place_id","is",null)`). The dual-mode client contexts (`components/saved-context.tsx`, `components/bookings-context.tsx`) are thoughtfully written: optimistic UI, FK-safe slug→uuid resolution, idempotent one-time localStorage→DB migration (saved-context.tsx:99-127, bookings-context.tsx:128-159), and try/catch guards so a network blip never wipes state. The ingestion script is idempotent on `google_place_id` (ingest-venues.ts:345) and the events pipeline is idempotent via a `(source, source_id)` unique constraint. The Gemini choke-point (`geminiFetch` at discover-venues.ts:327-356) with min-gap pacing + Retry-After-aware exponential backoff is exactly the right pattern for a free-tier API, and the per-run TARGET of 3 (discover-venues.ts:44) sensibly spreads the daily quota across 6 cron fires. Auth-optional middleware (`lib/supabase/middleware.ts:34`) correctly refreshes the session cookie without forcing redirects, and Server Actions re-check admin auth on every mutation (actions.ts:24, getAdminUser), defending against replay/leaked-URL attacks.

**Not working**

The chain detector **fails open**, defeating the product's core thesis (curated independents only). `londonLocationCount` (discover-venues.ts:289-304) wraps its Google Places call in `try { … } catch { return 1 }` — on ANY API error (429, 503, network blip, quota exhaustion) it returns 1, which is below `CHAIN_LOCATIONS = 4` (discover-venues.ts:77), so the chain gate at discover-venues.ts:608 passes and the chain gets **auto-published** with no human review (discover-venues.ts:18). This is asymmetric: source validation right below it (discover-venues.ts:621-624) correctly fails *closed* with `continue`. A bad afternoon on the Places quota silently lets Nando's and Franco Manca into a 'no chains' catalog. Separately, four of five event provider adapters are non-functional stubs returning `[]` — `fetchEventbrite` (ingest-events.ts:230-238), `fetchSkiddle` (:493), `fetchDice` (:501); only Ticketmaster (ingest-events.ts:240-279) is wired. The events cron runs green but produces zero curated events unless a Ticketmaster venueId subscription exists.

**Missing**

There is **no API layer and no error boundaries**. All user writes (saves, bookings) are client-side calls against the anon key, protected only by RLS (saved-context.tsx:188-205, bookings-context.tsx:233-249) — there is no server-validated write path, no rate limiting, no audit trail, and no server-side input validation (party_size, notes length, status enum are all trusted from the browser). And there is **no `app/global-error.tsx` and no route-level `error.tsx` anywhere**. Every query in queries.ts throws on Supabase failure (`throw new Error` at queries.ts:157, 169, 199, 241, etc.); in a Server Component that throw bubbles to Next's default 'Application error' white screen. A single transient Supabase blip turns the whole `/explore` or `/venue/[slug]` page into a crash with no retry affordance.

**Confusing/weak**

Admin authz is a **hardcoded personal Gmail** as the env default: `process.env.FL_ADMIN_EMAILS ?? "mp.aranzales@gmail.com"` (lib/auth.ts:32). If `FL_ADMIN_EMAILS` is ever unset in production, the admin surface silently grants access to exactly one external Gmail with no DB role table, no audit, no MFA gate beyond Supabase auth. The `fetchEvents` 'today' boundary is computed in **UTC, not Europe/London** (queries.ts:191-192, `setUTCHours(0,0,0,0)`). During BST a 00:30 London gig can be filtered out as 'past'. The `walking_mins: 12` and `tables_free: 4` are hard-coded constants stamped on every ingested venue (ingest-venues.ts:246-247) — fabricated live-availability data (though the detail page, venue-detail.tsx:96-98, deliberately hides them; the venue CARD may still surface them). Server Actions swallow all errors to `console` and return `void` (actions.ts:74-77) so an admin clicking Approve on a failed write sees the card silently reappear.

**Risky**

The **Google Places API key is embedded in plaintext in public photo URLs** shipped to every client (ingest-venues.ts:211-219 and again at discover-venues.ts:306-308). A scraped key still lets anyone burn the project's billable Places photo quota, DOS-ing the photo CDN and inflating the bill. The key sits in `img_url` columns for every venue, so it's in the DB, the server-rendered HTML, and every social/OG share. RLS is the **only** thing standing between an anonymous browser holding the anon key and the `bookings`/`saved_venues`/`profiles` tables. The service-role key is correctly confined to GitHub Actions — good — but `maintenance.yml`, `events-ingest.yml`, and `discover-venues.yml` have **no failure alerting**: a cron that 429s on Gemini or 403s on Places for a week fails silently with nobody watching.

**Recommendations**

Priority order: (1) Fix the fail-open chain check — on error `continue`/reject rather than `return 1`. (2) Move the Places photo key out of public URLs — download + reupload to Supabase Storage at ingest. (3) Add `app/global-error.tsx` + per-segment `error.tsx` with retry. (4) Replace the hardcoded admin Gmail default with a fail-closed empty default + a DB `admin_users` role table. (5) Fix the UTC/London timezone boundary in `fetchEvents`. (6) Stand up a thin Server-Action write layer for saves/bookings with Zod validation. (7) Wire cron failure notifications on `failure()`. The foundations are strong but the security and resilience gaps are launch-blockers.

---

### 5. Data / Content Agent

## Data & Content Review — Fun London

The product thesis (per memory: "curated independents only, verifiable in 2+ sources, brat editorial voice") is only half-built. There are two parallel data pipelines with wildly different quality, and the lower-quality one now dominates the live catalogue.

**Working well**

- **The hand-curated seed is genuinely excellent and on-thesis.** `scripts/venues-seed.ts` (1,762 lines, 31 venues) is the strongest asset in the repo. Each entry carries 3–6 real editorial sources with article titles and dates (116 `publication:` entries across the file), real creator coverage with handles and verdicts (`positive`/`mixed`/`critical`), and honest "Real Talk" critical flags (0 empty `criticalFlags` arrays — every venue has them). The Quality Chop House entry even surfaces a *mixed* creator verdict about uncomfortable benches (`venues-seed.ts:480-505`) and Sessions Arts Club flags a Jan-2024 chef change (`venues-seed.ts:289-302`). This is exactly the "trusted local guide" tone the thesis wants — it reads like a knowledgeable friend, not an algorithm.
- **The 2-source provenance gate is real and enforced** in the autonomous pipeline (`discover-venues.ts:625-631`): `REQUIRED_SOURCES = 2` (1 for Outdoors), validated via Gemini + Google Search against a 15-publication allowlist (`TRUSTED_PUBLICATIONS`, lines 163-180). This is the one integrity check that can't be faked, and it was correctly kept as the single Gemini call.
- **Chain detection by location count is implemented soundly.** `londonLocationCount()` + `brandKey()` (`discover-venues.ts:280-304`) correctly strips branch suffixes ("Dishoom | Shoreditch" → "dishoom") so a 4-branch chain collapses to one brand and trips `CHAIN_LOCATIONS = 4`. The inline comment (lines 274-283) shows the author understood and fixed the naive earlier version.
- **Honest CTAs over fake signals.** `venue-detail.tsx:92-98` deliberately suppresses "tables free", "next slot", and "X min walk" because there's no live feed — "a booking product can't afford fake signals". Correct instinct.
- **Event ingestion is idempotent and defensive.** `ingest-events.ts` upserts on `(source, source_id)`, only runs the cancellation pass when the provider returned ≥1 event (lines 631) to avoid mass-cancelling on an API blip, and drops poster-less / disallowed-host images (`safeImageUrl`, lines 122-132).

**Not working**

- **The templated-blurb pipeline has flooded the catalogue with generic copy, and it now outnumbers the curated content live.** On the production `/explore` feed I counted the templated phrase fragments ("critics keep coming back to" / "own —") **51 times** versus hand-written curated phrasing ("Basque", "Nose-to-tail", "hand-rolled") only **9 times**. The template (`discover-venues.ts:442-478`) produces near-identical prose for every venue: vibe = `"{area}'s own — a {noun} the critics keep coming back to."` and long_description = `"An independent {noun} in {area} that earned its place the honest way: cross-checked across N trusted sources…"`. Every Soho café reads the same as every Peckham wine bar. This is the opposite of "curated" — it is the algorithmic blandness the thesis explicitly rejects. The 49 venues now live (vs the 39 in the brief — the cron is actively adding more) are mostly these.
- **Critical flags on auto-discovered venues are worthless.** `templateEditorial` (lines 463-475) emits one of exactly two boilerplate flags: "Check times before you go" (day-spots) or "Independent — plan ahead" (everything else). Compare to the hand-curated Padella flag ("Arrive by 5:30pm or expect a 45-90 minute wait. They take a phone number and text you…", `venues-seed.ts:719-723`). The "Real Talk" feature — a headline differentiator — is real for 31 venues and theatre for the other ~18+.
- **Events are almost entirely a single source (Ticketmaster) and skew to music.** `ingest-events.ts:230-238, 493-509` — Eventbrite, Skiddle and DICE adapters all `return []`. Only `fetchTicketmaster`/`fetchLondonDiscovery` work. The `LONDON_VENUES` allowlist (lines 156-176) is 15 venues, 13 of which are music/gig rooms. `tmCategory` (lines 401-416) buckets Sports/Film/Misc into "Music" as a fallback, so the "Food"/"Club" event categories will be near-empty. 27 events live, almost all gigs.

**Missing**

- **Opening hours coverage is best-effort and silently absent on legacy rows.** `opening_hours` is nullable (`schema.sql:68`); the 11 demo seed rows in `seed.sql` have none; populated only when Google Places returns `regularOpeningHours`. No coverage metric, no backfill guarantee.
- **`instagram_handle` is never populated.** Hard-coded `null` in both `ingest-venues.ts:259` and `discover-venues.ts:671`, and 0 occurrences in `venues-seed.ts`. The `instagramHandle` field in the type/schema is dead.
- **No photos pipeline beyond Google Places single first photo.** Every venue uses `p.photos[0]` only (`discover-venues.ts:662-664`, `ingest-venues.ts:230`). One photo per venue, no gallery, no fallback diversity (all failures collapse to the *same* Unsplash placeholder, line 664).
- **Geographic concentration is baked into the discovery grid.** `NEIGHBOURHOODS` (`discover-venues.ts:82-99`) is 16 areas heavily weighted east/south-east (Bermondsey, Peckham, Hackney, Dalston, London Fields, Camberwell). The curated seed confirms the bias: Soho 4, then Shoreditch/Dalston/Bermondsey/Columbia Road/Borough 2 each. Whole swathes of London (west, north-west, south-west) are absent. A "trusted London guide" that can't suggest anything in Notting Hill, Hampstead or Richmond is not yet a London guide.
- **No candidate-scouting pipeline.** Every adapter under `scripts/candidate-sources/*` (eater, hardens, hot-dinners, infatuation, square-mile, timeout) is a stub returning `[]` (`infatuation.ts:21-29`). `scout-candidates.ts` therefore has no inputs — the "cross-reference mentions across publications" discovery path described in `_types.ts:1-8` does not exist.

**Confusing/weak**

- **Two ingestion paths write different-quality rows into the same table with no quality tier flag.** `ingest-venues.ts` (rich curated editorial) and `discover-venues.ts` (templated) both upsert into `public.venues`. There is no column distinguishing hand-curated from auto-templated, so the app can't prioritise the good rows or visually mark them. `lib/queries.ts` filters on `google_place_id IS NOT NULL` to hide demo rows — but that also can't separate the two real tiers.
- **Hard-coded fake operational data persists on real venues.** `walking_mins: 12`, `tables_free: 4`, `next_slot_label: "Open today"` are written verbatim for every ingested venue (`discover-venues.ts:659-661`, `ingest-venues.ts:246-248`). The detail page wisely hides these (`venue-detail.tsx:92-98`), but they sit in the DB as `NOT NULL` lies, and any future surface that reads them will show fabricated signals. The schema forces this (`schema.sql:43-45` all `NOT NULL default`).
- **`rating` precision mismatch.** Schema is `numeric(2,1)` (`schema.sql:41`) but discovery writes `p.rating` which Google returns to 1 decimal — fine — yet the fallback `rating: p.rating ?? MIN_RATING` (4.4, line 657) silently invents a rating for any venue Google didn't rate, presented to users as a real score.

**Risky**

- **CRITICAL: the Google API key is exposed in plaintext in production HTML.** `photoUrl()` embeds `key=${GOOGLE_PLACES_API_KEY}` directly in the stored `img_url` (`discover-venues.ts:306-307`, `ingest-venues.ts:211-219`, `refresh-venues.ts:112-113`). These URLs are written to the DB, served by `fetchVenues`, and rendered to anonymous users. I confirmed it live: `curl https://www.funldn.com/explore` returns `key=AIzaSy...` 49+ times in the page source. The code comment (`ingest-venues.ts:212-218`) claims this is "acceptable because the key is restricted to Places API only" — but a Places-scoped key is still abusable: an attacker can run unlimited Places lookups on Maria's quota/billing, and there is no evidence in-repo that the restriction is actually applied at the GCP level. This is a billing-exposure and key-rotation liability. Fix: download photos and re-host on Supabase Storage (the comment even says "Future: download + reupload"), or proxy through a signed endpoint.
- **The autonomous cron auto-publishes templated venues unattended every 4 hours** (`.github/workflows/discover-venues.yml` cron `15 1,5,9,13,17,21`). With templated editorial and only-2-source validation, the catalogue's average quality *degrades over time* as templated rows accumulate faster than anyone hand-curates. There is no human review step and no admin gate on auto-published venues (the `/admin/candidates` flow is for prospects, not discovery output).
- **Seed `delete from` is a footgun.** `seed.sql:18-19` wipes all events and venues. The warning (lines 8-11) says "Do NOT re-run once users have data" but nothing enforces it — a re-run cascades to `saved_venues` and `bookings` (FK `on delete cascade`).

**Recommendations**

1. **(P0) Rotate the leaked Google key and stop embedding it in public URLs.** Re-host Places photos in Supabase Storage at ingest time; rotate the key after. This is live and exploitable now.
2. **(P0) Add a `curation_tier` column** ('curated' | 'discovered') and have `fetchVenues` rank curated rows first, or visually badge them. Right now the 31 good venues are diluted by templated ones in the same feed.
3. **(P1) Pause or gate the autonomous discovery cron** until the editorial is non-templated, OR route discovery output to a review queue (reuse `partner_prospects`/admin pattern) instead of auto-publishing. The templated blurbs actively undermine the "curated guide" promise.
4. **(P1) Replace the two-template critical-flags with at least venue-type-specific, source-derived honesty** — even a single Gemini call per venue for the flag would beat the current boilerplate; or hold templated venues out of "Real Talk"-bearing surfaces.
5. **(P1) Broaden geography** — add west/north-west/south-west neighbourhoods to the discovery grid and curated seed; the current east/south-east concentration makes the app feel like a Bermondsey-Peckham guide, not a London one.
6. **(P2) Wire at least one non-Ticketmaster event adapter** (Skiddle has a clean API per `ingest-events.ts:497`) so Food/Club/Comedy categories aren't empty, and de-music the `LONDON_VENUES` allowlist.
7. **(P2) Make hard-coded operational fields nullable** (`walking_mins`, `tables_free`, `next_slot_label`) so the DB stops storing fabricated values the UI already refuses to show.

---

### 6. Visual Design / Brand Agent

Fun London is a competently-built, restrained mobile shell with one genuinely nice idea (time-of-day day/night theming) executed with discipline. But as a *brand* it is currently incoherent and under-powered: the signature logo gradient never appears in the live UI, the "purple" brand is actually an indigo-blue primary, the masthead throws the real logo away in favour of flat text, and a single sans font plus a near-absent illustration/iconography system give it none of the visual personality a "fun" going-out brand needs to compete with Resy, DICE, Time Out or The Infatuation.

**Working well**
- **Time-based day/night theme is a real differentiator.** `components/theme-provider.tsx:8-9` flips `data-theme` at 18:00/06:00, and `app/globals.css:5-34` defines a warm cream day palette and a genuinely warm near-black night palette (`#14110d` with `#ece6d9` text, not the lazy pure-black/pure-white). For a going-out app this "the app gets dressed for the evening" behaviour is on-thesis and rare. Keeping brand `--fl-primary`/`--fl-accent` theme-stable (globals.css:13-16, 32-33) is the correct call so CTAs read identically.
- **Motion system is tasteful and accessible.** One shared easing token and duration (`--fl-ease-out` cubic-bezier(0.16,1,0.3,1), 320ms, globals.css:69-72), a single fade-and-rise keyframe replayed per route via a `key={pathname}` remount (`components/page-transition.tsx:15`), a capped stagger (globals.css:96-102), and a real `prefers-reduced-motion` killswitch (globals.css:107-116). Bottom-nav micro-interactions (active pill fade, icon lift, `active:scale-90`) are restrained and confident (`components/bottom-nav.tsx:30-52`).
- **Spacing/elevation tokens are coherent.** Three-tier shadow scale (soft/card/elev) and a single `xl2` radius (`tailwind.config.ts:23-30`); the codebase even back-filled half-step spacing it actually depends on (4.5/5.5/6.5, tailwind.config.ts:37-41).
- **Editorial "Real Talk" / "Why this is here" treatment is the best-looking thing in the app.** The accent vertical rule, eyebrow + headline, italic body and source-citation list on the venue detail (`app/venue/[slug]/venue-detail.tsx:219-363`) is the one place the product looks like a magazine rather than a generic startup template, and it directly expresses the 2-source provenance thesis.

**Not working**
- **The brand's defining asset — the blue→magenta logo gradient — appears NOWHERE in the running UI.** The logo PNG (`public/logo-fun.png`, viewed) is a vivid blue→purple→pink gradient. Yet the only gradient token, `--fl-gradient`, is orange→pink (`hsl(20 90% 60%) → hsl(340 80% 60%)`, globals.css:21) — a *different* gradient — and a grep proves it is **defined but never referenced** anywhere in `app/` or `components/`. The signature look is trapped inside a 2 MB PNG and the live app never echoes it. This is the single biggest brand failure.
- **The "purple brand" is actually blue.** `--fl-primary: hsl(233 70% 55%)` (globals.css:17) is indigo-blue, and it is the colour of every primary CTA (Reserve, Continue, onboarding "Find my night", venue-detail.tsx:396). The purple (`--fl-accent: hsl(265 80% 60%)`, globals.css:19) is relegated to secondary states (nav active, eyebrows). So the brief's "purple brand" is contradicted by the actual hierarchy, and neither the blue nor the purple matches the logo's magenta endpoint. Three different "brand" hues (blue primary, purple accent, magenta logo) with no shared gradient = no colour identity.
- **The masthead throws the logo away.** On Explore, the wordmark is rendered as flat live text "fun London" in `text-primary` blue (`app/(main)/explore/explore-feed.tsx:170-174`) — not the gradient logo, not even the logo font. So the home screen, the most-seen surface, shows a blue text label while the splash (`app/splash-client.tsx:64-71`) and onboarding (`onboarding-flow.tsx:97`) show the magenta gradient PNG. The brand literally looks like two different products between splash and home.

**Missing**
- **No display/editorial typeface.** Single font, Plus Jakarta Sans (`app/layout.tsx:11-17`). It is a clean neutral geometric sans used by thousands of SaaS dashboards. For a "fun" London nightlife brand judged against DICE (bold condensed display), Time Out (its own slab/grotesque) or The Infatuation (serif editorial), one neutral sans across eyebrows, H1s and body gives zero typographic personality. The italic-lowercase eyebrow ("tonight in", explore-feed.tsx:164) is the only typographic flourish and it's doing all the work alone.
- **No illustration, pattern, texture or brand imagery system.** Every photo is a third-party Google Places image (`venue-card.tsx:53-65`, `venue-detail.tsx:108-118`), served `unoptimized`. There is no brand-owned imagery, no empty-state illustration (the empty feed is a bare grey sentence, explore-feed.tsx:195-197), no texture, no signature shape language beyond the heart-pin in the logo which is never reused in UI.
- **No iconography point of view.** Mostly lucide stock icons (`explore-feed.tsx:4-12`) plus a few hand-rolled SVGs in the nav (bottom-nav.tsx:81-128). Competent, generic, indistinguishable from any template.

**Confusing/weak**
- **`--coral` token referenced but never defined.** The team's own comment in `venue-detail.tsx:186-187` admits the amber star is a fallback for a missing `--coral` brand token — an incomplete colour system shipped to production.
- **Logo aspect-ratio fudge.** `components/logo.tsx:13-20` hardcodes a 1.5 (3:2) aspect for all variants because the source PNGs were re-exported to 1536×1024. The wordmark is only ~half that frame width, so every `<Logo>` render carries large transparent side margins — sizing/centering is guesswork rather than a tightly-cropped asset, and on splash the 240×160 box (splash-client.tsx:67-68) is mostly empty space.
- **Onboarding emoji set is off-brand and mislabelled.** `onboarding-flow.tsx:14-26` uses OS emoji (🍝🍸🎵😂✨🔥💎🎭) as the primary visual in the first-impression flow, and the value `culture` is labelled "Live Music" while `activity` is labelled "Comedy" — semantics drift from the type system, and OS emoji render completely differently across iOS/Android/web, so the brand's first screen looks different on every device.
- **2 MB logo PNG on the splash/critical path.** `public/logo-fun.png` is 2,089,385 bytes — a 2 MB raster for a simple two-colour gradient wordmark that should be an inline SVG (a few KB) that would also unlock recolouring/animating the gradient in-app.

**Risky**
- **App icon declared `maskable` but is not full-bleed.** `public/manifest.json` marks `/apple-icon.png` `purpose: "maskable"`, but the icon (viewed, `app/icon.png`) has its own baked-in rounded-rectangle tile plus transparent margin. Android applies its own mask on top, which will clip/double-round the already-rounded tile and shrink the safe area — the installed icon will look wrong on Android. Maskable icons need the artwork to fill the full canvas with the key content inside the inner 80% safe zone.
- **Chrome tint can diverge from app theme.** `app/layout.tsx:35-38` themeColor follows OS light/dark, but the in-app theme is wall-clock based (theme-provider.tsx). A user in OS-light at 9 pm gets a cream status bar above a near-black app. The code comments accept this, but it is a visible polish seam.
- **All photography is borrowed and unoptimised.** Relying entirely on Google Places photos (varying crop, quality, white-balance, watermark risk) and bypassing the image optimizer means the feed's visual consistency is at the mercy of third-party uploads — a real credibility risk for a "curated" premium brand.

**Recommendations**
1. Make the logo gradient the brand's load-bearing visual: replace the orange→pink `--fl-gradient` with the actual blue→magenta logo gradient, ship the logo as inline SVG, and use that gradient on the masthead wordmark, primary CTAs and key accents so splash → home → detail feel like one product.
2. Resolve the three-hue identity: either commit to purple (move `--fl-accent` to primary) or to the logo's magenta, and define the missing `--coral` (or remove the dependency). One brand gradient + one solid accent, applied consistently.
3. Add a second, characterful display typeface for H1s/eyebrows/masthead; keep Jakarta for body. This is the cheapest way to buy "fun London" personality.
4. Replace the flat-text masthead with the real (SVG) logo; tightly re-crop the logo assets so `Logo` sizing isn't a fudge.
5. Build brand imagery/empty-state illustrations and a real maskable icon; treat Google Places photos as a fallback, not the identity.

---

### 7. Growth / Marketing Agent

## Growth & Marketing Lens

**Working well**

- A genuine native share primitive exists and is wired into the three highest-intent surfaces: venue detail (`app/venue/[slug]/venue-detail.tsx:55-65`), event detail (`components/event-actions.tsx:25-35`) and the Plan Together lobby (`app/(main)/plan/together/_steps/lobby.tsx:19-23`). `lib/share.ts` correctly uses the Web Share API with a clipboard fallback and returns a typed result so the UI can confirm a copy. This is the *one* real organic-loop ingredient in the build.
- Plan Together is a structurally viral feature: a 4-char room code shared via a real URL (`window.location.origin/plan/together?room=${room.code}`, `lobby.tsx:19`) pulls a second person into the app. That is the closest thing to a built-in invite mechanic, and it works.
- `Add to calendar` produces a real `.ics` data URL (`components/event-actions.tsx:16-23`, `lib/ics.ts`) — a legitimate retention hook (the event re-surfaces in the user's own calendar with a `Tickets:` link back to the source).
- The PWA manifest is reasonably complete (`public/manifest.json`): name, short_name, categories, maskable icon, `lang: en-GB`, standalone display. Installability is the one acquisition channel that is actually configured.
- Middleware is auth-optional with no redirects (recon: `middleware.ts`), so a shared deep link to `/venue/[slug]` or `/event/[id]` *does* render for a logged-out stranger — the funnel isn't gated behind sign-in. Good.

**Not working**

- **Every shared link is a blank grey box on every platform.** There is no `openGraph`, no `twitter:` card, no per-page `generateMetadata`, and no OG image anywhere (recon SEO section; `app/layout.tsx:19-23` is the *entire* metadata surface — `title`, `description`, `manifest` only). When a user taps Share on Tao or a Soho wine bar and pastes it into WhatsApp/iMessage/Instagram DM, the recipient sees "Fun London — Your curated guide to London's best hidden gems" with no venue name, no photo, no neighbourhood. The product has built the share *button* and thrown away 100% of the share *payload*. This is the single biggest growth defect in the repo.
- **The splash screen actively sabotages shared links for new visitors.** `/` always plays the splash and then routes anonymous-with-no-localStorage users to `/onboarding` (`app/page.tsx:9-17`, `app/splash-client.tsx:32-46`). A deep link to `/venue/[slug]` is fine, but anyone who lands on the bare domain (the most common outcome of word-of-mouth: "check out funldn.com") is forced through a preference quiz before seeing a single venue. There is no public, indexable landing page that says what this is and shows the goods.
- **Zero conversion instrumentation.** Analytics is pageview-only (`app/layout.tsx:3,69`); recon confirms no `track()` on saves, reserves, shares, plan-creation or booking-confirm. You cannot measure share rate, K-factor, onboarding drop-off, or reserve conversion. Growth is being flown blind.

**Missing**

- No `app/sitemap.ts` / `app/robots.ts` — `/sitemap.xml` and `/robots.txt` both 404 on the live domain (recon). A discovery product indexed at a real domain (www.funldn.com) is telling Google nothing about its venue/event catalogue. Every `/venue/[slug]` is invisible to organic search.
- No JSON-LD structured data (`Restaurant`, `LocalBusiness`, `Event` schema). These pages are *perfect* candidates for rich results (rating stars, price, opening hours — all of which exist in `lib/types.ts`) and ship none.
- No email/newsletter capture anywhere (confirmed: only `channel.subscribe` in `lib/realtime/room.ts:225` matched). Auth is magic-link only; there is no "get the weekly London drop" capture for anonymous browsers, who are the majority.
- No referral loop. The closest mechanic (Plan Together room codes) is framed as a utility, not a growth loop — no "you both unlock…", no attribution, no post-plan "share your night" prompt.
- The post-booking moment — the single highest dopamine point in the funnel — has a "You're in 🎉" screen (`app/booking/[slug]/confirmed/did-you-book.tsx:136-163`) with **no share CTA**. The only buttons are "See it in Coming up" and "Back to exploring". This is the textbook place to inject an organic-share trigger and it's wasted.

**Confusing/weak**

- The profile action rows `Give Feedback`, `Notification prefs`, `Theme: Auto` are dead stubs — plain `<button>`s with no `onClick` (`app/(main)/profile/profile-body.tsx:103-107,158-169`). "Notification prefs" implies a re-engagement channel that does not exist; there are no push notifications, no notification permission request, nothing. It is marketing theatre.
- Share text is thin and inconsistent: venue shares `"${venue.name} · ${venue.neighbourhood}, London"` (`venue-detail.tsx:58`) but relies on `window.location.href` for the URL, so on desktop where Web Share is absent it copies a bare URL with no title/text and no OG fallback — the recipient gets a naked link to a blank-preview page.
- `did-you-book.tsx` logs bookings to client context only (`addBooking`, line 58) — there's no server-side booking record, so there is no data foundation for any lifecycle/retention email ("your table at X is tomorrow") even if a channel existed.

**Risky**

- Launching paid or word-of-mouth acquisition in this state would burn the channel: shared links render as blank previews (kills WhatsApp/Instagram/iMessage virality, the dominant London discovery channels), and the bare domain dumps newcomers into a forced quiz. The product is, functionally, a closed app with a share button that produces dead links.
- SEO debt compounds: with no sitemap/robots/metadata/JSON-LD and `cache-control: no-store` on every route (recon), the site is both un-indexable and un-cacheable. Organic search will deliver ~zero traffic indefinitely, leaving paid as the only lever — expensive for a pre-revenue consumer app.
- Admin allowlist defaults to a hardcoded personal Gmail (`lib/auth.ts:32`) — not a growth issue per se, but a launch-readiness smell if `/admin` ever leaks.

**Recommendations** (in priority order)

1. **Ship OG/Twitter metadata + dynamic OG images on `/venue/[slug]` and `/event/[id]`** via `generateMetadata` + `next/og` `ImageResponse`. This is the highest-leverage growth fix in the entire codebase: it turns every existing Share tap into a rich, branded preview. Until this lands, every other growth investment leaks.
2. **Add `app/sitemap.ts` + `app/robots.ts`** generated from `fetchVenues`/`fetchEvents`, and add `Restaurant`/`Event` JSON-LD to detail pages. Opens the organic search channel that is currently 404ing.
3. **Build a public, indexable landing page** (skip-splash for anonymous deep visitors to `/`) that shows real venues and a single CTA — so word-of-mouth "funldn.com" actually converts instead of dead-ending in onboarding.
4. **Inject a share trigger at the post-booking screen** ("Tell a friend where you're going") and add a real referral/invite framing to Plan Together room codes.
5. **Add custom event instrumentation** (share, save, reserve-click, plan-created, booking-confirmed) so K-factor and funnel are measurable before spending on acquisition.
6. **Add a lightweight email capture** (e.g. "the weekly London drop") for the anonymous majority, backed by a real lifecycle channel.

---

### 8. Investor / Business Agent

## Investor / Business Lens — Fun London

**Working well**

The build is genuinely impressive *as an engineering artefact for a non-engineer solo founder*, and there are two assets an investor would actually respect.

1. **The autonomous discovery robot is the strongest part of the story.** `scripts/discover-venues.ts` is a real, running, all-free pipeline: Google Places grid search over 16 neighbourhoods × 8 categories → cheap pre-filter (rating ≥4.4, review-count gates) → a genuinely clever chain filter by *London location count* (`londonLocationCount`, threshold 4, with brand-name normalisation — verified: "be at one" → 15 branches, rejected) → Gemini 2.5 Flash doing ≥2-source validation via built-in Google Search → upsert on `google_place_id`. It runs every 4h via `.github/workflows/discover-venues.yml` and has grown the catalog autonomously (STATE.md:54-61, 254-275). This is a defensible *supply-side* mechanic: a self-maintaining curation engine that costs near-zero. That is the one thing here that "Time Out + an intern" doesn't have.

2. **The `partner_prospects` BD overlay is a smart, non-obvious insight.** schema.sql:151-172 and the dual-write in `scripts/ingest-venues.ts:356-363` mean every curated venue is *automatically* logged as a BD target with `current_booking_method` and `bd_status`. The thesis in `project_business_model.md:144-166` is sharp: the venues that are hardest to integrate via API (independents with no OpenTable/Resy lock-in) are precisely the venues with no incumbent platform to displace — so they're the *easiest to acquire as partners*. That asymmetry is a real, articulable wedge. It is the most investable sentence in the whole repo.

3. **Honesty discipline.** `venue-detail.tsx:96-98` deliberately refuses to show fake "tables free / next slot / walk time" because "a booking product can't afford fake signals." Epic A of BUILD-PLAN.md ripped out phantom bookings. This integrity is rare and is a genuine de-risking signal to a diligence-minded investor.

**Not working**

- **There is no business.** The single most important fact: `project_business_model.md:18` states "Zero revenue today," and a grep for `affiliate|awin|commission|utm|partner_id|pid=` across `lib/ app/ scripts/` returns **nothing** (only an unrelated email input and a venue URL). The entire affiliate thesis — the supposed primary revenue path — is **0% built**. `lib/booking-link.ts` builds clean deep-links with date/party prefill but tags **no** affiliate ID. Every outbound click today monetises at £0. The "booking-aggregator" wedge currently generates exactly the same revenue as a hyperlink.
- **The "BD pipeline" is a spreadsheet with no UI.** `partner_prospects` is written by the ingest script and locked by RLS, but there is **no admin screen to read or progress it** — the only admin route, `/admin/candidates`, queries `pending_candidates` (the scout table), not prospects. So `bd_status` (`prospect|contacted|partnered…`) can only be changed by raw SQL. There is no evidence a single venue has been contacted. "Partner-BD wedge" is, today, a `text` column with a default of `'prospect'`.
- **The candidate scout — the second "moat" — is entirely stubbed.** All six adapters in `scripts/candidate-sources/` (`timeout.ts`, `eater.ts`, `infatuation.ts`, `hot-dinners.ts`, `hardens.ts`, `square-mile.ts`) `return []` with TODO docstrings. The `/admin/candidates` queue renders an empty state admitting "The scout is currently scaffold-only." The multi-source editorial-validation moat exists only in the discovery-robot path, not the publication-scout path that was pitched.

**Missing**

- **Every metric an investor will ask for.** The recon pack confirms analytics is **pageviews-only** (`<Analytics/>` in layout.tsx); there is **zero** event instrumentation for saves, reserves, swipes, plan generation, or outbound booking clicks. You cannot report activation, retention (D1/D7/D30), outbound CTR, click→book conversion, or partner conversion — because none are measured. There is also **no user base**: STATE.md:20-25 shows Google sign-in was never finished (0 google-provider users) and magic-link is rate-limited to ~3-4 emails/hour on Supabase's built-in SMTP (STATE.md:346). The funnel is unmeasured *and* the top of it is throttled.
- **Booking conversion is unprovable and probably unattributable.** Because Fun London deep-links *out*, even with affiliate tags the attribution depends entirely on the downstream network's cookie window. There is no first-party "did you book?" data feeding a conversion number an investor would trust at scale (the self-logged booking from Epic H is honest but self-reported and tiny).
- **Editorial differentiation is templated, not "brat."** STATE.md:266-268 and the recon pack confirm auto-published venues get **template-generated** `vibe`/`long_description`/`critical_flags` to survive Gemini's free tier. The "distinctive editorial voice" that's meant to justify a consumer subscription is, for robot-added venues, formulaic.
- **No SEO surface at all** for a public discovery product on a real domain: no OG/Twitter/JSON-LD, no `generateMetadata` on venue/event pages, `/sitemap.xml` and `/robots.txt` both 404 live. For a discovery business whose cheapest acquisition channel is organic search, this is a strategic, not cosmetic, gap.

**Confusing/weak**

- **Catalogue scale undercuts every claim.** 39 venues (STATE.md:238), 10 of them hand-curated day-spots that are explicitly `skipProspect:true`, leaving **19** in the BD pipeline. The events tab is structurally thin — `project_business_model.md:134-150` admits most of the catalog never sells tickets, so the Ticketmaster integration (17 events, one subscription) will always be a side widget, not a reason to open the app. An investor will read "39 venues, 0 users" as a prototype, not a company.
- **The narrative is muddled across three monetisation paths with no chosen wedge.** `project_business_model.md:98-101` itself says "the first 12 months want a single focus" but no focus is chosen. Pitching consumer freemium + partner SaaS + affiliate simultaneously reads as indecision. The honest math is brutal: ~£0.75/jazz ticket, £0.50-2/cover, and even ~30 partners at £50/mo ≈ £1,500/mo (`project_business_model.md:127-129`) — that's a burrito budget, not a venture outcome. The memo even names the graveyard (Foursquare, Yelp freemium failed; Eater/Infatuation stayed ad-supported, never paid-sub).
- **Defensibility vs incumbents is thin where it's pitched and real where it isn't.** Against Time Out / DesignMyNight / OpenTable / Resy / Google Maps, the *curation* is replicable (anyone can filter Google Places by rating). The *only* durable differentiators are (a) the autonomous-curation cost structure and (b) the "acquire un-platformed independents as booking partners" insight — and the second is 0% executed. As built, it is "a better-curated Google Maps," which is exactly the criticism flagged in `project_business_model.md:122`.

**Risky**

- **Single-key-person, single-point dependencies.** Admin gating is a hardcoded personal Gmail in `lib/auth.ts:32`. The whole operation is one founder; there is no team, no co-founder, no diligence-grade ownership structure visible.
- **Free-tier ceilings are the actual growth governor.** Gemini's *daily* free cap throttles discovery (STATE.md:271-275); Supabase SMTP throttles signups. The business literally cannot scale acquisition or supply without spend that hasn't started — which is fine pre-funding, but means every "autonomous/auto-growing" claim has an invisible asterisk.
- **Platform-dependency risk on supply.** Curation, photos, ratings, and chain-detection all depend on Google Places ToS (photos still carry an inline API key per STATE.md:517-519). A ToS change or pricing change hits the core engine.

**Recommendations**

1. **Instrument the funnel before the demo.** Add event tracking for save / reserve-click / plan-generate (the recon pack confirms none exist). Even 50 beta users with a measured outbound-CTR is infinitely more fundable than 39 venues with no users. This is the single highest-leverage thing.
2. **Ship affiliate tagging — it's a 2-3h job per platform (`project_business_model.md:60`) and converts the entire thesis from theoretical to live.** Even with no users, being able to say "every reserve click is monetised, here's the tag layer" closes an obvious diligence hole. Start with OpenTable (catalog is restaurant-heavy).
3. **Build a partner_prospects admin view and actually contact 5 venues.** Proof of *one* signed partner (or even one "in_conversation") would validate the wedge that is genuinely differentiated. A pipeline table no human can read is not a pipeline.
4. **Pick ONE wedge for 12 months and write a single-number thesis ("works if X by month N").** The memo asks for this and never delivers it. Investors fund a sharp wrong number over three vague right ones.
5. **Lead the pitch with the autonomous curation engine + the un-platformed-independents insight, and be explicit that everything else is roadmap.** The honesty UX is an asset — extend it to the pitch. Do not present templated editorial as "distinctive voice," stubbed scouts as "moat," or a 19-row table as a "BD pipeline."

---

### 9. QA / Testing Agent

**Working well**

The team has been unusually disciplined about *not* faking things, which is the right instinct for a booking product. `lib/booking-link.ts:1-11` and `app/venue/[slug]/venue-detail.tsx:92-98` explicitly refuse to surface "tables free / next slot / X-min walk" because there is no live-availability feed — a comment even states "a booking product can't afford fake signals". The Reserve flow is honest: `venue-detail.tsx:81-85` branches deep-link → `tel:` → "via the venue" → "no booking needed". `lib/plan-engine.ts:59-76` `isOpenAt` deliberately fails *open* when hours are missing so plans don't empty out before the backfill cron runs, and `pick`/`pickAny` (`plan-engine.ts:219-248`) have graceful widening (`computePlan` pool ladder at 256-262). Empty states exist for Explore (`explore-feed.tsx:195-198`), Saved (`saved-list.tsx:89-99`) and Events (`events-feed.tsx:225-231`). A branded 404 exists (`app/not-found.tsx`). Forms guard double-submit (`edit-form.tsx:64`, `plan-flow.tsx:139`, `sign-in-form.tsx`) and disable inputs while loading. The OAuth callback handles provider-side failures without a `code` (`auth/callback/route.ts:30-40`). `bottom-nav` and detail pages carry `aria-label`s.

**Not working**

The single most damaging issue: the post-handoff flow *manufactures a fake confirmed booking with a fake reference number*. `app/booking/[slug]/confirmed/did-you-book.tsx:56-72` builds `ref = ${SLUG}-${random 1000-9999}`, writes `status: "confirmed"`, and the success screen reads "You're in. 🎉" (line 142). That ref is then rendered in Saved → "Coming up" as **"Ref {b.id}"** (`saved-list.tsx:63-65`). Fun London never made a reservation and has no idea whether the user actually did — the ref is pure `Math.random()`. A user who clicks "Yes — add it to my plans" out of optimism (or by reflex) now has a fabricated confirmation code sitting in their plans. If they show up at the venue quoting "Ref OTT-4821", there is no such booking. This is a trust-and-liability problem, not a cosmetic one. The honesty of the rest of the codebase makes this inconsistency worse, not better.

`computePlan` can return a `Plan` with **zero steps** (if `venues` is empty, the `chosen` array is empty → `plan-flow.tsx:340` renders a header "Chill Night in undefined" over an empty list). `plan-flow.tsx:92` sets `area` to `areas[0] ?? ""`, and `toDisplay` produces `"... Night in "` with a trailing blank (`plan-flow.tsx:65`). There is no "couldn't build a plan" guard on the single-user Plan My Night path (the group path *does* have `unfilledRoles`, `result.tsx:240-246` — the solo path does not).

**Missing**

No `error.tsx` / `global-error.tsx` anywhere (confirmed: `find app -name error.tsx` → empty). `lib/queries.ts` throws plain `Error`s on Supabase failure; on `/venue/[slug]`, `/event/[id]`, `/booking/...`, `/sign-in` and the auth group there is **no** error boundary (the client `ErrorBoundary` only wraps `(main)`, `app/(main)/layout.tsx:17-19`). A Supabase outage or a transient query failure on a venue detail page therefore drops the user to Next's raw default error screen. There are **zero automated tests** and no test tooling — every flow above is unverified by anything but manual clicking. No analytics on save/reserve/plan/swipe, so you cannot even detect these failures in production after the fact.

**Confusing/weak**

Magic-link has no client-side cooldown; Supabase enforces ~3-4 sends/hour and returns a 429, which surfaces raw as `error.message` (`sign-in-form.tsx:75-78, 167-169`) — a user re-requesting a link will hit a cryptic rate-limit string with no "wait a bit" guidance. The Plan Together participants/presence are real (Supabase Realtime) but **ephemeral with no DB persistence** (`lib/realtime/room.ts` — Broadcast has no replay; host re-broadcasts on join); if the host's tab closes mid-session, late joiners may never converge and there is no recovery UI. Room codes are 4 chars from a reduced alphabet → collision and guess risk for a public URL with no auth. The empty-deck risk: Morning/Afternoon decks (`plan-together-moods.ts:38-121`) lean on `Outdoors`/`Culture`/`Market` venue types; if the live catalog (auto-discovery is night/food-biased) has none of those open at the meeting time, `heartedMoods` can still pass but `computeWalkablePlan` returns `unfilledRoles`, and `roles` falls back to `["Start"]` (`result.tsx:65-69`) — a one-stop "group night", which is a weak payoff after everyone swiped.

**Risky**

`did-you-book.tsx:52` does `new Date(\`${date}T${time}:00\`)` with no validation — a malformed `?d=`/`?t=` query param yields `Invalid Date`, then `.toISOString()` throws (`did-you-book.tsx:64`) inside the click handler, an uncaught error on a route with **no** error boundary. `booking/[slug]/confirmed/page.tsx:25` coerces party with `Number(...) || 2` (safe) but date/time are passed through unchecked. The admin allowlist defaults to a hardcoded personal Gmail (`lib/auth.ts:32`) — a deploy that forgets `FL_ADMIN_EMAILS` grants `/admin/*` to that one address regardless of intent. Production is fully public and uncached with no SEO surface and pageview-only analytics, so a regression here is invisible until a user complains.

**Recommendations**

1. Stop calling the random ref a "Ref" and stop labelling unverified entries "confirmed" — relabel to "You're planning to go" / "self-added", drop the fake code or clearly mark it "your note, not a booking confirmation" (P0). 2. Add `app/error.tsx` + `app/global-error.tsx` and wrap booking/venue/event routes (P0). 3. Guard zero-step plans in `plan-flow.tsx` and validate booking query params in `did-you-book.tsx` (P1). 4. Catch the magic-link 429 and show a friendly cooldown message (P1). 5. Introduce a test runner (Vitest) and write the first specs against the pure, high-value engines — `plan-engine.ts`, `booking-link.ts`, `ranking.ts`, `opening-hours.ts` — before touching UI (P1).

---

### 10. Performance / SEO / Accessibility Agent

## Performance, SEO & Accessibility audit — Fun London

**Working well**

- Image discipline is genuinely good: zero raw `<img>` tags; everything uses `next/image` across the nine image-bearing components (`components/venue-card.tsx:53`, `components/event-card.tsx:31`, `app/venue/[slug]/venue-detail.tsx:108`, etc.). Sensible `sizes` hints are supplied (`venue-card.tsx:57-59`), and the `unoptimized` bypass for Google Places photo URLs (`venue-card.tsx:63`, `venue-detail.tsx:116`) is the correct call given those URLs 302-redirect with a per-request API key and would otherwise burn the optimizer quota on non-cacheable proxies.
- Server-first architecture is sound: data pages are Server Components (`app/(main)/explore/page.tsx`, `app/venue/[slug]/page.tsx:13`) that `Promise.all` their fetches and hand plain data to thin client islands. Shared JS is a reasonable 87.2 kB.
- Fonts are loaded via `next/font/google` with `display: "swap"` (`app/layout.tsx:11-17`), self-hosted and preloaded automatically — no render-blocking external font request and no FOIT.
- Focus rings are theme-aware and use `:focus-visible` so they only appear for keyboard users (`app/globals.css:54-58`) — correct, modern behaviour.
- `prefers-reduced-motion` IS handled globally for CSS animations (`globals.css:107-116`), zeroing the page-transition and stagger durations. The reduced-motion comment in `components/page-transition.tsx:10` is accurate.
- Hero/LCP images carry `priority` (`venue-detail.tsx:112`, `event-detail.tsx`), and alt text is present and meaningful on all content images (venue/event name), with the decorative search-overlay thumbnail correctly set to `alt=""` (`search-overlay.tsx:189`). Card link wrappers and the heart button have `aria-label`s (`venue-card.tsx:46,96`).

**Not working**

- **Pinch-zoom is disabled.** `app/layout.tsx:28` sets `maximumScale: 1`. This is a direct WCAG 2.1 SC 1.4.4 (Resize Text) failure and a mobile-usability red flag — low-vision users physically cannot zoom the page. There is no justification in the code for it; it should simply be removed (or set to a value ≥5).
- **The 2 MB splash logo is shipped to every cold open.** `app/splash-client.tsx:64-70` renders `/logo-fun.png` with `priority`. That file is `2,089,385 bytes` (1536×1024 PNG — verified via `file public/logo-fun.png`). It is the very first paint and is marked `priority`, so it is the de-facto LCP element and it weighs 2 MB. On a 4G connection that is multiple seconds of transfer for a brand mark that displays at 240×160. This is the single biggest measured performance defect in the app.
- **The splash imposes an unconditional 1.7 s blocking hold before any real content.** `app/splash-client.tsx:21,33` (`TOTAL_DURATION_MS = 1700`) `setTimeout`s before `router.replace`. Per the docstring in `app/page.tsx:16-17` this fires on **every** visit to `/`, including already-onboarded returning users. That is 1.7 s of forced latency-to-content on top of the 2 MB logo download — together they inflate perceived load and real LCP/TTI dramatically. The page is also `force-dynamic` (`app/page.tsx:25`) so it can never be edge-cached.

**Missing**

- **No SEO surface whatsoever** (confirmed by recon and by grep). For a *public discovery product* live at funldn.com this is the most commercially damaging gap:
  - No `generateMetadata` on `/venue/[slug]` (`app/venue/[slug]/page.tsx` ships nothing) or `/event/[id]`. Every venue and event page shares the single global `<title>Fun London</title>` / generic description from `app/layout.tsx:19-23`. Google cannot differentiate the pages; they are effectively invisible/duplicated in search.
  - No Open Graph / Twitter card tags anywhere — every shared link (and the app has a Share button, `venue-detail.tsx:55-65`) renders as a bare URL on WhatsApp/iMessage/Slack with no image, title or description. This actively suppresses the viral sharing loop the product depends on.
  - No JSON-LD structured data. A venue catalogue is the textbook case for `LocalBusiness`/`Restaurant` + `Event` schema.org markup, which drives rich results. None present.
  - No `app/sitemap.ts` and no `app/robots.ts` — `/sitemap.xml` and `/robots.txt` both return HTTP 404 (verified live). Search engines have no crawl map for a dynamic, uncached catalogue.
- **No `error.tsx` / `global-error.tsx`.** `lib/queries.ts` throws on any Supabase failure, and there is no App Router error boundary on the auth, venue-detail, event-detail or booking routes (the client `ErrorBoundary` only wraps `app/(main)/layout.tsx:17`). A transient DB error on a venue page = Next's raw default error screen. This is a reliability/UX gap, not strictly perf, but it interacts with Core Web Vitals (error pages tank engagement metrics).
- **No analytics instrumentation beyond pageviews** (`<Analytics />`, `app/layout.tsx:69`). No measurement of LCP/CLS in the field beyond Vercel's defaults and zero funnel events, so you cannot actually *observe* the performance/UX regressions above on real users.

**Confusing/weak**

- **`ThemeProvider` runs `setInterval(apply, 60_000)` forever** (`components/theme-provider.tsx:13`). It wakes every 60 s for the entire session purely to flip a `data-theme` attribute at the 06:00/18:00 boundary. It is cheap per tick but it is a permanently-running timer that prevents the tab from fully idling and is wasteful — a single `setTimeout` scheduled to the next boundary would do the same job with ~1 wake per session instead of ~1 per minute.
- **Theme is wall-clock based, decoupled from OS preference.** The `themeColor` chrome tint follows `prefers-color-scheme` (`layout.tsx:35-38`) but the in-app body theme follows the clock (`theme-provider.tsx:8`). The layout comment (29-34) acknowledges they can diverge. The result: a user in a dark room at 14:00 gets a light app with a dark status bar (or vice-versa) — visually jarring and a contrast hazard. There is also a guaranteed flash: the theme is applied only after the client `useEffect` mounts, so first paint is always the `:root` (day) palette regardless of the actual time, then it may snap to night.
- **Splash hardcodes `background: "#000"`** (`splash-client.tsx:55`) while the manifest/themeColor backgrounds are cream `#f0eee9` / dark `#14110d` (`manifest.json`, `layout.tsx:36-37`). So the launch sequence is: themed background → black splash → themed app, i.e. a black flash that doesn't match the brand surface on either theme.
- **Maskable icon is wrong.** `manifest.json` declares `/apple-icon.png` as `purpose: "maskable"`, but it is the same full-bleed 1024×1024 square as the `any` icon. Maskable icons need ~20% safe-zone padding; as-is, Android will crop the logo edges when it applies a mask shape.

**Risky**

- **Colour contrast fails WCAG AA on the app's smallest, most-used text.** Computed ratios (sRGB, using the tokens in `globals.css`): `--fl-muted-fg` (#756c5d) on the cream `--fl-bg` (#f0eee9) = **4.46:1** — *below* the 4.5:1 AA threshold for normal text. This colour is applied to a large amount of `text-[10px]`/`text-[11px]` metadata: `venue-card.tsx:80` (10.5px), `event-card.tsx:52,57` (11px), `reserve-sheet.tsx:79,90` (10px), `saved-list.tsx:60`. Small text at sub-AA contrast is a real legibility problem, not a rounding nit.
- **`--fl-primary` purple as text fails badly on the night background.** primary (hsl 233 70% 55%) on `--fl-bg` night (#14110d) = **2.99:1** — well under AA. The primary colour is used as text in several places (e.g. `venue-detail.tsx:263`, `not-found.tsx:11`, admin eyebrows). On the night theme any primary-coloured text label is effectively illegible to low-vision users. (On day surfaces primary is fine: 5.4–6.3:1.)
- **`event-card.tsx` has no `unoptimized` guard** (contrast with `venue-card.tsx:63`). Event poster URLs come from `*.ticketm.net` / `images.universe.com` / Google (`next.config.js:11-24`). Routing every event thumbnail through Vercel's image optimizer will consume optimization quota and add origin-fetch latency for images that, like the venue photos, may not be worth optimizing. Inconsistent with the deliberate venue-card strategy.
- **The splash's 1.7 s timeout is not reduced-motion-aware.** The CSS keyframe is zeroed for reduced-motion users (`globals.css:107`), but the JS `setTimeout(1700)` in `splash-client.tsx:33` is not — so a user who has explicitly asked for no motion still waits the full 1.7 s staring at a black screen before being routed. The accessibility intent of the reduced-motion handling is undermined here.
- **Every route is `no-store`, fully dynamic.** Live headers show `cache-control: private, no-cache, no-store` on `/`, and the build marks nearly all routes `ƒ` (dynamic). The catalogue content (venues/events) is not user-specific and changes only ~every 4 h (the discovery cron), yet none of it is cached at the edge — so every visitor pays full server-render + DB-fetch latency on every navigation, and there is no ISR. This is a self-inflicted TTFB/CWV penalty.

**Recommendations** (ordered by impact-per-effort)

1. **Remove `maximumScale: 1`** (`layout.tsx:28`) — one-line WCAG fix.
2. **Compress/replace the 2 MB splash logo.** Re-export `/logo-fun.png` as a tightly-cropped WebP/optimised PNG at ~2× display size (≈480×320). Should drop from 2 MB to <30 kB and directly improve LCP.
3. **Add SEO surface:** `generateMetadata` on `/venue/[slug]` and `/event/[id]` (title, description, OG image using the venue/event photo), plus `app/sitemap.ts`, `app/robots.ts`, and `LocalBusiness`/`Event` JSON-LD. Highest commercial leverage for a discovery product.
4. **Make the splash conditional and reduced-motion-aware:** skip (or sharply shorten) it for already-onboarded returning users, and zero the 1.7 s timeout under `prefers-reduced-motion`. Match its background to the theme surface, not `#000`.
5. **Fix contrast:** darken `--fl-muted-fg` (day) to clear 4.5:1 and stop using `--fl-primary` as text on the night background (use `--fl-fg`/`--fl-heading` or lighten primary for night).
6. **Add `unoptimized` (or `loading="lazy"` + same Google guard) to `event-card.tsx`** to match the venue strategy.
7. **Replace the 60 s `setInterval` theme poll** with a single boundary-scheduled `setTimeout`, and set the initial `data-theme` before hydration (inline script in `<head>`) to kill the day→night first-paint flash.
8. **Add `error.tsx` at the root** (and ideally per detail route) so thrown query errors degrade gracefully and don't wreck engagement metrics.
9. **Introduce ISR/edge caching** for the venue/event catalogue (e.g. `revalidate` aligned to the 4 h discovery cron) instead of `no-store` everywhere.
10. **Pad the maskable icon** with a ~20% safe zone.

---

### 11. Security / Privacy / Legal Agent

## Security, Privacy & Legal Review — Fun London

**Working well**

The fundamentals of the Supabase auth layer are sound and, in places, better than most pre-seed products. RLS is enabled on every user-scoped table and the policies are correct and tight: `profiles`, `saved_venues`, `bookings`, `plans` all gate by `(select auth.uid()) = user_id` (`supabase/schema.sql:178-228`), and the `(select auth.uid())` wrapping is the documented InitPlan optimisation — someone read the Supabase hardening docs. `venues`/`events` are deliberately `using (true)` public-read, which is correct for a catalogue. The `handle_new_user()` SECURITY DEFINER trigger is properly locked down: `set search_path = public` defeats search-path hijacking and `revoke execute ... from public` closes the RPC surface while leaving the trigger functional (`schema.sql:233-256`) — this is exactly right and frequently got wrong. The service-role key is genuinely isolated: a repo-wide grep for `SERVICE_ROLE`/`service_role` in `app/ lib/ components/` returns nothing; it lives only in offline `scripts/*` run by GitHub Actions. `.env.local` is confirmed not git-tracked (`.gitignore:12-15`), and no literal API keys are committed. Admin server actions re-check authorisation server-side on every mutation via `getAdminUser()` (`app/admin/candidates/actions.ts:23-27`) rather than trusting the page-level gate — defence in depth. The magic-link/OAuth flow uses `exchangeCodeForSession` (PKCE), forces `prompt: "select_account"` for shared-device safety (`sign-in-form.tsx:42`), and the callback derives `origin` from the request rather than trusting client input for the host portion (`callback/route.ts:22`).

**Not working**

The single worst issue is the live Google Places API key shipped to every browser. `scripts/ingest-venues.ts:211-219`, `scripts/discover-venues.ts:306-307` and `scripts/refresh-venues.ts:112-113` all build `img_url` as `https://places.googleapis.com/v1/{photo}/media?key=${GOOGLE_PLACES_API_KEY}&maxWidthPx=1600` and **persist that string into `public.venues.img_url`**. That column is public-read by RLS (`schema.sql:202`) and rendered into the DOM `src` of every `next/image` on `/explore`, `/saved`, `/venue/[slug]` etc. (`venue-card.tsx:54,63`). The key is therefore in the page source of a publicly-reachable production site (www.funldn.com returns HTTP 200, no SSO wall). The in-code justification (`ingest-venues.ts:212-218`) claims the key "is restricted to Places API only … can't be abused for anything beyond Places lookups" — but Places API calls cost money, an unrestricted-by-referrer key can be drained by anyone who scrapes one venue card, and there is no evidence in the repo that an HTTP-referrer restriction is set (it cannot be, because the key is used server-side from GitHub Actions where referrer restriction would break it). This is a billing-DoS / quota-exhaustion exposure, not merely cosmetic. STATE.md "pending #8" already flagged it; it is still live.

**Missing**

There is **no privacy policy, no terms of service, no cookie policy** anywhere — `find app -iname "*privacy*" -o -iname "*terms*" -o -iname "*cookie*"` returns nothing. For a UK-targeted product collecting email addresses, Google profile names, saved venues, bookings and (per `schema.sql:17`) freeform preference data, a privacy notice is a hard legal requirement under UK GDPR Art. 13/14 — its absence is a compliance failure, not a nice-to-have. There is **no cookie/consent banner** while `@vercel/analytics` `<Analytics />` is mounted unconditionally at `app/layout.tsx:69` and runs for all visitors including UK/EU before any consent. Vercel Analytics is cookieless by default, which softens but does not eliminate PECR (Privacy and Electronic Communications Regulations) exposure — UK PECR requires consent for non-essential storage/processing, and the ICO treats analytics as non-essential. There is no data-subject-rights surface (no account deletion, no data export) despite `on delete cascade` FKs existing in the schema that would make deletion trivial to wire up. There is no `pending_candidates` table definition or RLS policy in tracked `supabase/schema.sql` at all — the admin page queries it via the anon-key client (`app/admin/candidates/page.tsx:37-46`), so if RLS was not manually enabled on that table in the live Supabase dashboard, scouted-venue candidate data (including source URLs) is anon-readable. This is unverifiable from the repo, which is itself the problem: the table is created out-of-band, outside the auditable schema.

**Confusing/weak**

The admin allowlist defaults to a hardcoded personal Gmail, `mp.aranzales@gmail.com` (`lib/auth.ts:32`). It is overridable by `FL_ADMIN_EMAILS`, but if that env var is ever unset/typo'd in production, admin access silently falls back to one specific personal account — and the address is now committed to git history forever. Email-string allowlisting is also brittle: it trusts `user.email` from the Supabase session, which is fine, but there is no DB role table, so revoking admin requires a redeploy/env change rather than a data change. The `return` redirect parameter is unvalidated end-to-end: `sign-in/page.tsx:33` does `redirect(searchParams.return ?? "/explore")` and `callback/route.ts:24,47` does `NextResponse.redirect(\`${origin}${returnTo}\`)`. A crafted `?return=//evil.com` (or `/\evil.com`) can produce a protocol-relative redirect after sign-in — a classic open-redirect that is also a phishing vector through the OAuth `redirectTo` chain (`sign-in-form.tsx:33-34,61-62`). No allowlist or `startsWith("/")` + reject-`//` guard exists anywhere.

**Risky**

No rate-limiting or abuse protection on `signInWithOtp` (`sign-in-form.tsx:67`) — the magic-link endpoint can be used to mail-bomb arbitrary addresses (each submission sends a real email via Supabase). Supabase has built-in rate limits, but there is no app-side throttle or captcha, and the form has no client-side cooldown. The auth-optional middleware (`middleware.ts` → `lib/supabase/middleware.ts:34`) calls `auth.getUser()` on every matched request purely to refresh cookies but performs no gating; combined with `force-dynamic` everywhere and `cache-control: no-store`, every request is a full dynamic render — not a security hole but it removes any edge-cache shield against traffic floods. There is no `error.tsx`/`global-error.tsx` (per recon), so an unhandled Supabase error on a detail or booking route surfaces Next's default error screen, which in some misconfigurations can leak stack frames; the only error boundary covers `(main)` (`app/(main)/layout.tsx`), leaving the booking flow and auth pages uncovered.

**Recommendations**

In priority order: (1) Stop shipping the Places key — download photos in the ingestion scripts and re-upload to Supabase Storage (the code comment at `ingest-venues.ts:217` already names this as the fix), then rotate the leaked key in Google Cloud. As an interim, set an HTTP-referrer restriction is NOT possible given server-side use, so a tight per-key quota cap + API restriction to Places-only is the minimum stop-gap while storage migration lands. (2) Add `/privacy`, `/terms`, `/cookies` pages and a consent banner before any further UK marketing — this is a legal blocker. (3) Validate the `return` param with a `startsWith("/") && !startsWith("//")` guard in both `sign-in/page.tsx` and `callback/route.ts`. (4) Move the `pending_candidates` table into tracked `schema.sql` with an explicit RLS policy and verify RLS is on in production via the Supabase advisor. (5) Remove the hardcoded Gmail default in `lib/auth.ts:32` — fail closed (empty allowlist) if `FL_ADMIN_EMAILS` is unset. (6) Wire account-deletion + data-export for GDPR data-subject rights (cheap given cascade FKs). (7) Add `app/global-error.tsx`.

---

### 12. Opportunity Agent

Fun London has quietly built two genuine moats that most "discovery app" competitors never get: (1) an **autonomous, free content engine** (`scripts/discover-venues.ts`) that hunts, chain-filters by location count, validates against ≥2 trusted publications via Gemini grounding, and auto-publishes — growing the catalogue 19→39 without a human; and (2) a **partner BD overlay** (`public.partner_prospects`, schema.sql:151-172) that — uniquely — captures every curated indie that has *no* major booking platform, i.e. the exact venues where Fun London can both add booking value and earn a relationship. On top of that sits real multiplayer (`lib/realtime/room.ts`) and a mood-deck planner (`lib/plan-together-moods.ts` + `computeWalkablePlan` in `lib/plan-engine.ts`). The strategic question is not "what features to add" — it is "what compounds these two moats into a data advantage no competitor can copy." The single biggest gap is that the app is currently **a one-way street**: it surfaces venues but captures almost nothing back. No analytics on saves/reserves/plans (recon pack confirms only Vercel pageviews), no user reviews/UGC, no notifications, no plan persistence wired through, and the rich `partner_prospects` table is write-only with no internal dashboard to action it. Below, British English, brutally honest.

**Working well**
- The autonomous discovery engine is the crown jewel and it is *real*, not stubbed: full pipeline from Google Places grid (discover-venues.ts:557-702), brand-normalised chain detection (brandKey, discover-venues.ts:280-304), ≥2-source Gemini validation (validateSources, discover-venues.ts:373-405), free-tier pacing/backoff (geminiFetch, :327-356). This is a defensible content flywheel.
- The `partner_prospects` BD table is a genuinely clever asset: it stores *why_qualified* + *current_booking_method* + *bd_status* lifecycle (schema.sql:151-172) — a ready-made sales CRM for the exact venues that need Fun London most. All 39 venues are dual-written here (ingest-venues.ts:356).
- Real multiplayer is honestly built (Presence + Broadcast, no fake participants) with thoughtful late-join reconvergence (room.ts:164-189) — a rare, shareable, viral-by-design surface.
- The walkable plan engine is sophisticated: proximity-first greedy clustering with radius ladder, multi-seed selection, per-step swap alternatives, opening-hours awareness (plan-engine.ts:410-555).
- The booking model is honest — deep-links out, then a "Did you book?" producer logs only real bookings (did-you-book.tsx) — no phantom rows.

**Not working / under-exploited**
- **Zero product analytics on the conversion funnel** (recon pack: only `<Analytics/>` pageviews). Saves, reserve-clicks, plan generations, swipe outcomes, room joins are *not* instrumented. This is the single highest-leverage gap: without it, none of the data-moat opportunities below can be measured, and affiliate revenue can't be attributed. Every `toggleSaved`, every Reserve deep-link, every `computeWalkablePlan` is signal being thrown away.
- **The booking deep-links carry no affiliate/attribution params.** `buildReserveUrl` (booking-link.ts:17-47) appends only date/time/party — no `ref`/affiliate ID for OpenTable/Resy/TheFork. The business model memo names affiliate as a revenue path, but the code leaks every click for free.
- **`partner_prospects` is write-only.** There is no `/admin/prospects` view (only `/admin/candidates` exists). Maria's entire BD pipeline lives in a table no UI reads. The moat is captured but un-actioned.
- **Plan persistence is half-wired.** `plan-flow.tsx:142` inserts into `public.plans`, but there's no `fetchPlans()` in `lib/queries.ts` (confirmed: grep shows only the insert) — saved plans can be written but never re-surfaced. A saved plan a user can't reopen is a dead feature.
- **No re-engagement loop.** Profile shows a "Notification prefs" row (profile-body.tsx:105) that is decorative — there is no push/notification system at all (grep confirms). A discovery app with no "this event near a venue you saved is tonight" notification has no reason to be reopened.

**Missing**
- **User-generated signal of any kind.** No reviews, no "I went / would return," no photo upload, no save-count display. The catalogue is critic-validated (great for trust) but captures zero first-party taste data — which is the only data Google/Time Out *can't* replicate and the only thing that makes "For You" defensible long-term. `ranking.ts` is keyword-matching with no behavioural input.
- **The discovery engine writes editorial that is templated, not voiced** (templateEditorial, discover-venues.ts:442-478 — explicitly "not the full brat voice"). The brand thesis is "brat editorial," yet auto-published venues get formulaic blurbs. A cheap async "voice pass" (paid Gemini Flash, batched overnight) would make every auto-published venue feel hand-written — compounding the content moat into a *brand* moat.
- **No venue→events join surface.** Schema has the index (`events_venue_starts_idx`, schema.sql:107) and 17 live Ticketmaster events, but `/venue/[slug]` never shows "what's on here." This is free cross-sell sitting unused.
- **No SEO surface whatsoever** (recon: no OG/JSON-LD/sitemap/robots). A publicly-indexed discovery product with 39 critic-validated venue pages and per-venue editorial is leaving organic acquisition — the cheapest growth channel — completely on the table. Each venue page *is* SEO gold (editorial + sources + structured Restaurant data) and ships with `<title>Fun London</title>` only.
- **No "claim your venue" / partner self-serve loop.** `partner_prospects` identifies targets, but there's no inbound path for a venue owner to claim a page, correct info, or push an offer — which would turn the BD pipeline from outbound-only into a two-sided network.

**Confusing / weak**
- `fetchNeighbourhoods()` exists and is documented as "used by no page" (queries.ts:220-223) — a half-built "Areas you love" preference that signals intent but isn't wired. Either finish it (areas are a strong personalisation axis at 39 venues) or cut it.
- The mood decks (`plan-together-moods.ts`) are hand-authored static data while the catalogue is now type-diverse and auto-growing. Morning/Afternoon decks are documented as "thin" (STATE.md:84) — the planner gracefully degrades, but the multiplayer "wow" moment depends on dense walkable clusters that only exist at night in central areas.
- `lib/config.ts` is a single `CITY = "London"` constant framed as the "swap-point for another city" — but the entire discovery grid (NEIGHBOURHOODS, discover-venues.ts:82-99) and regions are London-hardcoded. The multi-city ambition is aspirational, not architected.

**Risky**
- **Free-tier Gemini is the throughput ceiling on the core moat.** STATE.md:274-275 is explicit: the daily cap is the real limit; per-run target was cut 10→3. The content flywheel that *is* the moat is throttled to a trickle by a cost decision deferred "until launch." If a competitor spends £20/mo on paid Flash they out-discover Fun London 6×. This is the moat's single point of fragility.
- **Discovery quality is unaudited at scale.** There's an `/admin/candidates` review queue but the *autonomous* `discover-venues.ts` path auto-publishes with no human gate and no post-publish quality dashboard. One bad Gemini hallucination (a wrong source URL, a mislabelled chain) ships straight to production. The "2 sources" gate is strong but Gemini grounding can fabricate URLs (the code only checks `url.startsWith("http")`, discover-venues.ts:399).
- **Realtime rooms have no persistence and no abuse controls** (room.ts: 4-char codes, no rate-limit, no room TTL). Fine for a demo; a shared public link with a 4-char space (room.ts:117) is trivially enumerable and a griefing vector once it has users.

**Recommendations (sequenced bets that compound the moats)**
1. **Instrument the funnel first (P0, XS).** Add a tiny `track()` wrapper (Vercel Analytics custom events or a `public.events_log` table) on save, reserve-click, plan-generate, room-join. Nothing else on this list is measurable or monetisable without it. This is the foundation of the *behavioural* data moat.
2. **Add affiliate attribution to booking deep-links (P0, S).** Extend `buildReserveUrl` (booking-link.ts) with per-platform affiliate/ref params. Turns existing reserve traffic into revenue with zero new UX. Pair with click logging from bet 1.
3. **Pay for Gemini Flash and unthrottle discovery (P1, XS — a billing toggle + raise TARGET).** The cheapest, highest-leverage move to widen the content moat. Cents/month per STATE.md:275. Then layer an overnight "brat voice" pass over templated editorial to compound content→brand.
4. **Ship the `/admin/prospects` BD cockpit (P1, M).** Surface `partner_prospects` with bd_status kanban, notes, and one-click "draft outreach." Activates a captured-but-dormant moat; turns the discovery robot into a sales-lead generator.
5. **Finish plan persistence + add re-engagement notifications (P1, M then L).** Wire `fetchPlans()` and surface saved plans; then "an event you'd love is on near {saved venue} this weekend" push — the loop that earns repeat opens, fed by bets 1's behavioural data.
6. **SEO the venue pages (P1, M).** `generateMetadata` + JSON-LD Restaurant/Event + sitemap. 39 critic-validated editorial pages is a free organic-acquisition engine that grows automatically as the robot publishes.
7. **Add lightweight first-party signal (P2, M):** a single "would you go back?" tap on saved/booked venues, feeding `ranking.ts`. The only data Time Out and Google cannot copy, and the foundation for a true taste graph.


---

# Part 2 — Master product-development plan

## A. Executive diagnosis

**What the app currently is.** Fun London is a polished, server-first Next.js 14 mobile web app that surfaces a small, hand-and-robot-curated catalogue of independent London venues plus a thin feed of Ticketmaster events. It lets a user browse, filter, save, "plan a night" (solo or in a real-time multiplayer room), and deep-link out to a venue's own booking platform. It is built to an unusually honest standard for a prototype: it deliberately refuses to fake live availability, and the reserve flow degrades gracefully across deep-link / call / walk-in states.

**What it is trying to be.** A discovery + booking-aggregator "agent" for *curated independents only* — no chains, every venue verifiable in 2+ editorial sources, with a distinctive "brat" editorial voice and a "Real Talk" honesty layer — monetised through a mix of affiliate booking commissions, partner subscriptions for un-platformed independents, and consumer freemium. Underneath sits a genuinely novel supply engine: an autonomous, free discovery robot and a partner-BD overlay table that auto-logs every curated indie as an acquisition target.

**What is strongest.** Two things an investor would actually respect: (1) the **autonomous discovery robot** (`scripts/discover-venues.ts`) — a real, running, near-zero-cost curation flywheel with a genuinely clever chain-detection-by-location-count heuristic and ≥2-source Gemini validation; and (2) the **`partner_prospects` BD insight** — the venues hardest to integrate (no OpenTable/Resy lock-in) are precisely the easiest to acquire as partners. Engineering hygiene is also strong: clean build, strict TypeScript, disciplined RLS, sound server/client component split, and real intellectual honesty about not faking signals.

**What is weakest.** The product's single best differentiator — verifiable, anti-chain curation — is **invisible** until two taps deep behind a collapsed accordion. There is **no retention loop**, **no funnel analytics**, **no SEO surface**, and **no revenue infrastructure** (the affiliate thesis is 0% built — every outbound click monetises at £0). The catalogue is too thin and too geographically concentrated (east/south-east heavy) to sustain weekly use, and the autonomous robot now floods the live feed with **templated, generic editorial** that actively contradicts the "curated voice" promise.

**The biggest risk.** A trust-and-credibility cascade. The app builds honesty equity everywhere, then spends it in three places: a **fabricated "confirmed" booking with a fake reference number** (`did-you-book.tsx`), **personalisation theatre** ("✨ Sorted around your taste" over a near-trivial re-sort), and **dead buttons** in the profile. Layer on the **exposed Google Places API key** (a live billing-DoS exposure) and the **absent privacy/cookie/terms pages** (a UK GDPR/PECR compliance failure on a live UK product), and the risk is that the first serious user, journalist or investor finds the seams before the substance.

**The biggest opportunity.** Convert the two real moats — the autonomous content engine and the un-platformed-independents BD insight — into a *behavioural data advantage no competitor can copy*, by (a) instrumenting the funnel, (b) tagging booking links for affiliate revenue, (c) un-throttling the discovery robot (cents/month of paid Gemini Flash) and layering a real editorial voice pass, and (d) opening the SEO channel so 40+ critic-validated venue pages become a free, auto-growing organic-acquisition engine.

**Readiness verdict.**

| Dimension | Verdict | One-line reason |
|---|---|---|
| Demo-ready | **Almost** — with Phase 0 fixes | The happy path demos well; the fake booking ref, dead buttons and theme-flash will be noticed in a careful demo. |
| User-ready | **No** | No retention loop, thin catalogue, data-loss-without-warning for anon users, GDPR pages absent. |
| Investor-ready | **No** | Zero users, zero funnel metrics, zero revenue infrastructure — the three things diligence will ask for first. |
| Overall | **Advanced prototype** | Exceptional engineering substrate; pre-product on measurement, growth and monetisation. |

---

## B. Product map

Priority key: **P0** = fix before showing anyone · **P1** = MVP · **P2** = strong launch · **P3** = later.

### B.1 Landing / first impression
- **Files:** `app/page.tsx`, `app/splash-client.tsx`, `app/(auth)/onboarding/{page,onboarding-flow}.tsx`
- **Current:** Splash (1.7s forced hold, 2 MB logo) → onboarding 2-step mood/vibe quiz → `/explore`. Bare-domain visitors are forced through the quiz before seeing a single venue.
- **Missing:** any public, indexable landing page; any sentence stating what Fun London *is* or why it differs.
- **UX problems:** value proposition not legible in 5s; onboarding progress bar lies ("1/4", "2/4" for a 2-step flow); 1.7s blocking hold on *every* visit including returning users; not reduced-motion-aware.
- **Eng problems:** 2 MB PNG is the de-facto LCP element; `force-dynamic`, `no-store`, never edge-cached; theme applied only post-hydration → guaranteed day→night flash.
- **Priority:** **P0** (positioning + splash + onboarding count), **P1** (public landing page).

### B.2 Discovery (Explore feed)
- **Files:** `app/(main)/explore/{page,explore-feed}.tsx`, `components/{venue-card,event-card}.tsx`, `lib/ranking.ts`
- **Current:** server-fetched unified venue+event feed, 6 filter chips (For You / Eats / Bars / Cafés / Music / Events), greeting line, keyword-based "For You" scorer.
- **Missing:** real personalisation (onboarding collects 1 mood + 1 vibe; budget/areas hard-coded empty); save-for-events; "new this week" freshness surface; curated-vs-templated quality distinction.
- **UX problems:** "✨ Sorted around your taste" overclaims a trivial re-sort; chip labels ambiguous ("Eats" = Restaurant only, excludes cafés/markets); masthead renders flat blue text instead of the brand logo.
- **Eng problems:** `fetchVenues` selects `*` unbounded; no curation-tier flag so templated rows dilute curated ones.
- **Priority:** **P1** (personalisation honesty, chip clarity), **P2** (freshness surface, tiering).

### B.3 Search / filtering
- **Files:** `components/search-overlay.tsx`, filter logic in `explore-feed.tsx`, `events-feed.tsx`
- **Current:** instant client-side search over the in-memory catalogue with sensible match ranking and good empty-state copy.
- **Missing:** filters for area/price/open-now; search across events; no focus trap / return-focus on the overlay.
- **Priority:** **P2**.

### B.4 Event / content detail
- **Files:** `app/venue/[slug]/{page,venue-detail}.tsx`, `app/event/[id]/{page,event-detail}.tsx`
- **Current:** strong, honest venue detail — hero, "Real Talk" critical flags, collapsible "Why this is here" with clickable sources + creator coverage, honestly-branched Reserve CTA. Event detail names the real ticket provider and shows a real `.ics` add-to-calendar.
- **Missing:** per-page metadata / OG / JSON-LD (these pages are SEO gold and ship `<title>Fun London</title>` only); "what's on at this venue" cross-sell (index exists, surface doesn't); save-for-events.
- **UX problems:** "Real Talk" is rich for ~31 curated venues but two boilerplate flags for auto-discovered ones; no error boundary so a query error shows Next's raw screen.
- **Priority:** **P1** (SEO metadata, error boundary), **P2** (venue→events surface).

### B.5 Save / share / book / external link
- **Files:** `components/{saved-context,bookings-context,reserve-sheet,event-actions}.tsx`, `lib/{booking-link,share,ics}.ts`, `app/booking/[slug]/confirmed/{page,did-you-book}.tsx`, `app/(main)/saved/{page,saved-list}.tsx`
- **Current:** dual-mode (localStorage anon / DB authed) saves & bookings with one-time migration; real Web Share + clipboard fallback; honest deep-link reserve → manual "Did you book?".
- **Missing:** affiliate/attribution params on booking links (every click monetises at £0); save-for-events; remove-booking UI; share trigger at the post-booking moment; OG payload so shared links aren't blank.
- **UX problems / risks:** **fabricated "confirmed" booking + random "Ref" number** shown as a real reservation code; anon pre-seeded with 2 "saved" venues the user never chose *that don't render* (hidden demo slugs); fire-and-forget writes silently lose saves/bookings on failure; unvalidated booking query params can throw `.toISOString()` on a route with no error boundary.
- **Priority:** **P0** (fake ref/confirmed label, pre-seed bug), **P1** (affiliate tags, OG, write-failure handling).

### B.6 Plan My Night (solo + multiplayer)
- **Files:** `app/(main)/plan/{page,plan-flow,plan-together-card}.tsx`, `app/(main)/plan/together/*`, `lib/{plan-engine,plan-together-moods,regions,realtime/room}.ts`
- **Current:** genuine walkable recommender (proximity-first clustering, opening-hours aware, per-stop swap, reshuffle); real Supabase Realtime multiplayer (Presence + Broadcast) with mood-deck swipe.
- **Missing:** plan persistence is half-wired (`plans` insert exists, no `fetchPlans()` to re-open); group-only gating; recovery UI for host disconnect.
- **UX problems:** "Plan" vs "Plan Together" vs "For You" mental-model overlap unexplained; solo user can run the whole "group vote" alone (theatre); thin Morning/Afternoon decks degrade to a one-stop "group night"; zero-step plan possible ("Chill Night in undefined").
- **Eng problems / risks:** Broadcast has no replay/persistence → desync on disconnect; 4-char room codes are enumerable; CSS-background hero photos bypass `next/image`.
- **Priority:** **P1** (zero-step guard, plan re-open, solo-vs-group honesty), **P2** (persistence, room TTL/abuse).

### B.7 Account / login
- **Files:** `app/(auth)/sign-in/{page,sign-in-form}.tsx`, `app/(auth)/auth/callback/route.ts`, `lib/auth.ts`, `lib/supabase/*`, `middleware.ts`, `app/(main)/profile/*`
- **Current:** auth-optional; magic-link (PKCE) + Google OAuth (`select_account`); session-refresh middleware; server-checked profile.
- **Missing:** sign-in entry point / data-loss warning anywhere on the browsing surface for anon users; finished Google OAuth (0 google users); custom SMTP (magic-link throttled ~3–4/hr); account deletion / data export.
- **UX problems / risks:** three **dead buttons** in profile (Give Feedback, Notification prefs, Theme: Auto); raw 429 rate-limit string on repeat magic-link; **unvalidated `return` open-redirect** through sign-in + OAuth callback; admin allowlist defaults to a **hardcoded personal Gmail**.
- **Priority:** **P0** (dead buttons, open-redirect, admin default), **P1** (sign-in nudge, SMTP, Google OAuth).

### B.8 Admin / content management
- **Files:** `app/admin/candidates/{page,actions}.ts(x)`, `lib/auth.ts`
- **Current:** admin-gated candidate-review queue (approve / snooze / reject) with server-checked Server Actions.
- **Missing:** the queue reads `pending_candidates` (the **stubbed** scout table — all six publication adapters return `[]`), so it is empty; there is **no `/admin/prospects` view** to action the `partner_prospects` BD table (a pipeline no human can read); no human gate on the *autonomous* discovery output (it auto-publishes templated venues unattended every 4h).
- **Risks:** Server Actions swallow errors → silent failures; `pending_candidates` not defined in tracked schema (RLS unverifiable).
- **Priority:** **P1** (prospects cockpit, schema-track the table), **P2** (discovery review gate / quality dashboard).

### B.9 Other flows found
- **Theming:** time-based day/night (`theme-provider.tsx`) — a real differentiator, but post-hydration flash + 60s `setInterval`.
- **404:** branded `app/not-found.tsx` (good); **no error pages** (bad).
- **Crons:** `discover-venues` / `events-ingest` / `maintenance` GitHub Actions — real and running, but **no failure alerting** and free-tier-quota-bound.

---

## C. Technical architecture review (plain English)

- **Framework.** Next.js 14.2.15 App Router, React 18, TypeScript (strict), Tailwind. Rendering is server-first: data pages are React Server Components that fetch and hand plain data to thin `"use client"` islands. Nearly every route is dynamic (`ƒ`) and served `no-store` — nothing is edge-cached or ISR'd, even the catalogue that only changes every ~4 hours.
- **Frontend structure.** Route groups `(auth)` and `(main)`; providers (Saved, Bookings, Theme, ProfilePrefsMigration) lifted to the root layout so they span all routes. Colour design tokens are disciplined (`--fl-*` CSS vars, day/night inversion); typography/spacing are **not** (241 arbitrary `text-[11px]`/`h-[52px]`-style utilities, a 5×-copied CTA class). No shared Button/Card/Dialog primitives.
- **Backend / API structure.** There is **no API layer**. Reads go through a clean server-only data-access module (`lib/queries.ts`); user **writes (saves, bookings) happen client-side against the anon key, gated only by RLS** — no server validation, no rate limiting, no audit trail. Admin mutations use Server Actions with server-side re-auth (the one real server-write path).
- **Database / data model.** Supabase Postgres, seven tables (`profiles`, `venues`, `events`, `saved_venues`, `bookings`, `plans`, `partner_prospects`). The schema is the most mature artefact in the repo: correct RLS on every user-scoped table with the `(select auth.uid())` InitPlan optimisation, idempotent migrations, a properly locked-down `SECURITY DEFINER` trigger. Weaknesses: fabricated `NOT NULL` operational fields (`walking_mins`, `tables_free`, `next_slot_label`); no curation-tier flag; `pending_candidates` created out-of-band (not in tracked schema).
- **State management.** React context for Saved/Bookings (dual-mode local↔DB, near-duplicate ~250–300-line implementations); Supabase Realtime Presence+Broadcast for Plan Together (ephemeral, no persistence/replay).
- **Authentication.** Auth-optional. Magic-link (PKCE) + Google OAuth. Middleware only refreshes the session cookie (no gating); routes self-gate. Admin = env email allowlist defaulting to a hardcoded personal Gmail.
- **Deployment.** Vercel (production `www.funldn.com`, publicly reachable). GitHub Actions for CI (`pnpm check`) and three ingestion crons. Supabase project in eu-west-2 (London). Custom domain via Cloudflare.
- **External services.** Supabase (DB/auth/realtime), Google Places (venue data + photos), Gemini 2.5 Flash (source validation + templated editorial), Ticketmaster Discovery (events), Vercel Analytics. Eventbrite/Skiddle/DICE and six publication scouts are **stubs**.
- **Major dependencies.** `next`, `react`, `@supabase/ssr` + `@supabase/supabase-js`, `@vercel/analytics`, `lucide-react`. Lean tree; no test tooling.
- **Technical debt.** Zero tests; no error boundaries; duplicated context logic; oversized `plan-flow.tsx` (463 LOC); ad-hoc typography scale; templated editorial diluting the catalogue; half-wired plan persistence; dead `instagram_handle`/`fetchNeighbourhoods`.
- **Fragile areas.** (1) Discovery chain-check **fails open** → chains can auto-publish. (2) Exposed Places key → billing-DoS. (3) No error boundaries → any Supabase blip crashes whole pages. (4) Realtime rooms desync on disconnect. (5) Free-tier Gemini/SMTP ceilings throttle the core supply and signup loops. (6) Fabricated booking ref → trust/liability.

---

## D. Critical issues list

The full 121-finding register is in **Appendix 1**. Below is the curated, de-duplicated set of **Critical** and top **High** issues (multi-lens consensus collapsed into single rows).

| # | Issue | Category | Severity | Evidence | User impact | Business impact | Suggested fix | Effort | Blocker |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Google Places API key embedded in plaintext in every venue photo URL, served to anonymous browsers | Security | **Critical** | `ingest-venues.ts:211-219`, `discover-venues.ts:306-307`, `refresh-venues.ts:112-113`; key public-read in `venues.img_url`; confirmed live 49× in `/explore` source | Photos break if quota drained | Billing-DoS / quota-exhaustion; key in git + every share | Download photos → Supabase Storage at ingest; rotate key; restrict to Places-only with quota cap | M | GCP + Storage bucket |
| 2 | Discovery chain-detection **fails open** — on any Places error it returns count 1, below threshold, so chains auto-publish | Data integrity / thesis | **Critical** | `discover-venues.ts:301-303` `catch{return 1}`; threshold 4 at `:77`; gate `:608`; auto-publish `:18` | Users see chains in a "no chains" catalogue | Directly violates the core thesis; silent catalogue poisoning | On error return `Infinity`/throw + `continue` (fail closed, matching source validation) | XS | none |
| 3 | Fabricated "confirmed" booking with random "Ref" number presented as a real reservation | Trust / QA | **Critical** | `did-you-book.tsx:56-72` (`ref=${SLUG}-${random}`, `status:"confirmed"`, "You're in 🎉"); rendered "Ref {b.id}" `saved-list.tsx:63-65` | User quotes a meaningless code at the venue door | Trust/liability; contradicts the app's honesty equity | Relabel "Planning to go / self-added"; drop the fake code or mark "your note, not a confirmation" | S | none |
| 4 | No funnel analytics — only Vercel pageviews | Measurement / Business | **Critical** | `app/layout.tsx:69`; no `track()` on save/reserve/swipe/plan/book (recon) | — | Cannot measure activation, retention, CTR, K-factor, conversion; flying blind; un-fundable | Add custom-event wrapper on save / reserve-click / plan-generate / room-join / booking | S | none |
| 5 | No revenue infrastructure — affiliate thesis 0% built | Business | **Critical** | `booking-link.ts:17-47` adds only date/party, no affiliate/ref; grep `affiliate\|utm\|partner_id` → none | — | Every outbound click monetises at £0; the "aggregator" earns like a hyperlink | Add per-platform affiliate/ref params (start OpenTable) + click logging | S | affiliate sign-ups |
| 6 | No error boundaries anywhere — queries throw, crashing whole pages | Resilience | **Critical/High** | no `error.tsx`/`global-error.tsx`; throws `lib/queries.ts:157,169,199,241`; boundary only on `(main)` | Any Supabase blip → Next's raw error screen | Fragile public launch; tanks engagement metrics | Add `global-error.tsx` + per-segment `error.tsx` with retry | S | none |
| 7 | No privacy policy, terms or cookie banner on a live UK product running analytics | Legal / GDPR | **Critical** | `find *privacy/*terms/*cookie` → none; `<Analytics/>` unconditional `layout.tsx:69` | — | UK GDPR Art.13/14 + PECR breach; blocks UK marketing; no data-subject rights | Add `/privacy`, `/terms`, `/cookies` + consent banner + account-deletion/export | M | legal copy |
| 8 | No SEO surface — no OG/Twitter/JSON-LD/sitemap/robots; shared links render blank | Growth / SEO | **Critical/High** | `app/layout.tsx:19-23` only; `/sitemap.xml`,`/robots.txt` 404 live | Blank grey preview on WhatsApp/iMessage/IG | Kills viral sharing + organic search (cheapest channels) | `generateMetadata`+`next/og` on venue/event; `sitemap.ts`/`robots.ts`; `Restaurant`/`Event` JSON-LD | M | none |
| 9 | No users + throttled top-of-funnel | Business | **Critical** | Google OAuth unfinished (0 google users, STATE.md:20-25); magic-link ~3–4/hr (STATE.md:346) | New users blocked at sign-in | No traction story for investors | Finish Google OAuth; wire custom SMTP (Resend) | M | Google console + Resend |
| 10 | Templated editorial dominates the live catalogue, reading generic | Data / Brand | **High** | `discover-venues.ts:442-478`; ~51 templated vs 9 curated phrasings on live `/explore` | "Curated guide" reads algorithmic | Erodes the core differentiator as the cron runs | Pay for Gemini Flash + overnight voice pass; or route discovery to review queue | M | Gemini billing |
| 11 | Personalisation theatre — 1 mood + 1 vibe, budget/areas dead, labelled "Sorted around your taste" | Product / UX | **High** | `onboarding-flow.tsx:32-46`; `ranking.ts`; `explore-feed.tsx:189-193` | Barely-reordered feed undermines trust | Small lie that erodes the honesty brand | Multi-select moods/vibes+budget+area, or drop the claim | M | none |
| 12 | No retention loop | Product | **Critical** | no notifications/digest/"new this week"; `saved-list.tsx` passive (Product Strategy lens) | Nothing brings users back | One-to-three-session product, not a habit | Weekly "new in London" + "you saved X, it's on" nudge via email | L | analytics + email |
| 13 | Dead buttons in profile (Give Feedback, Notification prefs, Theme: Auto) | UX / Trust | **High** | `profile-body.tsx:103-107,158-169` (no `onClick`) | Fake controls erode trust | Marketing theatre at the most-invested surface | Wire or remove; make Theme a real toggle | S | none |
| 14 | Anon users pre-seeded with 2 "saved" venues that don't render (hidden demo slugs) | UX / QA | **High** | `mock-data.ts:24-27`; hidden by `google_place_id` filter; `saved-list.tsx:39,82` | "2 saved / nothing shown" on first screen | Self-inflicted first-impression trust wound | Remove `MOCK_SAVED_IDS` or point at live slugs | XS | none |
| 15 | Unvalidated `return` open-redirect via sign-in + OAuth callback | Security | **High** | `sign-in/page.tsx:33`; `callback/route.ts:24,47`; no `//` guard | Phishing redirect after sign-in | Account-safety / brand-abuse vector | Guard `startsWith("/") && !startsWith("//")` | XS | none |
| 16 | Admin authz defaults to a hardcoded personal Gmail; no DB role table | Security | **High** | `lib/auth.ts:32` | — | Unset env → admin silently grants to one external Gmail; committed to git | Fail closed (empty default); throw if unset in prod; DB `admin_users` table | S | none |
| 17 | 2 MB splash logo + unconditional 1.7s blocking hold as the LCP path | Performance | **High** | `logo-fun.png` 2,089,385 B; `splash-client.tsx:21,33` 1700ms every visit | Multi-second slow first paint | Poor CWV; bounce on word-of-mouth landings | Ship logo as inline SVG/optimised WebP (~<30 kB); skip/shorten splash for returning + reduced-motion | S | none |
| 18 | Pinch-zoom disabled (`maximumScale:1`) | Accessibility | **High** | `app/layout.tsx:28` | Low-vision users cannot zoom | WCAG 1.4.4 failure; legal/a11y risk | Remove the cap | XS | none |
| 19 | Sub-AA colour contrast on smallest text + primary-as-text on night theme | Accessibility | **High** | `--fl-muted-fg` 4.46:1; primary 2.99:1 on night bg (`globals.css`) | Illegible metadata for low-vision | WCAG AA failure | Darken `--fl-muted-fg`; stop using primary as text on night | S | none |
| 20 | Theme applied post-hydration → guaranteed day→night flash for evening visitors | Frontend / UX | **High** | `theme-provider.tsx:4-17`; no server `data-theme` (`layout.tsx:55`) | Jarring flash on the app's core "tonight" identity | Polish credibility | Set `data-theme` server-side / inline pre-paint script | S | none |
| 21 | `partner_prospects` BD table is write-only — captured but no UI to action it | Business / Opportunity | **High** | schema.sql:151-172; only `/admin/candidates` exists (reads a different table) | — | The one differentiated wedge is dormant; no venue contacted | Build `/admin/prospects` cockpit (status kanban, notes, draft-outreach) | M | none |
| 22 | Candidate scout fully stubbed; admin queue empty | Feature / Business | **High** | all six `scripts/candidate-sources/*` return `[]` | — | Pitched "curation moat" doesn't exist | Wire Time Out RSS first (no key needed) | L | none |
| 23 | Zero automated tests across the whole repo | Quality | **High** | no test deps/files (recon) | Regressions ship unnoticed | Slows safe iteration; diligence red flag | Add Vitest; first specs on `plan-engine`/`booking-link`/`ranking`/`opening-hours` | M | none |
| 24 | No server-side write layer — anon-key writes, no validation/rate-limit; fire-and-forget silent loss | Architecture / Reliability | **High** | `saved-context.tsx:188-205`, `bookings-context.tsx:233-249` | Saves/bookings silently lost on failure | RLS is the only guard; lost bookings = lost conversions | Server Actions + Zod + revert-on-error toast | M | none |
| 25 | Catalogue too thin & geographically concentrated (≈39–49, east/south-east heavy) | Data / Product | **High** | STATE.md:238; `discover-venues.ts:82-99` grid | Can't suggest West/North/SW London | Reads as prototype, not "London guide" | Broaden discovery grid + curated seed; un-throttle robot | M | Gemini billing |

---

## E. Missing features list

Full set distilled to the highest-value items per tier (counts across all lenses: 33 MVP, 37 launch, 18 differentiation, 11 investor-scale).

### E.1 Must-have for MVP
| Feature | Why |
|---|---|
| Funnel analytics (save / reserve-click / plan / room-join / booking) | Nothing else is measurable or monetisable without it |
| Error boundaries (`global-error.tsx` + per-route `error.tsx`) | Basic resilience for a public site; queries currently crash whole pages |
| Privacy / terms / cookie pages + consent banner + account deletion/export | UK GDPR/PECR legal blocker |
| Per-page SEO metadata + OG images on venue/event | Turns every Share tap and Google crawl into a real, branded entry point |
| Honest booking-confirmation language (kill the fake "Ref"/"confirmed") | Trust + liability |
| Sign-in nudge + data-loss warning for anon users | Prevents silent loss of saved venues |
| Real (or removed) personalisation; fix onboarding step count | Stop overclaiming; remove the lie |
| Server-side write path with validation for saves/bookings | Integrity, abuse prevention, affiliate attribution foundation |
| Photo pipeline to Supabase Storage (decouple the Places key) | Removes the live billing-DoS exposure |

### E.2 Should-have for strong launch
| Feature | Why |
|---|---|
| Affiliate/attribution tagging on booking deep-links | Converts the core thesis from theoretical to revenue-generating |
| Public, indexable landing page (skip splash for deep anon visitors) | Word-of-mouth "funldn.com" currently dead-ends in a quiz |
| `sitemap.ts` / `robots.ts` + `Restaurant`/`Event` JSON-LD | Opens organic search; rich results |
| `/admin/prospects` BD cockpit + contact ≥5 venues | Activates the one differentiated wedge |
| Eventbrite + Skiddle event adapters; de-music the feed | Fills empty Food/Club/Comedy categories |
| Custom SMTP (Resend) + finished Google OAuth | Unblocks the throttled top-of-funnel |
| Cron failure alerting + quota dashboards | Catalogue/events freshness depends on unattended crons |
| Save-for-events + remove-booking + plan re-open (`fetchPlans`) | Completes half-built core flows |
| Weekly "new in London" email + saved-venue nudges | First real retention loop |
| Vitest + first engine specs | Safe iteration; diligence signal |

### E.3 Could-have for differentiation
| Feature | Why |
|---|---|
| First-party taste signal ("would you go back?") feeding ranking | The only data Google/Time Out can't copy; a real taste graph |
| Overnight "brat voice" editorial pass on auto-published venues | Compounds the content moat into a brand moat |
| Venue→events cross-sell on `/venue/[slug]` | Free cross-sell; index already exists |
| Real availability / distance (geolocation, booking-platform feeds) | Genuine aggregator differentiation; replaces fabricated fields |
| Brand system: logo-gradient in UI, display typeface, illustration, empty states | Personality to compete with DICE/Time Out/Infatuation |
| "Claim your venue" partner self-serve | Turns outbound BD into a two-sided network |

### E.4 Future investor-scale features
| Feature | Why |
|---|---|
| Partner dashboard + Stripe Connect | Partner subscriptions / commissions revenue line |
| Behavioural recommender (replace keyword scorer) | Defensible personalisation at scale |
| Multi-city architecture (de-hardcode the London grid/regions) | The expansion story (currently aspirational) |
| Automated DB migrations + RLS policy tests in CI | RLS is the sole authz boundary; prove security at scale |
| Real booking inventory / availability partnerships | The actual "agent" the thesis promises |
| Push notifications via installed PWA | Re-engagement channel "Notification prefs" already implies |

---

## F. UX and visual improvements

- **Information architecture.** State the thesis on screen in the first 5 seconds (onboarding step 0 / intro card: "Independent London only. No chains. Every spot checked in 2+ places."). Resolve the "Plan / Plan Together / For You" overlap with one framing sentence each. Promote "Why this is here" from a buried accordion to a visible trust badge on cards.
- **Navigation.** Add a persistent sign-in nudge for anon users on Explore/Saved; add `<main>` landmark + skip-link; keep the (good) bottom nav.
- **Homepage / first impression.** Replace the unconditional 1.7s black splash with a conditional, theme-matched, reduced-motion-aware splash (skip for returning users); build a public indexable landing page that shows real venues immediately.
- **Discovery experience.** Make "For You" real or rename it; add curated-tier ranking so hand-curated venues lead; add a "new this week" freshness rail.
- **Cards.** Add the brand gradient/logo; add `unoptimized` to event-card to match venue-card; surface a curated badge; fix sub-AA metadata contrast.
- **Filters.** Disambiguate chips ("Eats" should include cafés/markets, or relabel); align the taste taxonomy end-to-end (drop or implement "Club"); add area/price/open-now.
- **Event / detail pages.** Add per-page metadata + OG + JSON-LD; add error boundary; surface "what's on here"; make "Real Talk" non-boilerplate for auto-venues.
- **Empty states.** Add a real empty-state for solo Plan (guard zero-step plans); add brand illustration to the bare Explore empty sentence.
- **Loading states.** Good `loading.tsx` exist for the heavy routes; extend to event/booking; ensure skeletons match final layout.
- **Error states.** Add branded `error.tsx`/`global-error.tsx` with a retry; never show Next's raw screen.
- **Mobile layout.** Remove `maximumScale:1` (restore pinch-zoom); verify tap targets ≥44px; fix chrome-tint-vs-theme divergence.
- **Typography.** Add a characterful display typeface for H1s/eyebrows/masthead; keep Jakarta for body; introduce a real type scale to retire 241 arbitrary `text-[…]` utilities.
- **Spacing.** Tokenise the half-step scale fully; build shared Button/Card/Sheet primitives (the 5×-copied CTA class).
- **Colour and brand.** Make the blue→magenta logo gradient the load-bearing visual (replace the unused orange→pink `--fl-gradient`); resolve the three-hue identity (commit to one accent); define the missing `--coral` token; ship the logo as inline SVG.
- **Imagery.** Treat Google Places photos as fallback, not identity; add brand-owned imagery + empty-state illustration; fix the maskable icon (≈20% safe zone).
- **Microcopy.** Kill the fake "Ref"; soften the magic-link 429 to a friendly cooldown; stop "✨ Sorted around your taste" until it's true; warn anon users their data is local.
- **Calls to action.** Add a share trigger at the post-booking moment; add affiliate-tagged Reserve; add email capture ("the weekly London drop").

---

## G. Backend / data improvements

- **Data schema.** Add a `curation_tier` ('curated' | 'discovered') column and rank/badge by it; make `walking_mins` / `tables_free` / `next_slot_label` nullable (stop storing fabricated values); move `pending_candidates` into tracked `schema.sql` with explicit RLS; drop dead `instagram_handle` or populate it.
- **Event / content model.** Wire Eventbrite + Skiddle adapters; de-music the `LONDON_VENUES` allowlist; broaden categories; fix the `fetchEvents` UTC→Europe/London day-boundary bug.
- **Admin workflow.** Build `/admin/prospects`; add a human review gate (or quality dashboard) on autonomous discovery output; surface Server Action errors via `useActionState`.
- **APIs.** Introduce a thin Server-Action write layer (save / booking / plan) with Zod validation, ownership checks and rate limiting; keep RLS as defence-in-depth.
- **Validation.** Validate booking query params (`did-you-book.tsx` `.toISOString()` can throw); validate the `return` redirect param; validate admin mutation inputs.
- **Error handling.** Add error boundaries (above); revert optimistic state + retry toast on failed writes; return empty-state fallbacks for non-critical reads instead of throwing.
- **Scalability.** Paginate `fetchVenues` + select needed columns; replace per-mount full-table slug→uuid client fetches with joined reads/indexed RPC; add ISR/edge caching for the catalogue (revalidate aligned to the 4h cron) instead of `no-store` everywhere.
- **Authentication.** Finish Google OAuth; custom SMTP; client cooldown on magic-link; DB-backed admin roles.
- **Security.** Photo pipeline to Storage + key rotation; close the open-redirect; privacy/terms/cookies + consent; account deletion/export; verify RLS via Supabase advisor; add room TTL/rate-limit for realtime codes.
- **Analytics.** Custom events on the full funnel (foundation for everything in H).
- **Monitoring.** Cron failure alerting (Slack/email/GitHub issue on `failure()`); quota/429 counters in summaries; field CWV + error telemetry.

---

## H. Growth and investor readiness

**To be credible for real users:** a retention loop (weekly drop + saved-venue nudges), a thicker, less-concentrated catalogue, honest personalisation, GDPR pages, and no dead buttons / fake refs.

**For launch:** rich shareable links (OG images), an indexable landing page, sitemap/robots/JSON-LD, custom SMTP + finished Google OAuth, and event-category breadth.

**For press / social sharing:** OG images are the single highest-leverage fix — the Share button already exists and currently produces blank previews on the dominant London discovery channels (WhatsApp/iMessage/Instagram). Add a post-booking and post-plan "share your night" trigger.

**For investors:** instrument the funnel (even 50 beta users with a measured outbound-CTR beats 39 venues with no users), ship affiliate tagging so the thesis is live not theoretical, prove the wedge by getting one partner "in conversation" via the `/admin/prospects` cockpit, un-throttle the discovery robot (cents/month) and lead the pitch with the autonomous engine + un-platformed-independents insight — explicitly labelling templated editorial, stubbed scouts and the 19-row pipeline as roadmap, not moat. Pick **one** wedge for 12 months with a single-number thesis.

**For partnerships:** the `partner_prospects` table is a ready-made CRM; activate it. Add "claim your venue" to make it two-sided. Affiliate sign-ups (OpenTable/Resy/Ticketmaster) are the immediate revenue plumbing.

**For revenue / monetisation:** affiliate booking commissions (build first — 2–3h/platform), then partner subscriptions (needs the BD cockpit + a partner dashboard + Stripe Connect), then consumer freemium (only credible once retention exists).

**KPIs to instrument now (none currently measured):**
- **Activation:** % of new users who save ≥1 venue or generate ≥1 plan in session 1.
- **Retention:** D1 / D7 / D30 return rate; weekly active / monthly active.
- **Engagement:** saves per user, plans generated, swipe completions, room joins, events added-to-calendar.
- **Outbound / conversion:** reserve-click CTR, click→"did you book" yes-rate, event ticket-link CTR.
- **Growth loop:** share rate per detail view, K-factor from Plan Together room invites, newsletter sign-ups.
- **Supply / quality:** venues published per week, % curated vs templated, source-validation pass-rate, dead-link rate, geographic coverage.
- **Business:** affiliate clicks → attributed bookings → commission; partner pipeline by `bd_status`; signed partners.

---

## I. Prioritised roadmap

### Phase 0 — Immediate fixes before showing anyone (≈1–3 days)
- **Tasks:** fix fail-open chain check; kill fake "Ref"/"confirmed" language; remove `MOCK_SAVED_IDS` pre-seed; wire/remove the 3 dead profile buttons; fix onboarding step count; close the `return` open-redirect; fail-closed admin default; remove `maximumScale:1`; compress the 2 MB splash logo + make splash conditional/reduced-motion-aware; add `global-error.tsx` + key route `error.tsx`; validate booking query params; guard zero-step plans.
- **Why:** these are the seams a careful demo or first user will hit; all are low-effort, high-trust-impact.
- **Files:** `scripts/discover-venues.ts`, `did-you-book.tsx`, `saved-list.tsx`, `mock-data.ts`, `profile-body.tsx`, `onboarding-flow.tsx`, `sign-in/page.tsx`, `auth/callback/route.ts`, `lib/auth.ts`, `app/layout.tsx`, `splash-client.tsx`, `app/page.tsx`, `app/global-error.tsx` (+ segment `error.tsx`), `plan-flow.tsx`.
- **Impact:** removes the credibility-cascade risk. **Effort:** mostly XS/S. **Dependencies:** none.

### Phase 1 — MVP readiness (≈2–3 weeks)
- **Tasks:** funnel analytics; photo pipeline → Supabase Storage + key rotation; privacy/terms/cookies + consent + account deletion; per-page SEO metadata + OG images; honest personalisation (multi-select moods/vibes/budget/area) or drop the claim; sign-in nudge for anon; server-side write path + write-failure handling; Vitest + first engine specs; server-side theme to kill the flash; contrast fixes.
- **Why:** the minimum to put in front of real users legally, measurably and resiliently.
- **Files:** `lib/queries.ts`, `components/*-context.tsx`, ingestion scripts, `app/(legal)/*`, `app/venue/[slug]/page.tsx`, `app/event/[id]/page.tsx`, `lib/ranking.ts`, `onboarding-flow.tsx`, `theme-provider.tsx`, `globals.css`, new `*.test.ts`.
- **Impact:** moves from prototype to measurable, compliant MVP. **Effort:** S–L. **Dependencies:** Storage bucket, legal copy, analytics decision.

### Phase 2 — Strong public launch (≈3–6 weeks)
- **Tasks:** sitemap/robots/JSON-LD + public landing page; affiliate tagging + click logging; custom SMTP + finished Google OAuth; Eventbrite/Skiddle adapters + de-music; un-throttle Gemini + overnight voice pass + curation-tier; broaden geography; weekly email retention loop + saved-venue nudges; cron alerting; ISR/edge caching; brand system pass (logo gradient, display font, empty states); save-for-events, remove-booking, plan re-open.
- **Why:** the things that make a single shared link compelling and bring users back.
- **Impact:** organic acquisition + retention + first revenue. **Effort:** M–L. **Dependencies:** affiliate accounts, Resend, Gemini billing, Google console.

### Phase 3 — Investor / demo readiness (≈ ongoing)
- **Tasks:** `/admin/prospects` cockpit + contact ≥5 venues (prove the wedge); first-party taste signal feeding ranking; partner dashboard + Stripe Connect; behavioural recommender; multi-city architecture; RLS policy tests in CI; a single-number 12-month thesis with a live metrics dashboard.
- **Why:** converts the two real moats into a defensible, fundable narrative backed by numbers.
- **Impact:** the difference between "advanced prototype" and "company". **Effort:** L–XL. **Dependencies:** Phase 1 analytics + Phase 2 revenue plumbing.

---

## J. Final todo list (curated, sorted by priority × impact)

The complete machine-collated todo set (119 items) underlies this; below is the de-duplicated, sequenced action list.

[ ] **Fix fail-open chain detection**
- Category: Data integrity · Priority: P0 · Why: an API error lets chains auto-publish into a "no chains" catalogue, breaking the core thesis · Evidence: `scripts/discover-venues.ts:301-303,608,18` · Suggested implementation: on error return `Infinity`/throw and `continue` (fail closed) · Files: `scripts/discover-venues.ts` · Effort: XS · Dependencies: none

[ ] **Stop presenting a fabricated booking as "confirmed" with a fake Ref**
- Category: Trust/QA · Priority: P0 · Why: users may quote a meaningless code at the door; contradicts the app's honesty · Evidence: `did-you-book.tsx:56-72`, `saved-list.tsx:63-65` · Implementation: relabel "Planning to go / self-added", drop the random code · Files: `did-you-book.tsx`, `saved-list.tsx` · Effort: S · Dependencies: none

[ ] **Move Places photos to Supabase Storage + rotate the key**
- Category: Security · Priority: P0 · Why: live billing-DoS — key shipped in every public photo URL · Evidence: `ingest-venues.ts:211-219`, `discover-venues.ts:306-307`, `refresh-venues.ts:112-113` · Implementation: download bytes at ingest → Storage bucket → store public URL; backfill; rotate; restrict key · Files: ingestion scripts · Effort: M · Dependencies: Storage bucket, GCP

[ ] **Add funnel analytics (save / reserve-click / plan / room-join / booking)**
- Category: Measurement · Priority: P0 · Why: nothing is measurable or monetisable without it · Evidence: pageviews-only (`layout.tsx:69`) · Implementation: thin `track()` wrapper (Vercel custom events or a log table) · Files: `lib/analytics.ts` (new), context + CTA components · Effort: S · Dependencies: none

[ ] **Add error boundaries**
- Category: Resilience · Priority: P0 · Why: any Supabase blip crashes whole pages · Evidence: no `error.tsx`/`global-error.tsx` · Implementation: `global-error.tsx` + per-segment with retry · Files: `app/global-error.tsx`, segment `error.tsx` · Effort: S · Dependencies: none

[ ] **Remove the anon pre-saved seed**
- Category: UX/QA · Priority: P0 · Why: "2 saved / nothing shown" on first screen · Evidence: `mock-data.ts:24-27` · Implementation: delete `MOCK_SAVED_IDS` or point at live slugs · Files: `mock-data.ts`, `saved-context.tsx` · Effort: XS · Dependencies: none

[ ] **Wire or remove the 3 dead profile buttons; fix onboarding step count**
- Category: UX/Trust · Priority: P0 · Why: fake controls + lying progress bar erode trust · Evidence: `profile-body.tsx:103-107`, `onboarding-flow.tsx:28` · Implementation: real Theme toggle + Feedback mailto; `TOTAL_STEPS=2` or add steps · Files: `profile-body.tsx`, `onboarding-flow.tsx` · Effort: S · Dependencies: none

[ ] **Close the `return` open-redirect; fail-closed admin default; remove `maximumScale:1`**
- Category: Security/A11y · Priority: P0 · Why: phishing vector; silent admin grant; WCAG 1.4.4 failure · Evidence: `sign-in/page.tsx:33`, `callback/route.ts:24,47`, `lib/auth.ts:32`, `layout.tsx:28` · Implementation: `startsWith("/")&&!"//"` guard; empty admin default; drop the cap · Files: those four · Effort: XS each · Dependencies: none

[ ] **Optimise the splash logo + make splash conditional/reduced-motion-aware**
- Category: Performance · Priority: P0 · Why: 2 MB LCP element + 1.7s forced hold every visit · Evidence: `logo-fun.png` 2 MB, `splash-client.tsx:21,33` · Implementation: inline SVG/WebP; skip for returning + reduced-motion; theme-match background · Files: `splash-client.tsx`, `app/page.tsx`, `logo.tsx` · Effort: S · Dependencies: none

[ ] **Privacy / terms / cookie pages + consent banner + account deletion/export**
- Category: Legal · Priority: P0/P1 · Why: UK GDPR/PECR blocker on a live product · Evidence: none exist; `<Analytics/>` unconditional · Implementation: legal pages + consent gate on analytics + delete/export (cheap given cascade FKs) · Files: `app/(legal)/*`, `layout.tsx` · Effort: M · Dependencies: legal copy

[ ] **Per-page SEO metadata + OG images on venue/event**
- Category: Growth/SEO · Priority: P1 · Why: every Share renders blank; pages invisible to Google · Evidence: `layout.tsx:19-23` only · Implementation: `generateMetadata` + `next/og` ImageResponse · Files: `venue/[slug]/page.tsx`, `event/[id]/page.tsx` · Effort: M · Dependencies: none

[ ] **Add affiliate/attribution tags to booking deep-links + log clicks**
- Category: Revenue · Priority: P1 · Why: every outbound click monetises at £0 today · Evidence: `booking-link.ts:17-47` · Implementation: per-platform ref params (start OpenTable) + click event · Files: `lib/booking-link.ts`, reserve components · Effort: S · Dependencies: affiliate accounts

[ ] **Make personalisation real (or drop the claim)**
- Category: Product · Priority: P1 · Why: "Sorted around your taste" over a trivial re-sort is a trust-eroding lie · Evidence: `onboarding-flow.tsx:32-46`, `ranking.ts`, `explore-feed.tsx:189-193` · Implementation: multi-select moods/vibes+budget+area, or remove the label · Files: those three · Effort: M · Dependencies: none

[ ] **Server-side write path for saves/bookings + revert-on-error**
- Category: Architecture · Priority: P1 · Why: anon-key writes silently lose data; no validation · Evidence: `saved-context.tsx:188-205`, `bookings-context.tsx:233-249` · Implementation: Server Actions + Zod + retry toast · Files: contexts, new `actions.ts` · Effort: M · Dependencies: Zod

[ ] **Introduce Vitest + first engine specs**
- Category: Quality · Priority: P1 · Why: zero tests; regressions invisible · Evidence: recon · Implementation: Vitest; specs for `plan-engine`/`booking-link`/`ranking`/`opening-hours` · Files: new `*.test.ts`, `package.json` · Effort: M · Dependencies: none

[ ] **Sitemap / robots / JSON-LD + public landing page**
- Category: Growth · Priority: P1/P2 · Why: opens organic search; word-of-mouth currently dead-ends in onboarding · Evidence: `/sitemap.xml`,`/robots.txt` 404 · Implementation: `sitemap.ts`/`robots.ts` from `fetchVenues/Events`; `Restaurant`/`Event` JSON-LD; skip-splash landing · Files: `app/sitemap.ts`, `app/robots.ts`, detail pages, `app/page.tsx` · Effort: M · Dependencies: none

[ ] **Custom SMTP (Resend) + finish Google OAuth**
- Category: Auth/Growth · Priority: P1/P2 · Why: top-of-funnel throttled (~3–4/hr) and Google flow unproven (0 users) · Evidence: STATE.md:20-25,346 · Implementation: Resend SMTP in Supabase; complete the 3-console OAuth job · Files: Supabase config · Effort: M · Dependencies: Resend, Google console

[ ] **Un-throttle discovery (paid Gemini Flash) + voice pass + curation-tier; broaden geography**
- Category: Data/Brand · Priority: P2 · Why: templated copy dilutes the catalogue; east/south-east concentration · Evidence: `discover-venues.ts:442-478,82-99` · Implementation: billing toggle + raise TARGET; overnight voice pass; `curation_tier` column + ranking; add W/N/SW neighbourhoods · Files: `discover-venues.ts`, `queries.ts`, schema · Effort: M · Dependencies: Gemini billing

[ ] **Build `/admin/prospects` cockpit + contact ≥5 venues**
- Category: Business · Priority: P2 · Why: activates the one differentiated wedge (currently write-only) · Evidence: schema.sql:151-172 · Implementation: status kanban + notes + draft-outreach · Files: new `app/admin/prospects/*` · Effort: M · Dependencies: admin auth

[ ] **Wire Eventbrite + Skiddle adapters; de-music the feed; fix UTC day-boundary**
- Category: Data · Priority: P2 · Why: events thin + single-source; late-night gigs dropped in BST · Evidence: `ingest-events.ts:230-238,493`, `queries.ts:191-192` · Implementation: implement adapters (key-gated); Europe/London start-of-day · Files: `ingest-events.ts`, `queries.ts` · Effort: L · Dependencies: Eventbrite/Skiddle tokens

[ ] **Retention loop: weekly "new in London" email + saved-venue nudges**
- Category: Product · Priority: P2 · Why: no reason to return today · Evidence: Product Strategy/Opportunity lenses · Implementation: digest job over new venues+events; "you saved X, it's on" · Files: new job, email templates · Effort: L · Dependencies: SMTP, analytics

[ ] **Brand system pass + shared UI primitives + type scale**
- Category: Design/Frontend · Priority: P2/P3 · Why: no logo gradient in UI, three-hue identity, 241 arbitrary utilities, 5×-copied CTA · Evidence: Visual + Frontend lenses · Implementation: inline-SVG logo gradient, display font, Button/Card/Sheet, type tokens · Files: `globals.css`, `tailwind.config.ts`, `logo.tsx`, new primitives · Effort: L · Dependencies: none

[ ] **Cron failure alerting + ISR/edge caching + maskable icon + theme-flash fix**
- Category: Ops/Perf · Priority: P2/P3 · Why: silent pipeline failure; uncached dynamic catalogue; wrong Android icon; first-paint flash · Evidence: workflows, `no-store` headers, `manifest.json`, `theme-provider.tsx` · Implementation: `if:failure()` alerts; `revalidate`; pad icon; server `data-theme` · Files: `.github/workflows/*`, route configs, `manifest.json`, `theme-provider.tsx` · Effort: S–M · Dependencies: Slack/email secret

[ ] **First-party taste signal + plan persistence + venue→events surface + save-for-events**
- Category: Differentiation · Priority: P3 · Why: completes core flows and starts a defensible taste graph · Evidence: `queries.ts` lacks `fetchPlans`; `events_venue_starts_idx` unused; events not savable · Implementation: "would you go back?" tap → ranking; `fetchPlans()`; venue events query; event save · Files: `queries.ts`, `ranking.ts`, detail/saved components · Effort: M–L · Dependencies: analytics

---

## K. Recommended next Claude Code prompts

1. **Implement Phase 0 trust-and-safety fixes.** "Implement all Phase 0 items from `docs/fun-london-roadmap-todo.md`: fail-closed chain detection, remove the fake booking Ref/'confirmed' language, delete the anon pre-saved seed, wire/remove the 3 dead profile buttons, fix the onboarding step count, close the `return` open-redirect, fail-closed admin default, remove `maximumScale:1`, optimise + conditionalise the splash, add `global-error.tsx` + route `error.tsx`, validate booking query params, and guard zero-step plans. Do not change product scope; keep diffs small and run `pnpm check` after each."

2. **Stand up measurement + revenue plumbing.** "Add a typed `lib/analytics.ts` event wrapper and instrument save, reserve-click, plan-generate, room-join and booking-confirm. Then add per-platform affiliate/ref params to `lib/booking-link.ts` (start with OpenTable) and log every reserve click. Add a KPI events table or use Vercel custom events; document each event."

3. **Open the growth channel (SEO + sharing).** "Add `generateMetadata` + `next/og` OG images to `/venue/[slug]` and `/event/[id]`, create `app/sitemap.ts` and `app/robots.ts` from `fetchVenues`/`fetchEvents`, add `Restaurant` and `Event` JSON-LD to the detail pages, and build a public, indexable landing page that skips the splash for anonymous deep visitors."

4. **Fix the visual system + accessibility.** "Replace the unused orange→pink `--fl-gradient` with the real blue→magenta logo gradient, ship the logo as inline SVG and use the gradient on the masthead and primary CTAs, add a display typeface for headings, build shared Button/Card/Sheet primitives with a focus-trap dialog, introduce a type scale to retire the arbitrary `text-[…]` utilities, fix sub-AA contrast on `--fl-muted-fg` and primary-on-night, and set `data-theme` server-side to kill the flash."

5. **Prepare the investor/demo build.** "Build the `/admin/prospects` BD cockpit over `partner_prospects` (status kanban, notes, draft-outreach), wire `fetchPlans()` so saved plans re-open, add privacy/terms/cookie pages + consent banner + account deletion, un-throttle the discovery robot with paid Gemini Flash plus an overnight editorial voice pass and a `curation_tier` column, and add a metrics dashboard reading the analytics events so the demo can show activation and outbound-CTR."


---

## Appendix 1 — Full issue register (all 121 findings, machine-collated)

Recurring themes across multiple lenses (e.g. the exposed Places key, missing error boundaries, no SEO surface, no funnel analytics) indicate multi-agent consensus and are weighted accordingly in the roadmap.


### Critical (12)

| # | Issue | Lens | Category | Evidence | Fix | Effort |
|---|---|---|---|---|---|---|
| 1 | Value proposition is not legible in the first 5 seconds; the differentiating thesis (curated independents, no chains, 2+ sources) never appears on the first screens | Product Strategy | Positioning / First-impression UX | app/splash-client.tsx (1.7s logo only); app/(auth)/onboarding/onboarding-flow.tsx:123 (asks mood, states no promise); app/(main)/explore/explore-feed.tsx:156-185 (masthead is just 'tonight in funLondon' + search). Only positioning copy lives in app/layout.tsx meta description, never user-visible. | Add a single positioning line to onboarding step 0 and an always-visible trust badge ('Independent · checked in 2+ places · no chains') on cards and venue detail; surface 'Why this is here' uncollapsed. | S |
| 2 | No retention loop — nothing brings a user back; Saved/Coming-up is a passive, manually self-reported bookmark list | Product Strategy | Retention | app/(main)/saved/saved-list.tsx:10-37 (list populated only from useSaved + manual useBookings); app/booking/[slug]/confirmed/did-you-book.tsx:56-72 (bookings exist only if user self-taps 'Yes'). No notifications, digests, or re-engagement anywhere in app/ or lib/. Recon: analytics is pageview-only, zero event instrumentation. | Ship one loop: weekly 'New in London' email/surface from events + newly-discovered venues; 'a place you saved is on this week' nudge via existing magic-link emails. | L |
| 3 | Google Places API key embedded in plaintext in every venue photo URL, served to anonymous users in production HTML | data-content | Security / Data | scripts/discover-venues.ts:306-307; scripts/ingest-venues.ts:211-219; scripts/refresh-venues.ts:112-113; confirmed live: curl https://www.funldn.com/explore returns 'key=AIzaSy...' 49+ times | Download Google photos at ingest time and re-host on Supabase Storage (already noted as 'Future' in code comment ingest-venues.ts:217); rotate the key afterwards | M |
| 4 | Every shared link renders a blank, generic preview on all platforms — no Open Graph, no Twitter card, no per-page metadata, no OG image. The Share button (which exists and works) produces dead-looking links. | Growth / Marketing | SEO / Social sharing | app/layout.tsx:19-23 is the entire metadata surface (title/description/manifest only); recon SEO section confirms grep for openGraph\|generateMetadata\|twitter: across app/ returns NONE; public/ contains no og image (only app-icon/logo files). Share is wired in venue-detail.tsx:55-65, event-actions.tsx:25-35. | Add generateMetadata to app/venue/[slug]/page.tsx and app/event/[id]/page.tsx returning openGraph + twitter card with venue name, neighbourhood, description and a dynamic OG image (next/og ImageResponse using the venue photo + brand mark). | M |
| 5 | Zero revenue infrastructure: the entire affiliate thesis (the pitched primary revenue path) is 0% built — no affiliate ID tagging exists anywhere | investor-business | Monetisation | project_business_model.md:18 ('Zero revenue today'); grep for affiliate\|awin\|commission\|utm\|partner_id across lib/ app/ scripts/ returns no matches; lib/booking-link.ts builds deep-links with NO affiliate tag | Add lib/affiliate-tags.ts that rewrites outbound booking_links URLs with per-platform affiliate IDs before redirect; start with OpenTable (restaurant-heavy catalog) | M |
| 6 | No product analytics for any core action — activation, retention, outbound CTR and conversion are all unmeasurable | investor-business | Metrics | Recon pack: @vercel/analytics is pageview-only; zero track()/gtag/custom events in app/ lib/ components/; saves/reserves/swipes/bookings/plan-gen not instrumented | Instrument save, reserve-click (outbound), plan-generate, swipe, sign-in completion with a lightweight analytics layer (PostHog or Vercel custom events) | M |
| 7 | No users: Google sign-in unfinished (0 google users) and magic-link throttled to ~3-4 emails/hour | investor-business | Traction | STATE.md:20-25 (Google OAuth never completed, DB shows 0 google-provider users); STATE.md:346 (built-in Supabase SMTP rate-limited) | Finish Google OAuth (3-console job in STATE.md:20-23) and wire Resend for unlimited magic-link sends | M |
| 8 | Post-handoff flow fabricates a 'confirmed' booking with a random reference number, implying Fun London made a real reservation it never made and cannot verify. | QA / Testing | Trust / Data integrity | app/booking/[slug]/confirmed/did-you-book.tsx:56-72 (ref = `${slug}-${Math.floor(Math.random()*9000)+1000}`, status:"confirmed", success copy "You're in. 🎉" line 142); rendered as "Ref {b.id}" in app/(main)/saved/saved-list.tsx:63-65 | Relabel to a self-added plan ('You're planning to go'), remove or clearly disclaim the random ref ('your note — not a booking confirmation'), and stop using status "confirmed" for unverified self-logs. | S |
| 9 | Live Google Places API key embedded in public venue photo URLs shipped to every browser | Security / Privacy / Legal | Security / Secrets exposure | scripts/ingest-venues.ts:211-219; scripts/discover-venues.ts:306-307; scripts/refresh-venues.ts:112-113 build img_url=...media?key=${GOOGLE_PLACES_API_KEY}; persisted to public.venues.img_url (schema.sql:202 public-read) and rendered in DOM src at components/venue-card.tsx:54,63 on the live public site | Migrate ingestion to download photos and re-upload to Supabase Storage (the fix the code comment already names at ingest-venues.ts:217); serve Storage URLs with no key. Then ROTATE the exposed key in Google Cloud and apply API restriction + a hard daily quota cap as an interim. | M |
| 10 | No privacy policy, terms, or cookie policy on a UK-targeted product collecting personal data | Security / Privacy / Legal | Legal / UK GDPR compliance | find app -iname '*privacy*'/'*terms*'/'*cookie*'/'*legal*' returns nothing; PII collected per schema.sql:13-20 (email via auth.users, display_name, avatar_url, preferences jsonb), bookings/saved/plans tables | Add /privacy, /terms, /cookies static routes with a genuine privacy notice (data categories, lawful basis, retention, DSAR contact). Link from footer/onboarding. | M |
| 11 | Chain-detection fails open — on any Google Places error the location count returns 1, below the chain threshold, so chains auto-publish | Backend Engineering | Data integrity / product thesis | scripts/discover-venues.ts:301-303 catch returns 1; threshold CHAIN_LOCATIONS=4 at :77; gate at :608; auto-publish at :18. Source validation fails closed at :623. | On error in londonLocationCount return Infinity (or throw and continue at call site) so an unknown count rejects rather than admits. | XS |
| 12 | Google Places API key embedded in plaintext in public photo URLs | Backend Engineering | Security | scripts/ingest-venues.ts:219; identical at scripts/discover-venues.ts:307. Key stored in venues.img_url, served in client HTML, OG tags, DB. | At ingest, download photo and re-upload to Supabase Storage; store Storage URL in img_url. Add HTTP-referrer/IP restrictions on the GCP key. | M |

### High (40)

| # | Issue | Lens | Category | Evidence | Fix | Effort |
|---|---|---|---|---|---|---|
| 1 | 39 venues is too thin to sustain weekly repeat use, and auto-discovery is throttled to ~3 venues/run on a free tier | Product Strategy | Catalog / Product-market fit | STATE.md ('catalog at 39 venues'); scripts/discover-venues.ts TARGET=3 per run (per recon, deliberately small for Gemini free quota). lib/queries.ts filters google_place_id IS NOT NULL, so demo rows are hidden — the live count is the real ceiling. | Accelerate discovery (paid Gemini tier or wire the stubbed publication adapters in scripts/candidate-sources/*), and lean on the events feed as the recurring-freshness surface until venue count scales. | M |
| 2 | Personalisation is cosmetic but labelled as real ('✨ Sorted around your taste'), and 2 of 4 preference dimensions are dead on arrival | Product Strategy | Personalisation / Trust | app/(auth)/onboarding/onboarding-flow.tsx:32-34,42-47 (single mood + single vibe; budget:null, areas:[] hard-coded at lines 45-46); lib/ranking.ts:78-86 (keyword-substring scorer, +3/+1.5/+1 over 39 venues); explore-feed.tsx:189-193 announces the result as taste-sorted. | Make onboarding multi-select for moods/vibes and collect budget + area (types already support it in UserPreferences), or drop the 'Sorted around your taste' label until the signal justifies it. | M |
| 3 | Onboarding progress bar claims 4 steps but only 2 exist; user dumped to Explore after 2/4 | UX Research / Real-User Walkthrough | Onboarding / Trust | app/(auth)/onboarding/onboarding-flow.tsx:28 (TOTAL_STEPS = 4), :37-38 (stepLabel `${step+1}/4`), only step 0 (mood) and step 1 (vibe) render (:121-145), finish() pushes to /explore (:83) | Set TOTAL_STEPS = 2, or add the two genuinely missing steps (budget, areas) so the indicator matches reality. | XS |
| 4 | Anonymous users start with two 'saved' venues they never saved, and those slugs are hidden demo rows the Saved list cannot render | UX Research / Real-User Walkthrough | Saved / Trust / Data integrity | lib/mock-data.ts:24-27 (MOCK_SAVED_IDS = dishoom-shoreditch, borough-market) seeded into the set at components/saved-context.tsx:50-52; lib/queries.ts fetchVenues filters google_place_id IS NOT NULL (these demo rows are hidden), so saved-list.tsx:39,82 `allVenues.find(...)` returns nothing for them | Remove MOCK_SAVED_IDS or seed only catalog-visible slugs; ensure saved count and rendered list always agree. | XS |
| 5 | Three dead buttons in profile (Give Feedback, Notification prefs, Theme: Auto) have no handlers | UX Research / Real-User Walkthrough | Profile / Fake buttons | app/(main)/profile/profile-body.tsx:103-107 (actionRows array) rendered as <button> with no onClick at :158-169 | Wire each row (real theme toggle via existing theme-provider, mailto/form for feedback) or remove the rows. | S |
| 6 | No sign-in entry point or data-loss warning for anonymous browsers on Explore/Saved | UX Research / Real-User Walkthrough | Auth / Retention | app/(main)/explore/explore-feed.tsx:156-185 header has search only; greeting 'Hi there,' (:158); saves/bookings persist to localStorage only (components/saved-context.tsx:160-170, bookings-context.tsx:213-221); sign-in only reachable from /profile and Plan save CTA | Add a lightweight 'saved on this device — sign in to keep it' nudge on Explore/Saved with a one-tap sign-in link. | S |
| 7 | No App Router error.tsx / global-error.tsx anywhere; the only error boundary covers the (main) group, so any thrown query error on auth, venue/event detail, or booking routes shows Next's raw default error screen on the live site. | frontend-engineering | Error handling / resilience | lib/queries.ts throws Error on Supabase failure; error boundary only at app/(main)/layout.tsx:17-19; no app/**/error.tsx (confirmed in recon pack) | Add app/global-error.tsx plus per-segment error.tsx for venue/[slug], event/[id], booking/[slug]/confirmed and the (auth) group, each with a themed retry UI mirroring components/error-boundary.tsx. | S |
| 8 | Theme is applied only post-hydration via useEffect with no server data-theme or pre-paint script, causing a flash of the wrong (day) theme on every first paint. | frontend-engineering | Theming / perceived performance | components/theme-provider.tsx:6-15 sets document.documentElement.dataset.theme in useEffect; app/layout.tsx:55 renders <html> with no data-theme | Compute the theme on the server from the request time and set data-theme on <html>, or inject a tiny inline <script> in <head> that sets it before first paint. | S |
| 9 | Modals (SearchOverlay, ReserveSheet) declare role=dialog/aria-modal but have no focus trap, no return-focus on close, and ReserveSheet has no Escape handler. | frontend-engineering | Accessibility | components/search-overlay.tsx:82-86 (Escape only, no trap); components/reserve-sheet.tsx:49-71 (no Escape, backdrop is div onClick at :55) | Build one shared Dialog primitive with focus-trap, initial-focus, return-focus on unmount, and Escape; migrate both overlays onto it. | M |
| 10 | Templated editorial blurbs now dominate the live catalogue, making it read generic rather than curated | data-content | Content quality | scripts/discover-venues.ts:442-478 (templateEditorial); live /explore shows templated phrasing 51x vs curated 9x | Route discovered venues to a review queue instead of auto-publishing, and/or restore a per-venue LLM editorial call; add curation_tier ranking | L |
| 11 | Auto-discovered venues get one of only two boilerplate 'Real Talk' critical flags | data-content | Content quality | scripts/discover-venues.ts:463-475 emits 'Check times before you go' or 'Independent — plan ahead'; contrast venues-seed.ts:719-723 Padella | Generate type/source-specific flags, or exclude templated venues from Real-Talk surfaces until enriched | M |
| 12 | Events are effectively single-source (Ticketmaster only) and music-skewed; Food/Club/Comedy near-empty | data-content | Data completeness | scripts/ingest-events.ts:230-238,493-509 (eventbrite/skiddle/dice return []); LONDON_VENUES list lines 156-176 is 13/15 music venues; tmCategory:401-416 dumps misc into Music | Wire the Skiddle adapter (has a clean public API), diversify LONDON_VENUES allowlist | M |
| 13 | Autonomous cron auto-publishes unattended every 4h with no human review or admin gate | data-content | Data governance | .github/workflows/discover-venues.yml cron '15 1,5,9,13,17,21'; discover-venues.ts:690-700 upserts directly to public.venues | Add review-queue step (reuse partner_prospects/admin pattern) before venues go public | M |
| 14 | The signature logo gradient (blue→magenta) never appears in the live UI. The only gradient token --fl-gradient is a different gradient (orange→pink) and is defined but never used anywhere. | Visual Design / Brand | Brand / colour | app/globals.css:21 (--fl-gradient orange→pink), public/logo-fun.png (actual logo is blue→magenta), grep: zero references to --fl-gradient in app/ or components/ | Redefine --fl-gradient to match the logo's blue→magenta stops and apply it to the masthead wordmark, primary CTA, and key accents; ship the logo as inline SVG so the gradient is recolourable. | M |
| 15 | Brand is described as 'purple' but the primary CTA colour is indigo-blue (hsl 233); purple is only a secondary accent, and neither matches the logo's magenta. | Visual Design / Brand | Brand / colour | app/globals.css:17 (--fl-primary hsl(233 70% 55%)), :19 (--fl-accent hsl(265 80% 60%)); venue-detail.tsx:396 primary CTA uses bg-primary (blue) | Pick one identity (purple OR the logo magenta), make it the primary CTA colour, and derive accent + gradient from it. | M |
| 16 | The Explore masthead renders 'fun London' as flat live text in text-primary blue instead of the actual logo, so the home screen brand looks different from splash/onboarding. | Visual Design / Brand | Brand / typography | app/(main)/explore/explore-feed.tsx:162-174 (flat text wordmark); app/splash-client.tsx:64-71 and onboarding-flow.tsx:97 use the gradient PNG logo | Render the real (SVG) logo in the masthead, or at minimum apply the brand gradient to the wordmark text. | S |
| 17 | No sitemap.xml or robots.txt — both 404 on the live domain. Venue/event detail pages are invisible to organic search. | Growth / Marketing | SEO | Recon: no app/sitemap.ts, no app/robots.ts, no public files; live /sitemap.xml and /robots.txt return HTTP 404. Catalog accessors exist (lib/queries.ts fetchVenues/fetchEvents) to generate them. | Add app/sitemap.ts (map fetchVenues -> /venue/[slug], fetchEvents -> /event/[id]) and app/robots.ts allowing crawl + pointing to the sitemap. | S |
| 18 | No structured data (JSON-LD) on detail pages despite having all the fields for rich results. | Growth / Marketing | SEO | Recon: grep for application/ld+json returns NONE. lib/types.ts Venue carries rating, priceTier, openingHours, neighbourhood; Event carries startsAt/venue — ideal for Restaurant/LocalBusiness/Event schema. | Emit Restaurant/LocalBusiness JSON-LD on venue pages and Event JSON-LD on event pages via a <script type=application/ld+json> in the server component. | S |
| 19 | The bare domain forces anonymous visitors through onboarding instead of showing the product. No public landing page. | Growth / Marketing | Acquisition funnel | app/page.tsx:9-17 and app/splash-client.tsx:32-46: anonymous + no localStorage key routes to /onboarding after the splash. No marketing/landing route exists in the route inventory. | Serve a public, indexable landing/explore preview for anonymous visitors at / (real venues + single CTA), and make onboarding optional/deferred rather than a hard gate. | M |
| 20 | No analytics instrumentation on core growth events (share, save, reserve, plan-create, booking-confirm). | Growth / Marketing | Growth analytics | Recon: only <Analytics /> pageview tracking in app/layout.tsx:3,69; no track() on product actions anywhere. Share handlers (venue-detail.tsx:55, event-actions.tsx:25, lobby.tsx:23) and addBooking (did-you-book.tsx:58) emit no events. | Add a thin track() wrapper (Vercel Analytics custom events or PostHog) fired on share, save, reserve-click, plan-created and booking-confirmed. | S |
| 21 | The partner-BD wedge has no operational workflow — partner_prospects is a data table with no admin UI and no evidence of outreach | investor-business | Business Model | schema.sql:151-172 (bd_status defaults 'prospect'); written only by scripts/ingest-venues.ts:356-363; /admin/candidates queries pending_candidates not partner_prospects — no screen reads or progresses bd_status | Build an /admin/prospects view to list and progress bd_status; manually contact 5 venues to validate the wedge | M |
| 22 | The publication candidate-scout (pitched as a curation moat) is entirely stubbed — all six adapters return empty | investor-business | Differentiation | scripts/candidate-sources/{timeout,eater,infatuation,hot-dinners,hardens,square-mile}.ts all 'return []' with TODO docstrings; /admin/candidates EmptyState admits 'scout is currently scaffold-only' | Wire the Time Out RSS adapter first (no API key needed) to prove the scout→review→ingest loop end-to-end | M |
| 23 | Catalogue too small to be credible (39 venues; 19 in BD pipeline; 0 users) | investor-business | Traction | STATE.md:238 (39 venues); day-spots skipProspect:true leaving 19 in partner_prospects; no user records | Lean on the discovery robot (needs paid Gemini Flash to lift the daily-quota ceiling) to scale supply toward hundreds of venues | L |
| 24 | No App Router error boundary on booking, venue, event, sign-in or auth routes; queries throw plain Errors that drop to Next's default error screen. | QA / Testing | Error handling | find app -name error.tsx/global-error.tsx → none; ErrorBoundary wraps only (main) group (app/(main)/layout.tsx:17-19); lib/queries.ts throws Error on Supabase failure | Add app/error.tsx and app/global-error.tsx with the branded fallback; optionally per-segment error.tsx for booking/venue/event. | S |
| 25 | did-you-book.tsx constructs a Date from unvalidated query params and calls .toISOString(); malformed ?d=/?t= throws an uncaught error on a route with no error boundary. | QA / Testing | Form validation / robustness | app/booking/[slug]/confirmed/did-you-book.tsx:52 new Date(`${date}T${time}:00`) then :64 startsAt.toISOString(); params passed unchecked from page.tsx:23-26 | Validate/parse date+time, fall back to today/now or show an inline 'pick your details again' state; never call toISOString on an Invalid Date. | XS |
| 26 | Zero automated tests and no test tooling across the entire repo, including the pure recommendation/booking engines. | QA / Testing | Test coverage | Recon pack: no vitest/jest/testing-library/playwright in package.json; no *.test.* files; CI runs build/lint/typecheck only | Add Vitest; write first specs for lib/plan-engine.ts, lib/booking-link.ts, lib/ranking.ts, lib/opening-hours.ts (all pure, high-value, no DOM). | M |
| 27 | Pinch-zoom disabled via maximumScale: 1 | Performance / SEO / Accessibility | Accessibility | app/layout.tsx:28 (viewport.maximumScale = 1) | Remove maximumScale (or set to >=5) in the viewport export. | XS |
| 28 | 2 MB splash logo shipped on every cold open as the LCP element | Performance / SEO / Accessibility | Performance | app/splash-client.tsx:64-70 loads /logo-fun.png with priority; file public/logo-fun.png = 2,089,385 bytes, 1536x1024, displayed at 240x160 | Re-export the splash mark as optimised WebP/PNG at ~480x320 (<30 kB); keep priority. | S |
| 29 | Unconditional 1.7s blocking splash hold before any content, every visit | Performance / SEO / Accessibility | Performance | app/splash-client.tsx:21,33 (TOTAL_DURATION_MS=1700 setTimeout before router.replace); app/page.tsx:16-17 confirms it runs for onboarded returning users too | Skip or shorten the splash for already-onboarded users; zero the timeout under prefers-reduced-motion. | S |
| 30 | No per-page metadata / Open Graph / Twitter cards on venue & event detail routes | Performance / SEO / Accessibility | SEO | app/venue/[slug]/page.tsx (no generateMetadata); global title only in app/layout.tsx:19-23; recon grep for openGraph/generateMetadata = NONE | Add generateMetadata (title, description, openGraph.images using venue/event photo, twitter card) to /venue/[slug] and /event/[id]. | M |
| 31 | No sitemap.xml or robots.txt | Performance / SEO / Accessibility | SEO | No app/sitemap.ts or app/robots.ts; live /sitemap.xml and /robots.txt return HTTP 404 (recon) | Add app/sitemap.ts enumerating venue/event slugs from queries, and app/robots.ts allowing crawl + pointing to the sitemap. | S |
| 32 | Vercel Analytics runs for all UK/EU visitors with no consent banner | Security / Privacy / Legal | Privacy / PECR consent | app/layout.tsx:3,69 mounts <Analytics/> unconditionally at root; no consent gate anywhere in app/ components/ lib/ | Add a consent banner; conditionally mount <Analytics/> only after consent (or document a defensible legitimate-interest/cookieless position in the privacy policy and offer opt-out). | M |
| 33 | Unvalidated open-redirect via the `return` parameter through sign-in and OAuth callback | Security / Privacy / Legal | Security / Open redirect | app/(auth)/sign-in/page.tsx:33 redirect(searchParams.return ?? '/explore'); app/(auth)/auth/callback/route.ts:24,47 NextResponse.redirect(`${origin}${returnTo}`); return flows from client to OAuth redirectTo at sign-in-form.tsx:33-34,61-62; no startsWith('/')/reject-'//' guard | Validate return: accept only if it startsWith('/') and not startsWith('//') and not startsWith('/\\'); else fall back to /explore. Apply in both page.tsx and callback/route.ts. | XS |
| 34 | pending_candidates table has no definition or RLS in tracked schema; admin page reads it via anon-key client | Security / Privacy / Legal | Security / RLS gap (unverifiable) | grep for 'create table pending_candidates' across supabase/ returns nothing; app/admin/candidates/page.tsx:37-46 selects from pending_candidates using createClient (anon key, lib/supabase/server.ts) | Add pending_candidates create-table + 'no anon' RLS (mirror partner_prospects pattern, schema.sql:331-334) to schema.sql; verify RLS is enabled in prod via Supabase advisor. | S |
| 35 | Core conversion funnel (save / reserve-click / plan-generate / room-join) is completely uninstrumented — only Vercel pageviews exist | Opportunity Agent | Analytics / Data moat | Recon pack: only <Analytics/> in app/layout.tsx:3,69; no track() anywhere in app/lib/components. toggleSaved (components/venue-card.tsx), Reserve deep-link (components/reserve-sheet.tsx:36), computeWalkablePlan (lib/plan-engine.ts:452) all fire with zero logging | Add a thin track() helper (Vercel Analytics custom events or a public.events_log table written via a server action) and call it on save, reserve-click, plan-generate, swipe-complete, room-join | S |
| 36 | Reserve deep-links carry no affiliate/attribution parameters despite affiliate being a named revenue path | Opportunity Agent | Monetisation | lib/booking-link.ts:17-47 buildReserveUrl appends only date/time/party params; no ref/affiliate ID for opentable/resy/thefork cases | Add per-platform affiliate/partner ref params in buildReserveUrl; register affiliate accounts (TheFork/OpenTable affiliate programmes); log clicks via the analytics from the issue above | S |
| 37 | partner_prospects BD table is write-only — captured but never surfaced in any UI | Opportunity Agent | BD / Partner pipeline | schema.sql:151-172 defines rich BD lifecycle (why_qualified, current_booking_method, bd_status, notes); only writer is scripts/ingest-venues.ts:356; only admin UI is /admin/candidates (app/admin/candidates/page.tsx) which reads pending_candidates, not partner_prospects | Build /admin/prospects Server Component mirroring /admin/candidates: bd_status columns, notes editing via Server Action, one-click draft-outreach | M |
| 38 | No error boundaries — queries throw, crashing whole pages to Next's default error screen | Backend Engineering | Resilience / UX | No app/global-error.tsx or route error.tsx exist. Throws at lib/queries.ts:157,169,181,199,211,241 run in Server Components. | Add app/global-error.tsx and segment error.tsx with branded message + retry; consider empty-state fallbacks for non-critical reads. | S |
| 39 | No server-side write/API layer — all user writes are client anon-key calls gated only by RLS, with no input validation | Backend Engineering | Architecture / Security | saved-context.tsx:188-205, bookings-context.tsx:233-249. party_size, notes, status, starts_at trusted from client. No rate limiting. | Server Actions/route handlers for save and booking writes with Zod validation + ownership checks; keep RLS as defence-in-depth. | M |
| 40 | Admin authorisation is a hardcoded personal Gmail as the env default with no DB role table | Backend Engineering | Security / Access control | lib/auth.ts:31-36 default "mp.aranzales@gmail.com"; used by admin/candidates/page.tsx:33 and actions.ts:24. | Fail closed: default to empty; throw at boot if missing in production. Move to a DB admin_users role table. | S |

### Medium (49)

| # | Issue | Lens | Category | Evidence | Fix | Effort |
|---|---|---|---|---|---|---|
| 1 | 'Booking-aggregator agent' is overstated — there is no agent, no availability, no held booking; it is deep-link + manual self-report | Product Strategy | Positioning / Expectation-setting | components/reserve-sheet.tsx:32-44 (window.open to venue platform); app/booking/[slug]/confirmed/did-you-book.tsx (user self-reports the booking); lib/booking-link.ts header comment concedes 'we can't show live availability'. | Describe the product as 'discovery + one-tap deep-link booking' externally; reserve 'agent'/availability language for when real inventory exists. The in-product honesty is already good — match the marketing to it. | XS |
| 2 | Onboarding taste labels mismatch their values and map to non-existent surfaces | UX Research / Real-User Walkthrough | Personalization / Taxonomy | onboarding-flow.tsx:14-19 (label 'Live Music' value 'culture'; label 'Comedy' value 'activity'); lib/ranking.ts:13-18 maps 'drinks'→'Club'; events-feed.tsx:30-40 has no Club category and explore-feed.tsx:247-254 has no Club chip | Align labels with values and ensure every mood maps to a category/filter that actually exists; implement or drop 'Club'. | S |
| 3 | Plan-Together runs the full group-voting flow with a single user | UX Research / Real-User Walkthrough | Plan Together / Confusion | app/(main)/plan/together/_steps/lobby.tsx:111-124 shows 'Waiting for someone to join…' yet 'Start swiping (1)' is always enabled; swipe.tsx proceeds solo | Require ≥2 present members to start, or explicitly reframe as 'works solo or with friends'. | S |
| 4 | Fabricated local booking reference shown as 'Ref' looks like a real reservation number | UX Research / Real-User Walkthrough | Booking / Trust | app/booking/[slug]/confirmed/did-you-book.tsx:57 (ref = slug prefix + random 1000-9999); rendered 'Ref {b.id}' in saved-list.tsx:64-65 | Relabel as a personal note (or remove); never present an internal random id as a venue reference. | XS |
| 5 | No error.tsx covers venue/event/booking/plan-together routes | UX Research / Real-User Walkthrough | Resilience / Polish | Recon pack: no app/**/error.tsx except (main) ErrorBoundary (app/(main)/layout.tsx:17); lib/queries.ts throws on failure; venue/[slug] and event/[id] are outside (main) | Add branded error.tsx boundaries for the venue, event, booking and plan/together segments. | S |
| 6 | Three plan hero photos are injected as CSS background images instead of next/image — no optimisation, lazy-loading, or alt text. | frontend-engineering | Images / performance / a11y | app/(main)/plan/plan-flow.tsx:353; app/(main)/plan/together/_steps/result.tsx:170; app/(main)/plan/together/_steps/swipe.tsx:105 | Replace the background-url divs with an absolutely-positioned next/image fill (same unoptimized=googleapis pattern as venue-card.tsx:63). | S |
| 7 | viewport sets maximumScale: 1, disabling pinch-to-zoom. | frontend-engineering | Accessibility | app/layout.tsx:28 | Remove maximumScale (and userScalable if present) from the Viewport export. | XS |
| 8 | Optimistic save/booking DB writes are fire-and-forget and only console.error on failure, with zero analytics on these actions, so silent persistence failures are invisible. | frontend-engineering | State management / observability | components/saved-context.tsx:188-206; components/bookings-context.tsx:233-249; recon pack: analytics is pageview-only | Surface write failures (toast / revert) and add event instrumentation on save/reserve/booking outcomes. | M |
| 9 | Dual-mode (localStorage ↔ Supabase) hydrate/migrate/persist logic is duplicated almost line-for-line across the two contexts. | frontend-engineering | Maintainability / duplication | components/saved-context.tsx:57-214 vs components/bookings-context.tsx:77-271 — same 3-step migrate pattern, slugToUuidRef, fire-and-forget writes | Extract a generic useSyncedStore(authUserId, {table, storageKey, toRow, fromRow}) hook used by both providers. | M |
| 10 | plan-flow.tsx is a 463-line client component mixing setup form, engine call, Supabase save/load, saved-plan re-open branching, and two full screens. | frontend-engineering | Maintainability | app/(main)/plan/plan-flow.tsx (463 lines); openedSaved vs computed branching at :99-116,:163-196; editInputs invalidation wrapper at :192-196 | Split into PlanSetup, PlanResult presentational components and a useSavedPlans data hook; lift Group/Chip into shared primitives. | M |
| 11 | Primary-CTA class string is hand-duplicated across 5+ files; 241 arbitrary Tailwind bracket utilities with no typography scale. | frontend-engineering | Design-token consistency | CTA string repeated at plan-flow.tsx:280, profile-body.tsx:58, event-detail.tsx:148, sign-in-form.tsx:157, reserve-sheet.tsx:130; text-[11px] x44, h-[52px] x13 (grep) | Add a Button primitive and a typography token set (e.g. text-eyebrow/body/heading) and refactor call sites. | M |
| 12 | Geographic concentration in east/south-east London; west/NW/SW absent | data-content | Data completeness | scripts/discover-venues.ts:82-99 NEIGHBOURHOODS; venues-seed.ts neighbourhood distribution (Soho 4, then Shoreditch/Dalston/Bermondsey/Columbia Rd/Borough 2 each) | Add west/NW/SW neighbourhoods to discovery grid and curated seed | S |
| 13 | Hard-coded fabricated operational data (walking_mins=12, tables_free=4, next_slot='Open today') stored on every venue | data-content | Data integrity | scripts/discover-venues.ts:659-661; scripts/ingest-venues.ts:246-248; schema.sql:43-45 NOT NULL | Make these columns nullable and stop writing placeholder values | S |
| 14 | Candidate-scouting pipeline is entirely stubbed; the multi-publication discovery path doesn't exist | data-content | Data completeness | scripts/candidate-sources/*.ts all return [] (infatuation.ts:21-29 etc.); scout-candidates.ts has no real inputs | Implement at least one real adapter (Time Out or Infatuation listing scrape) or formally retire scout-candidates | L |
| 15 | Two quality tiers written to one table with no distinguishing column | data-content | Data architecture | ingest-venues.ts and discover-venues.ts both upsert public.venues; lib/queries.ts only filters google_place_id IS NOT NULL | Add curation_tier enum column; rank/badge accordingly | S |
| 16 | seed.sql destructive 'delete from' with no guard cascades to user saves/bookings | data-content | Data integrity | supabase/seed.sql:18-19; FK on delete cascade schema.sql:115,124 | Gate seed behind an explicit env flag or move to a separate dev-only file | XS |
| 17 | App icon is declared maskable but is not full-bleed; it has a baked-in rounded tile plus transparent margins. | Visual Design / Brand | Iconography | public/manifest.json (apple-icon.png purpose:'maskable'); app/icon.png (viewed: rounded tile + transparent border) | Export a full-bleed maskable variant (artwork fills canvas, key content within inner 80% safe zone); keep a separate 'any' icon with padding. | S |
| 18 | Only one typeface (Plus Jakarta Sans) used for everything; no display/editorial face. | Visual Design / Brand | Typography | app/layout.tsx:11-17; tailwind.config.ts:20-22 (single sans family) | Add a characterful display face for H1s/eyebrows/masthead; keep Jakarta for body. | M |
| 19 | 2 MB PNG logo on the splash critical path for a simple gradient wordmark. | Visual Design / Brand | Performance / asset | public/logo-fun.png = 2,089,385 bytes; loaded priority on splash (splash-client.tsx:64-71) and onboarding | Replace with an inline SVG wordmark (few KB); unlocks in-app gradient recolour/animation too. | S |
| 20 | Onboarding (first-impression) screen uses OS emoji as primary visuals and mislabels values (culture→'Live Music', activity→'Comedy'). | Visual Design / Brand | Iconography / consistency | app/(auth)/onboarding/onboarding-flow.tsx:14-26 | Replace emoji with brand icons/illustrations; align labels with the Mood/Vibe enums. | M |
| 21 | All venue/event imagery is third-party Google Places photos served unoptimized, with no brand imagery or empty-state illustration. | Visual Design / Brand | Imagery | venue-card.tsx:53-65, event-card.tsx:31-37, venue-detail.tsx:108-118 (unoptimized for googleapis.com); explore-feed.tsx:195-197 bare-text empty state | Add brand imagery/illustration layer and empty-state art; treat Places photos as fallback; consider art-directed cropping. | L |
| 22 | Post-booking success screen has no share trigger — the highest-dopamine moment is wasted. | Growth / Marketing | Organic-share trigger | app/booking/[slug]/confirmed/did-you-book.tsx:136-163 — the 'You're in 🎉' state offers only 'See it in Coming up' and 'Back to exploring'; no share CTA. | Add a 'Tell a friend you're going' share button using shareOrCopy with the venue URL on the confirmed state. | S |
| 23 | Profile 'Notification prefs', 'Give Feedback' and 'Theme: Auto' are dead stub buttons implying re-engagement channels that don't exist. | Growth / Marketing | Retention | app/(main)/profile/profile-body.tsx:103-107 and 158-169 — plain <button> elements in actionRows with no onClick handler. | Either implement a real notification opt-in (web push) and feedback capture, or remove the stub rows until built. | M |
| 24 | Desktop share copies a bare URL to a blank-preview page; share text is minimal and the fallback gives no context. | Growth / Marketing | Social sharing | lib/share.ts:27-32 copies only data.url on the clipboard path; venue-detail.tsx:58 share text is just name + neighbourhood; URL is window.location.href with no OG behind it. | Once OG metadata lands, the copied URL will preview correctly; additionally enrich share text and consider copying title+URL together. | XS |
| 25 | No email/newsletter capture for the anonymous majority; no lifecycle channel. | Growth / Marketing | Retention / Lifecycle | Confirmed no newsletter/subscribe in app/lib/components (only Supabase Realtime channel.subscribe in lib/realtime/room.ts:225). Auth is magic-link only. Bookings are client-context only (did-you-book.tsx:58), no server record to drive reminders. | Add a lightweight 'weekly London drop' email capture for anonymous users and persist bookings server-side to enable reminder emails. | M |
| 26 | Auto-published editorial is templated, not the 'brat' voice that justifies a consumer subscription | investor-business | Differentiation | STATE.md:266-268 (Gemini calls 3→1, editorial now TEMPLATED to survive free tier); recon pack confirms formulaic vibe/long_description/critical_flags | Restore full LLM editorial on paid Gemini Flash, or hand-pass robot venues before publish | S |
| 27 | No SEO surface for a public discovery product on a live domain | investor-business | Growth | Recon pack: no OG/Twitter/JSON-LD, no generateMetadata on venue/event routes; /sitemap.xml and /robots.txt return 404 live | Add per-page generateMetadata (OG + JSON-LD LocalBusiness) on venue/event routes; add app/sitemap.ts and app/robots.ts | M |
| 28 | Events tab is structurally thin and will not be a primary engagement driver | investor-business | Product Strategy | project_business_model.md:134-150 (most catalog never sells tickets; Cafe OTO 0 events, Tayer no record); 17 events from one subscription | Reframe events as a per-venue 'what's on' widget rather than a standalone tab; focus monetisation on restaurant covers | S |
| 29 | Plan My Night (solo) can render a plan with zero steps and a malformed title when the venue pool is empty. | QA / Testing | Empty data state | lib/plan-engine.ts:268-293 chosen[] can be empty → steps[] empty; app/(main)/plan/plan-flow.tsx:65 toDisplay title `${vibe} Night in ${plan.area}` with area '' (plan-flow.tsx:92 areas[0] ?? ''); result view (340) maps empty steps | Guard for steps.length===0 in plan-flow result and show a 'couldn't build a plan here — try another area' message, mirroring the group path's unfilledRoles. | S |
| 30 | Magic-link rate-limit (Supabase ~3-4/hr → 429) surfaces as a raw error string with no cooldown UI or client throttle. | QA / Testing | Form validation / UX | app/(auth)/sign-in/sign-in-form.tsx:75-78 setError(otpError.message); rendered raw at :167-169; no resend cooldown anywhere | Detect 429/rate-limit in otpError and show a friendly 'we just sent one — check spam or wait a few minutes' message; add a client-side resend cooldown timer. | S |
| 31 | Plan Together room state is ephemeral (Realtime presence/broadcast, no DB); if the host disconnects, late joiners may never converge and there is no recovery UI. | QA / Testing | State consistency | lib/realtime/room.ts (Broadcast has no replay; host re-broadcasts state on presence-join per in-file note); together-flow.tsx:54-56 host = room creator only | Persist minimal room state (settings/phase/votes) to a DB table keyed by code, or elect a new broadcaster on host-leave; show a 'host left — restart room' fallback. | L |
| 32 | Morning/Afternoon mood decks depend on Outdoors/Culture/Market venue types the night-biased auto-discovery catalog may not supply, degrading the group result to a single stop. | QA / Testing | Empty data state | lib/plan-together-moods.ts:38-121 (Morning/Afternoon roles → Outdoors/Culture/Market); app/(main)/plan/together/_steps/result.tsx:65-69 roles fall back to ['Start'] when nothing hearted fills a role | Validate deck viability against the live catalog before showing the deck; hide moods whose types have no open venues, or warn the host their area/time has thin daytime coverage. | M |
| 33 | muted-fg small text fails WCAG AA contrast on cream background | Performance / SEO / Accessibility | Accessibility | globals.css:11 (--fl-muted-fg #756c5d) on globals.css:6 (--fl-bg #f0eee9) = 4.46:1; applied to text-[10.5px]/text-[11px] in venue-card.tsx:80, event-card.tsx:52,57, reserve-sheet.tsx:79,90 | Darken --fl-muted-fg (day) to reach >=4.5:1, e.g. ~#6a6052 or darker. | XS |
| 34 | Primary purple as text fails contrast on the night theme | Performance / SEO / Accessibility | Accessibility | --fl-primary hsl(233 70% 55%) on --fl-bg night #14110d = 2.99:1; primary used as text in venue-detail.tsx:263, not-found.tsx:11, admin eyebrows | Don't use raw --fl-primary for text on dark surfaces; introduce a lightened primary-on-dark token or use --fl-heading. | S |
| 35 | No App Router error.tsx outside the (main) group | Performance / SEO / Accessibility | Performance | No app/**/error.tsx or global-error.tsx (recon); lib/queries.ts throws on DB failure; ErrorBoundary only wraps app/(main)/layout.tsx:17 | Add app/error.tsx (root) and ideally per detail route with a branded retry UI. | S |
| 36 | All routes no-store / fully dynamic; catalogue not edge-cached | Performance / SEO / Accessibility | Performance | Live cache-control: private,no-cache,no-store on /; build marks nearly all routes ƒ dynamic; content changes only ~every 4h (discover cron) | Use ISR (revalidate aligned to the 4h discovery cadence) for venue/event listing and detail pages instead of force-dynamic/no-store. | M |
| 37 | Admin allowlist defaults to a hardcoded personal Gmail committed to git | Security / Privacy / Legal | Security / Access control | lib/auth.ts:31-32 default 'mp.aranzales@gmail.com' when FL_ADMIN_EMAILS unset | Fail closed: default to empty set when FL_ADMIN_EMAILS is unset; remove the literal email. Optionally move to a DB role table. | XS |
| 38 | No rate-limit / captcha on magic-link OTP send (email-bomb vector) | Security / Privacy / Legal | Security / Abuse | app/(auth)/sign-in/sign-in-form.tsx:67 signInWithOtp on each submit; no client cooldown, no captcha, no app-side throttle | Add a client-side cooldown + Supabase Auth captcha (hCaptcha/Turnstile) on the OTP form; rely on/verify Supabase rate-limit settings. | S |
| 39 | Plan persistence is half-wired: plans are inserted but never fetched/re-surfaced | Opportunity Agent | Feature completeness | app/(main)/plan/plan-flow.tsx:142 inserts into public.plans; grep confirms no fetchPlans() in lib/queries.ts and no read of the plans table anywhere | Add fetchPlans(userId) to lib/queries.ts and surface saved plans on /plan or /saved; pass authUserId through | S |
| 40 | Auto-discovery auto-publishes to production with no post-publish quality gate and weak source-URL validation | Opportunity Agent | Content quality / Risk | discover-venues.ts:690-700 upserts directly to public.venues; validateSources only checks url.startsWith('http') (discover-venues.ts:399) — a Gemini-hallucinated source URL passes the integrity gate | HEAD-check each validated source URL returns 2xx before counting it; add an /admin dashboard of last-N auto-published venues for spot review | S |
| 41 | Discovery throughput throttled to ~3 venues/run by free-tier Gemini — the core moat is rate-limited by a deferred cost decision | Opportunity Agent | Moat / Strategy | discover-venues.ts:44 TARGET=3; GEMINI_MIN_GAP_MS=4500 (:320); STATE.md:274-275 'free daily cap is the real ceiling… genuine unlock is pay-as-you-go Gemini Flash (cents), deferred until launch' | Enable pay-as-you-go Gemini Flash, raise TARGET, and add an overnight brat-voice rewrite pass over templated editorial | XS |
| 42 | No SEO surface on a publicly-indexed discovery product with 39 editorial venue pages | Opportunity Agent | Growth / SEO | Recon pack: no openGraph/JSON-LD/sitemap/robots; app/layout.tsx ships title+description only; /sitemap.xml and /robots.txt return 404 on www.funldn.com | Add generateMetadata + JSON-LD (Restaurant/Event schema) per detail route, app/sitemap.ts (driven by fetchVenues/fetchEvents), app/robots.ts, OG images | M |
| 43 | Re-engagement is non-existent; the 'Notification prefs' profile row is decorative | Opportunity Agent | Retention | profile-body.tsx:105 shows '💜 Notification prefs' action row; grep confirms no push/web-push/service-worker code exists anywhere | Phase 1: weekly 'new this week near venues you saved' email (Resend, already a pending dependency); Phase 2: web push for tonight's nearby events | L |
| 44 | fetchEvents 'today' boundary computed in UTC, not Europe/London — drops late-night events during BST | Backend Engineering | Correctness / timezone | lib/queries.ts:191-192 setUTCHours(0,0,0,0); filter .gte at :197. | Compute start-of-day in Europe/London (date-fns-tz or Intl offset) before .gte(). | S |
| 45 | Four of five event provider adapters are non-functional stubs | Backend Engineering | Feature completeness | scripts/ingest-events.ts:230-238 (Eventbrite), :493 (Skiddle), :501 (DICE) return []. Only Ticketmaster wired. | Wire Eventbrite + Skiddle (public APIs); document DICE (no public API). Gate behind keys as Ticketmaster is. | L |
| 46 | Cron workflows have no failure alerting; silent failure on quota/API errors | Backend Engineering | Operations / observability | .github/workflows/discover-venues.yml, events-ingest.yml, maintenance.yml render summaries if:always() but no failure() notification. Discovery depends on Gemini + Places free tiers. | Add an if:failure() step posting to Slack/email or opening a GitHub issue; surface 429 counts in summary. | S |
| 47 | Hard-coded fabricated live-availability fields written to every venue | Backend Engineering | Data integrity | scripts/ingest-venues.ts:246-248 walking_mins:12, tables_free:4, next_slot_label:"Open today" on every venue (detail page hides them; card may not). | Make nullable; hide UI when null; compute walking_mins from geolocation; source tables_free from booking platform or drop. | M |
| 48 | Saved/booking writes are fire-and-forget; failures only console.error and rely on next-mount reread | Backend Engineering | Data integrity / UX | saved-context.tsx:182-206 (no revert); bookings-context.tsx:233-249,255-268. | On write error revert optimistic state and show a retry toast; treat bookings as must-confirm. | S |
| 49 | Scalability: fetchVenues selects '*' unbounded; client contexts fetch the entire venues table on every signed-in mount | Backend Engineering | Scalability / performance | lib/queries.ts:150-159 select('*'); saved-context.tsx:86-89, bookings-context.tsx:107-109 fetch all venues per mount. | Paginate/limit + select needed columns; replace client slug→uuid full-table map with a join or indexed RPC. | M |

### Low (20)

| # | Issue | Lens | Category | Evidence | Fix | Effort |
|---|---|---|---|---|---|---|
| 1 | Mood/vibe taxonomy is semantically muddled — enum values are re-labelled twice and drift from user-facing copy | Product Strategy | Taxonomy / Maintainability | app/(auth)/onboarding/onboarding-flow.tsx:16-18 (mood 'culture' shown as 'Live Music', 'activity' as 'Comedy'); lib/ranking.ts:13-18 re-maps the same enums to event categories ('culture'->Music, 'activity'->Comedy). | Rename the Mood enum to match user-facing labels (e.g. liveMusic, comedy) or document the mapping in one place; collapse the double re-map. | S |
| 2 | Mood swipe cards use a real venue photo as backdrop, implying you are voting on that venue | UX Research / Real-User Walkthrough | Plan Together / Confusion | app/(main)/plan/together/_steps/swipe.tsx:103-120 renders mood label over `url(${venue.imgUrl})`; only a small '{emoji} mood' pill distinguishes it (together-flow.tsx:145-157 pickQuestionVenues) | Make the 'mood, not this venue' distinction explicit, or use non-venue mood imagery. | S |
| 3 | Cannot save events, yet /saved is framed as 'Your spots' | UX Research / Real-User Walkthrough | Saved / Feature gap | components/event-card.tsx and app/event/[id]/event-detail.tsx expose no save control; saved-list.tsx only handles venues + bookings | Add event saving to the saved-context model and surface it in /saved. | M |
| 4 | Swipe card can crash if the venue pool is empty — venue may be undefined and venue.imgUrl is dereferenced. | frontend-engineering | Robustness | app/(main)/plan/together/together-flow.tsx:145-157 fallback chain; app/(main)/plan/together/_steps/swipe.tsx:95,105 (venue.imgUrl) | Guard for empty questionVenues and render an empty-state; add the error.tsx safety net. | S |
| 5 | Realtime votes/swaps/plan exist only in Broadcast with no persistence; host disconnect loses the whole session. | frontend-engineering | Realtime architecture | lib/realtime/room.ts (Presence + Broadcast, no DB tables; documented :3-10) | Optionally persist room state to a lightweight table or promote a new host on presence-leave. | L |
| 6 | Heading hierarchy is inconsistent — several screens render h2 with no h1, and the reserve sheet injects a second h2 onto a page that already has an h1. | frontend-engineering | Accessibility (semantics) | swipe.tsx:115 (h2, no h1); reserve-sheet.tsx:73 (h2) opened over venue-detail.tsx:181 (h1) | Ensure each route has exactly one h1 and dialogs use an aria-labelledby heading at the correct level. | S |
| 7 | instagram_handle field is dead — never populated anywhere | data-content | Data completeness | ingest-venues.ts:259 null; discover-venues.ts:671 null; 0 occurrences in venues-seed.ts | Backfill manually for curated venues or drop the field | S |
| 8 | --coral brand token is referenced in code comments but never defined; amber-500 is used as a fallback. | Visual Design / Brand | Colour system | app/venue/[slug]/venue-detail.tsx:186-187 (comment: 'No brand --coral token defined in globals.css') | Define --coral in globals.css (day+night) and use it, or remove the dependency and standardise on amber. | XS |
| 9 | Logo component hardcodes a 1.5 aspect with large transparent margins; sizing is a fudge. | Visual Design / Brand | Brand asset | components/logo.tsx:13-20 (ASPECT all 1.5, comment explains re-export); public PNGs are 1536×1024 with the wordmark ~half width | Re-export tightly-cropped assets (or SVG with a real viewBox) and set true per-variant aspect ratios. | S |
| 10 | Single-key-person risk: admin gated by a hardcoded personal Gmail, solo founder | investor-business | Org/Diligence | lib/auth.ts:32 hardcoded default mp.aranzales@gmail.com; no DB role table | Move admin allowlist fully to env/DB role; document founding-team plan | XS |
| 11 | 4-character room codes from a reduced alphabet on a public, auth-free URL invite collisions and guessing. | QA / Testing | Security / correctness | lib/realtime/room.ts randomRoomCode (4 chars, ambiguous chars removed); together-flow.tsx:50-55 reads ?room= with no validation; lobby.tsx:17-19 shares the link | Increase to 6 chars and/or namespace with a random suffix; rate-limit/validate room codes server-side if rooms move to DB. | S |
| 12 | Admin route allowlist defaults to a hardcoded personal Gmail address. | QA / Testing | Security | lib/auth.ts:32 default FL_ADMIN_EMAILS = 'mp.aranzales@gmail.com' | Fail closed (no admins) when FL_ADMIN_EMAILS is unset, and log a warning; remove the hardcoded fallback. | XS |
| 13 | event-card images bypass the optimizer guard used elsewhere (no unoptimized handling) | Performance / SEO / Accessibility | Performance | components/event-card.tsx:31-37 has no unoptimized prop, unlike components/venue-card.tsx:63; event hosts are *.ticketm.net / images.universe.com / Google per next.config.js:11-24 | Apply the same unoptimized guard (or a deliberate decision) to event-card images. | XS |
| 14 | ThemeProvider runs a 60s setInterval for the whole session | Performance / SEO / Accessibility | Performance | components/theme-provider.tsx:13 setInterval(apply, 60_000) | Replace the interval with a setTimeout scheduled to the next 06:00/18:00 boundary, re-armed on fire. | S |
| 15 | Splash hardcodes black background, mismatching themed surfaces | Performance / SEO / Accessibility | Accessibility | app/splash-client.tsx:55 background:'#000' vs manifest.json/layout.tsx:36-37 cream/dark theme backgrounds | Set the splash background to the theme surface token (or a brand colour consistent with the manifest). | XS |
| 16 | Maskable PWA icon has no safe-zone padding | Performance / SEO / Accessibility | Accessibility | public/manifest.json declares /apple-icon.png purpose:maskable but it is a full-bleed 1024x1024 square (app/apple-icon.png) | Provide a separate maskable icon with ~20% safe-zone padding. | XS |
| 17 | No global error boundary; booking/auth/detail routes fall back to Next default error UI | Security / Privacy / Legal | Security / Reliability | Recon: no app/**/error.tsx or app/global-error.tsx; only error-boundary wraps app/(main)/layout.tsx; lib/queries.ts throws raw Error | Add app/global-error.tsx and route-group error.tsx for booking/venue/event; ensure no stack traces reach the client in production. | S |
| 18 | Venue→events cross-sell index exists but is never rendered on venue pages | Opportunity Agent | Feature / Cross-sell | schema.sql:106-109 events_venue_starts_idx built 'for the future this venue's upcoming events surface'; 17 live events (STATE.md:141); /venue/[slug]/venue-detail.tsx renders no events | Add fetchEventsForVenue(venueId) and a small 'What's on here' block on /venue/[slug] | S |
| 19 | Realtime rooms have a trivially enumerable 4-char code space and no abuse controls or TTL | Opportunity Agent | Security / Abuse | lib/realtime/room.ts:116-121 randomRoomCode is 4 chars from a 31-char alphabet (~924k space, no auth, no rate-limit); broadcast self:true with no validation | Lengthen codes to 6, add a short room TTL, and validate broadcast payloads against the host id | S |
| 20 | Server Actions swallow all errors and return void — no admin feedback on failed mutations | Backend Engineering | UX / reliability | app/admin/candidates/actions.ts:74-77 logs to console and returns. | useActionState with inline error display, or redirect with error toast param. | S |
