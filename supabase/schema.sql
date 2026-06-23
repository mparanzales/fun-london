-- ─────────────────────────────────────────────────────────
-- Fun London — schema (v2)
--
-- Aligned with lib/types.ts as of 2026-05-15. When the
-- consumer app swaps from lib/mock-data.ts to Supabase, the
-- accessors in lib/mock-data.ts can be replaced with
-- one-to-one queries against these tables.
--
-- Paste this whole file into the Supabase SQL editor and Run.
-- ─────────────────────────────────────────────────────────

-- Profiles (1:1 with auth.users) — backs the `User` type
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  preferences jsonb,         -- { moods, vibes, budget, areas }
  onboarded boolean not null default false,
  -- Weekly "new in London" digest opt-in (default OFF — explicit consent).
  -- email_unsub_token backs the one-click unsubscribe link (no login needed);
  -- it is secret, but profiles RLS is self-read only so it never leaks.
  email_weekly_opt_in boolean not null default false,
  email_unsub_token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);

-- Idempotent for databases created before the digest columns existed
-- (schema.sql is re-runnable; `create table if not exists` will not alter an
-- existing table, so add the columns explicitly). Existing rows are backfilled
-- with the defaults (opt-in false, a fresh unsubscribe token).
alter table public.profiles
  add column if not exists email_weekly_opt_in boolean not null default false,
  add column if not exists email_unsub_token uuid not null default gen_random_uuid();

-- Venues — backs the `Venue` type
-- Renamed from `places` in v1. Columns expanded to match the v2 Venue type
-- (longDescription, reviewCount, walkingMins, tablesFree, nextSlotLabel,
--  address, lat, lng) that the venue detail page renders.
-- v3 (Phase 4): added real-venue ingestion columns (google_place_id,
-- booking_links, website_url, phone, instagram_handle, editorial_sources).
create table if not exists public.venues (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  type text not null,                      -- VenueType enum (text-encoded)
  vibe text not null,                      -- short card tagline
  long_description text not null,          -- detail-page paragraph
  neighbourhood text not null,
  address text not null,
  lat double precision,                    -- nullable
  lng double precision,                    -- nullable
  price text not null,                     -- PriceTier
  time_of_day text not null,               -- TimeOfDay
  rating numeric(2,1) not null,
  review_count integer not null default 0,
  walking_mins integer not null default 0,
  tables_free integer not null default 0,
  next_slot_label text not null,
  img_url text not null,
  mood_tags text[] not null default '{}',
  vibe_tags text[] not null default '{}',
  -- Real-venue ingestion (Phase 4). All nullable so the existing 11 demo
  -- rows remain valid; populated by scripts/ingest-venues.ts when adding
  -- real venues sourced from Google Places + cross-referenced editorial.
  google_place_id text unique,             -- canonical id, lets us re-sync
  booking_links jsonb,                     -- [{platform, url, priority}]
  website_url text,
  phone text,
  instagram_handle text,
  editorial_sources jsonb,                 -- [{publication, url, title, date}]
  -- Phase 4.5 — creator coverage + critical flags (the "Real Talk" UI
  -- surface). Both nullable.
  creator_coverage jsonb,                  -- [{creator, handle, platform, url, verdict, follower_count?}]
  critical_flags jsonb,                    -- [{label, body}] — "Expect 20-min queue"
  -- Phase 5 (Tier 1 maintenance) — sync metadata, written by
  -- scripts/refresh-venues.ts on a daily GitHub Actions cron.
  last_synced_at timestamptz,              -- last time Google Places re-pulled
  closed_at timestamptz,                   -- set when businessStatus == CLOSED_PERMANENTLY (alert flag, not a hide-from-catalog flag)
  -- Plan Together v2 — real opening hours (normalized Google Places
  -- regularOpeningHours): { periods: [{open:{day,hour,minute}, close:{...}|null}] }
  opening_hours jsonb,
  -- "curated" = hand-picked seed venue, "discovered" = added by the robot.
  -- Curated venues rank first in the catalogue. Default discovered.
  curation_tier text not null default 'discovered',
  -- Canonical tag layer (lib/tag-vocabulary.ts): the venue's raw vibe_tags
  -- translated into the shared vocabulary, for the recommender + search.
  -- Stamped with TAG_VERSION; re-run scripts/backfill-canonical-tags.ts when
  -- the vocabulary changes. Populated by the ingest pipeline going forward.
  canonical_tags text[] not null default '{}',
  canonical_tags_version integer not null default 0,
  created_at timestamptz not null default now()
);
-- Idempotent for existing databases (see the profiles alter above).
alter table public.venues
  add column if not exists curation_tier text not null default 'discovered',
  add column if not exists canonical_tags text[] not null default '{}',
  add column if not exists canonical_tags_version integer not null default 0;
