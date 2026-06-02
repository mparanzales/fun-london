import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Fun London collects, uses and protects your personal data.",
};

// NOTE FOR MARIA: this is an honest, accurate TEMPLATE that reflects what the
// app actually does today. Have a solicitor review it before you rely on it,
// and replace the placeholder contact email with a real monitored inbox.
export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p className="text-muted-fg">Last updated: 2 June 2026</p>

      <p>
        This policy explains how Fun London (&quot;we&quot;) collects, uses and
        protects your personal data when you use funldn.com. We are the data
        controller for the purposes of UK GDPR.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Account data</strong> — your email address (for magic-link
          sign-in) and, if you sign in with Google, your name and Google profile
          email.
        </li>
        <li>
          <strong>Your activity in the app</strong> — venues you save, plans and
          self-added bookings you create, and your taste preferences (mood and
          vibe) from onboarding.
        </li>
        <li>
          <strong>Usage analytics</strong> — privacy-friendly, cookieless
          measurement of which pages and actions are used (via Vercel
          Analytics), only if you accept analytics in the cookie banner.
        </li>
      </ul>
      <p>
        We do <strong>not</strong> collect your location, and we do not sell
        your data.
      </p>

      <h2>Why we use it (lawful basis)</h2>
      <ul>
        <li>
          <strong>To provide the service</strong> (saves, plans, sign-in) —
          performance of a contract / legitimate interests.
        </li>
        <li>
          <strong>Analytics</strong> — your consent (you can withdraw it any
          time via the cookie settings).
        </li>
      </ul>

      <h2>Who we share it with</h2>
      <p>
        We use trusted processors to run the service: Supabase (database,
        authentication and hosting, EU/London region), Vercel (application
        hosting and cookieless analytics), and ticketing/booking partners (e.g.
        Ticketmaster, OpenTable) only when you choose to click out to them.
        Venue information comes from Google Places and public editorial sources
        and is not personal data about you.
      </p>

      <h2>How long we keep it</h2>
      <p>
        We keep your account data for as long as your account exists. When you
        delete your account, your profile, saved venues and bookings are
        removed.
      </p>

      <h2>Your rights</h2>
      <p>
        Under UK GDPR you have the right to access, correct, delete, or export
        your data, and to object to or restrict processing. To exercise any of
        these, or to delete your account, contact us at{" "}
        <a href="mailto:privacy@funldn.com">privacy@funldn.com</a>. You also
        have the right to complain to the Information Commissioner&apos;s Office
        (ICO) at ico.org.uk.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this policy:{" "}
        <a href="mailto:privacy@funldn.com">privacy@funldn.com</a>.
      </p>
    </>
  );
}
