import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { AnalyticsGate } from "@/components/analytics-gate";
import { ConsentBanner } from "@/components/consent-banner";
import { SignInTracker } from "@/components/signin-tracker";
import { SavedProvider } from "@/components/saved-context";
import { BookingsProvider } from "@/components/bookings-context";
import { ThemeProvider } from "@/components/theme-provider";
import { ProfilePrefsMigration } from "@/components/profile-prefs-migration";
import { getAuthUser } from "@/lib/auth";
import { SITE_URL } from "@/lib/config";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  style: ["normal", "italic"],
  variable: "--font-jakarta",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Fun London: independent London, no chains",
    template: "%s · Fun London",
  },
  description:
    "Independent London only. No chains, every spot checked in at least two trusted sources. Curated bars, restaurants and what's on tonight.",
  manifest: "/manifest.json",
  applicationName: "Fun London",
  // Site-wide sharing defaults; venue/event pages override with their own.
  openGraph: {
    type: "website",
    siteName: "Fun London",
    locale: "en_GB",
    url: SITE_URL,
    title: "Fun London: independent London, no chains",
    description:
      "Curated independent London. No chains, every spot checked in at least two trusted sources.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Fun London: independent London, no chains",
    description:
      "Curated independent London. No chains, every spot checked in at least two trusted sources.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // No maximumScale/userScalable cap — capping zoom fails WCAG 1.4.4
  // (users must be able to pinch-zoom up to 200%+).
  // Adapts iOS Safari's status-bar / browser-chrome tint to the user's
  // OS-level light/dark preference. Note: the in-app theme is TIME-based
  // (18:00–06:00 = night) via components/theme-provider.tsx, so the
  // chrome tint and the app body can diverge for users whose OS theme
  // doesn't match the wall clock. That's an acceptable trade for keeping
  // chrome legible at install time before the JS theme provider mounts.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f0eee9" },
    { media: "(prefers-color-scheme: dark)", color: "#14121a" },
  ],
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Fetch the auth user once at the root and pass its id (or null)
  // into both client providers. When this changes (sign-in, sign-out)
  // the layout re-renders and the providers re-hydrate from the
  // appropriate backing store (DB or localStorage) and run the
  // one-time local→DB migration if needed.
  const authUser = await getAuthUser();
  const authUserId = authUser?.id ?? null;

  return (
    // suppressHydrationWarning: the inline anti-flash script below writes
    // data-theme onto <html> before React hydrates, so the client DOM has an
    // attribute the server markup doesn't. Scopes to <html>'s own attributes
    // only — the documented Next.js pattern for pre-paint theme injection.
    <html lang="en" className={jakarta.variable} suppressHydrationWarning>
      <body className="font-sans antialiased min-h-screen">
        {/* Anti-flash: set the theme palette BEFORE first paint so there's no
            flash of the wrong colours while React hydrates and ThemeProvider's
            effect runs. Mirrors lib/theme.ts (key "fl.theme.v1"; auto = night
            18:00-06:00). Kept inline + tiny on purpose. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var m=localStorage.getItem('fl.theme.v1');var t;if(m==='day'||m==='night'){t=m}else{var h=new Date().getHours();t=(h>=18||h<6)?'night':'day'}document.documentElement.dataset.theme=t}catch(e){}})();",
          }}
        />
        {/* SavedProvider, BookingsProvider, ThemeProvider live at root so
            every route (consumer (main) shell, splash, onboarding,
            /venue/[slug], /booking/[slug]/confirmed) shares one provider
            tree. Bookings sits inside Saved purely for read order; they
            don't depend on each other. */}
        <ThemeProvider />
        <ProfilePrefsMigration authUserId={authUserId} />
        <SavedProvider authUserId={authUserId}>
          <BookingsProvider authUserId={authUserId}>
            {children}
          </BookingsProvider>
        </SavedProvider>
        <ConsentBanner />
        <SignInTracker />
        <AnalyticsGate />
      </body>
    </html>
  );
}