create index if not exists venues_canonical_tags_idx on public.venues using gin (canonical_tags);
create index if not exists venues_neighbourhood_idx on public.venues(neighbourhood);
create index if not exists venues_type_idx on public.venues(type);
create index if not exists venues_slug_idx on public.venues(slug);
create index if not exists venues_google_place_id_idx on public.venues(google_place_id);

-- Events — backs the `Event` type
-- Note: events may or may not have a venue in our taxonomy. venue_id is
-- nullable for one-off events (e.g. "Stand-Up Showcase at The Comedy Store"
-- where The Comedy Store isn't a partner venue yet).
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  venue_name text not null,                -- denormalised display name
  venue_id uuid references public.venues(id) on delete set null,
  area text not null,
  date_label text not null,                -- DateLabel
  time_label text not null,
  starts_at timestamptz not null,
  price text not null,
  category text not null,                  -- EventCategory
  img_url text not null,
  -- Phase 5 Tier 3 — ingestion + status surface, written by
  -- scripts/ingest-events.ts on the events GitHub Actions cron.
  source text,                             -- 'eventbrite' | 'ticketmaster' | 'dice' | 'skiddle' | 'manual'
  source_id text,                          -- provider's unique id (idempotency key when combined with source)
  source_url text,                         -- original event page URL (ticket-buy deep link)
  description text,                        -- short editorial 1-liner (nullable; demo events lack)
  last_synced_at timestamptz,              -- last provider re-pull
  sold_out boolean not null default false, -- provider-side status mirror
  cancelled_at timestamptz,                -- set once on provider cancellation (alert flag, not auto-hide)
  ends_at timestamptz,                      -- Pop-up radar: last day a source='popup' run is on (null for one-off events)
  created_at timestamptz not null default now(),
  constraint events_source_unique unique (source, source_id)
);
create index if not exists events_date_label_idx on public.events(date_label);
create index if not exists events_starts_at_idx  on public.events(starts_at);
-- For the future "this venue's upcoming events" surface on /venue/[slug].
create index if not exists events_venue_starts_idx
  on public.events(venue_id, starts_at)
  where venue_id is not null;

-- Saved venues (user ↔ venue) — backs the `SavedVenue` type
-- Renamed from `saved_places` in v1.
create table if not exists public.saved_venues (
  user_id uuid not null references auth.users(id) on delete cascade,
  venue_id uuid not null references public.venues(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, venue_id)
);
-- Index the venue_id FK: the composite PK covers user_id-leading lookups but
-- not venue_id alone (needed for "who saved this venue" + FK-cascade perf).
create index if not exists saved_venues_venue_id_idx on public.saved_venues(venue_id);

-- Bookings — backs the `Booking` type (consumer side; partners read via RLS)
create table if not exists public.bookings (
  id text primary key,                     -- e.g. "DIS-4912" (display ref)
  user_id uuid not null references auth.users(id) on delete cascade,
  venue_id uuid not null references public.venues(id) on delete restrict,
  party_size integer not null check (party_size > 0),
  starts_at timestamptz not null,
  status text not null default 'pending',  -- BookingStatus
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists bookings_user_idx     on public.bookings(user_id);
create index if not exists bookings_venue_idx    on public.bookings(venue_id);
create index if not exists bookings_starts_idx   on public.bookings(starts_at);

-- Plans (generated itineraries) — backs the `Plan` future type
create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  neighbourhood text not null,
  why_it_works text not null,
  steps jsonb not null,                    -- PlanStep[]
  created_at timestamptz not null default now()
);
create index if not exists plans_user_idx on public.plans(user_id);

