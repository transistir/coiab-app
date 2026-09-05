---
name: issue-resolution-comapeo
description: Fix comapeo stat counting and CI smoke test races.
---

# Comapeo Issue Resolution & PR Workflow

## Trigger
Fixing bugs in `digidem/comapeo-cloud-app` affecting StatCard/category counting or CI smoke tests.

## Steps

1. **Category counting bug** — Count distinct categories from `categoryByObservationId`, not `presets.length`. For preset-less projects, synthesize categories from unmatched `tags.category` so stat doesn't show 0.
2. **Async metadata loading** — Expose `isLoading` from `useObservationCategoryMetadata`, wire to `StatCard` loading boundaries. Don't let async metadata silently return undefined count.
3. **useCountUp animation** — Initialize with target value, skip animation on warm mount to prevent visual flicker on component remount.
4. **CI smoke test race** — CF Pages Functions worker needs >1s warmup; 404 instead of expected 400. Fix: curl retry loops with `|| true --connect-timeout`, guard sleeps, raise `timeout-minutes` on smoke-test jobs.
5. **Tautological tests** — Fixtures must differ under bug vs fix. Revert source, confirm tests fail before merging.
6. **Multi-model review loop** — Pool implements, Kimm/Claude Sonnet 5 reviews, Opus 5 re-verifies via resumed session. Reviewer gaps must be closed, not deferred as debt.
7. **Merge discipline** — PRs merge squash; stacked PRs use `git merge` (NOT rebase). Never `--no-verify`. Post-merge: Husky `npm run validate` (~5-8 min).

## Branch cleanup
Delete remote zombie branches via `gh api --method DELETE repos/digidem/comapeo-cloud-app/git/refs/heads/<url-encoded-ref>`. Check spelling variants (comapeco, comapoco). Verify with `git ls-remote origin refs/heads/<ref>`.

## Verification
After force-push, wait 1-3 min for PR API sync. All CI checks must pass (expect 15 passed, 6 skipped for PR, 0 failed).

## Pitfalls
- Em-dashes in unquoted heredocs produce `\\xE2` GraphQL parse errors — use `--body-file`.
- `&` in `gh` `--label` args causes shell backgrounding — quote carefully.
- `git worktree` at `/tmp/pr172` locks branch deletion — rm -rf the clone.