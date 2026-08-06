-- 0007: events.source_url holds a URL-SHAPED value or NULL, never a sentinel.
--
-- Note the claim carefully. A SQL prefix test is not a parser, so what this
-- enforces is "NULL, or begins with http(s):// and carries no control
-- character" -- NOT "is a valid URL". The authority is storedUrlOrNull in
-- lib/safe-url.ts; this predicate is a strictly weaker FLOOR that the helper
-- sits above. Values like 'https://' or 'http://a b' would pass this and are
-- refused by the helper, so they cannot be written, but if one were inserted
-- by hand this migration would not clean it.
--
-- WHY. Six live rows carry a non-URL in a NULLABLE column: five spell "N/A"
-- and one spells "Not available". All six are source='popup', created
-- 2026-06-04/05 by the Gemini-era pop-up generator (removed 2026-07-11), which
-- wrote a model's idea of "no value" as text. The literals appear nowhere in
-- the repo, because no code ever wrote them.
--
-- Nothing is visibly broken today: lib/safe-url.ts refuses all three, so no bad
-- href renders and the .ics correctly omits its URL property. The hazard is the
-- shape, not the symptom. The column is nullable, so the ordinary way to read
-- it is a truthiness check (`event.sourceUrl ? ... : ...`), and every one of
-- those treats "N/A" as a real ticket link. This is a trap set for the next
-- person to touch the file.
--
-- 🧨 RUN THIS BEFORE `pnpm fix-events --write`. That script scores duplicate
-- events with `(e.source_url ? 2 : 0)` (scripts/fix-events.ts:151) and keeps
-- the older row on a tie -- and the six sentinel rows are the OLDEST. So with
-- "N/A" still in place, a dedupe run can keep the sentinel pop-up and DELETE
-- a newer twin holding a real ticket link. That is the trap below, live.
--
-- The write side is fixed in the same PR: scripts/ingest-events.ts now routes
-- every source_url through storedUrlOrNull(), which keeps a parseable http(s)
-- URL byte-for-byte and nulls everything else. That ordering matters -- a
-- backfill without creation-path parity is undone by the next cron run.
--
-- 🧨 The predicate is an ALLOWLIST, deliberately. `where source_url = 'N/A'`
-- would clean five of the six and leave "Not available" sitting there looking
-- fixed. Anything that is not a parseable http(s) URL is not a URL, whatever it
-- spells, so this matches on shape rather than on a list of spellings we happen
-- to have seen.
--
-- Idempotent: re-running matches nothing once the rows are NULL. Additive only
-- -- no schema change, no constraint, no policy.
--
-- Rollback: this destroys the sentinel strings, which carry no information (the
-- providers had no URL; that is the whole content of the value). To restore the
-- exact prior state anyway:
--   (each guarded with `and source_url is null` so a re-run cannot overwrite a
--    real URL the cron has since set)
--   update public.events set source_url = 'N/A' where source_url is null and id in (
--     '960fb352-c11b-49bd-8cb9-1f96f726340f',  -- Urban Makers Market
--     'e23cb747-9733-4bb6-9a1f-edbe3adb25c6',  -- London Craft Beer Festival
--     '3f31c805-9b1b-4f5a-ab03-98975fb5e2ee',  -- London Wing Fest
--     'c3db0f5a-4730-4948-a46a-a8730d405d60',  -- Oliver Beer: The Sky in the Cave
--     '078db072-e423-48ec-8b5c-e38a2f7ef1dc'); -- Roni Horn: Seizure of Hope
--   update public.events set source_url = 'Not available'
--     where source_url is null
--       and id = 'ec19b153-3794-4ab0-81c4-a417a059d7cc'; -- England World Cup Pop-Up Shop

begin;

update public.events
   set source_url = null
 where source_url is not null
   and (
        -- Not a web URL at all: "N/A", "Not available", "", "   ",
        -- "www.example.com", "//example.com", "javascript:...".
        source_url !~* '^https?://'
        -- Or shaped like one but carrying a control character. The URL parser
        -- DELETES CR/LF/TAB rather than rejecting them, so such a row stores a
        -- value no consumer resolves to. storedUrlOrNull refuses the same
        -- input on the write side (and also refuses padding and userinfo,
        -- which this predicate cannot express). Currently 0 rows.
        or source_url ~ '[[:cntrl:]]'
       )
returning id, name, source;

commit;
