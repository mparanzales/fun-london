import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Use",
  description: "The terms for using Fun London.",
};

// NOTE FOR MARIA: plain-English TEMPLATE terms reflecting how the app works
// (a discovery + deep-link product that does NOT take bookings itself).
// Have a solicitor review before relying on it.
export default function TermsPage() {
  return (
    <>
      <h1>Terms of Use</h1>
      <p className="text-muted-fg">Last updated: 2 June 2026</p>

      <p>
        By using funldn.com you agree to these terms. If you do not agree,
        please don&apos;t use the app.
      </p>

      <h2>What Fun London is</h2>
      <p>
        Fun London is a discovery guide to independent London venues and events.
        We help you find places and then link you out to the venue&apos;s own
        booking platform or a ticket provider.{" "}
        <strong>We do not take, hold or confirm reservations ourselves.</strong>{" "}
        Any booking you make happens on the third party&apos;s site, under their
        terms, and the &quot;Did you book?&quot; note you save in the app is
        your own reminder, not a confirmation from us or the venue.
      </p>

      <h2>Accuracy of information</h2>
      <p>
        We curate venues from Google Places and trusted editorial sources and
        try to keep details accurate, but opening hours, prices and availability
        change. Always check with the venue before you travel. We are not liable
        for third-party content, ticket providers, or your experience at a
        venue.
      </p>

      <h2>Your account</h2>
      <p>
        You are responsible for activity under your account. Don&apos;t misuse
        the service, attempt to disrupt it, or use it unlawfully. You can delete
        your account at any time (see the <a href="/privacy">Privacy Policy</a>
        ).
      </p>

      <h2>Changes</h2>
      <p>
        We may update these terms as the product evolves; the &quot;last
        updated&quot; date will change. Continued use means you accept the
        updated terms.
      </p>

      <h2>Contact</h2>
      <p>
        Questions: <a href="mailto:hello@funldn.com">hello@funldn.com</a>.
      </p>
    </>
  );
}
