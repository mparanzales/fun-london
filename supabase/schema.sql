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
  created_at timestamptz not null default now()
);

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
  created_at timestamptz not null default now()
);
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
  created_at timestamptz not null default now()
);
create index if not exists events_date_label_idx on public.events(date_label);
create index if not exists events_starts_at_idx  on public.events(starts_at);

-- Saved venues (user ↔ venue) — backs the `SavedVenue` type
-- Renamed from `saved_places` in v1.
create table if not exists public.saved_venues (
  user_id uuid not null references auth.users(id) on delete cascade,
  venue_id uuid not null references public.venues(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, venue_id)
);

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

-- ─────────────────────────────────────────────────────────
-- Row-Level Security
-- ─────────────────────────────────────────────────────────

alter table public.profiles       enable row level security;
alter table public.venues         enable row level security;
alter table public.events         enable row level security;
alter table public.saved_venues   enable row level security;
alter table public.bookings       enable row level security;
alter table public.plans          enable row level security;

-- Profiles: users can read/update only their own row, insert their own row
drop policy if exists "profiles self read"   on public.profiles;
drop policy if exists "profiles self insert" on public.profiles;
drop policy if exists "profiles self update" on public.profiles;
create policy "profiles self read"   on public.profiles for select using (auth.uid() = id);
create policy "profiles self insert" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles self update" on public.profiles for update using (auth.uid() = id);

-- Venues + Events: public read (catalog)
drop policy if exists "venues public read" on public.venues;
drop policy if exists "events public read" on public.events;
create policy "venues public read" on public.venues for select using (true);
create policy "events public read" on public.events for select using (true);

-- Saved: users only see/modify their own
drop policy if exists "saved self read"   on public.saved_venues;
drop policy if exists "saved self write"  on public.saved_venues;
drop policy if exists "saved self delete" on public.saved_venues;
create policy "saved self read"   on public.saved_venues for select using (auth.uid() = user_id);
create policy "saved self write"  on public.saved_venues for insert with check (auth.uid() = user_id);
create policy "saved self delete" on public.saved_venues for delete using (auth.uid() = user_id);

-- Bookings: users only see/modify their own (partner-side will use a
-- service-role connection for venue-scoped reads — handled separately).
drop policy if exists "bookings self read"   on public.bookings;
drop policy if exists "bookings self write"  on public.bookings;
drop policy if exists "bookings self update" on public.bookings;
create policy "bookings self read"   on public.bookings for select using (auth.uid() = user_id);
create policy "bookings self write"  on public.bookings for insert with check (auth.uid() = user_id);
create policy "bookings self update" on public.bookings for update using (auth.uid() = user_id);

-- Plans: users only see/modify their own
drop policy if exists "plans self read"   on public.plans;
drop policy if exists "plans self write"  on public.plans;
drop policy if exists "plans self delete" on public.plans;
create policy "plans self read"   on public.plans for select using (auth.uid() = user_id);
create policy "plans self write"  on public.plans for insert with check (auth.uid() = user_id);
create policy "plans self delete" on public.plans for delete using (auth.uid() = user_id);

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
