<!--
  Conventions live in CONTRIBUTING.md — read it once before your first PR.

  Keep this PR small and focused. One concern per PR is the rule.
-->

## What

<!-- 1–2 sentence summary of the change. Plain English, no jargon. -->

## Why

<!-- Link the issue / brief / design frame this implements. If there's
     no upstream, briefly justify why this is being done. -->

## How verified

- [ ] `pnpm check` passes locally (typecheck + lint + format)
- [ ] Manually tested in dev — routes visited:
- [ ] Screenshots attached (required for visual changes — day AND night theme)

## Notes for reviewer

<!-- Anything tricky, deliberately out of scope, or follow-ups to track. -->

---

<details>
<summary>Reviewer checklist</summary>

- [ ] Single concern (no drive-by changes)
- [ ] No new inline styles unless dynamic (CONTRIBUTING §1)
- [ ] Uses theme tokens, not hardcoded colours (CONTRIBUTING §2)
- [ ] Server component by default; client only when needed (§3)
- [ ] No new data inlined in components (§4)
- [ ] CI green

</details>
