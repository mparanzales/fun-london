# Security

Fun London is a small production app run by one person. Reports are read and
taken seriously, and I would much rather hear about a problem than not.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Use GitHub's private vulnerability reporting: go to the
[Security tab](https://github.com/mparanzales/fun-london/security) and click
**Report a vulnerability**. That opens a private thread visible only to me.

Useful things to include, as far as you have them: what you found, the steps
to reproduce it, and what an attacker could actually do with it. A rough note
is better than no note; do not wait until you have a polished write-up.

Expect a first reply within about a week. If something is actively exposing
user data I will prioritise it over everything else.

## Scope

In scope:

- The live app at [funldn.com](https://www.funldn.com)
- This repository's application code, database policies and GitHub Actions
  workflows

Out of scope:

- Findings against third-party services (Supabase, Vercel, Cloudflare, Google
  Places, Eventbrite, Ticketmaster). Report those to the vendor.
- Automated scanner output with no demonstrated impact.
- Missing security headers or best-practice warnings with no exploit path.
- Denial of service through sheer volume of requests.

## Please do not

- Access, modify or delete data belonging to anyone but yourself. If you need
  a second account to demonstrate something, create one.
- Run destructive tests, spam the venue or event pipelines, or generate load
  that costs money. Several APIs behind this app are metered.
- Publish details of an unfixed issue.

## Known and accepted

Recorded here so nobody spends time re-reporting them:

- **Plan Together rooms are membership-scoped.** This entry previously said
  codes were 4 characters with no rate limit and that closing the gap needed a
  product decision. All three are out of date. Codes are **6** characters from a
  32-character alphabet, minted by the database with a CSPRNG; joining is
  throttled in the database at 20 attempts per 10 minutes per account, so the
  limit cannot be skipped by calling the RPC directly; and membership is
  persisted, so the Realtime policies require a membership row rather than a
  matching topic prefix. A signed-in user who is not a member is refused.
  Rooms remain short-lived and are purged 7 days past expiry.
- **Signed-out visitors can read card-level venue data.** That is deliberate.
  Descriptions, tags, reviews, phone numbers and opening hours are withheld by
  column-level grants on the `anon` role.
- **The repository is public by design.** Finding a secret committed here is
  very much in scope; finding that the source is readable is not.

## Credit

If you report something valid I will credit you here unless you would rather
stay anonymous. There is no bug bounty; this is a student-built project with
no budget.
