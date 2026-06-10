import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { PEEK_COOKIE, PEEK_MAX_AGE } from "@/lib/peek";

type CookieToSet = { name: string; value: string; options: CookieOptions };

export async function updateSession(request: NextRequest) {
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
  // can enforce the login wall below.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // ── Login wall ───────────────────────────────────────────────────────────
  // The app requires an account. Anonymous visitors may see ONLY:
  //   • "/"            — the public marketing landing (funldn.com, indexable)
  //   • "/explore"     — ONE free metered preview of the feed (see below)
  //   • sign-in + auth callback, the legal pages, robots/sitemap
  //   • /api/email/unsubscribe — reached from email links, must work logged-out
  // Everything else (What's on, Plan, Saved, You, every venue/event detail,
  // booking, admin) redirects to /sign-in with a ?return so they land back
  // where they were after authenticating.
  const { pathname } = request.nextUrl;

  if (!user) {
    const toSignIn = () => {
      const url = request.nextUrl.clone();
      url.pathname = "/sign-in";
      url.search = "";
      // safeReturnPath() on the sign-in side rejects non-site-internal paths.
      url.searchParams.set("return", pathname);
      return NextResponse.redirect(url);
    };

    // The metered preview: one free peek, then hard. The first anonymous visit
    // to /explore is allowed and stamps the fl_peeked cookie; every visit after
    // that is walled. (The sign-in "take a peek" link is hidden once spent.)
    if (pathname === "/explore") {
      if (request.cookies.get(PEEK_COOKIE)) return toSignIn();
      response.cookies.set(PEEK_COOKIE, "1", {
        path: "/",
        maxAge: PEEK_MAX_AGE,
        sameSite: "lax",
      });
      return response;
    }

    const isPublic =
      pathname === "/" ||
      pathname === "/robots.txt" ||
      pathname === "/sitemap.xml" ||
      pathname === "/sign-in" ||
      pathname.startsWith("/auth") ||
      pathname.startsWith("/privacy") ||
      pathname.startsWith("/terms") ||
      pathname.startsWith("/cookies") ||
      pathname.startsWith("/api/email/unsubscribe");

    if (!isPublic) return toSignIn();
  }

  return response;
}
