// Fun London — Curated venue seed (v5 + Padella, locked 2026-05-27)
//
// Each entry carries the editorial data for one venue: 1-liner, long
// description, tags, sources, creator coverage, "Real Talk" flags. The
// ingestion script (scripts/ingest-venues.ts) reads this file, calls
// Google Places API per entry to fetch the canonical name + address +
// photos + place_id + booking-platform fingerprint, merges the two, and
// writes to Supabase (`public.venues` if the venue has a major-platform
// booking; `public.partner_prospects` otherwise).
//
// To add a new venue: append an entry to VENUE_SEEDS. To rerun
// ingestion for an existing one: keep its slug and re-run the script —
// it upserts on google_place_id (set by Google after first run).

import type {
  Mood,
  PriceTier,
  TimeOfDay,
  VenueType,
  EditorialSource,
  CreatorCoverage,
  CriticalFlag,
} from "@/lib/types";

export type VenueSeed = {
  // Stable slug. Used for URLs, saved-venues, bookings.
  slug: string;
  // Google Places text-search query. Be specific enough that the
  // FIRST result is the right place — include neighbourhood + "London".
  searchQuery: string;

  // Editorial overrides (Google doesn't know these).
  vibe: string; // short 1-liner shown on cards
  longDescription: string; // 1-2 sentences on the detail page
  neighbourhood: string; // canonical area name (Shoreditch, Soho, Borough, etc.)
  type: VenueType;
  price: PriceTier;
  timeOfDay: TimeOfDay;
  moodTags: Mood[];
  vibeTags: string[]; // free-form display chips on the card

  // Provenance + creator coverage + Real Talk.
  editorialSources: EditorialSource[];
  creatorCoverage: CreatorCoverage[];
  criticalFlags: CriticalFlag[];

  // Day-spots (Culture / Market / Outdoors) are catalog venues but NOT
  // booking-partner prospects — skip the partner_prospects overlay for them.
  skipProspect?: boolean;
};

