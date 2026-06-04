# Weekly digest email — go-live steps (the maintainer)

The weekly "new in London" retention email is built. Two one-time steps switch
it on. Until then nothing breaks: the profile toggle shows but won't save, and
the weekly job stays dormant.

## 1. Run the database migration ✅ DONE (2026-06-04)

Applied to the live database (migration `add_email_digest_optin_to_profiles`).
The profiles table now has `email_weekly_opt_in` + `email_unsub_token`, so the
profile toggle saves and the one-click unsubscribe link works. Nothing to do
here. (SQL kept for reference:)

```sql
alter table public.profiles
  add column if not exists email_weekly_opt_in boolean not null default false,
  add column if not exists email_unsub_token uuid not null default gen_random_uuid();
```

## 2. Add your Resend API key as a GitHub secret

The weekly job sends through Resend, so it needs the key (the same Resend API
key you used for SMTP works).

GitHub repo → **Settings → Secrets and variables → Actions → New repository
secret**:

- Name: `RESEND_API_KEY`
- Value: your Resend API key (starts with `re_`)

Optional: also add `NEXT_PUBLIC_SITE_URL` = `https://www.funldn.com` (the job
defaults to this if unset) and `EMAIL_FROM` (defaults to
`Fun London <hello@funldn.com>` — the from-address must be on your verified
funldn.com domain).

## 3. Test it

- Locally: `pnpm send-weekly-digest:preview` writes `digest-preview.html` (open
  in a browser). `pnpm send-weekly-digest --dry` lists who would receive it.
- On GitHub: Actions → **weekly-digest** → Run workflow → tick "Dry run" to
  list recipients without sending.

## Schedule + consent

- Sends **Thursday 09:00 UTC**, only to people who turned the toggle ON
  (default OFF — explicit opt-in). Never sends an empty digest.
- Every email has a one-click unsubscribe link (and native Gmail/Apple Mail
  unsubscribe via List-Unsubscribe headers).
