// Fun London — fixed tag vocabulary for the personalisation engine.
//
// Derived from OneZone's curated lists (Cuisines / Occasions / Vibes) plus
// Fun London's existing mood/vibe enums. This is the canonical tag space
// used to build experience vectors and user taste vectors.
//
// To add a tag: append to the relevant array and bump TAG_VERSION.
// Removing or reordering tags invalidates existing vectors — do a full
// backfill of experience_vector and taste_vector if you do.

export const TAG_VERSION = 1;

// ── Cuisine tags ─────────────────────────────────────────────────────────────
// What kind of food / drink the venue primarily serves.

export const CUISINE_TAGS = [
  // Broad cuisine families
  "british",
  "european",
  "french",
  "italian",
  "spanish",
  "greek",
  "mediterranean",
  "middle-eastern",
  "indian",
  "west-african",
  "latin-american",
  "japanese",
  "chinese",
  "korean",
  "thai",
  "vietnamese",
  "asian",
  "american",
  "australian",
  "nordic",
  // Specific formats
  "pizza",
  "pasta",
  "sushi",
  "omakase",
  "dim-sum",
  "ramen",
  "tapas",
  "seafood",
  "steak",
  "charcoal",
  "small-plates",
  "tasting-menu",
  "street-food",
  "sandwiches",
  "bakery",
  // Drink-led
  "wine-bar",
  "cocktail-bar",
  "craft-beer",
  "natural-wine",
  "coffee",
  // Dietary
  "vegan",
  "vegetarian",
  "gluten-free",
  "healthy",
] as const;

// ── Vibe tags ─────────────────────────────────────────────────────────────────
// Atmosphere and setting — answers "what does this place feel like?"

export const VIBE_TAGS = [
  "cosy",
  "lively",
  "romantic",
  "date-night",
  "fancy",
  "fine-dining",
  "casual",
  "neighbourhood",
  "hidden-gem",
  "speakeasy",
  "rooftop",
  "sky-high-views",
  "by-the-water",
  "garden-terrace",
  "outdoor-seating",
  "beautiful-interiors",
  "iconic",
  "quirky",
  "minimalist",
  "candlelit",
  "buzzy",
  "high-energy",
  "low-key",
  "good-for-groups",
  "counter-dining",
  "wine-bar-vibes",
  "cocktail-connoisseur",
  "music-djs",
  "wow-factor",
  "cheap-cheerful",
  "dog-friendly",
  "beer-garden",
] as const;

// ── Occasion tags ─────────────────────────────────────────────────────────────
// Why someone is going out — answers "what is this trip for?"

export const OCCASION_TAGS = [
  "dinner",
  "drinks",
  "brunch",
  "breakfast",
  "lunch",
  "coffee",
  "first-date",
  "date-night",
  "group-celebration",
  "birthday",
  "anniversary",
  "girls-night",
  "boys-night",
  "solo",
  "work-meeting",
  "business-lunch",
  "business-dinner",
  "impress-a-client",
  "take-the-parents",
  "treat-yourself",
  "child-friendly",
  "late-night",
  "after-work",
  "weekend-afternoon",
  "sunday-roast",
  "afternoon-tea",
  "culture-night",
  "laptop-friendly",
] as const;

// ── Combined vocabulary ───────────────────────────────────────────────────────

export const ALL_TAGS = [
  ...CUISINE_TAGS,
  ...VIBE_TAGS,
  ...OCCASION_TAGS,
] as const;

export type CuisineTag = (typeof CUISINE_TAGS)[number];
export type VibeTag = (typeof VIBE_TAGS)[number];
export type OccasionTag = (typeof OCCASION_TAGS)[number];
export type Tag = (typeof ALL_TAGS)[number];

export const TAG_COUNT = ALL_TAGS.length;

// Tag index for fast vector construction (tag → position in vector)
export const TAG_INDEX: Readonly<Record<Tag, number>> = Object.fromEntries(
  ALL_TAGS.map((t, i) => [t, i]),
) as Readonly<Record<Tag, number>>;

// ── OneZone tag → canonical tag mapping ──────────────────────────────────────
// Maps raw OneZone list labels and free-form tags to our canonical vocabulary.
// Used during import and backfill to populate experience vectors.