-- Partner prospects — venues that pass editorial curation but have no
-- major-platform booking link (OpenTable/Resy/SevenRooms/TheFork/Quandoo).
-- Internal-only working table; locked tight via RLS (service-role only,
-- no anon/authenticated read).
create table if not exists public.partner_prospects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  google_place_id text unique,
  type text,                               -- VenueType enum (text-encoded)
  neighbourhood text,
  address text,
  website_url text,
  phone text,
  instagram_handle text,
  why_qualified text,                      -- "passed all 4 hard filters, no major booking platform"
  current_booking_method text,             -- "walk-in only" | "own website" | "phone only"
  editorial_sources jsonb,
  creator_coverage jsonb,
  critical_flags jsonb,
  bd_status text not null default 'prospect',  -- prospect | contacted | in_conversation | partnered | declined | passed
  notes text,                              -- the maintainer's freeform notes
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists partner_prospects_status_idx on public.partner_prospects(bd_status);
create index if not exists partner_prospects_place_id_idx on public.partner_prospects(google_place_id);

-- Candidate queue — venues the discovery scout has found and pre-filled drafts
-- for, awaiting review before promotion to the public catalogue. Internal-only
-- working table, written by scripts/scout-candidates.ts through the service-role
-- key. Locked tight via RLS: NO anon/authenticated access at all (every read +
-- write goes through the service-role key, which bypasses RLS). Documented here
-- so the gate is reviewable in source, not only in the live database.
create table if not exists public.pending_candidates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  neighbourhood text,
  type_guess text,
  google_place_id text,
  sources jsonb not null default '[]'::jsonb,
  sources_count integer not null default 0,
  first_seen_at timestamptz not null default now(),
  vibe_draft text,
  long_description_draft text,
  vibe_tags_draft text[],
  real_talk_drafts jsonb,
  creator_coverage_drafts jsonb,
  filter_results jsonb,
  chain_risk_score numeric,
  -- Allowed status values are enforced by the CHECK below. Keep this list in
  -- sync with scripts/ingest-from-pending.ts and app/admin/candidates/actions.ts.
  -- pending | approved | rejected | snoozed | ingested | needs_review |
  -- ingest_failed | skipped
  status text not null default 'pending'
    check (
      status in (
        'pending', 'approved', 'rejected', 'snoozed',
        'ingested', 'needs_review', 'ingest_failed', 'skipped'
      )
    ),
  reviewed_at timestamptz,
  reviewed_notes text,
  snoozed_until timestamptz,
  matches_venue_slug text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pending_candidates_status_idx on public.pending_candidates(status);

alter table public.pending_candidates enable row level security;
-- Deny ALL access to anon + authenticated: a leaked or ordinary signed-in
-- session can never read or mutate the candidate queue. The admin tooling uses
-- the service-role key, which bypasses RLS. Mirrors partner_prospects.
drop policy if exists "pending_candidates deny all" on public.pending_candidates;
create policy "pending_candidates deny all" on public.pending_candidates
  for all to anon, authenticated using (false) with check (false);

-- ─────────────────────────────────────────────────────────
-- Row-Level Security
-- ─────────────────────────────────────────────────────────

alter table public.profiles          enable row level security;
alter table public.venues            enable row level security;
alter table public.events            enable row level security;
alter table public.saved_venues      enable row level security;
alter table public.bookings          enable row level security;
alter table public.plans             enable row level security;
alter table public.partner_prospects enable row level security;

-- Policies for tables that scope rows by the calling user wrap the
-- `auth.uid()` call as `(select auth.uid())`. This lets Postgres
-- treat it as a query-constant initplan instead of re-evaluating it
-- per row. See Supabase docs on Auth RLS InitPlan optimisation.

-- Profiles: users can read/update only their own row, insert their own row
drop policy if exists "profiles self read"   on public.profiles;
drop policy if exists "profiles self insert" on public.profiles;
drop policy if exists "profiles self update" on public.profiles;
create policy "profiles self read"   on public.profiles for select using ((select auth.uid()) = id);
create policy "profiles self insert" on public.profiles for insert with check ((select auth.uid()) = id);
create policy "profiles self update" on public.profiles for update using ((select auth.uid()) = id);

-- Venues + Events: public read (catalog)
drop policy if exists "venues public read" on public.venues;
drop policy if exists "events public read" on public.events;
create policy "venues public read" on public.venues for select using (true);
create policy "events public read" on public.events for select using (true);

-- Pop-up radar: admin may hide an auto-published pop-up (set cancelled_at)
-- without the service-role key. Scoped to source='popup' + the admin email
-- (mirror FL_ADMIN_EMAILS). Migration: events_admin_hide_popups_policy.
drop policy if exists "events admin update popups" on public.events;
create policy "events admin update popups" on public.events for update
  using (
    source = 'popup'
    -- auth.jwt() wrapped in a subselect so it's evaluated once per query, not
    -- per row (Supabase Auth RLS InitPlan advisory). Admin email is
    -- environment-specific and kept out of source (public repo) — set it for
    -- your own deploy. The live prod policy already carries the real address.
    and ((select auth.jwt()) ->> 'email') = 'admin@funldn.example'
  )
  with check (source = 'popup');

