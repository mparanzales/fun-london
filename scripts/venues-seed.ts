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
        title: "Sessions Arts Club — Andy Hayler Feb 2024 review (post Florence Knight)",
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
        url: "https://www.hot-dinners.com/Restaurant-Reviews/Bridge-Bankside-South-Bank/padella",
        title: "Padella — Hot Dinners profile",
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
];

// Helper to get a seed by slug (used by the ingestion script).
export function getSeedBySlug(slug: string): VenueSeed | undefined {
  return VENUE_SEEDS.find((s) => s.slug === slug);
}
