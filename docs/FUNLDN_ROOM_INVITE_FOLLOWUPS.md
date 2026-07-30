# Plan Together invites: known limitations after the URL fix

Raised 2026-07-30, alongside the change that takes the room code out of the
browser URL. **None of these is a security gap** — the credential no longer
reaches any analytics vendor, which was the point. They are reliability and
recovery gaps in the invite journey, recorded here so they are decided
deliberately rather than discovered.

They share one failure signature, and it is the expensive part:

> **A lost invite does not produce an error. It produces a lobby.**

The invitee is silently made host of a new, empty room with a different code
and a live "Waiting for someone to join…". Two people then sit in two different
rooms, each believing the other is late. Nothing on screen says anything is
wrong. Any fix should attack the silence first and the cause second.

---

## 1. Magic-link sign-in in a different browser loses the invite

**Status: accepted trade for this change. Highest-value follow-up.**

The code is stashed in same-origin `localStorage`, so it does not travel between
browsers. The common path does exactly that:

```
WhatsApp in-app browser  ->  arms the stash
  email opens in Mail    ->  Safari
  /auth/callback         ->  /plan/together   (Safari has no stash)
  -> new empty room
```

Before this change the code rode in the `returnTo`, through Supabase's
`redirect_to`, and into the magic-link **email body**. That worked across
browsers, and it is precisely why it had to go: an emailed URL containing a
bearer credential is a durable copy of that credential in a third-party inbox,
and it is the value PostHog freezes into `$initial_person_info`.

Google OAuth in the same browser is unaffected and was verified: the pre-paint
script leaves `?signedin=1` alone and the stash survives the round trip.

**Cheapest real mitigation: a room-code input (see 2).** The invitee's friend
already has the six characters on screen.

## 2. There is no way to type a room code anywhere in the app

**Status: pre-existing, not caused by this change. Now load-bearing.**

`joinRoom()` has exactly one caller: the resolver that reads the stash. There is
no input on any screen, in any state. This was survivable while a link always
worked; it is what turns (1), (3) and (5) from annoyances into dead ends.

It also makes existing copy untrue today:

- `not-found` says *"Check the code"* — there is no field to check it in.
- `denied` says *"Ask whoever started it to send you the link again"* — a re-sent
  link lands in the same wrong browser and fails identically.

**Suggested shape:** put the input in the empty lobby, under the roster, where
every victim of (1), (3) and (5) already lands — *"Meant to join a friend?
Enter their code"* — and reuse it on the `denied` / `not-found` / `expired` /
`closed` screens. No new server surface: `joinRoom` already normalises,
validates and rate-limits (20 attempts / 10 min, enforced in the DB).

## 3. Terminal failure screens are dead ends

`denied`, `too-many-rooms` and `auth` all have `action: null` and no back link;
the only escape is the tab bar. Worse, backing out of one re-mounts the flow and
calls `createRoom()` again, so a few back-presses can burn the 10-rooms/hour
limit and land on "That's a lot of rooms", which itself has no action.

Fixed by (2) plus a "Start a new room instead" control.

## 4. Reload mid-room can mark you as having left

**Status: pre-existing, untouched by this change.**

`pagehide` fires `leaveRoom()`, and iOS Safari fires `pagehide` when the page
enters bfcache — i.e. when the user switches to WhatsApp to send the link. On
bfcache restore, effects do not re-run, so nothing rejoins: the UI looks normal
while the row has `left_at` set and host handoff may already have moved on. On a
true reload, the fire-and-forget `leaveRoom` races the `joinRoom` that follows.

Also: `failureFromJoin` maps a join-side rate-limit to `denied`, so a user on a
flaky connection is eventually told **"You're not in this room"** — a wrong
diagnosis with no action attached.

## 5. Copying the address bar no longer shares the room

The URL is now a clean `/plan/together` by design, so copying it from the
address bar — routine on desktop — produces a link that drops the recipient into
their own new room. The Share button is the only correct channel and nothing
says so. A one-line hint next to the code covers it.

## 6. Signed-out invitees see nothing of the room before the wall

An invitee arrives from a personal message and is shown a blurred teaser and
"Sign up to plan together" — less than the message contained. The room's roster
("Anna's room · 3 waiting") is real, demonstrated value and is currently
discarded: `page.tsx` deliberately stops reading `searchParams` so the code
cannot reach the server component. Rendering a roster teaser again would need
the code server-side, which reopens exactly what this change closed, so it needs
a different mechanism (an opaque, non-joining preview token) rather than a
revert.

