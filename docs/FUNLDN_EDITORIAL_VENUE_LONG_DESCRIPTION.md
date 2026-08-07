# Venue `long_description`: the editorial standard

**Owner:** editorial-ux-director (voice standard, formats, within-screen hierarchy).
**Enforcement:** curation-voice, per string, at PR time.
**Approval:** ⏳ v2, back for re-review. v1 was REJECTED by agency-creative-director on 2026-08-07 for stating unverified facts about our own product in the section that opens "read this before writing a word". Every claim in §0 is now re-derived from `origin/main` with a file:line, and each is marked ✅ verified.
**Written:** 2026-08-07, against 64 live venues with `long_description = ''`.

**What changed in v2** (the rejection list, and nothing else — the spine was explicitly preserved by both gates):
- §0 `description_curated_at`: the v1 claim was FALSE. Corrected against the migration.
- §0/§8(c) the empty band: v1 asserted it does not render; at the time it DID. Fixed in PR #237 and now true. Cited.
- §2 first-sentence spec: v1 was wrong in both directions. Re-derived from the actual regex.
- §2 the banned 161-299 band: DELETED. A renderer defect is not a writer's tax (agency-creative-director overrule).
- §4.4: the bucket split of the 64 is now published, as required.

---

## 0. What the field actually renders into (read this before writing a word)

Three surfaces, one string. Every rule below comes from here.

