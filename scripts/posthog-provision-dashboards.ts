// ─────────────────────────────────────────────────────────────────────────
// Create the six agreed dashboards in PostHog, from code, in one command.
//
// WHY CODE AND NOT CLICKING: the six dashboards are ~24 insights. Built by
// hand they are unreproducible, undiffable, and silently drift from the event
// names in lib/analytics.ts. Built from this file they are reviewable in a PR,
// re-runnable after a rename, and every event name here is one the codebase
// actually emits (checked against the AnalyticsEvent union).
//
// IDEMPOTENT: re-running matches dashboards and insights BY NAME and updates
// them in place, so this is safe to run repeatedly. Renaming an insight in the
// PostHog UI will make the next run create a duplicate: rename it here instead.
//
// Usage:
//   pnpm posthog:dashboards:dry     # print the plan, touch nothing
//   pnpm posthog:dashboards         # create / update
//
// SCOPES: this one WRITES, so it needs dashboard:write + insight:write on top
// of the read scopes. Recommended: keep a permanent READ-ONLY key for
// posthog:verify, and issue a second key with the write scopes, run this once,
// then delete that key from the PostHog settings page.
//
// ⚠️ Dashboard 5 (generation failures + latency) still ships PROXIES as of
// 2026-07-30. PR #189 merged, so main now emits plan_generate_failed,
// plan_preview_failed and duration_ms, but the panels were NOT switched over
// because nobody has confirmed those events are actually arriving yet (that
// needs the read key). A flat panel there means NOT YET MEASURED, not "no
// failures". Finish it by verifying arrival first, then rewriting the panels,
// then deleting the warning (see the manifest doc for the ordered steps).
// ─────────────────────────────────────────────────────────────────────────

import { ph, resolveProjectId, API_HOST } from "./posthog-api";

const DRY_RUN = process.argv.includes("--dry-run");

type Query = Record<string, unknown>;

// ── query builders ───────────────────────────────────────────────────────

function series(events: string[]): Query[] {
  return events.map((event) => ({ kind: "EventsNode", event, name: event }));
}

function trend(
  events: string[],
  opts: { days?: number; breakdown?: string; display?: string } = {},
): Query {
  return {
    kind: "TrendsQuery",
    series: series(events),
    dateRange: { date_from: `-${opts.days ?? 30}d` },
    interval: "day",
    trendsFilter: { display: opts.display ?? "ActionsLineGraph" },
    ...(opts.breakdown
      ? {
          breakdownFilter: {
            breakdown: opts.breakdown,
            breakdown_type: "event",
          },
        }
      : {}),
  };
}

function funnel(steps: string[], opts: { days?: number } = {}): Query {
  return {
    kind: "FunnelsQuery",
    series: series(steps),
    dateRange: { date_from: `-${opts.days ?? 30}d` },
    funnelsFilter: {
      funnelVizType: "steps",
      funnelWindowInterval: 1,
      funnelWindowIntervalUnit: "day",
    },
  };
}

function table(sql: string): Query {
  return { kind: "DataTableNode", source: { kind: "HogQLQuery", query: sql } };
}

// ── the six dashboards ───────────────────────────────────────────────────

type Insight = { name: string; description: string; query: Query };
type Dashboard = { name: string; description: string; insights: Insight[] };