export const ONEZONE_TAG_MAP: Record<string, Tag[]> = {
  // Cuisine lists
  "amazing asian": ["asian"],
  "awesome australian": ["australian"],
  "bakeries & patisseries": ["bakery"],
  "best bagels": ["sandwiches", "bakery"],
  "best bakeries": ["bakery"],
  "best bars": ["cocktail-bar"],
  "best burgers": ["american"],
  "best of british": ["british"],
  "charcoal cooking": ["charcoal"],
  "chinese champions": ["chinese"],
  "cool for craft beer": ["craft-beer"],
  "delicious delis": ["sandwiches"],
  "divine dim sum": ["dim-sum"],
  "fabulous french": ["french"],
  "favourites for fish": ["seafood"],
  "good for gluten free": ["gluten-free"],
  "greek gems": ["greek"],
  "incredible italian": ["italian"],
  "indian inspiration": ["indian"],
  "italian institutions": ["italian"],
  "japanese jewels": ["japanese"],
  "marvellous mediterranean": ["mediterranean"],
  "matcha magic": ["coffee"],
  "meat masterpiece": ["steak", "charcoal"],
  "mexican, margaritas & mezcal": ["latin-american", "cocktail-bar"],
  "middle eastern magic": ["middle-eastern"],
  "naughty noodles": ["asian", "ramen"],
  "outstanding omakase": ["omakase", "sushi"],
  "perfect pasta": ["pasta", "italian"],
  "perfect pizza": ["pizza", "italian"],
  "sensational seafood": ["seafood"],
  "south + latin american": ["latin-american"],
  "steak stars": ["steak"],
  "superb spanish": ["spanish", "tapas"],
  "superb sri lankan": ["asian"],
  "superb sushi": ["sushi", "japanese"],
  "superior sandwiches": ["sandwiches"],
  "tasty thai": ["thai"],
  "vegan vibes": ["vegan", "vegetarian"],
  "fast casual faves": ["casual"],
  "superb salads": ["healthy", "vegetarian"],
  "superb smoothies": ["healthy"],
  "sweet treats": ["bakery"],

  // Occasion lists
  "a stylish sunday roast": ["sunday-roast", "dinner"],
  "awesome afternoon teas": ["afternoon-tea"],
  "best for breakfast": ["breakfast"],
  "best for brunch": ["brunch"],
  "birthdays & special occasions": ["birthday", "group-celebration"],
  "boys night": ["boys-night", "drinks"],
  "child friendly faves": ["child-friendly"],
  "designed for date night": ["date-night", "romantic"],
  "first date dinners": ["first-date", "dinner"],
  "first date drinks": ["first-date", "drinks"],
  "fun night out": ["group-celebration", "late-night"],
  "great for girls lunch": ["girls-night", "lunch"],
  "great for girls night": ["girls-night", "drinks"],
  "impress a client": ["impress-a-client", "business-dinner"],
  "laptop friendly locations": ["laptop-friendly", "coffee"],
  "street food, markets & food halls": ["street-food"],
  "sultry saturdays": ["date-night", "drinks"],
  "sunday roasts to boast about": ["sunday-roast"],
  "super spenny but worth it": ["fancy", "fine-dining"],
  "take the parents": ["take-the-parents", "dinner"],
  "treat your dad": ["take-the-parents", "dinner"],
  "treat your mum": ["take-the-parents", "dinner"],
  "trolleys & tableside theatre": ["fancy", "fine-dining"],
  "wonderful weddings": ["group-celebration"],

  // Vibe lists
  "beautiful bathrooms": ["beautiful-interiors"],
  "beautiful bistros": ["cosy", "neighbourhood"],
  "best beer gardens": ["beer-garden", "outdoor-seating"],
  "best boozers": ["craft-beer", "neighbourhood"],
  "by the water": ["by-the-water"],
  "candlelit & cosy": ["candlelit", "cosy", "romantic"],
  "cheap & cheerful": ["cheap-cheerful"],
  "classic caffs": ["neighbourhood", "casual"],
  "cocktail connoisseurs": ["cocktail-connoisseur", "cocktail-bar"],
  "cool coffee shops": ["coffee", "laptop-friendly"],
  "cosy country style": ["cosy", "neighbourhood"],
  "counter dining delights": ["counter-dining"],
  "cute for coffee": ["coffee", "cosy"],
  "cute, classic, cosy pubs": ["cosy", "neighbourhood"],
  "dog friendly faves": ["dog-friendly"],
  "dog friendly pubs": ["dog-friendly"],
  "fine dining & fancy": ["fine-dining", "fancy"],
  "good for groups & great vibes": ["good-for-groups", "buzzy"],
  "great drinks & great vibes": ["cocktail-bar", "buzzy"],
  "health is wealth": ["healthy", "vegan"],
  "heatwave hangouts": ["outdoor-seating", "beer-garden"],
  "hottest hotel bars": ["cocktail-bar", "fancy"],
  "iconic institutions": ["iconic"],
  "incredible interiors": ["beautiful-interiors"],
  "martini magic": ["cocktail-connoisseur", "cocktail-bar"],
  "music, djs and dancing": ["music-djs", "late-night"],
  "picture perfect pubs": ["neighbourhood", "beer-garden"],
  "romantic restaurants": ["romantic", "date-night", "candlelit"],
  "rooftop ready": ["rooftop", "outdoor-seating"],
  "secret gardens, courtyards and terraces": ["garden-terrace", "hidden-gem"],
  "sky high views": ["sky-high-views", "rooftop"],
  "small plates perfection": ["small-plates"],
  "speakeasy style": ["speakeasy", "cocktail-bar", "hidden-gem"],
  "tantalising tasting menus": ["tasting-menu", "fine-dining"],
  "tempting terraces": ["outdoor-seating", "garden-terrace"],
  "vibes & hangouts": ["buzzy", "good-for-groups"],
  "weekend pub perfection": ["neighbourhood", "beer-garden"],
  "wine bar wonders": ["wine-bar-vibes", "natural-wine"],
  "wow factor": ["wow-factor", "fancy"],
  "gardens, courtyards & riversides": ["garden-terrace", "by-the-water"],
  "come rain or shine": ["good-for-groups"],
  "food meets fashion": ["fancy", "buzzy"],
  "foodie forward pubs": ["neighbourhood", "craft-beer"],

  // Free-form tags from the Tags column (common ones)
  "date night": ["date-night", "romantic"],
  "date spot": ["date-night"],
  "first date": ["first-date"],
  "first date dinner": ["first-date", "dinner"],
  "tasting menu": ["tasting-menu", "fine-dining"],
  "fine dining": ["fine-dining", "fancy"],
  "counter dining": ["counter-dining"],
  "small plates": ["small-plates"],
  "sharing style": ["small-plates"],
  "wine bar": ["wine-bar-vibes"],
  "cocktail bar": ["cocktail-bar"],
  speakeasy: ["speakeasy", "hidden-gem"],
  rooftop: ["rooftop"],
  "outdoor seating": ["outdoor-seating"],
  "outside seating": ["outdoor-seating"],
  terrace: ["outdoor-seating", "garden-terrace"],
  "beer garden": ["beer-garden", "outdoor-seating"],
  cosy: ["cosy"],
  intimate: ["cosy", "romantic"],
  romantic: ["romantic", "date-night"],
  elegant: ["fancy"],
  upscale: ["fancy"],
  luxury: ["fancy", "fine-dining"],
  casual: ["casual"],
  neighbourhood: ["neighbourhood"],
  buzzy: ["buzzy"],
  vibrant: ["buzzy", "lively"],
  lively: ["lively", "buzzy"],
  quirky: ["quirky", "hidden-gem"],
  unique: ["quirky"],
  "hidden gem": ["hidden-gem"],
  stunning: ["beautiful-interiors", "wow-factor"],
  beautiful: ["beautiful-interiors"],
  minimalist: ["minimalist"],
  sleek: ["minimalist", "fancy"],
  "good for groups": ["good-for-groups"],
  "dog friendly": ["dog-friendly"],
  "child friendly": ["child-friendly"],
  "kid friendly": ["child-friendly"],
  "open late": ["late-night"],
  "late night": ["late-night"],
  "after work": ["after-work", "drinks"],
  "business lunch": ["business-lunch", "lunch"],
  "business dinner": ["business-dinner", "dinner"],
  "work spot": ["laptop-friendly"],
  "laptop friendly": ["laptop-friendly"],
  "coffee shop": ["coffee"],
  bakery: ["bakery"],
  brunch: ["brunch"],
  breakfast: ["breakfast"],
  "sunday roast": ["sunday-roast"],
  healthy: ["healthy"],
  vegan: ["vegan"],
  "good vegan options": ["vegan"],
  vegetarian: ["vegetarian"],
  "good vegetarian options": ["vegetarian"],
  "gluten free": ["gluten-free"],
  "natural wine": ["natural-wine", "wine-bar-vibes"],
  "biodynamic wines": ["natural-wine", "wine-bar-vibes"],
  "craft beer": ["craft-beer"],
  music: ["music-djs"],
  djs: ["music-djs", "late-night"],
  dancing: ["music-djs", "late-night"],
} as const;

