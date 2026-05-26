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
    },
  },
  plugins: [],
};

export default config;
