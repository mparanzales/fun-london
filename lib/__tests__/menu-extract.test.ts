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
});
