import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--fl-bg)",
        fg: "var(--fl-fg)",
        muted: "var(--fl-muted)",
        "muted-fg": "var(--fl-muted-fg)",
        card: "var(--fl-card)",
        border: "var(--fl-border)",
        primary: "var(--fl-primary)",
        "primary-fg": "var(--fl-primary-fg)",
        accent: "var(--fl-accent)",
        "accent-fg": "var(--fl-accent-fg)",
        heading: "var(--fl-heading)",
      },
      fontFamily: {
        sans: ["var(--font-jakarta)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        soft: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)",
        card: "0 1px 3px rgba(0,0,0,0.06), 0 6px 20px rgba(0,0,0,0.06)",
        elev: "0 8px 28px rgba(0,0,0,0.12)",
      },
      borderRadius: {
        xl2: "1.25rem",
      },
      // Extend Tailwind's default spacing scale with half-step values
      // the codebase already uses (4.5, 5.5, 6.5). Without these,
      // classes like `bottom-4.5` and `pb-5.5` silently fail —
      // a real bug we caught when the Swipe step's question text
      // landed on top of the mood pill instead of at the card's
      // bottom edge.
      spacing: {
        "4.5": "1.125rem", // 18px
        "5.5": "1.375rem", // 22px
        "6.5": "1.625rem", // 26px
      },
    },
  },
  plugins: [],
};

export default config;