const DASHBOARDS: Dashboard[] = [
  {
    name: "1. Complete-night funnel",
    description:
      "The core product promise: does a visitor arrive and leave with a full three-stop night? Signed-in and signed-out paths are separate funnels because they emit different events.",
    insights: [
      {
        name: "Signed-in: open to saved night",
        description:
          "$pageview to plan_generate to plan_save. plan_save is the bottom of the funnel: a night the user chose to keep.",
        query: funnel(["$pageview", "plan_generate", "plan_save"]),
      },
      {
        name: "Signed-out: preview to account to saved night",
        description:
          "The anon builder shipped in PR #185. plan_preview_built is the number that route exists to move. ⚠️ This funnel CROSSES THE IDENTIFY BOUNDARY while the SDK runs with person_profiles set to identified_only, so the pre-sign-in steps sit on an anonymous distinct_id that only becomes a person at sign-in. Read it on distinct_id rather than unique users, and treat the step-to-step rates as approximate.",
        query: funnel([
          "$pageview",
          "plan_preview_built",
          "sign_in_complete",
          "plan_save",
        ]),
      },
      {
        name: "Was the night COMPLETE (3 stops)?",
        description:
          "plan_generate broken down by the `full` property. `false` means the engine could not fill three stops. This is the quality of the core output.",
        query: trend(["plan_generate"], { breakdown: "full" }),
      },
      {
        name: "Stops filled per generated plan",
        description:
          "plan_generate broken down by `stops` (0 to 3). A rising 0/1/2 share means the catalogue is too thin for the areas people ask for.",
        query: trend(["plan_generate"], { breakdown: "stops" }),
      },
    ],
  },
  {
    name: "2. Anonymous-plan conversion",
    description:
      "Signed-out visitors can now build a real night. This measures whether that generosity converts, and whether the auth wall helps or hurts.",
    insights: [
      {
        name: "Anon preview to sign-in",
        description:
          "plan_preview_built to plan_stop_opened to sign_in_complete. The middle step is interest; the last is conversion. ⚠️ Same identify-boundary caveat as dashboard 1's signed-out funnel: the first two steps are anonymous distinct_ids under person_profiles identified_only.",
        query: funnel([
          "plan_preview_built",
          "plan_stop_opened",
          "sign_in_complete",
        ]),
      },
      {
        name: "Wall dismissals vs sign-ins",
        description:
          "detail_wall_dismissed against sign_in_complete. If dismissals climb while sign-ins stay flat, the wall is friction, not conversion. This is the data the deferred detail-wall decision was waiting for.",
        query: trend(["detail_wall_dismissed", "sign_in_complete"]),
      },
      {
        name: "Did the built night survive sign-in?",
        description:
          "plan_stash_restored fires when a night built signed-out is handed back after the auth round-trip. plan_save without it means the user rebuilt from scratch.",
        query: trend(["plan_stash_restored", "plan_save"]),
      },
      {
        name: "Anon previews and sign-ins, by day",
        description:
          "Two raw daily counts and their ratio. ⚠️ signins_per_preview is NOT a conversion rate: it divides two independent daily event counts, so the sign-ins in a day need not be the same people as the previews in that day, and a sign-in that never previewed still lands in the numerator. Read it as a coarse trend line for spotting the effect of a copy or wall change, and use the funnel insights on this dashboard for real per-person conversion.",
        query: table(
          `SELECT toDate(timestamp) AS day,
                  countIf(event = 'plan_preview_built') AS previews,
                  countIf(event = 'sign_in_complete')   AS signins,
                  round(100.0 * countIf(event = 'sign_in_complete')
                        / nullif(countIf(event = 'plan_preview_built'), 0), 1)
                    AS signins_per_preview_pct
             FROM events
            WHERE timestamp > now() - INTERVAL 60 DAY
              AND event IN ('plan_preview_built', 'sign_in_complete')
            GROUP BY day
            ORDER BY day DESC`,
        ),
      },
    ],
  },
  {
    name: "3. Plan engagement and replacements",
    description:
      "What people do to a plan after they get it. Every reshuffle and swap is the engine being told it was wrong.",
    insights: [
      {
        name: "Engagement actions",
        description:
          "plan_reshuffle, plan_swap, plan_open_maps, plan_stop_opened. Opening the walking route in Maps is the strongest intent signal short of booking.",
        query: trend([
          "plan_reshuffle",
          "plan_swap",
          "plan_open_maps",
          "plan_stop_opened",
        ]),
      },
      {
        name: "Did the FIRST plan land?",
        description:
          "Reshuffles and swaps per generated plan. Close to 0 means the first answer was good. Climbing means the ranker is guessing.",
        query: table(
          `SELECT toDate(timestamp) AS day,
                  countIf(event = 'plan_generate')   AS plans,
                  countIf(event = 'plan_reshuffle')  AS reshuffles,
                  countIf(event = 'plan_swap')       AS swaps,
                  round(countIf(event = 'plan_reshuffle')
                        / nullif(countIf(event = 'plan_generate'), 0), 2) AS reshuffles_per_plan
             FROM events
            WHERE timestamp > now() - INTERVAL 60 DAY
              AND event IN ('plan_generate', 'plan_reshuffle', 'plan_swap')
            GROUP BY day
            ORDER BY day DESC`,
        ),
      },
      {
        name: "WHICH stop gets replaced",
        description:
          "plan_swap broken down by `stop` (0, 1, 2). Tells you which role the engine is worst at: the opener, the main, or the finish.",
        query: trend(["plan_swap"], { breakdown: "stop" }),
      },
      {
        name: "How wide did the engine have to cast?",
        description:
          "plan_generate broken down by `poolStage`. `all` means it abandoned the chosen area or budget to find anything at all.",
        query: trend(["plan_generate"], { breakdown: "poolStage" }),
      },
      {
        name: "Group rooms and swipes",
        description:
          "together_room_create, together_room_join, together_swipe. Joins over creates is the invite loop working.",
        query: trend([
          "together_room_create",
          "together_room_join",
          "together_swipe",
        ]),
      },
    ],
  },
  {
    name: "4. Booking handoffs",
    description:
      "In-app booking is partner-gated, so the product hands off to OpenTable, Resy and SevenRooms. The handoff click is the revenue signal that exists today.",
    insights: [
      {
        name: "Handoffs by platform",
        description:
          "venue_reserve_click broken down by `platform`. This is the number a booking-platform partnership conversation is built on.",
        query: trend(["venue_reserve_click"], { breakdown: "platform" }),
      },
      {
        name: "Handoff to self-reported booking",
        description:
          "venue_reserve_click to booking_self_logged. Self-reporting is voluntary, so treat this as a FLOOR on real bookings, never a measurement of them.",
        query: funnel(["venue_reserve_click", "booking_self_logged"]),
      },
      {
        name: "Event ticket clicks by provider",
        description: "event_ticket_click broken down by `provider`.",
        query: trend(["event_ticket_click"], { breakdown: "provider" }),
      },
      {
        name: "Venues driving handoffs",
        description:
          "Which venues people actually try to book. Ranked by reserve clicks, with party size.",
        query: table(
          `SELECT properties.venue        AS venue,
                  count()                 AS reserve_clicks,
                  count(DISTINCT distinct_id) AS people,
                  round(avg(toFloat(properties.party)), 1) AS avg_party
             FROM events
            WHERE timestamp > now() - INTERVAL 90 DAY
              AND event = 'venue_reserve_click'
            GROUP BY venue
            ORDER BY reserve_clicks DESC
            LIMIT 50`,
        ),
      },
    ],
  },
  {
    name: "5. Generation failures and latency (PARTIAL)",
    description:
      "⚠️ STILL PROXIES AS OF 2026-07-30 (dated on purpose so this text cannot silently become false). UPDATE: PR #189 is now MERGED, so main DOES emit plan_generate_failed, plan_preview_failed and duration_ms. The panels below were deliberately NOT switched over yet, because at the time of writing nobody had confirmed those events are actually ARRIVING (that needs the read key). So: a flat line here still means NOT YET MEASURED, not zero failures. To finish: run pnpm posthog:verify -- --all, confirm the three names have non-zero counts, THEN replace these panels with a failure trend broken down by reason and a latency panel on duration_ms, and only then delete this warning. Ordered steps in docs/FUNLDN_ANALYTICS_DASHBOARD_MANIFEST.md.",
    insights: [
      {
        name: "Soft failure: nights that did not fill",
        description:
          "plan_generate by `stops`. A generated night with fewer than 3 stops is the failure the user actually sees, even though nothing errored.",
        query: trend(["plan_generate"], { breakdown: "stops" }),
      },
      {
        name: "Quality failure: engine abandoned the constraints",
        description:
          "plan_generate by `poolStage`. `budget` means it widened past the chosen budget; `all` means it gave up on the area too.",
        query: trend(["plan_generate"], { breakdown: "poolStage" }),
      },
      {
        name: "Anon builds that produced a plan",
        description:
          "plan_preview_built is emitted ONLY on the success branch. Compare it against $pageview on /plan: the gap is the unmeasured failure population.",
        query: trend(["plan_preview_built", "plan_generate"]),
      },
      {
        name: "Client crashes by surface",
        description:
          "Exceptions from lib/analytics.ts reportError, broken down by `surface`. This is real failure data already flowing, and the only failure signal in this dashboard that is not a proxy.",
        query: trend(["$exception"], { breakdown: "surface" }),
      },
      {
        name: "Where visitors land and leave",
        description:
          "Pageviews by path. Used here to size the /plan population against plan_preview_built.",
        query: table(
          `SELECT properties.$pathname AS path,
                  count()              AS views,
                  count(DISTINCT distinct_id) AS people
             FROM events
            WHERE timestamp > now() - INTERVAL 30 DAY
              AND event = '$pageview'
            GROUP BY path
            ORDER BY views DESC
            LIMIT 50`,
        ),
      },
    ],
  },
  {
    name: "6. Venue traffic for photography prioritisation",
    description:
      "Which venue pages carry the most attention, so the photo work is spent on the pages people actually reach. Join this against the photo-quality audit: high traffic plus a weak lead image is the top of the shot list.",
    insights: [
      {
        name: "Top venue pages by traffic",
        description:
          "Pageviews on /venue/<slug>. The anon ISR twin is an internal rewrite, so signed-out and signed-in traffic share one path here.",
        query: table(
          `SELECT properties.$pathname AS path,
                  count()              AS views,
                  count(DISTINCT distinct_id) AS people
             FROM events
            WHERE timestamp > now() - INTERVAL 90 DAY
              AND event = '$pageview'
              AND properties.$pathname LIKE '/venue/%'
            GROUP BY path
            ORDER BY views DESC
            LIMIT 100`,
        ),
      },
      {
        name: "PHOTO SHOT LIST: traffic plus engagement per venue",
        description:
          "Views, saves and booking handoffs in one row per venue slug. Shoot the top of this list first: attention already exists there, so better photography compounds immediately.",
        query: table(
          `SELECT coalesce(
                    properties.venue,
                    replaceOne(properties.$pathname, '/venue/', '')
                  ) AS venue,
                  countIf(event = '$pageview')           AS views,
                  countIf(event = 'venue_save')          AS saves,
                  countIf(event = 'venue_unsave')        AS unsaves,
                  countIf(event = 'venue_reserve_click') AS reserve_clicks
             FROM events
            WHERE timestamp > now() - INTERVAL 90 DAY
              AND (
                    (event = '$pageview' AND properties.$pathname LIKE '/venue/%')
                 OR event IN ('venue_save', 'venue_unsave', 'venue_reserve_click')
              )
            GROUP BY venue
            ORDER BY views DESC
            LIMIT 100`,
        ),
      },
      {
        name: "Most saved venues",
        description:
          "venue_save minus venue_unsave per venue. A save is a stronger vote than a view, and a high unsave share is a page that oversold itself.",
        query: table(
          `SELECT properties.venue AS venue,
                  countIf(event = 'venue_save')   AS saves,
                  countIf(event = 'venue_unsave') AS unsaves,
                  countIf(event = 'venue_save') - countIf(event = 'venue_unsave') AS net
             FROM events
            WHERE timestamp > now() - INTERVAL 90 DAY
              AND event IN ('venue_save', 'venue_unsave')
            GROUP BY venue
            ORDER BY net DESC
            LIMIT 100`,
        ),
      },
      {
        name: "Event pages by traffic",
        description:
          "The same question for /event/<id>, where photography comes from the resolved Google Places venue.",
        query: table(
          `SELECT properties.$pathname AS path,
                  count()              AS views
             FROM events
            WHERE timestamp > now() - INTERVAL 90 DAY
              AND event = '$pageview'
              AND properties.$pathname LIKE '/event/%'
            GROUP BY path
            ORDER BY views DESC
            LIMIT 50`,
        ),
      },
    ],
  },
];