## 7. The share LINK still carries the code, where a fragment would not

**Status: deliberate non-change here. Strongest remaining privacy win.**

`lobby.tsx` builds `/plan/together?room=CODE`, and the page is `force-dynamic`,
so every invite tap writes the code into the server request log. Worse,
WhatsApp, iMessage and Slack fetch shared URLs server-side to build preview
cards, so sharing the link hands a live join credential to Meta, Apple or Slack
before the invitee has opened anything.

A URL **fragment** (`#room=CODE`) is never sent to any server, and the pre-paint
script already reads one. It is close to a one-line change.

It is not being made here because "preserve the invite flow" is the binding
constraint on this change and a fragment cannot be verified across WhatsApp,
iMessage, Slack, Instagram and Gmail from a terminal. If a client rewrites or
strips fragments, **every** invite breaks, not just an edge case. It needs one
afternoon of real-device testing, and then it should ship.

## 8. Storage-blocked browsers lose the retry

`armRoomInvite` writes the window global and *tries* `localStorage`. The retry
button then calls `location.assign`, which destroys the document and the global
with it. Where the write throws (Safari "block all cookies", some in-app
webviews) the retry silently starts a new room. Either keep the retry inside the
document, or say "we couldn't hold onto that room" instead of failing silently.

## 9. An invite armed while signed out survives a *different* person signing in

The stash is cleared on sign-*out*, which covers the shared-browser case it was
written for. It is not cleared when a different account signs in, and the
inline script needs no session to arm one. Clearing on sign-in would break the
magic-link journey, so the fix is to bind the stash to the sign-in attempt (it
can ride alongside `fl.signintrigger.v1`) rather than to the clock.

## 10. A rejected Server Action leaves a permanent spinner

The resolver is `void (async () => { … })()` with no `.catch()`. Server Actions
*reject* on transport failure rather than resolving `{ok:false}`, so airplane
mode means `setFailure`/`setReady` never run and the "Setting up your room…"
state is permanent. `ROOM_FAILURE_COPY.offline` exists and is unreachable from
this path. Pre-existing, and a small fix: try/catch, map a thrown action to
`offline`.

## 11. Codes already sent to PostHog cannot be un-sent

Forward-only, and worth stating plainly. Any browser that opened
`/plan/together?room=…` before this ships has that URL frozen in posthog's
`$initial_person_info` in its own localStorage — the analytics-gate PR scrubs
that copy on init — but the values already recorded on person profiles in
PostHog EU are vendor-side. The codes are dead after six hours, so the exposure
is bounded, but purging them is a console action, not a code change.

---

## Fixed in this change, recorded so it is not reintroduced

**"Start a session ->" used to return you to the room you just left.** Arming
the stash on create/join conflated two different reasons for a code to be
present, so finishing a room and starting a new one read the old code straight
back for the length of the TTL, with no way out. The stash now records *why* the
code is there: an **invite** (from a `?room=` URL) is honoured unconditionally,
a **resume** (written by us after create/join) only on an actual reload or
back/forward, and either way only **once per document** — because
`isResumeNavigation()` is a document-level fact, so one pull-to-refresh
otherwise licensed every later client navigation to rejoin the finished room.

**A 4G blip deleted the invite.** The retry guard read the *mapped* failure
against `"timeout" | "channel-error" | "offline"` — three values
`failureFromJoin` cannot produce, since they come from the Realtime path. It was
therefore always false and every join failure cleared the stash, including a
transient RPC error. Transience is now decided from the result's own `reason`
(`isTransientJoinReason`), and `lib/__tests__/room-failure-transience.test.ts`
asserts that every reason the check accepts is one the join path can actually
return — the generalisation of the bug, not just the instance.

**A resume expired before the room did.** The TTL was one hour against a
six-hour room, so a tab left open and then reloaded (or discarded and reloaded
by iOS) silently made the user host of a new empty room while their friends
stayed in the old one. Resume now matches the room's own lifetime; the invite
TTL stays sized for a magic-link round trip.

**Two comments still told the next developer to put the code back in the URL**
(`auth-wall.tsx`'s `returnTo`, `legal-links.tsx`). Both now say why not.
