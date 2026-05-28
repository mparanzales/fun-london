import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import { SavedProvider } from "@/components/saved-context";
import { BookingsProvider } from "@/components/bookings-context";
import { ThemeProvider } from "@/components/theme-provider";
import { ProfilePrefsMigration } from "@/components/profile-prefs-migration";
import { getAuthUser } from "@/lib/auth";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  style: ["normal", "italic"],
  variable: "--font-jakarta",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Fun London",
  description: "Your curated guide to London's best hidden gems.",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  // Adapts iOS Safari's status-bar / browser-chrome tint to the user's
  // OS-level light/dark preference. Note: the in-app theme is TIME-based
  // (18:00–06:00 = night) via components/theme-provider.tsx, so the
  // chrome tint and the app body can diverge for users whose OS theme
  // doesn't match the wall clock. That's an acceptable trade for keeping
  // chrome legible at install time before the JS theme provider mounts.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f0eee9" },
    { media: "(prefers-color-scheme: dark)", color: "#14110d" },
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
    <html lang="en" className={jakarta.variable}>
      <body className="font-sans antialiased min-h-screen">
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
        <Analytics />
      </body>
    </html>
  );
}