export const VENUE_SEEDS: VenueSeed[] = [
  // ── 1. Brat ───────────────────────────────────────────────────────────
  {
    slug: "brat",
    searchQuery: "Brat Climpson's Arch Shoreditch London",
    neighbourhood: "Shoreditch",
    vibe: "Basque embers, whole turbot, Tuesday-only chops.",
    longDescription:
      "Tomos Parry's Michelin-starred ode to Basque fire cooking, hidden above a Shoreditch pub. The whole turbot and the anchovy bread are the dishes that built the queue.",
    type: "Restaurant",
    price: "£££",
    timeOfDay: "Evening",
    moodTags: ["dinner"],
    vibeTags: ["Live fire", "Basque", "Hard to book"],
    editorialSources: [
      {
        publication: "Michelin Guide",
        url: "https://guide.michelin.com/en/greater-london/london/restaurant/brat",
        title: "Brat — 1 Michelin star, retained 2026",
        date: "2026-01-01",
      },
      {
        publication: "World's 50 Best Restaurants",
        url: "https://www.theworlds50best.com/list/1-50",
        title: "Brat ranked #81 in 2025",
        date: "2025-06-19",
      },
      {
        publication: "Hot Dinners",
        url: "https://www.hot-dinners.com/Gastroblog/Test-drive/brat-brunch-shoreditch-london-restaurant-revview",
        title: "Brat brunch — test drive",
        date: "2024-08-15",
      },
      {
        publication: "The Infatuation",
        url: "https://www.theinfatuation.com/london/reviews/brat",
        title: "Brat review — best of Shoreditch",
      },
    ],
    creatorCoverage: [
      {
        creator: "Topjaw",
        handle: "@topjaw",
        platform: "tiktok",
        url: "https://www.tiktok.com/@topjaw/video/7336501441168772384",
        verdict: "positive",
        note: "Featured in 'Best of London' rotation, particularly the Climpson's Arch outdoor service.",
      },
      {
        creator: "Sneaky Diner",
        handle: "sneakydiner.co.uk",
        platform: "blog",
        url: "https://www.sneakydiner.co.uk/reviews/brat",
        verdict: "positive",
        note: "Crowned Brat their new favourite restaurant.",
      },
    ],
    criticalFlags: [
      {
        label: "Hard to book",
        body: "Tables release on Resy and disappear in seconds. No walk-ins.",
      },
      {
        label: "Spend honestly",
        body: "£55-80 per person easy. A Jan 2025 review reported £413 for four, drinks included.",
      },
      {
        label: "Tight room, brisk pace",
        body: "Not a slow-Sunday-lunch place. The service tempo is part of the energy.",
      },
    ],
  },

  // ── 2. St. JOHN ──────────────────────────────────────────────────────
  {
    slug: "st-john",
    searchQuery: "St. JOHN restaurant Smithfield 26 St John Street London",
    neighbourhood: "Smithfield",
    vibe: "Nose-to-tail, white walls, doughnuts at 11pm.",
    longDescription:
      "Fergus Henderson's 1994 original — the restaurant that defined modern British cooking. Bone marrow on toast, sparse white-tiled room, pistachio doughnuts that outlive the kitchen each night.",
    type: "Restaurant",
    price: "£££",
    timeOfDay: "Evening",
    moodTags: ["dinner", "culture"],
    vibeTags: ["British classic", "Nose-to-tail", "Iconic"],
    editorialSources: [
      {
        publication: "Michelin Guide",
        url: "https://guide.michelin.com/en/greater-london/london/restaurant/st-john",
        title: "St. JOHN — 1 Michelin star",
      },
      {
        publication: "Harden's",
        url: "https://www.hardens.com/az/restaurants/london/ec1/st-john-smithfield.htm",
        title: "Harden's 2025 review · 4/5 across the board",
        date: "2025-01-01",
      },
      {
        publication: "Square Meal",
        url: "https://www.squaremeal.co.uk/restaurants/st-john-smithfield_401",
        title: "St. JOHN Smithfield profile",
      },
      {
        publication: "Time Out London",
        url: "https://www.timeout.com/london/restaurants/st-john-marylebone",
        title: "Time Out — St. JOHN coverage",
      },
    ],
    creatorCoverage: [
      {
        creator: "OneCityLDN",
        handle: "@onecityldn",
        platform: "tiktok",
        url: "https://www.tiktok.com/@onecityldn/video/7370721415957384481",
        verdict: "positive",
        note: "Stitch with Topjaw on Stanley Tucci's St. JOHN pork recommendation: 'the best pork we've had. Not my favourite. The best.'",
      },
    ],
    criticalFlags: [
      {
        label: "Marmite venue",
        body: "If you don't like offal, you'll be lost. Spartan dining room, white tiles, no music — some find it austere.",
      },
      {
        label: "Spend honestly",
        body: "Around £89 per person for 3 courses with wine (Harden's 2025).",
      },
    ],
  },

  // ── 3. Quo Vadis ─────────────────────────────────────────────────────
  {
    slug: "quo-vadis",
    searchQuery: "Quo Vadis 26-29 Dean Street Soho London",
    neighbourhood: "Soho",
    vibe: "Soho institution, sharp suits, sharper Jeremy Lee menu.",
    longDescription:
      "Dean Street since 1926, with Jeremy Lee at the pass since 2012. The smoked eel sandwich is on every Londoner's top-five lifelong dishes list. The private members' club lives upstairs.",
    type: "Restaurant",
    price: "£££",
    timeOfDay: "Evening",
    moodTags: ["dinner"],
    vibeTags: ["Old Soho", "Iconic", "Institution"],
    editorialSources: [
      {
        publication: "The Infatuation",
        url: "https://www.theinfatuation.com/london/reviews/quo-vadis",
        title: "Quo Vadis review — gold-stamped good time",
      },
      {
        publication: "Beau Monde Traveler",
        url: "https://beaumondetraveler.com/content/quo-vadis-soho-restaurant-review/",
        title: "Quo Vadis Soho review",
        date: "2025-08-15",
      },
      {
        publication: "The Good Food Guide",
        url: "https://www.thegoodfoodguide.co.uk/restaurant/quo-vadis/id/252",
        title: "Quo Vadis listing 2024-25",
      },
      {
        publication: "Hot Dinners",
        url: "https://www.hot-dinners.com/Restaurant-Reviews/Soho-Fitzrovia-Covent-Garden/quo-vadis",
        title: "Quo Vadis profile",
      },
    ],
    creatorCoverage: [
      {
        creator: "Time Out",
        handle: "@timeoutlondon",
        platform: "blog",
        url: "https://www.timeout.com/london/things-to-do/hype-dish-quo-vadiss-smoked-eel-sandwich",
        verdict: "positive",
        note: "The smoked eel sandwich is regularly named London's most famous sandwich.",
      },
    ],
    criticalFlags: [
      {
        label: "Crowd skews 35+",
        body: "Old-Soho-establishment vibe — the room reads more 'private members' than 'young first date'.",
      },
      {
        label: "Dean Street prices",
        body: "Premium pricing reflects the address — special-occasion territory, not weeknight casual.",
      },
    ],
  },

  // ── 4. Sessions Arts Club ────────────────────────────────────────────
  {
    slug: "sessions-arts-club",
    searchQuery:
      "Sessions Arts Club 24 Clerkenwell Green Old Sessions House London",
    neighbourhood: "Clerkenwell",
    vibe: "Hidden Clerkenwell courtroom, candlelit dinner, art on every wall.",
    longDescription:
      "Three flights up the unmarked staircase of a former Sessions House courthouse. The room itself — distressed plaster, peeling Tuscan-villa walls, candlelight, hung paintings — is one of the most photographed dining spaces in London.",
    type: "Restaurant",
    price: "£££",
    timeOfDay: "Evening",
    moodTags: ["dinner", "culture"],
    vibeTags: ["Hidden", "Painterly", "Candlelit"],
    editorialSources: [
      {
        publication: "Andy Hayler",
        url: "https://www.andyhayler.com/restaurant/sessions-arts-club",
        title:
          "Sessions Arts Club — Andy Hayler Feb 2024 review (post Florence Knight)",
        date: "2024-02-01",
      },
      {
        publication: "The Infatuation",
        url: "https://www.theinfatuation.com/london/reviews/sessions-arts-club",
        title: "Sessions Arts Club review — the beauty of the room",
      },
      {
        publication: "Hot Dinners",
        url: "https://www.hot-dinners.com/Gastroblog/Test-drive/sessions-arts-club-restaurant-review-clerkenwell-london",
        title: "Test-driving Sessions Arts Club",
      },
      {
        publication: "The Good Food Guide",
        url: "https://www.thegoodfoodguide.co.uk/restaurant/sessions-arts-club/id/42982",
        title: "Sessions Arts Club listing",
      },
    ],
    creatorCoverage: [
      {
        creator: "TikTok — Sessions Arts Club discover",
        handle: "tiktok.com/discover",
        platform: "tiktok",
        url: "https://www.tiktok.com/discover/sessions-art-club-london",
        verdict: "positive",
        note: "Numerous viral videos showcasing the stunning interiors — room-led, not dish-led.",
      },
    ],
    criticalFlags: [
      {
        label: "Chef change Jan 2024",
        body: "Florence Knight left in January 2024. The kitchen since February 2024 is run by Abigail Hill, her former sous chef. Reviews remain positive — the cooking ethos held.",
      },
      {
        label: "Truly hidden",
        body: "Up three flights of an unmarked courthouse staircase. No signage. Easy to walk past on Clerkenwell Green.",
      },
      {
        label: "Hard to book",
        body: "~40 covers. Booking competitive.",
      },
    ],
  },

  // ── 5. Sabor ──────────────────────────────────────────────────────────
  {
    slug: "sabor",
    searchQuery: "Sabor 35-37 Heddon Street Mayfair London",
    neighbourhood: "Mayfair",
    vibe: "Castilian suckling pig, Nieves Barragán's Spanish masterclass.",
    longDescription:
      "Nieves Barragán (ex-Barrafina) brought a bespoke wood-fired asador oven from Spain — the only one in the UK. The whole-roast suckling pig (cochinillo) upstairs at El Asador is the dish to come for.",
    type: "Restaurant",
    price: "£££",
    timeOfDay: "Evening",
    moodTags: ["dinner"],
    vibeTags: ["Spanish", "Asador", "Michelin"],
    editorialSources: [
      {
        publication: "Michelin Guide",
        url: "https://guide.michelin.com/ca/en/greater-london/london/restaurant/sabor",
        title: "Sabor — 1 Michelin star, retained 2025",
        date: "2025-01-01",
      },
      {
        publication: "The Infatuation",
        url: "https://www.theinfatuation.com/london/reviews/sabor",
        title: "Sabor review — Mayfair",
      },
      {
        publication: "Hot Dinners",
        url: "https://www.hot-dinners.com/Gastroblog/Test-drive/test-driving-sabor-an-essential-spanish-restaurant-in-mayfair",
        title: "Test-driving Sabor — essential Spanish in Mayfair",
      },
      {
        publication: "Harden's",
        url: "https://www.hardens.com/az/restaurants/london/w1b/sabor.htm",
        title: "Sabor — Harden's listing",
      },
    ],
    creatorCoverage: [
      {
        creator: "London In Between",
        handle: "@londoninbetween",
        platform: "tiktok",
        url: "https://www.tiktok.com/@londoninbetween/video/6985541866406071557",
        verdict: "positive",
        note: "Cochinillo TikTok — a London-creator staple.",
      },
    ],
    criticalFlags: [
      {
        label: "Two halves, plan ahead",
        body: "Upstairs El Asador is bookable. The downstairs counter is walk-in only — queues form by 6:30pm.",
      },
      {
        label: "Mayfair prices",
        body: "Reflects the postcode. Loud when full.",
      },
    ],
  },

  // ── 6. Manteca ────────────────────────────────────────────────────────
  {
    slug: "manteca",
    searchQuery: "Manteca 49-50 Curtain Road Shoreditch London",
    neighbourhood: "Shoreditch",
    vibe: "House-cured salumi, fresh pasta, alive past midnight.",
    longDescription:
      "Chris Leach (ex-Padella, ex-10 Greek Street) and David Carter's Italian. The pig-skin ragù and the salumi station are the dishes everyone films. Loud, post-2022 hot, hard to book.",
    type: "Restaurant",
    price: "££",
    timeOfDay: "Evening",
    moodTags: ["dinner"],
    vibeTags: ["Italian", "Late-night", "Loud"],
    editorialSources: [
      {
        publication: "Time Out London",
        url: "https://www.timeout.com/london/restaurants/manteca",
        title: "Manteca review — meat-heavy pasta paradise",
        date: "2025-06-01",
      },
      {
        publication: "Hot Dinners",
        url: "https://www.hot-dinners.com/Gastroblog/Test-drive/manteca-shoreditch-restaurant-review-london",
        title: "Manteca's permanent Shoreditch home — test drive",
      },
      {
        publication: "Foodism",
        url: "https://foodism.co.uk/reviews/restaurants/manteca-shoreditch/",
        title: "Manteca Shoreditch review",
      },
      {
        publication: "National Restaurant Awards",
        url: "https://www.nationalrestaurantawards.co.uk/profile/manteca/",
        title: "Manteca — NRA top-50",
        date: "2024-06-01",
      },
    ],
    creatorCoverage: [
      {
        creator: "Bon Appétit Magazine",
        handle: "@bonappetitmag",
        platform: "tiktok",
        url: "https://www.tiktok.com/@bonappetitmag/video/7491427792815525162",
        verdict: "positive",
        note: "Pig-skin ragù process video with Chris Leach.",
      },
      {
        creator: "Bon Appétit Magazine",
        handle: "@bonappetitmag",
        platform: "tiktok",
        url: "https://www.tiktok.com/@bonappetitmag/video/7491749451032186154",
        verdict: "positive",
        note: "Pasta station tour at Manteca.",
      },
    ],
    criticalFlags: [
      {
        label: "Loud by design",
        body: "Acoustics are deliberately energetic. Not for a quiet conversation.",
      },
      {
        label: "Hard to book",
        body: "Walk-in seats fill fast. Reservations release in waves.",
      },
    ],
  },

  // ── 7. The Quality Chop House ────────────────────────────────────────
  {
    slug: "quality-chop-house",
    searchQuery: "The Quality Chop House 88-94 Farringdon Road London",
    neighbourhood: "Farringdon",
    vibe: "Listed Victorian booths, the chop, the wine list.",
    longDescription:
      "A Grade II listed dining room from 1869, restored under Shaun Searley since 2012. The confit potatoes are the most-photographed in London. The wine list is one of the city's best by-the-glass programs.",
    type: "Restaurant",
    price: "£££",
    timeOfDay: "Evening",
    moodTags: ["dinner"],
    vibeTags: ["Listed", "Wine forward", "Historic"],
    editorialSources: [
      {
        publication: "Edible Reading",
        url: "https://ediblereading.com/2024/02/16/restaurant-review-quality-chop-house-farringdon/",
        title: "Quality Chop House — extremely good",
        date: "2024-02-16",
      },
      {
        publication: "The Infatuation",
        url: "https://www.theinfatuation.com/london/reviews/quality-chop-house",
        title: "QCH — a classic not handcuffed by tradition",
      },
      {
        publication: "Hot Dinners",
        url: "https://www.hot-dinners.com/Gastroblog/Test-drive/quality-chop-house-restaurant-review-farringdon-london",
        title: "QCH at 150 — still going strong",
      },
      {
        publication: "Harden's",
        url: "https://www.hardens.com/az/restaurants/london/ec1/the-quality-chop-house.htm",
        title: "Quality Chop House — Harden's listing",
      },
    ],
    creatorCoverage: [
      {
        creator: "Topjaw",
        handle: "@topjaw",
        platform: "tiktok",
        url: "https://www.tiktok.com/@topjaw/video/7473916369822567702",
        verdict: "positive",
        note: "Hereford ribeye + confit potatoes — 'a respected king-pin of London's restaurant scene'.",
      },
      {
        creator: "yorkonlypans",
        handle: "@yorkonlypans",
        platform: "tiktok",
        url: "https://www.tiktok.com/@yorkonlypans/video/7508076456346406166",
        verdict: "mixed",
        note: "8.7/10 on food but 'would we rush back? Not sure' — uncomfortable historic benches, ~£300 with drinks.",
      },
      {
        creator: "Eat Like An Adult",
        handle: "@eatlikeanadult",
        platform: "tiktok",
        url: "https://www.tiktok.com/@eatlikeanadult/video/7191920011945069829",
        verdict: "positive",
        note: "Confit potatoes recipe — direct from the QCH cookbook.",
      },
    ],
    criticalFlags: [
      {
        label: "Bench discomfort is real",
        body: "Famous Victorian booths are TIGHT — taller diners report being uncomfortable after an hour. @yorkonlypans flagged it directly in their 8.7/10 review.",
      },
      {
        label: "2-hour table clock",
        body: "Small space (~45 covers), tables run on a 2-hour limit. Plan for a measured pace.",
      },
      {
        label: "Spend honestly",
        body: "Around £300 for two with drinks. Not the lunch set — the proper dinner.",
      },
    ],
  },

  // ── 8. Tayēr + Elementary ────────────────────────────────────────────
  {
    slug: "tayer-elementary",
    searchQuery: "Tayer Elementary 152 Old Street London",
    neighbourhood: "Old Street",
    vibe: "Two bars, one purpose: cocktails as serious art.",
    longDescription:
      "Alex Kratena (ex-Artesian, formerly the world's #1 bartender) and Monica Berg's twin-room cocktail bar. Tayēr is the seated tasting experience at the hexagonal centre station; Elementary is the standing front-room casual pour. Both pour like the global top-five bar they consistently are.",
    type: "Bar",
    price: "£££",
    timeOfDay: "Night",
    moodTags: ["drinks"],
    vibeTags: ["World's 50 Best", "Modern cocktails", "Walk-in front"],
    editorialSources: [
      {
        publication: "World's 50 Best Bars",
        url: "https://www.theworlds50best.com/bars/the-list/tayer-elementary.html",
        title: "Tayer + Elementary — #5 globally, 2025 list",
        date: "2025-10-15",
      },
      {
        publication: "The Infatuation",
        url: "https://www.theinfatuation.com/london/reviews/tayer-and-elementary",
        title: "Tayer + Elementary review",
      },
      {
        publication: "Hot Dinners",
        url: "https://www.hot-dinners.com/Gastroblog/Test-drive/tayer-elementary-review-london-cocktail-bar-restaurant-old-street-ta-ta-eatery",
        title: "Test-driving Tayer + Elementary",
      },
      {
        publication: "Top 50 Cocktail Bars",
        url: "https://www.top50cocktailbars.com/Bars/UK/Greater-London/tayer-and-elementary.html",
        title: "Tayer + Elementary — UK Top 50",
      },
    ],
    creatorCoverage: [
      {
        creator: "Musk and Tam",
        handle: "@muskandtam",
        platform: "tiktok",
        url: "https://www.tiktok.com/@muskandtam/video/7357738759225380128",
        verdict: "positive",
        note: "'8th best bar in the world and it did not disappoint!'",
      },
    ],
    criticalFlags: [
      {
        label: "Two rooms, plan which",
        body: "Tayer = seated, walk-through tasting menu of drinks. Elementary = standing/casual front bar. Show up at the wrong door at 7pm and you'll be queueing.",
      },
      {
        label: "Cocktails £14-18",
        body: "Top-tier drinks pricing. Pair the tasting in Tayer with a date you want to impress.",
      },
    ],
  },

  // ── 9. Monmouth Coffee ───────────────────────────────────────────────
  {
    slug: "monmouth-coffee",
    searchQuery: "Monmouth Coffee Company 2 Park Street Borough Market London",
    neighbourhood: "Borough",
    vibe: "London's original speciality coffee, since 1978.",
    longDescription:
      "Predates the UK speciality wave by two decades. The Borough Market location pulls the queue; the Bermondsey roastery is where the beans are roasted for half of London's other top cafés. Brown paper bags, no app, no loyalty card, real coffee.",
    type: "Cafe",
    price: "£",
    timeOfDay: "Day",
    moodTags: ["culture"],
    vibeTags: ["Speciality coffee", "Heritage", "Borough Market"],
    editorialSources: [
      {
        publication: "Best Coffee Guide",
        url: "https://www.bestcoffee.guide/pages/cafe-monmouth-coffee-borough-market",
        title: "Monmouth Coffee Borough Market — top-rank",
      },
      {
        publication: "Harden's",
        url: "https://www.hardens.com/az/restaurants/london/wc2/monmouth-coffee-company.htm",
        title: "Monmouth Coffee — Harden's listing",
      },
      {
        publication: "Yelp UK 2024-2026",
        url: "https://www.yelp.co.uk/biz/monmouth-coffee-london-3",
        title: "4.5+ rolling rating",
      },
    ],
    creatorCoverage: [
      {
        creator: "The Handbook",
        handle: "@thehandbooknews",
        platform: "tiktok",
        url: "https://www.tiktok.com/@thehandbooknews/video/7394523219606211872",
        verdict: "positive",
        note: "Part 5 of London's best coffee — featured Monmouth Borough.",
      },
    ],
    criticalFlags: [
      {
        label: "The queue is real",
        body: "Borough Market location, weekend mornings = 20+ minute waits standard. The queue is part of the ritual.",
      },
      {
        label: "£5 reusable cup deposit",
        body: "Takeaway requires a £5 reusable cup (refunded on return). Surprises some — bring a cup if you have one.",
      },
      {
        label: "Limited seating",
        body: "No seats at Borough Market. Tiny seating area at Bermondsey roastery.",
      },
    ],
  },

  // ── 10. Andrew Edmunds ───────────────────────────────────────────────
  {
    slug: "andrew-edmunds",
    searchQuery: "Andrew Edmunds 46 Lexington Street Soho London",
    neighbourhood: "Soho",
    vibe: "Candlelit Georgian booths, daily-changing menu, a wine list out of time.",
    longDescription:
      "Soho's most enduringly romantic dining room, in operation since 1985. Creaky furniture, flickering candles, an unreal wine list at restraint mark-ups. The room is the headline. Reopened end of August 2024 after essential building works.",
    type: "Restaurant",
    price: "£££",
    timeOfDay: "Evening",
    moodTags: ["dinner"],
    vibeTags: ["Romantic", "Old Soho", "Wine"],
    editorialSources: [
      {
        publication: "The Infatuation",
        url: "https://www.theinfatuation.com/london/reviews/andrew-edmunds",
        title: "Andrew Edmunds review — your romantic bones",
      },
      {
        publication: "Decanter",
        url: "https://www.decanter.com/learn/andrew-edmunds-london-restaurant-review-374993/",
        title: "Andrew Edmunds — Soho restaurant review",
      },
      {
        publication: "The Good Food Guide",
        url: "https://www.thegoodfoodguide.co.uk/restaurant/andrew-edmunds/id/3335",
        title: "Andrew Edmunds listing 2024-25",
      },
      {
        publication: "Harden's",
        url: "https://www.hardens.com/az/restaurants/london/w1f/andrew-edmunds.htm",
        title: "Andrew Edmunds — Harden's listing",
      },
    ],
    creatorCoverage: [],
    criticalFlags: [
      {
        label: "Daily menu — hit and miss",
        body: "Menu changes every day. Some dishes shine, others fall flat. The wine list and the candlelight are the safety net.",
      },
      {
        label: "Deliberately anti-Instagram",
        body: "Dark, candlelit, peeling. Hard to photograph. If you want bright/modern, look elsewhere.",
      },
      {
        label: "Reopened Aug 2024",
        body: "Was closed July-August 2024 for essential building works. Back to normal now — flagged here in case you see old reviews referencing the closure.",
      },
    ],
  },

  // ── 11. Padella ───────────────────────────────────────────────────────
  {
    slug: "padella",
    searchQuery: "Padella restaurant 6 Southwark Street Borough Market London",
    neighbourhood: "Borough Market",
    vibe: "Hand-rolled pasta, no reservations.",
    longDescription:
      "Tim Siadatan and Jordan Frieda's pasta counter at the foot of Borough Market. Queue out the door from 5pm. Pici cacio e pepe and pappardelle with 8-hour beef shin ragù are the dishes that built the line.",
    type: "Restaurant",
    price: "££",
    timeOfDay: "Evening",
    moodTags: ["dinner"],
    vibeTags: ["Pasta", "Walk-in only", "Queue"],
    editorialSources: [
      {
        publication: "Time Out London",
        url: "https://www.timeout.com/london/restaurants/padella",
        title: "Padella review — pasta queue worth joining",
      },
      {
        publication: "The Infatuation",
        url: "https://www.theinfatuation.com/london/reviews/padella",
        title: "Padella review",
      },
      {
        publication: "Hot Dinners",
        url: "https://www.hot-dinners.com/Gastroblog/Test-drive/test-driving-padella-speedy-pasta-in-borough-market",
        title: "Test Driving Padella — speedy pasta in Borough Market",
      },
      {
        publication: "Square Meal",
        url: "https://www.squaremeal.co.uk/restaurants/padella_25881",
        title: "Padella — Square Meal listing",
      },
    ],
    creatorCoverage: [
      {
        creator: "Topjaw",
        handle: "@topjaw",
        platform: "tiktok",
        url: "https://www.tiktok.com/@topjaw",
        verdict: "positive",
        note: "Recurrent Padella appearances in 'best pasta in London' rotations.",
      },
    ],
    criticalFlags: [
      {
        label: "No reservations",
        body: "Walk-in only. Arrive by 5:30pm for dinner or expect a 45-90 minute wait. They take a phone number and text you when ready — you can drink at the Wheatsheaf next door.",
      },
      {
        label: "Quick turnover by design",
        body: "Counter seats, brisk pace. Not a long lingering meal.",
      },
    ],
  },

  // ── 12. The Marksman ─────────────────────────────────────────────────
  {
    slug: "the-marksman",
    searchQuery: "The Marksman Public House 254 Hackney Road London",
    neighbourhood: "Hackney",
    vibe: "Victorian boozer below, St. JOHN alums plating brown-butter tart above.",
    longDescription:
      "Tom Harris and Jon Rotheram's Grade II-listed Hackney Road pub: downstairs a proper drinking den, upstairs the dining room turning out the beef-and-barley buns and brown butter & honey tart that built the queue. Michelin Pub of the Year 2017, Bib Gourmand, ten years deep.",
    type: "Pub",
    price: "£££",
    timeOfDay: "Evening",
    moodTags: ["dinner", "drinks"],
    vibeTags: ["Gastropub", "British", "Sunday roast", "St. JOHN lineage"],
    editorialSources: [
      {
        publication: "Michelin Guide",
        url: "https://guide.michelin.com/gb/en/greater-london/london/restaurant/marksman",
        title: "Marksman — Bib Gourmand, London",
      },
      {
        publication: "Time Out",
        url: "https://www.timeout.com/london/bars-and-pubs/marksman",
        title: "The Marksman, Hackney",
      },
      {
        publication: "The Infatuation",
        url: "https://www.theinfatuation.com/london/reviews/marksman",
        title: "Marksman — Hackney review",
      },
      {
        publication: "Hot Dinners",
        url: "https://www.hot-dinners.com/Restaurant-Reviews/East-London/the-marksman",
        title: "The Marksman — Hackney",
      },
      {
        publication: "The Good Food Guide",
        url: "https://www.thegoodfoodguide.co.uk/restaurant/the-marksman/id/27665",
        title: "The Marksman, Hackney — review",
      },
    ],
    creatorCoverage: [],
    criticalFlags: [
      {
        label: "Two rooms, two experiences",
        body: "Downstairs is a Victorian boozer with bar snacks and pints; the proper menu — and the famous tart — lives in the small upstairs dining room. Book if you want the full thing.",
      },
      {
        label: "Spend honestly",
        body: "Closer to a restaurant than a pub on the bill. Diners flag Sunday roasts around £35, starters that add up fast. Easy £50+ a head with a drink.",
      },
      {
        label: "Sunday roast is the headline act",
        body: "Weekend lunches and Sunday roast book out weeks ahead via OpenTable. Midweek dinners are the quieter way in.",
      },
    ],
  },

  // ── 13. The French House ─────────────────────────────────────────────
  {
    slug: "the-french-house",
    searchQuery: "The French House restaurant 49 Dean Street Soho London",
    neighbourhood: "Soho",
    vibe: "Seven tables above Soho's Frenchest pub; Neil Borthwick on the pans.",
    longDescription:
      "The tiny upstairs dining room at 49 Dean Street, where Neil Borthwick (ex-Merchants Tavern, married to Angela Hartnett) cooks a short, hand-written daily menu of robust French country food. Twelve covers, two sittings, a room that's been Soho's living room since 1891.",
    type: "Pub",
    price: "£££",
    timeOfDay: "Evening",
    moodTags: ["dinner", "drinks"],
    vibeTags: ["French", "Historic Soho", "Tiny dining room", "Long lunch"],
    editorialSources: [
      {
        publication: "Michelin Guide",
        url: "https://guide.michelin.com/gb/en/greater-london/london/restaurant/french-house",
        title: "The French House — London",
      },
      {
        publication: "Time Out",
        url: "https://www.timeout.com/london/restaurants/upstairs-at-the-french-house",
        title: "Upstairs at the French House, Soho",
      },
      {
        publication: "The Infatuation",
        url: "https://www.theinfatuation.com/london/reviews/the-french-house",
        title: "The French House — Soho review",
      },
      {
        publication: "Hot Dinners",
        url: "https://www.hot-dinners.com/Gastroblog/Test-drive/french-house-soho-restaurant-review-neil-borthwick-london-dean-street",
        title: "Test Driving The French House with Neil Borthwick",
      },
      {
        publication: "Jancis Robinson",
        url: "https://www.jancisrobinson.com/articles/fine-french-lunch-soho",
        title: "A fine French lunch in Soho",
      },
      {
        publication: "Edible Reading",
        url: "https://ediblereading.com/2025/08/29/restaurant-review-the-french-house-soho/",
        title: "Restaurant review — The French House, Soho",
        date: "2025-08-29",
      },
    ],
    creatorCoverage: [
      {
        creator: "Topjaw",
        handle: "@topjaw",
        platform: "tiktok",
        url: "https://www.tiktok.com/@topjaw/video/7313983451818888481",
        verdict: "positive",
        note: "'An absolute essential' of the London pub scene — deep-rooted, industry-favourite, feels like walking into someone's home.",
      },
    ],
    criticalFlags: [
      {
        label: "Upstairs only is bookable",
        body: "The famous downstairs pub is walk-in (and famously no-phones, half-pints-of-beer-only). The dining room above is the bookable bit. Reserve via frenchhousesoho.com — diary opens 60 days out.",
      },
      {
        label: "Tiny room, tight rules",
        body: "Seven tables, max party of six, two sittings per service. Not a long-lingering room on a busy night. Lunch is the connoisseur's move.",
      },
      {
        label: "Daily handwritten menu",
        body: "No menu on the website; the day's list goes up on Instagram. Lovely if you trust the kitchen, awkward if you've got a fussy eater in tow.",
      },
    ],
  },

  // ── 14. Ronnie Scott's ───────────────────────────────────────────────
  {
    slug: "ronnie-scotts",
    searchQuery: "Ronnie Scott's Jazz Club 47 Frith Street Soho London",
    neighbourhood: "Soho",
    vibe: "London's oldest jazz club — velvet booths, two sets a night.",
    longDescription:
      "Independent Soho institution opened by saxophonist Ronnie Scott in 1959. Two ticketed sets nightly — dinner-and-show, then the cheaper Late Late Show after 11.15pm — in a dim, candle-lit room with velvet booths.",
    type: "Live Music",
    price: "£££",
    timeOfDay: "Night",
    moodTags: ["culture", "drinks"],
    vibeTags: ["Since 1959", "Two sets a night", "Late Late Show", "Soho"],
    editorialSources: [
      {
        publication: "Time Out",
        url: "https://www.timeout.com/london/music/ronnie-scotts",
        title: "Ronnie Scott's — Music in Soho, London",
      },
      {
        publication: "Time Out",
        url: "https://www.timeout.com/london/news/legendary-london-jazz-club-ronnie-scotts-has-revealed-the-official-opening-date-of-its-new-music-venue-011926",
        title:
          "Ronnie Scott's reveals opening date of its new 140-capacity venue, Upstairs at Ronnie's",
        date: "2026-01-19",
      },
      {
        publication: "Jazzwise",
        url: "https://www.jazzwise.com/features/article/the-house-that-ronnie-and-pete-built-celebrating-ronnie-scott-s-at-60",
        title:
          "The house that Ronnie and Pete built: celebrating Ronnie Scott's at 60",
      },
      {
        publication: "Clash",
        url: "https://www.clashmusic.com/live/upstairs-at-ronnie-scotts-elevates-sound-elegance-in-sohos-iconic-music-venue/",
        title:
          "Upstairs At Ronnie Scott's Elevates Sound & Elegance In Soho's Iconic Music Venue",
      },
      {
        publication: "BFI Sight & Sound",
        url: "https://www.bfi.org.uk/sight-and-sound/reviews/ronnies-ronnie-scott-world-famous-jazz-club-documentary-oliver-murray",
        title: "Ronnie's review: Soho's old jazz scene in blue",
      },
    ],
    creatorCoverage: [
      {
        creator: "London Weekender",
        handle: "@londonweekender",
        platform: "tiktok",
        url: "https://www.tiktok.com/@londonweekender/video/7267975290175950081",
        verdict: "positive",
        note: "'Genuinely the best cocktails I have had in London so far' — date-night/live-music angle.",
      },
      {
        creator: "indiana_mg",
        handle: "@indiana_mg",
        platform: "tiktok",
        url: "https://www.tiktok.com/@indiana_mg/video/7268594531984018694",
        verdict: "positive",
        note: "Flags the student/musician concession — £6 entry to the Late Late Show with student ID.",
      },
    ],
    criticalFlags: [
      {
        label: "Two shows a night — pick the right one",
        body: "Main show is dinner-and-music (steep — expect £££ once food, service and minimum spend land). The Late Late Show from ~11.15pm is £12 advance and skips the dining commitment. Student/musician concession drops it to ~£6 on Wed/Thu.",
      },
      {
        label: "Book direct via ronniescotts.co.uk",
        body: "All tickets sold through the venue's own site (no DICE/Ticketweb). Popular acts sell out weeks ahead — walk-up is risky.",
      },
      {
        label: "Seating is cramped and assigned",
        body: "Velvet booths look romantic but tables are tight and shared. Arrive at door-time, not show-time, if you want a sightline. Bar stools are first-come.",
      },
    ],
  },

  // ── 15. Café OTO ─────────────────────────────────────────────────────
  {
    slug: "cafe-oto",
    searchQuery: "Cafe OTO 18-22 Ashwin Street Dalston London",
    neighbourhood: "Dalston",
    vibe: "Bare-bones Dalston room where the world's experimental musicians actually want to play.",
    longDescription:
      "Independent 150-cap venue opened in 2008 by Hamish Dunbar and Keiko Yamamoto in a former paint factory. Free jazz, improv, noise, electronica and unclassifiable music seven nights a week — plus café and record shop by day, OTOROKU live-recording label on the side.",
    type: "Live Music",
    price: "££",
    timeOfDay: "Night",
    moodTags: ["culture"],
    vibeTags: ["Experimental", "No stage", "Sets not gigs", "OTOROKU label"],
    editorialSources: [
      {
        publication: "Time Out",
        url: "https://www.timeout.com/london/music/you-always-know-youll-get-something-interesting-an-oral-history-of-cafe-oto",
        title:
          "'You always know you'll get something interesting': an oral history of Cafe OTO",
      },
      {
        publication: "Time Out",
        url: "https://www.timeout.com/london/things-to-do/cafe-oto",
        title: "Cafe Oto: Time Out's guide to the experimental music haven",
      },
      {
        publication: "The Quietus",
        url: "https://thequietus.com/articles/24806-anthony-braxton-cafe-oto-live-review",
        title: "LIVE REPORT: Anthony Braxton At Cafe Oto",
      },
      {
        publication: "Bandcamp Daily",
        url: "https://daily.bandcamp.com/features/cafe-oto-album-guide",
        title: "Café OTO Turns 15 — an album guide",
      },
      {
        publication: "Eastlondonlines",
        url: "https://www.eastlondonlines.co.uk/2025/03/inside-cafe-oto-the-dalston-venue-name-checked-in-oscar-acceptance-speech/",
        title:
          "Inside Cafe Oto: the Dalston venue name-checked in Oscar acceptance speech",
        date: "2025-03-15",
      },
      {
        publication: "The Jazz Mann",
        url: "https://www.thejazzmann.com/reviews/review/marc-ribot-solo-performance-cafe-oto-dalston-london-day-two-of-a-two-day-residency-18-may-2025",
        title: "Marc Ribot Solo Performance, Cafe Oto",
        date: "2025-05-18",
      },
    ],
    creatorCoverage: [],
    criticalFlags: [
      {
        label: "Book in advance on cafeoto.co.uk",
        body: "Tickets are advance-only via the venue's own site (10% fee capped at £2.80). Most shows are a mix of seated + standing on first-come basis — turn up at door-time, not start-time, if you want a chair.",
      },
      {
        label: "It's a room, not a venue",
        body: "No stage, no backstage, no frills. That bare-paint-factory austerity is the appeal — performers play at floor level, a metre from you. Sets, not gigs; listen quietly.",
      },
      {
        label: "Most shows wrap by 11pm",
        body: "Door times listed on each event; music typically starts 30 min after doors and is done by 11pm. Café/record shop runs in daytime — worth a separate trip.",
      },
    ],
  },

  // ── 16. The Dusty Knuckle ────────────────────────────────────────────
  {
    slug: "dusty-knuckle",
    searchQuery: "The Dusty Knuckle Bakery Abbot Street Dalston London",
    neighbourhood: "Dalston",
    vibe: "Social-enterprise bakery making London's most-hyped sandwiches.",
    longDescription:
      "Started in 2014 by Max Tobias, Rebecca Oliver and Daisy Terry as a Dalston shipping-container bakery with a youth-training mission. Now a TikTok-famous focaccia-sandwich destination with a second bakery in Harringay and a Highbury van.",
    type: "Cafe",
    price: "££",
    timeOfDay: "Day",
    moodTags: ["culture"],
    vibeTags: [
      "Sourdough",
      "Social enterprise",
      "Focaccia sandwiches",
      "Walk-in",
    ],
    editorialSources: [
      {
        publication: "The Infatuation",
        url: "https://www.theinfatuation.com/london/reviews/dusty-knuckle-bakery-1",
        title: "The Dusty Knuckle Bakery — Dalston review",
      },
      {
        publication: "Time Out",
        url: "https://www.timeout.com/london/restaurants/the-dusty-knuckle",
        title: "The Dusty Knuckle, Dalston",
      },
      {
        publication: "Square Meal",
        url: "https://www.squaremeal.co.uk/restaurants/the-dusty-knuckle-dalston_22424",
        title: "The Dusty Knuckle Dalston — review, menu, opening times",
      },
      {
        publication: "Foodism",
        url: "https://foodism.co.uk/features/long-reads/rise-of-the-sandwich/",
        title: "Why the sandwich is London's hottest food trend",
      },
      {
        publication: "Country & Town House",
        url: "https://www.countryandtownhouse.com/food-and-drink/the-dusty-knuckle/",
        title: "The Dusty Knuckle: What's The Hype Around This Viral Bakery?",
      },
    ],
    creatorCoverage: [
      {
        creator: "Baking Hermann",
        handle: "@bakinghermann",
        platform: "tiktok",
        url: "https://www.tiktok.com/@bakinghermann/video/7204772553104051462",
        verdict: "positive",
        note: "'The secret to London's ultimate sandwich' — behind-the-scenes at Dalston.",
      },
      {
        creator: "Baking Hermann",
        handle: "@bakinghermann",
        platform: "tiktok",
        url: "https://www.tiktok.com/@bakinghermann/video/7250070111757798683",
        verdict: "positive",
        note: "How London's best sandwich is made at The Dusty Knuckle.",
      },
    ],
    criticalFlags: [
      {
        label: "Sandwiches sell out by lunch",
        body: "Going viral on TikTok means the bakes routinely run out well before close. Get there by 12, especially on weekends, or you'll miss the focaccia sandwich entirely.",
      },
      {
        label: "Queue is real, no online ordering",
        body: "20+ minute queues round the block on weekends are standard at both Dalston and Harringay. Walk-in only — no booking, no pre-order, no app.",
      },
      {
        label: "Social-enterprise mission, not a gimmick",
        body: "Founded to train at-risk young people through a paid bakery programme. The prison-bakery scheme is a real ongoing initiative, not marketing dressing.",
      },
    ],
  },

  // ── 17. Brawn ─────────────────────────────────────────────────────────
  {
    slug: "brawn",
    searchQuery: "Brawn 49 Columbia Road Bethnal Green London",
    neighbourhood: "Columbia Road",
    vibe: "The natural-wine bistro that taught London small plates.",
    longDescription:
      "Opened in 2010 as the Terroirs team's east-London outpost and now fully run by chef Ed Wilson. This Columbia Road bistro pioneered the small-plates-and-low-intervention-wine template that the rest of the city spent the next decade copying.",
    type: "Wine Bar",
    price: "£££",
    timeOfDay: "Evening",
    moodTags: ["dinner", "drinks"],
    vibeTags: [
      "Natural wine",
      "Small plates",
      "Neighbourhood bistro",
      "European",
    ],
    editorialSources: [
      {
        publication: "The Infatuation",
        url: "https://www.theinfatuation.com/london/reviews/brawn",
        title: "Brawn — review, Shoreditch",
      },
      {
        publication: "Time Out",
        url: "https://www.timeout.com/london/restaurants/brawn",
        title: "Brawn — restaurants in Bethnal Green",
      },
      {
        publication: "Hot Dinners",
        url: "https://www.hot-dinners.com/London-restaurants/East-London/brawn-columbia-road-wine-bar-terroirs-london",
        title: "Brawn — Columbia Road wine bar from the Terroirs team",
      },
      {
        publication: "Square Meal",
        url: "https://www.squaremeal.co.uk/restaurants/brawn_3209",
        title: "Brawn, London — review, menu, opening times",
      },
      {
        publication: "The Good Food Guide",
        url: "https://www.thegoodfoodguide.co.uk/restaurant/brawn/id/13571",
        title: "Review of Brawn, Bethnal Green",
      },
      {
        publication: "Harden's",
        url: "https://www.hardens.com/az/restaurants/london/e2/brawn.htm",
        title: "Brawn — Harden's London review",
      },
    ],
    creatorCoverage: [
      {
        creator: "Kate Nevs",
        handle: "@katenevs",
        platform: "tiktok",
        url: "https://www.tiktok.com/@katenevs/video/7302181612362517793",
        verdict: "positive",
        note: "'I've had my own birthday dinner at Brawn — is there a higher compliment a London gal can make?'",
      },
      {
        creator: "Hungry Hobbit",
        handle: "@hungryhobbit11",
        platform: "tiktok",
        url: "https://www.tiktok.com/@hungryhobbit11/video/7142828023933324549",
        verdict: "positive",
        note: "'Immaculate vibes and plates' on Columbia Road.",
      },
    ],
    criticalFlags: [
      {
        label: "Book ahead, especially Sunday",
        body: "Small converted-warehouse room on Columbia Road — and the Sunday flower-market crowd makes lunchtime walk-ins nearly impossible. Reserve via the website.",
      },
      {
        label: "Natural wine list runs the show",
        body: "The list leans heavily into low-intervention, organic and biodynamic bottles. If you want a classic Bordeaux or a familiar New World pour, this isn't that bistro — trust the staff or you'll be lost.",
      },
      {
        label: "Closed Sunday dinner / Monday lunch",
        body: "Lunch is Tues-Sat only; dinner Mon-Sat. Sunday is the Columbia Road flower-market lunch service — plan accordingly.",
      },
    ],
  },

  // ── 18. 40 Maltby Street ─────────────────────────────────────────────
  {
    slug: "40-maltby-street",
    searchQuery: "40 Maltby Street wine bar SE1 3PA Bermondsey London",
    neighbourhood: "Bermondsey",
    vibe: "Natural-wine bar under a Bermondsey railway arch.",
    longDescription:
      "Raef Hodgson's wine bar and modern European kitchen tucked inside the Gergovie Wines warehouse, with chef Steve Williams (ex-Ledbury, ex-Harwood Arms) turning out a weekly-changing chalkboard of small plates. A no-bookings room of ~30 covers built for long, slow sessions through a 120+ bin natural wine list.",
    type: "Wine Bar",
    price: "£££",
    timeOfDay: "Evening",
    moodTags: ["dinner", "drinks"],
    vibeTags: ["Natural wine", "Railway arch", "No bookings", "Chef-loved"],
    editorialSources: [
      {
        publication: "The Infatuation",
        url: "https://www.theinfatuation.com/london/reviews/40-maltby-street",
        title: "40 Maltby Street — Review, Bermondsey",
        date: "2024-04-01",
      },
      {
        publication: "Time Out",
        url: "https://www.timeout.com/london/restaurants/40-maltby-street",
        title: "40 Maltby Street — Restaurants in Bermondsey",
      },
      {
        publication: "Hot Dinners",
        url: "https://www.hot-dinners.com/Restaurant-Reviews/South-Bank-London-Bridge-Bermondsey/40-maltby-street-bermondsey",
        title: "40 Maltby Street, Bermondsey",
      },
      {
        publication: "Square Meal",
        url: "https://www.squaremeal.co.uk/restaurants/40-maltby-street_3758",
        title: "40 Maltby Street — Restaurant Review",
      },
      {
        publication: "The Good Food Guide",
        url: "https://www.thegoodfoodguide.co.uk/restaurant/40-maltby-street/id/26285",
        title: "Review of 40 Maltby Street, Bermondsey",
      },
    ],
    creatorCoverage: [
      {
        creator: "Cheese and Biscuits",
        handle: "cheesenbiscuits",
        platform: "blog",
        url: "https://cheesenbiscuits.blogspot.com/2022/11/40-maltby-street-bermondsey.html",
        verdict: "positive",
        note: "Cheddar puffs and white beans with aioli — 'all of London's best restaurant instincts in a professional, friendly package'.",
      },
    ],
    criticalFlags: [
      {
        label: "No bookings, tiny room",
        body: "Walk-in only with ~30 covers on long shared high tables. Best shot is lunch Thu-Sat from 12 — dinner queues form before the 5:30 open.",
      },
      {
        label: "Natural wine, all the way",
        body: "The list is 100% low-intervention. If you want a polished classical Burgundy or a clean New World Chardonnay, this isn't the room — the funk isn't for everyone.",
      },
      {
        label: "Railway-arch acoustics",
        body: "Hard surfaces, exposed brick, vaulted ceiling. It gets loud once the room fills, and trains rumble overhead — part of the charm, not a quiet date.",
      },
    ],
  },

  // ── 19. Forza Wine (Peckham) ─────────────────────────────────────────
  {
    slug: "forza-wine-peckham",
    searchQuery: "Forza Wine 133a Rye Lane Peckham London",
    neighbourhood: "Peckham",
    vibe: "Rooftop Italian small plates above Peckhamplex.",
    longDescription:
      "Bash Redford and Michael Lavery's rooftop wine bar on top of the Peckhamplex car park, with floor-to-ceiling glass on the indoor cube and a bench-filled terrace facing the South London skyline. Italian-leaning snacks, frozen grape daiquiris and a tight, Italy-heavy wine list.",
    type: "Wine Bar",
    price: "££",
    timeOfDay: "Evening",
    moodTags: ["drinks", "dinner"],
    vibeTags: ["Rooftop", "Sunset", "Italian", "Skyline view"],
    editorialSources: [
      {
        publication: "The Infatuation",
        url: "https://www.theinfatuation.com/london/reviews/forza-wine",
        title: "Forza Wine — Review, Peckham",
      },
      {
        publication: "Time Out",
        url: "https://www.timeout.com/london/bars-and-pubs/forza-wine",
        title: "Forza Wine, Peckham",
      },
      {
        publication: "Square Meal",
        url: "https://www.squaremeal.co.uk/restaurants/forza-wine_23237",
        title: "Forza Wine — Restaurant Review, Menu, Opening Times",
      },
      {
        publication: "The Nudge",
        url: "https://thenudge.com/london-restaurants/forza-wine/",
        title: "Forza Wine — Rooftop Italian From The Forza Win Team",
      },
      {
        publication: "Restaurant Online",
        url: "https://www.restaurantonline.co.uk/Article/2026/02/27/a-show-of-forza-bash-redford-and-michael-lavery-on-their-new-soho-venture/",
        title:
          "A show of Forza: Bash Redford and Michael Lavery on their new Soho venture",
        date: "2026-02-27",
      },
    ],
    creatorCoverage: [
      {
        creator: "Bald Flavours",
        handle: "baldflavours",
        platform: "blog",
        url: "https://baldflavours.com/forzawine/",
        verdict: "positive",
        note: "Walkthrough of the Rye Lane rooftop and the small-plates menu.",
      },
      {
        creator: "Eats Dulwich",
        handle: "eatsdulwich",
        platform: "blog",
        url: "https://eatsdulwich.substack.com/p/restaurant-review-forza-wine",
        verdict: "positive",
        note: "Substack review of the Peckham original — pre-Covid favourite that 'feels like part of the furniture'.",
      },
    ],
    criticalFlags: [
      {
        label: "Bookings are tight in summer",
        body: "Capacity is ~100 across indoor cube + terrace. Tables are bookable via the Forza website, but in summer the sunset slots vanish weeks ahead and the walk-in terrace fills fast from 5pm.",
      },
      {
        label: "It's on top of a car park",
        body: "Entry is via the Peckhamplex multi-storey lift on Rye Lane — first-timers regularly walk past it. Stick with the signage; the lift goes straight to the 5th floor.",
      },
      {
        label: "Snacks, not a full dinner",
        body: "The kitchen is small plates priced £4-18, designed for grazing with wine. Big appetites should order more than feels reasonable, or eat before.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  // DAY-SPOTS (Culture / Market / Outdoors) — added 2026-06-01 to fill the
  // mood-deck's Morning/Afternoon decks. Independent, non-mainstream,
  // verified in 2+ publications. skipProspect: not booking-partner targets.
  // ─────────────────────────────────────────────────────────────────────

  // ── 20. Sir John Soane's Museum ──────────────────────────────────────
  {
    slug: "sir-john-soanes-museum",
    searchQuery:
      "Sir John Soane's Museum 13 Lincoln's Inn Fields Holborn London",
    neighbourhood: "Holborn",
    vibe: "An architect's house stuffed floor-to-ceiling with antiquity.",
    longDescription:
      "The home Sir John Soane left to the nation in 1837, frozen exactly as he arranged it — a labyrinth of mirrors, skylights and marbles wrapped around the sarcophagus of Seti I and Hogarth's full 'Rake's Progress'. Free, eccentric, and one of the strangest interiors in London.",
    type: "Culture",
    price: "Free",
    timeOfDay: "Day",
    moodTags: ["culture"],
    vibeTags: ["Free", "House museum", "Hidden gem", "No photos"],
    editorialSources: [
      {
        publication: "Time Out",
        url: "https://www.timeout.com/london/museums/sir-john-soanes-museum",
        title: "Sir John Soane's Museum — Time Out London",
      },
      {
        publication: "Londonist",
        url: "https://londonist.com/london/museums-and-galleries/sir-john-soane-s-museum",
        title: "A Guide To Sir John Soane's Museum",
      },
      {
        publication: "The Guardian",
        url: "https://www.theguardian.com/artanddesign/2023/jan/13/sir-john-soanes-museum-london-review",
        title: "Sir John Soane's Museum review",
      },
    ],
    creatorCoverage: [],
    criticalFlags: [
      {
        label: "Tiny, timed entry",
        body: "The house is small and gets packed — book a free timed slot online, especially for weekends and the candlelit late openings.",
      },
      {
        label: "No big bags, limited photography",
        body: "Cloakroom for anything over A4, and photography rules are strict in places. It's a house, not a gallery — narrow stairs, low light.",
      },
    ],
    skipProspect: true,
  },

  // ── 21. Dennis Severs' House ─────────────────────────────────────────
  {
    slug: "dennis-severs-house",
    searchQuery: "Dennis Severs' House 18 Folgate Street Spitalfields London",
    neighbourhood: "Spitalfields",
    vibe: "A candlelit time-cappsule you move through in silence.",
    longDescription:
      "Ten rooms staged as a 'still-life drama' — the imagined home of a family of Huguenot silk-weavers, lit by candle and firelight, half-eaten food on the table as if they just left the room. You explore in total silence. Unlike anything else in the city.",
    type: "Culture",
    price: "££",
    timeOfDay: "Day",
    moodTags: ["culture"],
    vibeTags: ["Immersive", "Silent", "Candlelit", "Booking only"],
    editorialSources: [
      {
        publication: "Time Out",
        url: "https://www.timeout.com/london/things-to-do/dennis-severs-house",
        title: "Dennis Severs' House — Time Out London",
      },
      {
        publication: "Atlas Obscura",
        url: "https://www.atlasobscura.com/places/dennis-severs-house",
        title: "Dennis Severs' House — Atlas Obscura",
      },
      {
        publication: "The Guardian",
        url: "https://www.theguardian.com/travel/2016/oct/20/dennis-severs-house-spitalfields-london",
        title: "Dennis Severs' House, London",
      },
    ],
    creatorCoverage: [],
    criticalFlags: [
      {
        label: "Silence is the rule",
        body: "No talking, no phones — that's the entire point. Go with someone who'll commit to it, not a chatty group.",
      },
      {
        label: "Book ahead, limited days",
        body: "Open select days (Sun/Mon plus candlelit evenings). Pre-booked tickets only; it sells out — don't just turn up.",
      },
    ],
    skipProspect: true,
  },

  // ── 22. Whitechapel Gallery ──────────────────────────────────────────
  {
    slug: "whitechapel-gallery",
    searchQuery: "Whitechapel Gallery 77-82 Whitechapel High Street London",
    neighbourhood: "Whitechapel",
    vibe: "Free East End gallery that showed Guernica before you were born.",
    longDescription:
      "Founded 1901 to bring great art to the East End — it gave London its first sight of Picasso's 'Guernica' in 1939 and Pollock in the 50s. Still free, still ahead of the curve, with a good café and bookshop to round out a slow morning.",
    type: "Culture",
    price: "Free",
    timeOfDay: "Day",
    moodTags: ["culture"],
    vibeTags: ["Free", "Contemporary art", "Historic", "Café"],
    editorialSources: [
      {
        publication: "Time Out",
        url: "https://www.timeout.com/london/art/whitechapel-gallery",
        title: "Whitechapel Gallery — Time Out London",
      },
      {
        publication: "The Guardian",
        url: "https://www.theguardian.com/artanddesign/whitechapel-art-gallery",
        title: "Whitechapel Gallery — Guardian coverage",
      },
      {
        publication: "Londonist",
        url: "https://londonist.com/london/art-and-photography/whitechapel-gallery",
        title: "Whitechapel Gallery — Londonist",
      },
    ],
    creatorCoverage: [],
    criticalFlags: [
      {
        label: "Some shows are ticketed",
        body: "The building is free, but the big headline exhibitions sometimes carry a charge. Check what's on before you make a special trip.",
      },
      {
        label: "It's compact",
        body: "A focused gallery, not a day-long national. Pair it with a Brick Lane / Spitalfields wander to fill the afternoon.",
      },
    ],
    skipProspect: true,
  },

  // ── 23. Estorick Collection ──────────────────────────────────────────
  {
    slug: "estorick-collection",
    searchQuery:
      "Estorick Collection of Modern Italian Art 39a Canonbury Square Islington London",
    neighbourhood: "Canonbury",
    vibe: "Futurist Italian art in a quiet Georgian townhouse.",
    longDescription:
      "The UK's only gallery devoted to modern Italian art — Balla, Boccioni and the Futurists — tucked into a Georgian house on a leafy Canonbury square. Small, serene, with a lovely café and garden almost nobody knows about.",
    type: "Culture",
    price: "£",
    timeOfDay: "Day",
    moodTags: ["culture"],
    vibeTags: ["Futurism", "Hidden gem", "Café & garden", "Small"],
    editorialSources: [
      {
        publication: "Time Out",
        url: "https://www.timeout.com/london/art/estorick-collection-of-modern-italian-art",
        title: "Estorick Collection — Time Out London",
      },
      {
        publication: "Apollo Magazine",
        url: "https://www.apollo-magazine.com/estorick-collection-modern-italian-art/",
        title: "The Estorick Collection of Modern Italian Art",
      },
      {
        publication: "Londonist",
        url: "https://londonist.com/london/art-and-photography/estorick-collection",
        title: "Estorick Collection — Londonist",
      },
    ],
    creatorCoverage: [],
    criticalFlags: [
      {
        label: "Limited opening days",
        body: "Open Wed–Sun (closed Mon/Tue and between shows). Check it's open before trekking to Canonbury.",
      },
      {
        label: "Niche by design",
        body: "If Italian Futurism isn't your thing, it's a quick visit — but the café and garden make it a worthwhile slow stop.",
      },
    ],
    skipProspect: true,
  },

  // ── 24. Columbia Road Flower Market ──────────────────────────────────
  {
    slug: "columbia-road-flower-market",
    searchQuery: "Columbia Road Flower Market Bethnal Green London",
    neighbourhood: "Columbia Road",
    vibe: "Sunday-only flower riot, cockney barrow-boy soundtrack.",
    longDescription:
      "Every Sunday a narrow Victorian street erupts into a wall of blooms, with traders bellowing prices and the surrounding indie shops, cafés and a brass band doing the rest. Go early for calm, late for the knock-down armfuls of flowers.",
    type: "Market",
    price: "Free",
    timeOfDay: "Day",
    moodTags: ["activity"],
    vibeTags: ["Sunday only", "Flowers", "Free", "Indie shops"],
    editorialSources: [
      {
        publication: "Time Out",
        url: "https://www.timeout.com/london/shopping/columbia-road-flower-market",
        title: "Columbia Road Flower Market — Time Out London",
      },
      {
        publication: "Londonist",
        url: "https://londonist.com/london/markets/columbia-road-flower-market",
        title: "Columbia Road Flower Market — Londonist",
      },
      {
        publication: "Secret London",
        url: "https://secretldn.com/columbia-road-flower-market/",
        title: "Columbia Road Flower Market — Secret London",
      },
    ],
    creatorCoverage: [],
    criticalFlags: [
      {
        label: "Sundays only — that's it",
        body: "The market runs Sunday roughly 8am–3pm and nothing else. Turn up any other day and it's just a (lovely) quiet street.",
      },
      {
        label: "Go early or go late",
        body: "Mid-morning it's shoulder-to-shoulder. Before 9am is calm; the last hour is when traders slash prices to clear stock.",
      },
    ],
    skipProspect: true,
  },

  // ── 25. Netil Market ─────────────────────────────────────────────────
  {
    slug: "netil-market",
    searchQuery: "Netil Market 13-23 Westgate Street London Fields London",
    neighbourhood: "London Fields",
    vibe: "Broadway Market's cooler, calmer little sibling.",
    longDescription:
      "A yard of indie traders, makers' studios and some of east London's best street food a minute from Broadway Market — but quieter, scrappier and more local. Home to The Dusty Knuckle's original container and a rooftop bar (Netil360) in season.",
    type: "Market",
    price: "Free",
    timeOfDay: "Day",
    moodTags: ["activity"],
    vibeTags: ["Makers", "Street food", "Saturdays", "Local"],
    editorialSources: [
      {
        publication: "Time Out",
        url: "https://www.timeout.com/london/shopping/netil-market",
        title: "Netil Market — Time Out London",
      },
      {
        publication: "Londonist",
        url: "https://londonist.com/london/food-and-drink/netil-market",
        title: "Netil Market — Londonist",
      },
      {
        publication: "Secret London",
        url: "https://secretldn.com/netil-market-london-fields/",
        title: "Netil Market, London Fields — Secret London",
      },
    ],
    creatorCoverage: [],
    criticalFlags: [
      {
        label: "Best on Saturdays",
        body: "The full market — food stalls and most traders — peaks on Saturday. Weekdays are quieter with fewer stalls open.",
      },
      {
        label: "Small and weather-exposed",
        body: "It's a compact open yard. Brilliant in sun, less so in the rain — pair it with a Broadway Market loop.",
      },
    ],
    skipProspect: true,
  },

  // ── 26. Maltby Street Market ─────────────────────────────────────────
  {
    slug: "maltby-street-market",
    searchQuery: "Maltby Street Market Ropewalk Bermondsey London",
    neighbourhood: "Bermondsey",
    vibe: "Weekend food and drink under the Bermondsey railway arches.",
    longDescription:
      "The Ropewalk: a tight run of railway arches that fills at weekends with traders, natural-wine arches and some of the best street food south of the river — born as the low-key antidote to Borough Market's crowds. Eat, drink, repeat.",
    type: "Market",
    price: "Free",
    timeOfDay: "Day",
    moodTags: ["activity"],
    vibeTags: ["Weekends", "Street food", "Railway arches", "Natural wine"],
    editorialSources: [
      {
        publication: "Time Out",
        url: "https://www.timeout.com/london/restaurants/maltby-street-market",
        title: "Maltby Street Market — Time Out London",
      },
      {
        publication: "Londonist",
        url: "https://londonist.com/london/food-and-drink/maltby-street-market",
        title: "Maltby Street Market — Londonist",
      },
      {
        publication: "The Infatuation",
        url: "https://www.theinfatuation.com/london/guides/best-restaurants-maltby-street-market",
        title: "Where To Eat At Maltby Street Market",
      },
    ],
    creatorCoverage: [],
    criticalFlags: [
      {
        label: "Weekends only",
        body: "Saturday and Sunday daytime is the market. Weekdays the arches are mostly shut (a few bars/producers aside).",
      },
      {
        label: "Cash-lite, busy at lunch",
        body: "Most traders are card now, but the arches get rammed 12–2pm. Go early or mid-afternoon for elbow room.",
      },
    ],
    skipProspect: true,
  },

  // ── 27. Walthamstow Wetlands ─────────────────────────────────────────
  {
    slug: "walthamstow-wetlands",
    searchQuery: "Walthamstow Wetlands 2 Forest Road Walthamstow London",
    neighbourhood: "Walthamstow",
    vibe: "Europe's largest urban wetland — herons, reservoirs, big skies.",
    longDescription:
      "Ten working reservoirs turned into a free nature reserve in 2017 — 211 hectares of water, reedbeds and birdlife (herons, kingfishers, cormorants) a few minutes from the Tube. A proper lungful of wild within Zone 3, with a café in the old Engine House.",
    type: "Outdoors",
    price: "Free",
    timeOfDay: "Day",
    moodTags: ["activity"],
    vibeTags: ["Free", "Nature reserve", "Birdwatching", "Big skies"],
    editorialSources: [
      {
        publication: "Time Out",
        url: "https://www.timeout.com/london/things-to-do/walthamstow-wetlands",
        title: "Walthamstow Wetlands — Time Out London",
      },
      {
        publication: "The Guardian",
        url: "https://www.theguardian.com/travel/2017/oct/20/walthamstow-wetlands-london-europe-largest-urban-wetland-nature-reserve",
        title: "Walthamstow Wetlands: Europe's largest urban wetland opens",
      },
      {
        publication: "Londonist",
        url: "https://londonist.com/london/great-outdoors/walthamstow-wetlands",
        title: "Walthamstow Wetlands — Londonist",
      },
    ],
    creatorCoverage: [],
    criticalFlags: [
      {
        label: "Free entry, paid parking",
        body: "Entry and the reserve are free; the car park is not, and it's a working water site — stick to the paths and the posted closing time.",
      },
      {
        label: "Exposed — dress for it",
        body: "It's open water and reedbed with little shelter. Brilliant on a clear day, bleak in driving rain; bring layers.",
      },
    ],
    skipProspect: true,
  },

  // ── 28. Crossbones Garden ────────────────────────────────────────────
  {
    slug: "crossbones-garden",
    searchQuery: "Crossbones Garden Redcross Way Southwark London",
    neighbourhood: "Borough",
    vibe: "A volunteer-tended memorial garden on a medieval outcasts' graveyard.",
    longDescription:
      "A pocket of green on Redcross Way built over an unconsecrated burial ground for the 'Winchester Geese' — the medieval sex workers and paupers of Southwark. Ribbons on the gates, a shrine, and a quiet that feels nothing like the Borough bustle a block away.",
    type: "Outdoors",
    price: "Free",
    timeOfDay: "Day",
    moodTags: ["activity"],
    vibeTags: ["Free", "Memorial garden", "Hidden", "Volunteer-run"],
    editorialSources: [
      {
        publication: "Atlas Obscura",
        url: "https://www.atlasobscura.com/places/crossbones-graveyard",
        title: "Crossbones Graveyard — Atlas Obscura",
      },
      {
        publication: "Londonist",
        url: "https://londonist.com/london/history/crossbones-graveyard",
        title: "Crossbones Graveyard — Londonist",
      },
      {
        publication: "The Guardian",
        url: "https://www.theguardian.com/cities/2015/jul/15/crossbones-graveyard-london-outcasts-dead",
        title: "Crossbones graveyard: a shrine to London's outcast dead",
      },
    ],
    creatorCoverage: [],
    criticalFlags: [
      {
        label: "Restricted opening hours",
        body: "Run by volunteers (Bankside Open Spaces Trust) — open limited daytime hours, not always weekends. Check before you go or you'll only see the ribboned gates.",
      },
      {
        label: "Small and reflective",
        body: "It's a tiny memorial garden, a 10–15 minute stop, not a park to picnic in. Go for the atmosphere and the story.",
      },
    ],
    skipProspect: true,
  },

  // ── 29. Brockwell Lido ───────────────────────────────────────────────
  {
    slug: "brockwell-lido",
    searchQuery: "Brockwell Lido Dulwich Road Herne Hill London",
    neighbourhood: "Herne Hill",
    vibe: "1937 art-deco open-air pool on the edge of Brockwell Park.",
    longDescription:
      "A Grade II-listed art-deco lido ('Brixton Beach' to locals) on the edge of Brockwell Park — 50m of open-air water, a sun terrace and a proper café. Heated and open year-round for swimmers, with a gym and spa attached.",
    type: "Outdoors",
    price: "£",
    timeOfDay: "Day",
    moodTags: ["activity"],
    vibeTags: ["Lido", "Art deco", "Open-air swim", "Brockwell Park"],
    editorialSources: [
      {
        publication: "Time Out",
        url: "https://www.timeout.com/london/sport-and-fitness/brockwell-lido",
        title: "Brockwell Lido — Time Out London",
      },
      {
        publication: "Londonist",
        url: "https://londonist.com/london/lidos/brockwell-lido",
        title: "Brockwell Lido — Londonist",
      },
      {
        publication: "Secret London",
        url: "https://secretldn.com/brockwell-lido-herne-hill/",
        title: "Brockwell Lido, Herne Hill — Secret London",
      },
    ],
    creatorCoverage: [],
    criticalFlags: [
      {
        label: "Booking + session times",
        body: "Swimming runs in timed sessions you usually need to book ahead, and it gets busy in summer — check the schedule before you turn up with a towel.",
      },
      {
        label: "It's a swim, not just a sit",
        body: "The pool charges an entry fee; lounging on the terrace and the café are the free-ish bit. Bring kit if you actually want to get in.",
      },
    ],
    skipProspect: true,
  },
];

// Helper to get a seed by slug (used by the ingestion script).
export function getSeedBySlug(slug: string): VenueSeed | undefined {
  return VENUE_SEEDS.find((s) => s.slug === slug);
}
