import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import { SavedProvider } from "@/components/saved-context";
import { BookingsProvider } from "@/components/bookings-context";
import { ThemeProvider } from "@/components/theme-provider";
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
  themeColor: "#f0eee9",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={jakarta.variable}>
      <body className="font-sans antialiased min-h-screen">
        {/* SavedProvider, BookingsProvider, ThemeProvider live at root so
            every route (consumer (main) shell, splash, onboarding,
            /venue/[slug], /booking/[slug]/confirmed) shares one provider
            tree. Bookings sits inside Saved purely for read order; they
            don't depend on each other. */}
        <ThemeProvider />
        <SavedProvider>
          <BookingsProvider>{children}</BookingsProvider>
        </SavedProvider>
        <Analytics />
      </body>
    </html>
  );
}
