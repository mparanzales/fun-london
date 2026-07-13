import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { anonCachePath, hasSupabaseAuthCookie } from "@/lib/anon-cache";

type CookieToSet = { name: string; value: string; options: CookieOptions };

// ── Login wall paths ───────────────────────────────────────────────────────
// The app requires an account, BUT anonymous visitors can always browse a
// metered preview of the feed first (skip → /explore → a few cards → the
// SignupWall in the feed once they scroll past the preview). Anonymous may
// reach ONLY:
//   • "/"            — the public marketing landing (funldn.com, indexable)
//   • "/explore"     — the always-on metered preview (wall lives in the feed)
//   • sign-in + auth callback, the legal pages, robots/sitemap
//   • /api/email/unsubscribe — reached from email links, must work logged-out
// Everything that DOES something (What's on, Plan, Saved, You, every
// venue/event detail, booking, admin) redirects to /sign-in with a ?return,
// so tapping a restaurant or any other tab forces an account.
//
// Venue/event DETAIL pages render for anon too, but their content is shown
// blurred behind a sign-up card (components/auth-wall.tsx) — the soft
// "enter a place → sign up" gate. Rendering (not redirecting) also keeps
// these pages indexable/shareable. /plan/together renders the soft wall
// instead of a bare redirect so a logged-out invitee sees what they're
// joining, and the page keeps the ?room code in its sign-in returnTo (the
// middleware redirect drops the query, which would strand an invitee into
// creating a NEW empty room).
function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/explore" ||
    pathname === "/events" ||
    pathname === "/plan" ||
    pathname === "/plan/together" ||
    pathname === "/saved" ||
    pathname === "/profile" ||
    pathname.startsWith("/venue/") ||
    pathname.startsWith("/event/") ||
    // The ISR twins of the detail pages (normally reached via rewrite, but
    // direct hits are public + harmless: canonical points at the primary).
    pathname.startsWith("/anon/venue/") ||
    pathname.startsWith("/anon/event/") ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname === "/sign-in" ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/privacy") ||
    pathname.startsWith("/terms") ||
    pathname.startsWith("/cookies") ||
    pathname.startsWith("/api/email/unsubscribe")
  );
}

function signInRedirect(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const url = request.nextUrl.clone();
  url.pathname = "/sign-in";
  url.search = "";
  // Preserve the original query string in the return path (e.g. a ?room
  // invite code, or reserve ?d/&t/&p) so it survives the sign-in round-trip.
  // safeReturnPath() on the sign-in side rejects non-site-internal paths.
  url.searchParams.set("return", `${pathname}${search}`);
  return NextResponse.redirect(url);
}

export async function updateSession(request: NextRequest) {
  // ── Cookie-less fast path ────────────────────────────────────────────
  // No Supabase auth cookie means there is NO session to refresh — hitting
  // Supabase Auth here was a wasted network round-trip on every anonymous
  // page view (including every crawler hit). Decide from the path alone,
  // and send detail pages to their ISR twins so the CDN can serve them.
  if (!hasSupabaseAuthCookie(request.cookies.getAll().map((c) => c.name))) {
    const { pathname } = request.nextUrl;
    const cached = anonCachePath(pathname);
    if (cached) {
      const url = request.nextUrl.clone();
      url.pathname = cached; // rewrite: the browser URL stays /venue/x
      return NextResponse.rewrite(url);
    }
    if (!isPublicPath(pathname)) return signInRedirect(request);
    return NextResponse.next({ request });
  }

  // ── Session-carrying path (behavior unchanged) ───────────────────────
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }: CookieToSet) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }: CookieToSet) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refresh the session cookie if it's near expiry, and read the user so we
  // can enforce the login wall below. A present-but-expired session that
  // fails refresh lands in the !user branch: public pages render the anon
  // state dynamically (uncached — correct, just slower), the rest redirect
  // to sign-in.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublicPath(request.nextUrl.pathname)) {
    return signInRedirect(request);
  }

  return response;
}
