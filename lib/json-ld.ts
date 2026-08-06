// Serialise a JSON-LD object for injection into a <script> tag.
//
// 🧨 JSON.stringify alone is NOT safe here. It escapes quotes and backslashes,
// but it does NOT escape the "<" character, and the HTML parser closes a
// <script> element at the first closing script tag it sees regardless of what
// the surrounding JSON means. So a catalogue value such as a venue named
//
//     Bar </script><script>alert(1)</script>
//
// ends the JSON-LD block early and opens a real script element. That is stored
// XSS through a field nobody thinks of as a URL or as markup, on anon-reachable
// pages, and there is no CSP to blunt it (see next.config.js: the CSP is
// deliberately deferred until it can be done with nonces and real testing).
//
// Escaping "<" to its < form keeps the block byte-equivalent in meaning
// for every JSON-LD consumer while making the breakout impossible. U+2028 and
// U+2029 go too: they are legal JSON but illegal inside a JS string literal,
// so any consumer that evaluates the block would choke on them.
export function jsonLdHtml(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
