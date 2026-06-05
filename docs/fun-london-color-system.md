# Fun London — colour system (the panel verdict)

_Decided by a deliberating expert panel (graphic, product, marketing, UX, Gen-Z
culture) chaired by a creative director, 2026-06-05. The brief: keep the
founder's blue→purple, perfect it, no red/coral, elegant + Gen-Z._

## Principle: restraint

Cream does ~85% of the work, solid violet ~12%, the gradient + grain the last
~3%. A brand that does not shout reads as "vetted, not advertised." The gradient
is precious — spend it almost nowhere.

## Tokens (in `app/globals.css`)

| Token | Value | Use |
|---|---|---|
| `--fl-bg` (day) | `#f0eee9` warm cream | the editorial canvas (most of every screen) |
| `--fl-bg` (night) | `#14121a` violet-undertoned near-black | night canvas (in-family, not pure black) |
| `--fl-primary` | `hsl(250 70% 50%)` solid violet | ~95% of coloured UI: buttons, links, active states, icons |
| `--fl-accent` | `hsl(266 78% 58%)` | cohesive violet for active/selected states (no second hue) |
| `--fl-gradient` | `linear-gradient(135deg, hsl(240 84% 60%), hsl(266 78% 58%))` | the signature — **2 stops only** (magenta deleted) |

## Utilities

- **`.fl-grad-text`** — the brand gradient as text. Primary home = the "fun
  London" wordmark. Kept clean (no grain on type).
- **`.fl-grad`** — gradient FILL surfaces. **Always carries film grain** (baked
  in via `::after` fractal-noise overlay). The grain is the ownable, editorial
  texture that separates us from every clean-gradient AI/SaaS look.

## Where the gradient is allowed

ONLY the wordmark + **one** hero moment per screen (masthead / splash / the
"your night" reveal). Never under small text, never on the verified badge, never
on stacked plan-a-night cards. Everywhere else = solid violet.

## The "Fun Verified" badge

A **solid** violet stamp (legible at small sizes; reads as fact, not marketing)
with a thin gradient hairline so it still reads as family. NOT a gradient fill —
a gradient-under-text trust mark fails contrast and looks like a paid sticker.
_(Badge component is a later build; the tokens + treatment are decided.)_

## Accent

**None for launch.** Blue→violet + cream + grain is the whole system. No coral,
no citrus. (Parked: a "live / on now" signal done with motion or a soft glow,
not a new colour — post-launch.)

## DO / DON'T

**DO** use solid violet for nearly all coloured UI · put grain on every gradient
fill · keep the verified badge solid + hairline · hold one gradient hero moment
per screen.

**DON'T** put the gradient on the badge, body text, or stacked cards · add a
second accent (no coral/citrus) · use a 3-stop/magenta mesh (2 stops only) · ship
a clean gradient with no grain.

## Why this is right

It keeps the founder's owned blue→violet but spends it with the discipline of a
magazine — so Fun London reads as a friend with taste and a trustworthy stamp of
proof, not another polished paywalled app or another AI gradient.