1. **Signed in, venue page** · `app/venue/[slug]/venue-detail.tsx:546` renders it as a single `<p>`, collapsed to `line-clamp-3`. A "Read more" button appears only when the string is longer than 160 characters. One `<p>` means **newlines collapse**: multi-paragraph writing renders as one run-on block. ✅ Verified: the band is gated on `signedIn && venue.longDescription.trim() !== ""`, so an empty description renders **nothing at all** — no stray `<p>`, no dead margin. That gate did not exist when v1 was written (it shipped in PR #237); v1 asserted this behaviour before it was true, which is why v1 was rejected.
2. **Signed out, venue page** · `lib/anon-teaser.ts` derives the teaser, and the mechanics are NOT what v1 described. ✅ Verified at `lib/anon-teaser.ts:51` and `:56`:
   - **Any string of 160 characters or fewer is returned WHOLE, before the sentence regex ever runs** (`if (text.length <= SENTENCE_MAX) return { text, truncated: false }`). A Short form is therefore shown complete, with no "Continue reading" link, and the first-sentence rules below simply do not apply to it.
   - Above 160 characters the regex is `^[\s\S]{60,159}?[.!?](?=\s|$)` — **lazy**. It does not cut mid-phrase on a short opener; it takes the shortest run of COMPLETE sentences that lands in 61-160 characters. So a punchy 40-character opener silently welds sentence 2 into the snippet.
3. **Google and social** · `app/venue/[slug]/venue-page-shared.tsx` uses that same teaser as the `<meta name="description">`, the Open Graph description and the Twitter card.

So: **the first sentence is not an opener, it is a product surface.** It is the search snippet, the shared link preview and the only prose a stranger reads. Write it as if it were the only sentence, because for most readers it is.

Two mechanical consequences:

- **Dashes do not fail the build here.** `scripts/check-no-dashes.ts` scans `app`, `components` and `lib` only. Catalogue prose lives in the database and is never scanned. What happens instead is silent: `tidyText` (via `lib/queries.ts`) rewrites any em dash, en dash or spaced double hyphen to `", "` at render time. Your rhythm is quietly changed and you never find out. Write commas, colons, full stops and middots yourself.
- 🧨 **`description_curated_at` does NOT currently mean "a human wrote this", and v1 of this document said it did.** ✅ Verified against `supabase/schema.sql:792-799`: a run-once migration mass-set it with
  `update public.venues set description_curated_at = now() where long_description is not null and btrim(long_description) <> '' and btrim(long_description) !~* '^An independent [\s\S]*Opening hours can vary'`.
  So today it means **"non-empty, and does not match one specific template regex"**. ✅ Verified in production 2026-08-07: **1,865 live venues carry the marker**, and none of them were written to this standard.
  **What that means for you:** the column is NOT evidence that a description is curated, and must not be read as provenance until it is re-derived. **Going forward it is set by the writer, in the same change as the string, and never backfilled in bulk.** Correcting the 1,865 historic rows is a separate, tracked job and is not this document's to authorise.

---

## 1. The job of the field

The 12-word blurb (`vibe`) is written against twenty other cards. It has to win a tap.

The description is written against the **back button**. The reader has already tapped. They are holding a slot in a night (early, dinner, late, tomorrow with four people) and they are deciding whether to spend it here or keep looking.

That makes the description a different genre, not a longer blurb:

| The blurb does | The description does |
|---|---|
| One concrete detail, the recognition hit | Two or more, and how they relate |
| Never carries friction (a card must not be a warning) | **Carries the friction**: the queue, the early close, the counter-only seating, the no-bookings rule |
| No time | **Time**: what changes before ten and after, what is gone by noon |
| Says what the place is | Says **what it is like to be in it**, and **which slot it can hold** |

Two hard rules fall out of this:

- **The description may not open on the blurb's fact.** If the blurb leads on the armour, the description leads elsewhere. It may return to that fact later only if it is doing new work.
- **The description must add at least two facts the blurb does not carry.** If it cannot, do not write it. See the floor in section 4.

And the line we do not cross: a guidebook describes the place, we place the place. We are not writing an entry. We are answering "is this the Thursday at eight, or not".

---

## 2. Shape

**One paragraph. Always.** No line breaks, no lists, no headings. The renderer is a single `<p>`.

**Two legal forms.**

| Form | Size | When | Renders as |
|---|---|---|---|
| **Full** | 55 to 90 words, 3 to 5 sentences, 300 to 650 characters | Two or more concrete facts | Clamped to 3 lines, "Read more" reveals two real sentences |
| **Short** | 1 to 2 sentences, **160 characters or fewer** | Exactly one concrete fact | Renders whole. No expander. Nothing is hidden and nothing is claimed to be |

Hard ceiling 110 words. Past that we are writing an article and the clamp is hiding most of it.

**v1 banned a 161-299 character band, on the grounds that "Read more" would appear and pay out only one line. That rule is DELETED** (agency-creative-director overrule, 2026-08-07). The reasoning was sound but the fix was aimed at the writer instead of the defect: the button's visibility is measured in **characters** (`> 160`) while the reveal is measured in **lines** (`line-clamp-3`), and those decouple by viewport, so no character threshold can be correct at both breakpoints. Editorial rule is binary: **short enough to render whole, or long enough to pay out a real reveal.** The character/line mismatch is routed to the venue-page owner in §10.

**Never lengthen a description to trigger the "Continue reading · free" link.** Padding prose to manufacture a sign-up pull is the same crime as the Cross-checked badge, in a nicer jumper. The short form giving a stranger the complete text is the correct behaviour, not a leak to be patched with adjectives.

**First sentence spec** — applies to the **Full form only**. A Short form is shown whole (see §0.2), so it has no separate snippet to spec.

- The snippet is the shortest run of **complete sentences** that lands between 61 and 160 characters. Aim for a first sentence that lands in that window on its own; if it is shorter, **sentence 2 will be pulled in with it**, so the two together must still read as a coherent snippet. (v1 claimed a short opener triggers a mid-phrase word cut. It does not — the regex is lazy. Correcting this matters because a writer following v1 would have padded sentence 1 for no reason.)
- Carries the strongest decision-changing fact.
- Does not begin with the venue name, the neighbourhood, the price tier or the type. All four already render as metadata directly above the paragraph, and in the page title.
- Does not begin with "This restaurant", "This bar", "The place".

**Register:** third person, present tense, en_GB. No "we", no "our", no "I". Times in prose are words ("gone by ten"), never the 24-hour clock, which belongs to the hours table. No prices for individual items: they go stale and we cannot verify them.

---

## 3. The hierarchy: what earns the clamped three lines

This is a **priority order, not a slot order.** A fixed sequence of beats is a template, and a template repeated over 64 venues is exactly the debt we are paying off. Rank the evidence you have, lead with the highest rank you actually hold, and let the sentence order fall out of that.

1. **The thing that could rule it out or lock it in.** Free entry. No bookings. Two sets a night. Kitchen closes at nine. Cash only. Forty-minute queue.
2. **What you are walking into**, in physical nouns. The room, the counter, the courtyard, the volume.
3. **The specific thing to do or order**, named.
4. **Where it sits in a night.** What it can hold: the first hour, the long middle, the last drink.

Rules on top of the ranking:

- **Any deal-breaker goes in the first 160 characters**, never behind "Read more". If a place shuts at four, someone planning dinner must learn that before they tap. Burying friction past the fold is a bait and switch even when every word is true.
- **The last sentence carries a fact, not a verdict.** Long form's gravity pulls towards a summary close. There is no summary close.
- **If you find yourself using the same order three venues running, the evidence is being forced.** Stop and go back to the reviews.

---

## 4. The evidence floor (the partial-evidence rule)

This is the rule that decides all 64 rows.

### 4.1 What counts as a concrete fact

A **concrete fact** is a detail that is:

1. **Attributable** to something stored on the row: a verbatim review, a structured field, a curator's own verified note.
2. **Falsifiable.** It could be wrong. "The turbot comes whole" can be wrong. "A welcoming atmosphere" cannot.
3. **Not already rendered as metadata.** The eyebrow renders neighbourhood, price tier and type. The masthead renders rating and review count. The accordion renders opening hours. **None of those count.**

**The template test, which is the whole standard in one line:** if a sentence could be generated from the structured fields alone, it is a template by construction, no matter who typed it. "An independent cafe in Peckham, open from early" is a template whether it came from Gemini or from you.

**Non-examples**, all of which have shipped somewhere before and none of which count as a fact: popular with locals · a favourite among regulars · known for its atmosphere · a great spot for groups · serves excellent coffee · has a relaxed vibe.

**Hours are a half-fact.** The numbers are metadata and are banned. What the hours *mean* for a plan ("done by late afternoon, so it cannot hold dinner") may support a description when it is non-obvious and changes the decision, but **it can never be the only thing in one**. A description built from hours alone is the same sentence for every venue with those hours.

Related: hours are hidden from signed-out users on purpose (a moat field). Do not smuggle them into the description to "give anon something". The moat is deliberate.

### 4.2 The floor

| Evidence held | What ships | `description_curated_at` |
|---|---|---|
| **2 or more** concrete facts, at least one not hours-derived | Full form, 55 to 90 words | Set |
| **Exactly 1** concrete fact, not hours-derived | Short form, 160 characters or fewer. One or two sentences. Nothing padded around it | Set |
| **0** concrete facts, or only metadata and hours | **Nothing. `long_description` stays `''`** | Stays `NULL` |

**An empty `long_description` is a correct, shippable state.** It is not a gap, not a bug and not a job for a generator. A venue page with photos, tags, hours, rating, reviews, a map and a booking route is a working page. Sixty-four honest silences beat sixty-four paragraphs we cannot stand behind, and we already know what the second option costs.

### 4.3 Where `[NEEDS DETAIL]` goes

**Never into the column.** The blurb rule says emit `[NEEDS DETAIL: x]` instead of plausible filler, and that stands, but for this field the marker is an instruction to a researcher, not a string. If it were written to `long_description` it would render verbatim on the signed-in page and, worse, become the meta description Google indexes.

The marker goes in the curation worksheet and the PR body, in this shape:

```
slug: <venue-slug>
status: EMPTY (0 facts)
[NEEDS DETAIL: what one fact would unlock a short form, and where to look for it]
```

The instruction must be specific enough to action in five minutes. "Needs more info" is not a marker. "Check the stored reviews for what sells out and when" is.

### 4.4 The three buckets for the 64 — MEASURED, not estimated

v1 described these buckets without counting them, and was rejected for it: without a count, "sixty-four honest silences" is an alibi rather than a floor. ✅ Measured against production on 2026-08-07, over the 64 live venues with `long_description = ''`:

| Bucket | Test | Count |
|---|---|---|
| **Writable now** | 3 or more stored reviews AND 600+ characters of review text | **63** |
| **Cheap to unlock** | 1-2 reviews, or 3+ reviews but under 600 characters | **0** |
| **No evidence at all** | zero stored reviews | **1** |

**The floor does not block this work.** 63 of 64 carry enough stored evidence to attempt a description; only one is a catalogue problem rather than a writing one. The floor's job here is not to excuse silence, it is to decide *per venue* between the Full and Short forms, and to catch the small number of rows where the reviews turn out to be content-free on inspection.

The buckets stay in the standard because the ratio will invert on the next injection: a venue published the week it opens has no reviews yet, and the honest state for it is empty.

---

## 5. Review quotes

Stored Google reviews are **third-party text**. They are our best evidence and our weakest copy.

**Default: do not quote. Extract the fact, then write it in our voice.** Five reviews mentioning a queue does not produce `"be prepared to queue!"`, it produces our sentence: "Expect a queue at the door."

A quotation is permitted only when **the wording is itself the fact**, and then all of these hold:

- One per venue, maximum. Eight words, maximum.
- Double quotes, unattributed. Never a reviewer's name, never a star rating, never "one visitor said".
- **Never the first sentence.** A stranger's sentence must not become our meta description and our link preview.
- Verbatim. Never merged from two reviews, never tidied into something they did not say, never trimmed so the meaning changes.
- Never about a named member of staff. Never a price. Never anything defamatory about the business.
- A quote is not verification. Nothing may frame it as consensus.

**When a review claim becomes a stated fact:**

- **Stable properties** (a dish on the menu, free entry, a courtyard café, counter seating, a no-bookings rule): needs **two or more independent reviews**, or one review plus corroboration from a structured field, before we state it flatly.
- **One-off experiences** ("service was slow", "our table was ready early") are never facts. They are one night.
- **Aggregate sentiment** may support a comparative or frequency claim ("it stays quieter than the headline collections") only when several reviews say the same thing, and it must be written as our judgement, not laundered as reportage. "Visitors praise the calm" is banned; "it stays quieter" is ours to say and ours to defend.

**The bulk-import note is never publishable.** Not verbatim, not paraphrased closely, not at any length. It is a third-party list and it is licence-sensitive. It is a pointer telling you where to go and look. It is not evidence and it is not copy.

---

## 6. Banned in long form

Everything in curation-voice's blurb list carries over: the `[Area]'s own, a [type]...` template and **any structure repeated across two or more venues**; hidden gem, must-visit, vibrant, bustling, cosy, iconic, elevated, curated, unique; anything a chain's marketing team could have written about itself.

Long form invites these, so they are banned by name:

- **Throat-clearing openers.** Tucked away · Nestled · Set in the heart of · Step inside · Whether you are · If you are looking for · There is something about.
- **Second-person tourism voice.** You will find · you will want to · make sure to · do not miss · be sure to try · a feast for the senses. **One narrow exception**: the imperative of expectation, for friction only. "Expect a queue after noon" is allowed. "Expect to be blown away" is not.
- **History-dump padding.** Founding dates, ownership chains, listed status, architectural provenance. A date earns its place only when it is the reason to go or explains what you will actually see.
- **The verdict close.** A real find · well worth the trip · London at its best · you will not be disappointed · a must for any visitor.
- **The unfalsifiable hedge.** Arguably · perhaps · some say · known for · popular with locals. "Popular with locals" is the hidden gem of 2026.
- **Review laundering.** Visitors praise · regulars rave · reviewers consistently mention.
- **Metadata restatement.** The neighbourhood, price tier, type, rating, review count or the literal opening-hours numbers.
- **Blurb restatement.** Reusing the `vibe` line's lead fact as the opener.
- **Unverifiable superlatives.** London's best · the city's only · the oldest, unless the claim is stored and sourced.
- **The retired positioning.** Independent · no chains · family-run. Retired 2026-08-05, and unverifiable per row regardless.
- **Capability and status claims the product cannot verify.** Booked · confirmed · cross-checked · verified · reservations essential · walk-ins welcome, absent stored evidence. Precedent is the plan marker: "Booking opened here", never "Booked". We saw a door open.
- **Em dashes, en dashes, spaced double hyphens** (silently rewritten to a comma, see section 0) and **emoji** (line icons only, no emoji anywhere in the UI).
- **`[NEEDS DETAIL: ...]` in the column itself.** See 4.3.

---

## 7. The decision test

Before a sentence ships, one question: **does this change which slot the venue gets, or whether it gets one at all?**

If a sentence only makes the venue sound nice, cut it. Nice is what the photographs are for.

Three checks that operationalise it:

1. **The friend test.** Read it as an answer to "is it any good for Thursday at eight, four of us". If it does not answer, it is a guidebook entry.
2. **The swap test.** Could this paragraph be moved to a different venue of the same type with only the nouns changed? Then it is a template and it fails, however specific the nouns feel.
3. **The clamp test.** Read only the first three lines. Would a reader who never taps "Read more" be misled by anything, or miss the reason not to go? If so, reorder.

---

## 8. Worked examples

### (a) Rich evidence · The Wallace Collection

**Evidence held** (stored reviews): "completely free to visit" · "Fascinating collection of arms and armour" · "masterpieces by world-renowned artists" · "Excellent café set in a covered courtyard" · "Not overcrowded compared to many London attractions".
**Approved blurb:** "Arms and armour, then the café in the covered courtyard." So armour and café are spoken for. The description leads elsewhere.

**Ships:**

> Entry is free, so a single room is a fair visit and nobody has wasted a ticket by leaving early. Paintings by world-renowned artists hang in the same house as the armour. It stays quieter than the headline collections, which makes it a low-commitment stop rather than the anchor of a night, and an easy one to fold into an afternoon.

60 words, 3 sentences, one paragraph. First sentence is 96 characters, inside the 61-160 window, so it is the whole snippet on its own. Total length is over 160, so "Read more" appears and pays out two further sentences.

**v1's version of this example was rejected**, and the reasons are the two traps this example now exists to demonstrate. It read *"a museum you can walk into"*, *"without feeling you have wasted a ticket"*, *"the one you build a night around"* — three second-person constructions, in the example 64 venues would be pattern-matched against, in a document whose §6 bans second-person voice. **The worked example is the standard that actually gets copied.** It also asserted *"The paintings are half the reason to go, not a supporting act to the armour"*, a comparative ranking that neither cited review supports. Hence the sufficiency rule below.

**Ledger** (this ships in the PR body; a sentence without a ledger row does not ship):

```
sentence 1 · free entry, low commitment  · reviews: "completely free to visit" (x2 stored)
sentence 2 · paintings and armour coexist · reviews: "masterpieces by world-renowned artists",
                                             "Fascinating collection of arms and armour"
             SUFFICIENCY: the reviews establish that BOTH exist. They do NOT rank them, so
             no comparative ("half the reason", "as much as") may be written from them.
             A ledger row must support the CLAIM, not merely mention the subject.
sentence 3 · quieter than headline museums · reviews: "Not overcrowded compared to many
                                             London attractions" (aggregate, 3 stored)
unwritten · café: opening hours, and whether it seats without booking
            [NEEDS DETAIL: if it holds a sit-down slot, sentence 4 replaces the clause in
             sentence 3 with the stronger "works as the hour before dinner"]
unwritten · closing time
            [NEEDS DETAIL: confirm from opening_hours before any claim about early evening]
```

Note what did **not** get written despite rich evidence: the café's usefulness (we know it exists and is covered, we do not know if you can sit at six), and anything about timing (we have not checked the hours field). "Excellent" is the reviewer's adjective and never ours. The strongest available sentence stayed unwritten because the check was not done. That is the standard working, not the standard failing.

### (a2) The shipped reference set · five more shapes

§8(a) warns in its own words that **"the worked example is the standard that actually gets copied"**, and on the first real batch that happened inside a single sitting: five of six drafts arrived carrying (a)'s cadence, all built on `[fact] + so/which + [planning implication]` with a "rather than" contrast close. The gate rewrote them apart. One example is not enough to write 64 rows against, so the first approved batch is now part of the standard, chosen because their engines differ:

| Venue | Opening move | Why it is a different shape |
|---|---|---|
| **Cittie of Yorke** | names the thing in the glass first | no causal connective at all; the role emerges from a party size |
| **Dirty Dicks** | splits the building in two | spatial, not causal; the close reframes the blurb's fact as a *slot* rather than a dish |
| **The London Dungeon** | leads on the deal-breaker | the age warning sits inside the snippet, per §3 |
| **The Mayflower** | leads on the physical thing you came for | friction ("usually busy") folded into the first sentence, not appended |
| **The Sherlock Holmes Museum** | leads on the process, not the exhibit | two queues as the fact; the role arrives as a consequence of duration |

Read all six before writing. If a draft's closing clause could be swapped with (a)'s and nobody would notice, it has caught the cadence and needs restructuring, not rewording.

### (b) Thin evidence · category plus hours only

**Evidence held:** Google category `cafe`. Opening hours 07:00 to 16:00. Nothing else. No stored reviews with content, no verified note.

**Ships: nothing.** `long_description` stays `''`. `description_curated_at` stays `NULL`.

Both available items are metadata: the category renders in the eyebrow, the hours render in the accordion. Under the template test, every sentence available here is a template. "Open from seven and done by four, this is a morning place" could be pasted onto every 07:00-to-16:00 café in the catalogue, which is precisely how the unapproved prose happened. Hours are a half-fact and cannot stand alone.

**Worksheet row:**

```
slug: <venue-slug>
status: EMPTY (0 qualifying facts; category + hours are metadata)
[NEEDS DETAIL: one thing the counter is known for, or one thing that runs out.
 Look in stored reviews first, then the venue's own menu photo.]
```

**The unlock, for illustration.** The moment one real fact lands, say two stored reviews both mention the cardamom buns going early, this becomes a legal short form:

> The cardamom buns tend to be gone by ten, so this is an early stop or none at all.

81 characters. Under the 160 cap, so it renders whole with no "Read more", and a signed-out reader sees the complete text with no "Continue reading" link. Nothing is hidden, so nothing pretends to be. One fact, one form, done. Do not grow it to 300 characters to earn an expander.

### (c) Zero evidence

**Evidence held:** name, slug, address, coordinates, price tier, type, rating, review count. No review text. No note. Nothing.

**What gets written:** nothing at all.

```
long_description        = ''      (unchanged)
description_curated_at  = NULL    (unchanged)
```

**What the user sees.** Signed in: photos, the eyebrow, the name, rating, tags, hours, reviews, map, booking route, and **no description band at all** — ✅ verified at `app/venue/[slug]/venue-detail.tsx:546`, gated on `signedIn && venue.longDescription.trim() !== ""`. ⚠️ v1 asserted this before it was true: until PR #237 the guard checked `signedIn` alone and every one of these 64 rows rendered an empty `<p>` plus a dead `mt-5` margin. The rule was right; the fact was not checked. Do not restate a rendering claim in this document without opening the file. Signed out: `deriveAnonTeaser('')` returns `null`, so no teaser block and no "Continue reading" link. There is no placeholder, no "Description coming soon" and no apology.

⚠️ **The silence is not total, and this is worth knowing.** `app/venue/[slug]/venue-page-shared.tsx` still emits a generic `<meta name="description">` for a venue with no teaser — it is the one surface where an empty row is not silent. It previously promised *"book a table"* for every venue type including museums and parks, which was a capability claim the product cannot make; that was corrected in PR #237 to a line true of every venue page. It remains a shared, generic string, and is the SEO owner's to bless.

That is a deliberate copy call. Every state ships with words, but a state is a **surface**, not a field. An empty screen owes the reader an explanation. An empty band inside a page that is otherwise full of true, useful content owes them silence. "We have not written this one yet" promises a delivery date we cannot keep, on 64 pages, and draws a ring around the one thing we lack.

**What must never be written here**, with the reason each fails:

| Tempting | Why it fails |
|---|---|
| "An independent cafe in Peckham. Opening hours can vary." | The exact template of the gated rows. Metadata restatement plus retired positioning. |
| "A neighbourhood favourite with a relaxed feel and friendly staff." | Nothing falsifiable. Written from the fields, so it fits any venue, so it is a template. |
| "Locals rate it highly." | Laundered from the rating, which already renders four lines above. |

**Worksheet row:**

```
slug: <venue-slug>
status: EMPTY (no evidence of any kind)
[NEEDS DETAIL: no stored review text exists. Needs first-party evidence before any copy:
 menu, a photo of the room, or a visit. Not a writing task.]
```

---

## 9. Enforcement

- **Every description ships with a ledger**, sentence to evidence, in the PR body. A sentence with no ledger row does not ship. This is the mechanism that stops the next Gemini, because it makes the absence of evidence visible instead of invisible.
- **curation-voice is the per-string gate.** It checks the banned lists, the two forms, the first-sentence spec, the ledger's sufficiency, and that no two venues share a structure. It does not have to invent the spec any more, which was its stated objection.
  (⚠️ v2.0 of this file left "the 161-to-299-character gap" in this line after §2 had deleted that rule, so the gate was being told to enforce something the standard no longer contained. Caught by the gate itself on the first real batch. Removed in v2.1.)
- **CI does not cover this field.** `pnpm check` scans `app`, `components` and `lib` only. Catalogue prose is database content. Until a database lint exists, the human gate is the only gate. Say that out loud rather than trusting a green tick.
- **`description_curated_at` is set by the writer, in the same change as the string.** Never backfilled in bulk, never set to clear a queue.

---

## 10. Deliberately left undecided

- Whether a venue with an empty `long_description` should rank lower in Explore or be skipped by the plan engine is a **ranking and surfacing** decision for the algorithm owner and product-strategy-ia-lead, not an editorial one.
- The **moat trade** the short form exposes (a description of 160 characters or fewer is shown complete to signed-out visitors) is existing, deliberate behaviour from the 2026-07-11 panel. Flagged, not changed; padding as a workaround is banned. Belongs to supabase-guardian and Maria.
- **Where `[NEEDS DETAIL]` markers physically live** (a curation worksheet, the PR body, or a new nullable column) is a schema question for supabase-guardian and code-reviewer. Specified here only that they must never live in the rendered column.
- **Event descriptions are out of scope.** Their provenance is genuinely different (real provider prose from Ticketmaster, Eventbrite and Places, with no template class), and extending this standard to them without re-reading that evidence would be exactly the invention this document exists to prevent.
