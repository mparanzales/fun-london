-- ─────────────────────────────────────────────────────────
-- Fun London — seed (v2)
--
-- Run AFTER schema.sql. Inserts 11 venues + 5 events that
-- match lib/mock-data.ts exactly, so the app looks the same
-- before and after the Supabase swap.
--
-- WARNING: The `delete from` at the top wipes all venues
-- (and cascades to saved_venues + bookings via FK rules).
-- Safe only before real users save anything. Do NOT re-run
-- once users have data.
--
-- venue.id is uuid (gen_random_uuid by default). Events
-- reference venues by slug subquery so the seed stays
-- deterministic without hard-coded UUIDs.
-- ─────────────────────────────────────────────────────────

delete from public.events;
delete from public.venues;

-- ── Venues ───────────────────────────────────────────────────

insert into public.venues (slug, name, type, vibe, long_description, neighbourhood, address, lat, lng, price, time_of_day, rating, review_count, walking_mins, tables_free, next_slot_label, img_url, mood_tags, vibe_tags) values
  (
    'padella', 'Padella', 'Restaurant',
    'Hand-rolled pasta, no reservations',
    $$Hand-rolled pasta at the window, no reservations, all evening. Queue moves fast, usually 30 to 40 min at peak.$$,
    'London Bridge', '6 Southwark St, London SE1 1TQ', 51.5054, -0.0905,
    '££', 'Evening', 4.8, 880, 8, 0, '8:30 PM',
    '',
    ARRAY['dinner']::text[], ARRAY['Hand-rolled', 'Lively']::text[]
  ),
  (
    'dishoom-shoreditch', 'Dishoom Shoreditch', 'Restaurant',
    'Bombay café buzzing with spice',
    $$Bombay café buzzing with spice. Hand-rolled flatbreads in a 1920s Bombay-style room. Walk-ins held 15 min. Open till 11pm tonight.$$,
    'Shoreditch', 'Boundary Street · Shoreditch', 51.5257, -0.0764,
    '££', 'Evening', 4.7, 1240, 12, 2, '9:00 PM',
    '',
    ARRAY['dinner']::text[], ARRAY['Spicy', 'Lively']::text[]
  ),
  (
    'sager-wilde', 'Sager + Wilde', 'Wine Bar',
    'Moody, low-lit, low-intervention wines',
    $$Moody, low-lit wine bar with low-intervention bottles. Skilled pours and a quiet room for talk.$$,
    'Shoreditch', '193 Hackney Rd, London E2 8JL', 51.5316, -0.0716,
    '££', 'Night', 4.6, 612, 15, 3, '9:15 PM',
    '',
    ARRAY['drinks']::text[], ARRAY['Moody', 'Chill']::text[]
  ),
  (
    'borough-market', 'Borough Market', 'Market',
    'A thousand tiny tastings',
    $$Wandering food market under the railway arches. Stalls for everything from oysters to brownies. Bring an appetite.$$,
    'London Bridge', '8 Southwark St, London SE1 1TL', 51.5055, -0.0909,
    '£', 'Day', 4.7, 2100, 4, 0, 'Open till 5 PM',
    '',
    ARRAY['activity']::text[], ARRAY['Lively', 'Daytime']::text[]
  ),
  (
    'tate-modern', 'Tate Modern', 'Culture',
    'Turbine Hall hush',
    $$Modern and contemporary art across seven floors of a former power station. Free permanent collection.$$,
    'Southbank', 'Bankside, London SE1 9TG', 51.5076, -0.0994,
    'Free', 'Day', 4.6, 4321, 18, 0, 'Open till 6 PM',
    '',
    ARRAY['culture']::text[], ARRAY['Cultural', 'Chill']::text[]
  ),
  (
    'bao-soho', 'Bao Soho', 'Restaurant',
    'Pillowy buns, queue out the door',
    $$Pillowy steamed buns and Taiwanese small plates. Tiny dining room, so queue early or book on the dot.$$,
    'Soho', '53 Lexington St, London W1F 9AS', 51.5132, -0.1372,
    '££', 'Evening', 4.7, 1024, 6, 1, '8:45 PM',
    '',
    ARRAY['dinner']::text[], ARRAY['Pillowy', 'Lively']::text[]
  ),
  (
    'ronnie-scotts', $$Ronnie Scott's$$, 'Live Music',
    'Jazz legends, red velvet',
    $$Soho's jazz institution since 1959. Red velvet booths, world-class musicians, intimate room.$$,
    'Soho', '47 Frith St, London W1D 4HT', 51.5135, -0.1316,
    '£££', 'Night', 4.7, 980, 10, 4, '10:00 PM',
    '',
    ARRAY['drinks', 'culture']::text[], ARRAY['Iconic', 'Lively']::text[]
  ),
  (
    'spiritland', 'Spiritland', 'Listening Bar',
    'Audiophile sound, cocktails in amber',
    $$Audiophile listening bar with custom Living Voice speakers. Cocktails in amber light, conversation kept low.$$,
    $$King's Cross$$, '9-10 Stable St, London N1C 4AB', 51.5364, -0.1265,
    '££', 'Night', 4.6, 540, 22, 2, '9:30 PM',
    '',
    ARRAY['drinks']::text[], ARRAY['Audiophile', 'Chill']::text[]
  ),
  (
    'barbican-conservatory', 'Barbican Conservatory', 'Culture',
    'Brutalist jungle, Sundays only',
    $$Brutalist concrete jungle hiding a lush conservatory of 1,500 plants and tropical fish. Open Sundays only.$$,
    'Barbican', 'Silk St, London EC2Y 8DS', 51.52, -0.0936,
    'Free', 'Day', 4.8, 312, 14, 0, 'Open Sun · noon',
    '',
    ARRAY['culture']::text[], ARRAY['Hidden', 'Chill']::text[]
  ),
  (
    'camden-market', 'Camden Market', 'Market',
    'Canalside, chaotic, delicious',
    $$Canalside maze of food stalls, vintage clothes, and live music. Chaotic in the best way.$$,
    'Camden', 'Camden Lock Pl, London NW1 8AF', 51.5414, -0.1466,
    '£', 'Day', 4.4, 2890, 28, 0, 'Open till 7 PM',
    '',
    ARRAY['activity']::text[], ARRAY['Lively', 'Daytime']::text[]
  ),
  (
    'monmouth-coffee', 'Monmouth Coffee', 'Cafe',
    $$Roaster's bench, single-origin beans$$,
    $$Roaster's bench, single-origin beans, no laptops. Order the filter and watch them weigh out the dose.$$,
    'London Bridge', '2 Park St, London SE1 9AB', 51.505, -0.0903,
    '£', 'Day', 4.6, 410, 5, 1, 'Open till 6 PM',
    '',
    ARRAY['activity']::text[], ARRAY['Quiet', 'Daytime']::text[]
  );

-- ── Events ───────────────────────────────────────────────────
-- Demo events removed 2026-05-29 once Phase 5 Tier 3 went live with
-- real provider-ingested data. Fresh setups now start with an empty
-- events table; events flow in from scripts/ingest-events.ts on a
-- 4-hourly GitHub Actions cron (currently Ticketmaster, more
-- providers to follow per project_pending_work). Demo events
-- previously seeded: Jazz & Soul Night, Stand-Up Showcase, Street
-- Food Festival, Warehouse Techno, Immersive Art: Dreams — none
-- reachable in user-facing UI for >24h before being replaced.

-- ── Sanity check (returns the seeded counts; cosmetic only) ─────
select
  (select count(*) from public.venues) as venues_count,
  (select count(*) from public.events) as events_count;
