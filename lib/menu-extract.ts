// Pure menu-link extraction, shared by scripts/discover-menus.ts and its test.
// Given a page's HTML + final URL, find the best link to the venue's OWN menu
// (a /menu page or a menu PDF), or null. No network, no side effects.

// Links that are clearly NOT a menu (unless the URL literally contains "menu").
const BAD =
  /(book|reserv|gift|voucher|career|job|privacy|terms|cookie|contact|about|\bnews\b|\bblog\b|press|instagram|facebook|twitter|tiktok|linkedin|login|signin|account|basket|\bcart\b|\bshop\b|newsletter|subscribe|\bfaq\b)/i;
const FOODISH =
  /(\bfood\b|drinks?|a-?la-?carte|sample|tasting|brunch|breakfast|lunch|dinner|wine-?list|\bcarte\b|set-?menu)/i;
const MENU_WORD = /menus?/i;
const MENU_TEXT =
  /\b(menus?|view (the )?menu|see (the )?menu|our menu|food menu|drinks? menu|sample menu|a la carte)\b/;
// Third-party delivery / booking aggregators — we want the venue's OWN menu,
// not a Deliveroo or OpenTable page.
const THIRD_PARTY =
  /(deliveroo|uber-?eats|just-?eat|grubhub|opentable|resy|sevenrooms|the-?fork|quandoo|bookatable|design-?my-?night|toasttab|tripadvisor|yelp)/i;

export function findMenuUrl(html: string, finalUrl: string): string | null {
  let base: URL;
  try {
    base = new URL(finalUrl);
  } catch {
    return null;
  }
  // <a href="...">text</a> — skip same-page (#...) anchors via the [^"'#] first char.
  const anchorRe =
    /<a\b[^>]*?href\s*=\s*["']([^"'#][^"']*)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi;
  const cands: { url: string; score: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const href = m[1].trim();
    const text = m[2]
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    if (!href || /^(mailto:|tel:|javascript:)/i.test(href)) continue;
    let abs: URL;
    try {
      abs = new URL(href, base);
    } catch {
      continue;
    }
    const full = abs.toString().toLowerCase();
    const host = abs.host.toLowerCase();
    const path = abs.pathname.toLowerCase();
    // Skip delivery / booking aggregators — not the venue's own menu.
    if (THIRD_PARTY.test(host)) continue;
    const isPdf = /\.pdf(\?|$)/i.test(path);
    let score = 0;
    if (MENU_WORD.test(path) || MENU_WORD.test(host)) score += 5; // /menu, /menus, menu.host
    if (isPdf && /(menu|carte|food|drinks)/i.test(path)) score += 4; // a menu PDF
    if (FOODISH.test(path)) score += 2; // /food, /drinks, /a-la-carte
    if (MENU_TEXT.test(text)) score += 3; // anchor text says "menu"
    // Prefer the main FOOD menu over a drinks / allergen / breakfast sub-menu.
    if (
      /(a-?la-?carte|all-?day|set-?menu|\bmain\b|\bfood\b|tasting|dinner|lunch)/i.test(
        `${path} ${text}`,
      )
    ) {
      score += 2;
    }
    if (
      /(drinks?|allergen|kids|children|wine-?list|breakfast|pop-?up)/i.test(
        path,
      )
    ) {
      score -= 1;
    }
    if (BAD.test(full) && !MENU_WORD.test(path) && !MENU_WORD.test(host)) {
      score -= 6;
    }
    if (score >= 4) cands.push({ url: abs.toString(), score });
  }
  if (cands.length === 0) return null;
  cands.sort((a, b) => b.score - a.score);
  return cands[0].url;
}