// ── provisioning ─────────────────────────────────────────────────────────

type Named = { id: number; name: string };

async function findByName(
  projectId: number,
  resource: "dashboards" | "insights",
  name: string,
): Promise<Named | null> {
  const out = await ph<{ results: Named[] }>(
    `/api/projects/${projectId}/${resource}/?search=${encodeURIComponent(name)}&limit=100`,
  );
  return (out.results ?? []).find((r) => r.name === name) ?? null;
}

async function main(): Promise<void> {
  // The dry run is deliberately OFFLINE: it must work before the personal API
  // key exists, so the six dashboards can be reviewed in a PR by someone who
  // has not issued a key yet.
  if (DRY_RUN) {
    console.log("DRY RUN: nothing will be written to PostHog.\n");
    let insights = 0;
    for (const d of DASHBOARDS) {
      console.log(d.name);
      for (const i of d.insights) {
        console.log(`   - ${i.name}  [${String(i.query.kind)}]`);
        insights++;
      }
      console.log("");
    }
    console.log("scoreboard");
    console.log(`  dashboards_planned:  ${DASHBOARDS.length}`);
    console.log(`  insights_planned:    ${insights}`);
    return;
  }

  const projectId = await resolveProjectId();
  console.log(`PostHog project ${projectId} at ${API_HOST}\n`);

  let dashboardsCreated = 0;
  let dashboardsReused = 0;
  let insightsCreated = 0;
  let insightsUpdated = 0;

  for (const d of DASHBOARDS) {
    console.log(d.name);

    let dash = await findByName(projectId, "dashboards", d.name);
    if (dash) {
      dashboardsReused++;
      console.log(`   dashboard ${dash.id} (reused)`);
    } else {
      dash = await ph<Named>(`/api/projects/${projectId}/dashboards/`, {
        method: "POST",
        body: { name: d.name, description: d.description },
      });
      dashboardsCreated++;
      console.log(`   dashboard ${dash.id} (created)`);
    }

    for (const i of d.insights) {
      const existing = await findByName(projectId, "insights", i.name);
      const body = {
        name: i.name,
        description: i.description,
        query: i.query,
        dashboards: [dash.id],
        saved: true,
      };
      if (existing) {
        await ph(`/api/projects/${projectId}/insights/${existing.id}/`, {
          method: "PATCH",
          body,
        });
        insightsUpdated++;
        console.log(`   - ${i.name} (updated)`);
      } else {
        await ph(`/api/projects/${projectId}/insights/`, {
          method: "POST",
          body,
        });
        insightsCreated++;
        console.log(`   - ${i.name} (created)`);
      }
    }
    console.log("");
  }

  // A scoreboard of integers, not a status word. "It ran" is not the question.
  console.log("scoreboard");
  console.log(`  dashboards_created:  ${dashboardsCreated}`);
  console.log(`  dashboards_reused:   ${dashboardsReused}`);
  console.log(`  insights_created:    ${insightsCreated}`);
  console.log(`  insights_updated:    ${insightsUpdated}`);

  if (!DRY_RUN && insightsCreated + insightsUpdated === 0) {
    console.error("\nFAIL: nothing was written. That is not success.");
    process.exit(1);
  }

  if (!DRY_RUN) {
    console.log(`\nOpen them at ${API_HOST}/project/${projectId}/dashboard`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