-- Saved: users only see/modify their own
drop policy if exists "saved self read"   on public.saved_venues;
drop policy if exists "saved self write"  on public.saved_venues;
drop policy if exists "saved self delete" on public.saved_venues;
create policy "saved self read"   on public.saved_venues for select using ((select auth.uid()) = user_id);
create policy "saved self write"  on public.saved_venues for insert with check ((select auth.uid()) = user_id);
create policy "saved self delete" on public.saved_venues for delete using ((select auth.uid()) = user_id);

-- Bookings: users only see/modify their own (partner-side will use a
-- service-role connection for venue-scoped reads — handled separately).
drop policy if exists "bookings self read"   on public.bookings;
drop policy if exists "bookings self write"  on public.bookings;
drop policy if exists "bookings self update" on public.bookings;
create policy "bookings self read"   on public.bookings for select using ((select auth.uid()) = user_id);
create policy "bookings self write"  on public.bookings for insert with check ((select auth.uid()) = user_id);
create policy "bookings self update" on public.bookings for update using ((select auth.uid()) = user_id);

-- Plans: users only see/modify their own
drop policy if exists "plans self read"   on public.plans;
drop policy if exists "plans self write"  on public.plans;
drop policy if exists "plans self delete" on public.plans;
create policy "plans self read"   on public.plans for select using ((select auth.uid()) = user_id);
create policy "plans self write"  on public.plans for insert with check ((select auth.uid()) = user_id);
create policy "plans self delete" on public.plans for delete using ((select auth.uid()) = user_id);

-- ─────────────────────────────────────────────────────────
-- Auto-create a profile row on new auth.users
-- ─────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, onboarded) values (new.id, false)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Close the public RPC surface on this SECURITY DEFINER function. The
-- trigger above still fires (triggers run as the function owner), but
-- nobody can hit /rest/v1/rpc/handle_new_user from the outside. We
-- revoke from PUBLIC because that's the default-granted role; anon
-- and authenticated inherit from PUBLIC, so a revoke from them alone
-- would not actually close the door.
revoke execute on function public.handle_new_user() from public;

-- Same hardening for rls_auto_enable() if it exists (set up at
-- Supabase project init as an event trigger that auto-enables RLS
-- on new public.* tables). Wrapped in DO so this is a no-op on fresh
-- projects that don't have it.
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on p.pronamespace = n.oid
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    execute 'revoke execute on function public.rls_auto_enable() from public';
  end if;
end$$;

-- ─────────────────────────────────────────────────────────
-- Migrations (idempotent in-place ALTERs for existing dbs)
--
-- Re-running this block is safe: each statement uses `if not exists`.
-- Order: most recent at the BOTTOM. Each migration is dated + named.
-- ─────────────────────────────────────────────────────────

-- 2026-05-27 · Phase 4 real-venue ingestion columns ───────────────────────
alter table public.venues
  add column if not exists google_place_id text,
  add column if not exists booking_links jsonb,
  add column if not exists website_url text,
  add column if not exists phone text,
  add column if not exists instagram_handle text,
  add column if not exists editorial_sources jsonb;

-- Unique constraint on google_place_id (skip if it already exists)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'venues_google_place_id_key'
  ) then
    alter table public.venues
      add constraint venues_google_place_id_key unique (google_place_id);
  end if;
end$$;

create index if not exists venues_google_place_id_idx on public.venues(google_place_id);

-- 2026-05-27 evening · Phase 4.5 creator coverage, critical flags,
-- partner prospects ───────────────────────────────────────────────────────
alter table public.venues
  add column if not exists creator_coverage jsonb,
  add column if not exists critical_flags jsonb;

create table if not exists public.partner_prospects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  google_place_id text unique,
  type text,
  neighbourhood text,
  address text,
  website_url text,
  phone text,
  instagram_handle text,
  why_qualified text,
  current_booking_method text,
  editorial_sources jsonb,
  creator_coverage jsonb,
  critical_flags jsonb,
  bd_status text not null default 'prospect',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists partner_prospects_status_idx on public.partner_prospects(bd_status);