// ── Vector helpers ────────────────────────────────────────────────────────────

/** Build a unit-norm float vector from a list of tags. */
export function tagsToVector(tags: Tag[]): number[] {
  const vec = new Array<number>(TAG_COUNT).fill(0);
  for (const tag of tags) {
    const idx = TAG_INDEX[tag];
    if (idx !== undefined) vec[idx] += 1;
  }
  return normalise(vec);
}

/** Cosine similarity between two equal-length vectors. Returns 0 if either is zero. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0,
    magA = 0,
    magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/** L2-normalise a vector in place (returns same array). */
export function normalise(vec: number[]): number[] {
  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  if (mag === 0) return vec;
  for (let i = 0; i < vec.length; i++) vec[i] /= mag;
  return vec;
}

/**
 * Map a raw OneZone tag string (or free-form venue tag) to canonical Tag[].
 * Returns empty array if no mapping is found.
 */
export function mapRawTag(raw: string): Tag[] {
  return ONEZONE_TAG_MAP[raw.toLowerCase().trim()] ?? [];
}

/**
 * Convert a list of raw OneZone tags to a deduplicated canonical tag set.
 */
export function rawTagsToCanonical(rawTags: string[]): Tag[] {
  const seen = new Set<Tag>();
  for (const raw of rawTags) {
    for (const tag of mapRawTag(raw)) {
      seen.add(tag);
    }
  }
  return Array.from(seen);
}
