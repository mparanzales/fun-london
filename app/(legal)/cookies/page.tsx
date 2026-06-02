import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cookie Policy",
  description:
    "The cookies and local storage Fun London uses, and your choices.",
};

export default function CookiesPage() {
  return (
    <>
      <h1>Cookie Policy</h1>
      <p className="text-muted-fg">Last updated: 2 June 2026</p>

      <p>
        We keep cookies and similar storage to a minimum. Here is everything we
        use and why.
      </p>

      <h2>Strictly necessary</h2>
      <ul>
        <li>
          <strong>Sign-in session</strong> — a secure cookie set by Supabase to
          keep you signed in. Required for the app to work; cannot be switched
          off.
        </li>
        <li>
          <strong>Local storage</strong> — your saved venues, plans and
          preferences are stored on your own device so the app works before you
          sign in. This never leaves your device unless you sign in.
        </li>
      </ul>

      <h2>Analytics (optional)</h2>
      <p>
        If you accept analytics, we use Vercel Analytics — a privacy-friendly,
        <strong> cookieless</strong> measurement of page views and key actions
        (saves, reserve clicks, plans). It does not track you across other
        sites. You can decline this in the cookie banner, and we will not load
        it.
      </p>

      <h2>Your choice</h2>
      <p>
        When you first visit, we ask whether to enable analytics. To change your
        mind later, clear the site&apos;s storage in your browser settings and
        reload — the banner will appear again. See our{" "}
        <a href="/privacy">Privacy Policy</a> for the full picture.
      </p>
    </>
  );
}
