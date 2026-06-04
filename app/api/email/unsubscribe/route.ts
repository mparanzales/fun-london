// One-click unsubscribe for the weekly digest. No login required — the link
// carries the user's secret email_unsub_token (profiles RLS is self-read only,
// so the token never leaks except into the email we send that user).
//
// GET  → a small confirm page (a button that POSTs). GETs are sometimes
//        prefetched by mail clients/scanners, so GET must NOT change state.
// POST → actually flips email_weekly_opt_in off. Also satisfies RFC 8058
//        one-click unsubscribe (List-Unsubscribe-Post) when the mail client
//        POSTs the link directly.

import { createServiceClient } from "@/lib/supabase/admin";

// Brandless-but-tidy standalone page (this route renders outside the app shell).
function page(title: string, body: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} · Fun London</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background:#f0eee9; color:#2a2419; padding:24px; }
  .card { max-width:380px; text-align:center; }
  h1 { font-size:20px; margin:0 0 8px; color:#1a1409; }
  p { font-size:14px; line-height:1.5; color:#645c50; margin:0 0 20px; }
  button, a.btn { display:inline-block; border:0; cursor:pointer; text-decoration:none;
    background:hsl(233 70% 55%); color:#fff; font-weight:800; font-size:14px;
    padding:12px 22px; border-radius:14px; }
  a.muted { color:#645c50; font-size:13px; }
</style></head><body><div class="card">${body}</div></body></html>`;
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function GET(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  // Show a confirm button that POSTs back. Don't mutate anything on GET.
  return page(
    "Unsubscribe",
    `<h1>Unsubscribe from weekly emails?</h1>
     <p>You will stop getting the weekly "new in London" email. You can turn it
     back on any time from your profile.</p>
     <form method="post">
       <input type="hidden" name="token" value="${encodeURIComponent(token)}">
       <button type="submit">Unsubscribe</button>
     </form>`,
  );
}

export async function POST(request: Request): Promise<Response> {
  // Token may arrive as a query param (one-click clients) or form field.
  let token = new URL(request.url).searchParams.get("token") ?? "";
  if (!token) {
    try {
      const form = await request.formData();
      token = String(form.get("token") ?? "");
    } catch {
      // no form body
    }
  }

  const done = page(
    "Unsubscribed",
    `<h1>You're unsubscribed</h1>
     <p>You won't get the weekly email any more. Changed your mind? Turn it back
     on under "Email me what's new in London" in your profile.</p>
     <a class="muted" href="/explore">Back to Fun London</a>`,
  );

  // Always show the success page (don't reveal whether a token was valid).
  if (!token) return done;
  const supabase = createServiceClient();
  if (!supabase) {
    console.error("[unsubscribe] service client unavailable");
    return done;
  }
  const { error } = await supabase
    .from("profiles")
    .update({ email_weekly_opt_in: false })
    .eq("email_unsub_token", token);
  if (error) console.error(`[unsubscribe] ${error.message}`);
  return done;
}

// Never cache the confirm/result pages.
export const dynamic = "force-dynamic";
