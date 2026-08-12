-- 0008 — stop `venues.price` asserting a tier we never measured.
--
-- STATE AT AUTHORING, measured on production 2026-08-12. RE-MEASURE ON THE DAY.
-- NOT YET APPLIED TO PRODUCTION.
--
--   curation_tier | price | rows
--   --------------+-------+------
--   discovered    | ££    | 1863   <- the defaulted set, nulled by this migration
--   discovered    | £££   |  169
--   discovered    | Free  |   83
--   discovered    | £     |   72
--   curated       | ££    |   16   <- HAND-SET BY MARIA. NOT TOUCHED.
--   curated       | £££   |   16
--   curated       | Free  |   11
--   curated       | £     |    3
--
-- WHY. scripts/ingest-from-pending.ts mapPriceLevel() returned "££" in its
-- `default:` branch, i.e. whenever Google returned NO priceLevel. Google
-- reports no priceLevel for museums, parks, churches and most non-food
-- venues, so "££" came to mean two different things — "Google said MODERATE"
-- and "Google said nothing" — with no way to tell them apart. 84% of live
-- venues ended up on that one value: a constant that looks like data.
--
-- IT WAS NOT COSMETIC. lib/plan-engine.ts withinBudget() ranks "££" as 2, so a
-- "£" night (cap 1) excluded every defaulted row — including the Natural
-- History Museum, Novelty Automation, St Bride's and the London Mithraeum,
-- all of which are FREE.
--
-- 🧨 SCOPED TO `discovered` ON PURPOSE. An earlier draft of this migration
-- said "Free/£/£££ can only ever have come from an explicit Google
-- priceLevel". THAT WAS FALSE and it would have destroyed data: curated
-- venues are written by scripts/ingest-venues.ts from hand-authored values in
-- scripts/venues-seed.ts, which sets "££" and "£££" by editorial judgement
-- (Manteca, Padella, Cafe OTO, Dennis Severs' House …). Those 16 "££" rows
-- are assertions Maria made, not Google's silence, and they stay.
--
-- RECOVERY. Every nulled row is captured first in archive.venues_price_0008
-- (id, slug, price). The genuinely-MODERATE subset among them is otherwise
-- unrecoverable without a metered Place Details call, and the Places budget is
-- parked — so the capture also bounds a future re-fetch to exactly these ids
-- instead of the whole catalogue. Rollback:
--   update public.venues v set price = a.price
--     from archive.venues_price_0008 a where a.id = v.id;
--
-- RUN-ONCE BY CONSTRUCTION. The capture is the guard: the INSERT is a no-op
-- once archive.venues_price_0008 holds rows, and the UPDATE only touches ids
-- in that table. So after the fixed mapPriceLevel starts writing a REAL
-- PRICE_LEVEL_MODERATE → "££", re-running this cannot destroy it.
--
-- DEPLOY ORDER: CODE FIRST, THEN THIS. The application changes in this PR are
-- a strict superset of current behaviour (they handle "££" identically), so
-- code-first has no gap. DB-first is survivable — today's
-- `PRICE_RANK[price] ?? 2` maps null to 2, exactly like "££", so the plan pool
-- is unchanged — but it is NOT behaviour-free: lib/ranking.ts's
-- `v.price === prefs.budget` bonus stops firing, which re-orders the
-- signed-in feed, and every unguarded render site shows a dangling separator
-- until the code ships.

begin;

-- Never queue behind a long read on a live table; retry rather than block
-- every venue read (ACCESS EXCLUSIVE is held to COMMIT).
set local lock_timeout = '3s';

-- 1. the column must be allowed to say "unknown"
alter table public.venues alter column price drop not null;

-- 2. admit null explicitly. (A null passes `in (...)` as UNKNOWN and a CHECK
--    accepts anything not FALSE, so this is documentation more than
--    enforcement — but it keeps schema.sql honest about what may be stored.)
alter table public.venues drop constraint if exists venues_price_check;
alter table public.venues add constraint venues_price_check
  check (price is null or price in ('Free', '£', '££', '£££'));

-- 3. capture what we are about to destroy, in a schema PostgREST does not
--    expose. Not a bare public table: that would inherit anon/authenticated
--    grants and land as an RLS-disabled public table in the security advisor.
create schema if not exists archive;
revoke all on schema archive from anon, authenticated;

create table if not exists archive.venues_price_0008 (
  id uuid primary key,
  slug text not null,
  price text not null,
  captured_at timestamptz not null default now()
);
revoke all on archive.venues_price_0008 from anon, authenticated;

insert into archive.venues_price_0008 (id, slug, price)
select id, slug, price
  from public.venues
 where price = '££'
   and curation_tier = 'discovered'
   and not exists (select 1 from archive.venues_price_0008)
on conflict (id) do nothing;

-- 4. retire the defaulted value, only for the rows just captured
update public.venues v
   set price = null
  from archive.venues_price_0008 a
 where a.id = v.id
   and v.price = '££'
returning v.id, v.slug;

commit;
