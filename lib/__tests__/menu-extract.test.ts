import { describe, it, expect } from "vitest";
import { findMenuUrl } from "@/lib/menu-extract";

const BASE = "https://example-restaurant.co.uk/";

describe("findMenuUrl", () => {
  it("finds a /menu page link and resolves it absolute", () => {
    const html = `<nav><a href="/about">About</a><a href="/menu/">Our Menu</a></nav>`;
    expect(findMenuUrl(html, BASE)).toBe(
      "https://example-restaurant.co.uk/menu/",
    );
  });

  it("prefers the food menu over the drinks menu", () => {
    const html = `<a href="/menu/drinks/">Drinks</a><a href="/menu/all-day-food/">Food menu</a>`;
    expect(findMenuUrl(html, BASE)).toBe(
      "https://example-restaurant.co.uk/menu/all-day-food/",
    );
  });

  it("picks a menu PDF", () => {
    const html = `<a href="/files/A-LA-CARTE-MENU.pdf">Menu</a>`;
    expect(findMenuUrl(html, BASE)).toBe(
      "https://example-restaurant.co.uk/files/A-LA-CARTE-MENU.pdf",
    );
  });

  it("skips third-party delivery links (Deliveroo)", () => {
    const html = `<a href="https://deliveroo.co.uk/menu/london/soho/x">Order online</a>`;
    expect(findMenuUrl(html, BASE)).toBeNull();
  });

  it("returns null when there is no menu link", () => {
    const html = `<a href="/about">About</a><a href="/contact">Contact</a>`;
    expect(findMenuUrl(html, BASE)).toBeNull();
  });

  it("ignores same-page #menu anchors and booking links", () => {
    const html = `<a href="#menu">Menu</a><a href="/reservations">Book a table</a>`;
    expect(findMenuUrl(html, BASE)).toBeNull();
  });

  // menu_url is rendered as an href on the venue page, so a scraped scheme is
  // a stored-XSS candidate. This used to be a denylist matched against the raw
  // string BEFORE resolution, which the URL parser then defeated by stripping
  // whitespace: the tab/newline/leading-space spellings below walked through it.
  //
  // Every path here carries "menu" ON PURPOSE. Scoring needs >= 4, and anchor
  // text alone is only 3, so a bare "javascript:alert(1)" would be dropped by
  // the SCORER and the case would pass whether or not the scheme check exists.
  // These score 8, so the only thing that can reject them is the guard.
  it.each([
    "javascript:alert(1)/menu",
    "java\tscript:alert(1)/menu",
    "java\nscript:alert(1)/menu",
    " javascript:alert(1)/menu",
    "JavaScript:alert(1)/menu",
    "data:text/html,/menu<script>alert(1)</script>",
    "vbscript:msgbox(1)/menu",
  ])("never returns %j as a menu link", (href) => {
    const html = `<a href="${href}">Our menu</a>`;
    expect(findMenuUrl(html, BASE)).toBeNull();
  });

  it("the hostile fixtures above really do out-score the threshold", () => {
    // Guards the guard: the same path shape on a normal https link IS picked,
    // which proves the rejections above come from the scheme check and not
    // from these URLs quietly scoring too low to be considered.
    const html = `<a href="https://example-restaurant.co.uk/alert(1)/menu">Our menu</a>`;
    expect(findMenuUrl(html, BASE)).toBe(
      "https://example-restaurant.co.uk/alert(1)/menu",
    );
  });

  it("still skips mailto: and tel:, now via the scheme allowlist", () => {
    const html = `<a href="mailto:menu@example.com">Menu</a><a href="tel:+442071234567">Menu</a>`;
    expect(findMenuUrl(html, BASE)).toBeNull();
  });
});
