---
name: issue-resolution-comapeo
description: Resolve COIAB bugs with reproducible regression tests, independent review, and verified PR checks; includes historical CoMapeo counting and smoke-test lessons.
---

# Comapeo Issue Resolution & PR Workflow

## Trigger

Fixing COIAB bugs in `transistir/coiab-app`. Read `AGENTS.md` first: all COIAB
implementation stays here, including work begun in `transistir/comapeo-mobile-1`.
Never write to `digidem/*`.

## Regression and review workflow

1. Reproduce the reported behavior before fixing it. Record the test command,
   buggy SHA and actual RED assertion failure; setup/import failures are not
   RED evidence. Run the same test against the fix and record GREEN.
2. For navigation races, mount the real navigator with seeded state and a
   delayed query refresh. Assert the route before and after reconciliation.
   Route pruning caused fallback to the original initial route in a verified
   regression; code reading had ranked it only as H5/H1. Screen-level mocks
   bypass this behavior and cannot disprove the race.
3. Independent fresh-context review and verification of fixes are never
   optional. Supply the exact diff, source and tests without the implementer's
   preferred diagnosis. The reviewer may use the same model: `gpt-6-astra`
   found a missed root cause and P2 in its own prior commit on 2026-09-05.
   Verify findings against source, resolve actionable gaps, and independently
   re-verify the final change. Record reviewer, SHA and findings/disposition.
4. Preserve PR ancestry when the local and actual PR-repository heads diverge:
   fetch and merge the PR branch, never substitute cherry-picks or rebase.
   Keep the PR-branch version as the baseline for conflicts in PR-owned files,
   reconcile integration changes, then rerun regression tests and review.
5. Run relevant tests and `npm run lint`; use the capture skills for UI changes.
   Poll exact-head check-runs following `AGENTS.md`. Zero checks for minutes
   after a protected-branch push means CI is unverified. `ci.yml` has no
   `workflow_dispatch`; do not claim it can be force-started. Verify required
   `all` and `frontend` checks and post-merge CI separately.

## Historical cloud-app lessons

The following findings came from `digidem/comapeo-cloud-app`; identifiers are
preserved for reference, not presented as files or APIs in this native repo.

1. **Category counting bug** — Count distinct categories from `categoryByObservationId`, not `presets.length`. For preset-less projects, synthesize categories from unmatched `tags.category` so stat doesn't show 0.
2. **Async metadata loading** — Expose `isLoading` from `useObservationCategoryMetadata`, wire to `StatCard` loading boundaries. Don't let async metadata silently return undefined count.
3. **useCountUp animation** — Initialize with target value, skip animation on warm mount to prevent visual flicker on component remount.
4. **CI smoke test race** — CF Pages Functions worker needs >1s warmup; 404 instead of expected 400. Fix: curl retry loops with `|| true --connect-timeout`, guard sleeps, raise `timeout-minutes` on smoke-test jobs.
5. **Tautological tests** — Fixtures must differ under bug vs fix. Revert source, confirm tests fail before merging.
6. **Historical review loop** — Pool implemented, Kimm/Claude Sonnet 5 reviewed,
   and Opus 5 re-verified via resumed session. Those model names are provenance,
   not requirements; use the independent review workflow above.
7. **Merge discipline** — PRs merge squash; stacked PRs use `git merge` (NOT
   rebase). Never `--no-verify`. Historical cloud-app Husky validation used
   `npm run validate` (~5-8 min); coiab-app has no such script. Use its actual
   `package.json` scripts and preserve hooks.

## Branch cleanup

Only delete merged/obsolete branches within authorized cleanup scope, in
`transistir/coiab-app`. Check spelling variants (comapeco, comapoco) and exact
refs before deletion. Verify with `git ls-remote origin refs/heads/<ref>`.
Inspect `git worktree list` and worktree status first; remove clean disposable
worktrees with `git worktree remove <path>`, never recursively delete a clone
or force removal to bypass uncommitted work.