create index if not exists partner_prospects_place_id_idx on public.partner_prospects(google_place_id);

alter table public.partner_prospects enable row level security;
-- No anon policies — locked to service-role only (internal BD pipeline).
-- Drop any prior policies first for idempotency.
drop policy if exists "partner_prospects no anon" on public.partner_prospects;

-- 2026-05-31 · Plan Together v2 — real opening hours on venues ──────────────
alter table public.venues
  add column if not exists opening_hours jsonb;

-- 2026-06-02 · Soft-launch feedback capture ────────────────────────────────
-- Anyone (signed in or anonymous) can submit one row; nobody can read rows
-- back via the API. Reads happen in the Supabase dashboard (service_role,
-- which bypasses RLS). See app/(main)/profile/actions.ts + feedback-sheet.tsx.
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,  -- null when anonymous
  email text,                          -- optional follow-up address
  use_intent text,                     -- Q1: would_use | maybe | not_yet
  found_something text,                -- Q2: several | one_or_two | nothing
  differentiation text,                -- Q3: love | nice | not_fussed
  wants text[] not null default '{}',  -- Q4: feature multi-select
  message text,                        -- Q5: open-ended
  path text,                           -- where in the app it was submitted from
  created_at timestamptz not null default now()
);
create index if not exists feedback_created_idx on public.feedback(created_at desc);
-- Cover the user_id FK (perf advisor: unindexed foreign key).
create index if not exists feedback_user_id_idx on public.feedback(user_id);

alter table public.feedback enable row level security;

-- Anyone can submit. No SELECT/UPDATE/DELETE policies exist, so anon and
-- authenticated can write but never read or alter the table. The check pins
-- user_id (anon rows null; a signed-in user can only attribute feedback to
-- their own id) so it's not "always true" and can't be spoofed.
drop policy if exists "feedback anyone insert" on public.feedback;
create policy "feedback anyone insert"
  on public.feedback for insert
  to anon, authenticated
  with check (user_id is null or user_id = (select auth.uid()));

-- ── Enum value enforcement (defense-in-depth) ──────────────────────────────
-- The ingest/admin writers (scripts/ingest-from-pending.ts, buildVenueRow /
-- buildProspectRow) only emit values from the TS unions in lib/types.ts, and
-- lib/queries.ts casts these columns blindly on read. Without a DB-level CHECK,
-- a future mapping edit (e.g. a lowercased 'pub') would be silently stored and
-- mis-ranked, with no error on write or read. These mirror the TS unions
-- exactly. Guarded on pg_constraint so re-running schema.sql is safe; every
-- existing row was verified to conform before these were added.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'venues_type_check') then
    alter table public.venues add constraint venues_type_check
      check (type in ('Restaurant','Cafe','Bar','Wine Bar','Pub','Listening Bar','Live Music','Culture','Market','Outdoors'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'venues_price_check') then
    alter table public.venues add constraint venues_price_check
      check (price in ('Free','£','££','£££'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'venues_time_of_day_check') then
    alter table public.venues add constraint venues_time_of_day_check
      check (time_of_day in ('Day','Evening','Night'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'venues_curation_tier_check') then
    alter table public.venues add constraint venues_curation_tier_check
      check (curation_tier in ('curated','discovered'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'partner_prospects_bd_status_check') then
    alter table public.partner_prospects add constraint partner_prospects_bd_status_check
      check (bd_status in ('prospect','contacted','in_conversation','partnered','declined','passed'));
  end if;
end $$;

-- 2026-06-23 · Phase 2 venue media (photo gallery, reviews, static map) ──────
-- Populated server-side by the ingest/discover/refresh scripts; these columns
-- hold ONLY keyless values — mirrored Supabase Storage URLs (photos, map) and
-- verbatim Google review JSON. The server-only Places API key never reaches
-- them. photo_urls[0] equals img_url (the hero). reviews/map_url are moat
-- fields (signed-in only) and must stay OUT of VENUE_CARD_COLUMNS; photo_urls
-- is keyless so it is safe to expose to the anonymous preview.
-- Idempotent — paste-and-run in the Supabase SQL Editor, then confirm all four
-- columns exist (information_schema.columns) BEFORE deploying the cron changes
-- that write them (a cron writing to a missing column errors silently).
alter table public.venues
  add column if not exists photo_urls text[] not null default '{}',
  add column if not exists reviews jsonb,
  add column if not exists reviews_synced_at timestamptz,
  add column if not exists map_url text;
