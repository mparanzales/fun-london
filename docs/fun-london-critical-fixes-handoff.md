# Critical fixes — handoff & manual steps for Maria

This covers the parts of the 12 Critical issues that **can't be done in code** — they need you to click around in a console or paste a key. Everything else is already fixed in the codebase (see the summary at the bottom). Nothing here is urgent-as-in-broken; the code is safe and live without these. They unlock security hardening, revenue, sign-ups and retention.

Plain English first, exact steps after.

---

## 1. Turn off the exposed Google key (C3 / C9 / C12) — security

**What's wrong:** every venue photo URL on the site currently contains your Google Places API key in plain text. Anyone can copy it and run up your Google bill.

**What I did in code:** added an optional "photo mirror" — when switched on, the ingestion scripts download each photo and re-host it on your own Supabase storage, so the public URLs no longer contain the key. It's *off by default* so nothing breaks until you do the steps below.

**Your steps (~15 min + a script run):**
1. Supabase dashboard → **Storage** → **New bucket** → name it `venue-photos` → tick **Public** → create.
2. Add `FL_PHOTO_BUCKET=venue-photos` to:
   - your local `.env.local`, and
   - the **GitHub Actions secrets** used by the ingest/discover/maintenance workflows.
3. From the app folder, run `pnpm ingest` (this rewrites every venue's photo to the keyless Storage URL). Let the discovery/maintenance crons run once too.
4. Check it worked: `curl https://www.funldn.com/explore | grep AIza` — it should print **nothing**.
5. **Only then**, in Google Cloud Console → APIs & Services → Credentials → your Places key → **rotate/regenerate it**, and add an **API restriction** (Places API only) + a **daily quota cap**. Update `GOOGLE_PLACES_API_KEY` everywhere it's stored.

---

## 2. Finish Google sign-in + unlimited emails (C7) — get real users

**What's wrong:** Google sign-in was never finished (0 Google users) and magic-link emails are throttled to ~3–4/hour, so you can't onboard testers.

**This is entirely console work — no code needed.**

**Google OAuth (~20 min):**
1. Google Cloud Console → **APIs & Services → OAuth consent screen** → publish the app (or add your testers' emails as test users).
2. **Credentials → Create credentials → OAuth client ID → Web application**. Authorised redirect URI:
   `https://fxfuzabrivuianfwdopc.supabase.co/auth/v1/callback`
3. Copy the **Client ID + Client Secret** → Supabase dashboard → **Authentication → Providers → Google** → paste both → enable.
4. Test "Continue with Google" on `/sign-in`.

**Custom email sender — Resend (~20 min):**
1. Create a [Resend](https://resend.com) account, verify your `funldn.com` domain (DNS records go in Cloudflare).
2. Create an API key.
3. Supabase dashboard → **Project Settings → Authentication → SMTP** → enable custom SMTP and enter Resend's host/port/user/key. This removes the 3–4/hour cap.

---

## 3. Switch on affiliate revenue (C5) — money

**What I did in code:** every outbound booking/ticket link now carries UTM attribution automatically, and will carry an affiliate id the moment you provide one (env-driven, currently a safe no-op). The reserve + ticket clicks are also now tracked.

**Your steps (external approval takes weeks, so start now):**
1. Apply to: **OpenTable** Affiliate/Partner Program (start here — catalogue is restaurant-heavy), **Resy**, and **Awin** (for Ticketmaster).
2. When approved, paste each id into the matching env var (local `.env.local` + Vercel):
   `NEXT_PUBLIC_AFFILIATE_OPENTABLE`, `NEXT_PUBLIC_AFFILIATE_RESY`, `NEXT_PUBLIC_AFFILIATE_TICKETMASTER`, etc.
3. Confirm the exact param name each programme expects (mine are sensible defaults in `lib/affiliate.ts`) and adjust if needed.

---

## 4. Retention loop (C2) — get people back

**Status: blocked on #2 (needs the email sender).** This is the one Critical that's genuinely a build, not a toggle, and it can't send anything until Resend is wired.

**The plan once email works:**
- A weekly "New in London" digest: newly-discovered venues + this week's events, emailed to signed-in users.
- A "a place you saved is on this week" nudge (we already capture saved venues + magic-link emails).
- The analytics added in this batch (saves, plans, reserve-clicks) will measure whether it works.

I've left this un-built deliberately rather than ship dead code; it's the first thing to build right after Resend is live.

---

## ✅ Already fixed in code this session (no action needed)

- **C11** Chain detection now fails *closed* (a Google error can no longer let chains auto-publish).
- **C8** Fake "confirmed" booking + random "Ref" removed — now honestly labelled "self-added, not a venue confirmation"; booking date params validated.
- **C1** Value proposition now visible on the first screens (onboarding line, Explore tagline, venue trust badge "Independent · No chains · Checked in N sources"); onboarding progress bar no longer lies.
- **C6** Full funnel analytics added (save, reserve-click, event-ticket-click, plan-generate/reshuffle, share, onboarding-complete, room create/join, booking self-log).
- **C5** Affiliate + attribution tagging plumbed into all outbound links (awaits your ids).
- **C4** SEO/sharing: per-page titles + Open Graph, dynamic OG share images, sitemap.xml, robots.txt, and Restaurant/Event structured data.
- **C10** Privacy / Terms / Cookies pages + a cookie-consent banner gating analytics; legal links in profile + footer.

Verified: `pnpm build`, `pnpm typecheck`, `pnpm lint` all pass; key screens checked live in the browser.