Squash merges do not preserve ancestry: after the PR merges,
`git log origin/develop..HEAD` still lists the branch commits, and
`git branch --merged` is the wrong check. Run `git fetch origin --prune` first
— a stale `origin/develop` makes any comparison meaningless. Then accept one of
two proofs: the branch tree matches `develop`
(`git diff --stat origin/develop origin/<branch>` empty), or all three hold:
`gh pr view <N> --json state,headRefOid` says
`MERGED`, its `headRefOid` equals
`git rev-parse origin/<branch>` (no commit was pushed after the merge), and the
squash commit is an ancestor of `develop` (`gh pr view <N> --json mergeCommit
-q .mergeCommit.oid`, then `git merge-base --is-ancestor <oid> origin/develop`).
The empty-diff check alone false-negatives once an unrelated commit landed on
`develop` after the merge; the ancestor check survives that, but only together
with the head match — the squash commit stays reachable even after a follow-up
commit lands on the branch, and deleting then loses it. Before deleting a local
`<branch>`, also require `<branch>` and `origin/<branch>` to point at the same
commit, or run the tree proof against `<branch>` — unpushed local commits are
invisible to any comparison that only reads `origin/*`.

## Verification

PR APIs can lag a push by 1-3 minutes; poll the actual head SHA rather than
sleeping once and trusting stale results. The historical cloud-app tally was
15 passed, 6 skipped, 0 failed; do not use that fixed count for COIAB. Check
required names, conclusions and SHA, not just the absence of failures.

## Flake repro loops

- A single jest run can PASS yet hang after the suite ("Jest did not exit")
  until the surrounding tool timeout kills it (~15 min per run observed). In a
  loop, bound every iteration with an external `timeout` or the loop collects
  zero evidence. `--forceExit` is not a substitute: it only forces exit after
  tests finish, so a hang during tests or teardown still stalls, and it kills
  Jest before handle cleanup completes — treat any `--forceExit` run as unable
  to verify process cleanup, since the open handles are the very thing being
  diagnosed. Hang after teardown = open handles surviving teardown — often the
  same surface as the CI-only flake being chased (case: #97 repro loop,
  2026-09-29).
- Integration teardown timeouts: `@comapeo/core`'s `FastifyController.stop()`
  calls `server.close()` + `server.closeIdleConnections()` directly and never
  `fastify.close()`, so fastify's `forceCloseConnections` never applies. A
  teardown measured 70031ms and 70055ms — just under fastify's 72s
  `keepAliveTimeout` (4.29.1) — so a 30s `afterEach` budget dies while every
  test in the suite passes. The exact mechanism is unconfirmed: the socket was
  not counted as idle by `closeIdleConnections()`, and if the 72s timer is the
  cause, its countdown started just before `encerrar()` — i.e. the response had
  already finished. An unconsumed response body (see the helper's docblock) is
  the known suspect. Budget the hook above 72s (90s) and warn above 20s to
  record the real duration. Do not force `closeAllConnections()`: the killed
  connection has a `fetch` in flight and `clienteDeCriacao.ts` has no catch,
  which trades a timeout flake for an unhandled rejection. Measure before
  choosing — two ~70s teardowns are proof the delay is real; six fast runs are
  not.
- A flake that never reproduces locally does not clear the suspect: read the
  failure path in the dependency source (`rpc-reflector` `handleClose` rejects
  all in-flight calls with `ChannelClosedError` at close; `@comapeo/ipc`
  documents in-flight rejections as by-design). If teardown closes the channel
  while work is pending, the fix is deterministic draining (cancel queries,
  await in-flight RPCs before close) — never a fixed `sleep(N)` boundary.

## Pitfalls

- `gh pr view --json merged` is not a field; use `state`, `mergedAt` and
  `mergeCommit`. The error lists every valid field.
- Em-dashes in unquoted heredocs produce `\\xE2` GraphQL parse errors — use `--body-file`.
- `&` in `gh` `--label` args causes shell backgrounding — quote carefully.
- A branch checked out in a worktree (historically `/tmp/pr172`) cannot be deleted; use the safe cleanup procedure above.
