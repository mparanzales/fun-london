# Staging test matrix — the exact checks the harness runs

`scripts/staging-room-security-suite.ts` implements every row. All are **NOT RUN** (no staging database was available); the harness is committed so the whole matrix executes in one command once one exists.

| ID | Area | Expectation | Status |
|---|---|---|---|
| ENV-1 | environment | target ref is not a known production ref (hard denylist) | NOT RUN |
| ENV-2 | environment | staging DB reachable and `plan_rooms` exists (0001 applied) | NOT RUN |
| ACC-1 | accounts | three disposable accounts created and signed in (real JWTs) | NOT RUN |
| R-1…R-4 | room create | host creates a room; code is 6 chars; creator is host; expiry ≈6h | NOT RUN |
| R-5 | room join | member joins with the code and gets a membership row | NOT RUN |
| C-1 | table read | unrelated account reads **zero** room rows | NOT RUN |
| C-2 | table read | unrelated account reads **zero** membership rows | NOT RUN |
| C-3 | realtime | unrelated account **cannot subscribe** to the room topic | NOT RUN |
| C-4 | host theft | unrelated account cannot promote itself with `p_stale_seconds: 0` | NOT RUN |
| C-5 | closure | unrelated account cannot close the room | NOT RUN |
| C-6 | purge | unrelated account cannot execute `purge_expired_plan_rooms` | NOT RUN |
| M-1 / M-2 | realtime | host and member **can** subscribe | NOT RUN |
| M-3 | host theft | a real member cannot steal host from a live host via `stale=0` (clamp holds) | NOT RUN |
| T-1 | throttle | direct RPC join is throttled **server-side** (no UI involved) | NOT RUN |
| X-1 | closure | host can close the room | NOT RUN |
| X-2 / X-3 | closure | new subscribes denied after closure (unrelated **and** member) | NOT RUN |
| X-4 | existing socket | **measure** how long an already-open socket keeps broadcasting after closure | NOT RUN |
| E-1 / E-2 | expiry | expired room cannot be joined; new subscribe denied | NOT RUN |
| E-3 | expiry | members can still **read** an expired room so the UI can say why | NOT RUN |
| H-1 / H-2 | handoff | a stale host is replaced, by the earliest-joined remaining member | NOT RUN |
| H-3 | handoff | repeat promotion is stable (no host flapping) | NOT RUN |
| CLEAN-1 | cleanup | every temporary room and account removed | NOT RUN |

## Not covered by this harness (needs a browser, and a preview deployment)

Subscription-error copy rendering, the lobby/close-room control, three-profile UI journeys, PostHog URL autocapture inspection, and the full functional regression sweep (Explore/Saved/Venue/solo plan). These need Phase 4's preview deployment, which is itself blocked — see the verification document.
