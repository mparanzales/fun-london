import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthUserProvider } from "@/components/auth-user-context";
import { AuthedProviders } from "@/components/authed-providers";
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
    default: "Fun London: plan the night, not the place",
    template: "%s · Fun London",
  },
  description:
    "fun london builds you a night out: two or three independent spots, a short walk apart, in the order you'd do them, with the table ready to book in a couple of taps.",
  manifest: "/manifest.json",
  applicationName: "Fun London",
  // Site-wide sharing defaults; venue/event pages override with their own.
  openGraph: {
    type: "website",
    siteName: "Fun London",
    locale: "en_GB",
    url: SITE_URL,
    title: "Fun London: plan the night, not the place",
    description:
      "fun london builds you a night out: a walkable two or three stop evening of independent london, the table ready to book in a couple of taps.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Fun London: plan the night, not the place",
    description:
      "fun london builds you a night out: a walkable two or three stop evening of independent london, the table ready to book in a couple of taps.",
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Cookie-FREE on purpose: this layout no longer reads getAuthUser(), so it
  // doesn't force every route into dynamic rendering (which disabled ISR on
  // the /anon detail twins). The signed-in id now flows from AuthUserProvider
  // (browser session) into AuthedProviders, which passes it to the same four
  // client providers, unchanged. See components/auth-user-context.tsx.
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
        {/* One provider tree at root so every route (consumer (main) shell,
            splash, onboarding, /venue/[slug], /booking/[slug]/confirmed)
            shares it and state persists across client navigations.
            AuthUserProvider (browser session) feeds the id into
            AuthedProviders → the four unchanged providers. */}
        <ThemeProvider />
        <AuthUserProvider>
          <AuthedProviders>{children}</AuthedProviders>
        </AuthUserProvider>
      </body>
    </html>
  );
}
