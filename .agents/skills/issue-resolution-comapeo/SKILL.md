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

## PR-cycle lessons

- **Recount review threads after every push, once the automated review of the
  new head has finished.** Automated reviewers re-review each new head; a
  clean thread list earlier in the PR says nothing about the current one.
  Confirm the reviewer has posted its review for the exact head SHA — wait one
  bounded window (a CI run is enough) — before counting. If the bot publishes
  nothing for that SHA (paused, rate-limited, `Review skipped`), record that in
  the PR, keep reviewing and resolving the threads that do exist, and rely on
  the independent review; an absent automated review is not evidence of a clean
  head. One cycle went from "all resolved" to three fresh P1s on the new
  head. Fix or rebut with evidence (`file:line`, test, SHA), then resolve.
- **A green rerun of the same SHA does not prove a flake.** An intermittent
  regression also passes. Compare against what CI actually tested: `ci.yml`
  checks out `refs/pull/N/merge` — the head merged into the base branch as it
  stood when the triggering event fired (a rerun reuses that merge) — so
  reproduce on that merge commit and on its base side (`Merge <head> into
  <base>` in the checkout log), fetching the SHAs from the log rather than a
  fresh `refs/pull/N/merge`, which GitHub recomputes when the base moves. A local
  run of the head alone, or of the merge base, covers neither when the base
  moved, because the failure can come from the PR, from new base commits, or
  from their interaction. Two flake suspects seen in one cycle: the IPC drain
  timing out in a slow navigator suite, and unrelated screen suites failing
  only in CI. File the suspicion with the observed message and a hypothesis,
  never as "flake" alone.
- **A disabled primary button must name what is missing.** When `canCreate`
  ANDs several conditions, render the unmet one next to the button, in a
  fixed priority order, and test each state. A green validation check with a
  grey button reads as a bug to the user even when the gate is correct.
- **A single-option catalog must not ask for a choice.** Pre-select when the
  list has exactly one entry and keep `null` for 2+; a forced tap on the only
  option adds friction and hides why the action stays disabled.
- **Never hide exit codes behind `| head`, `| grep` or `| tail`.** Reviewer
  sandboxes are read-only and often cannot bind a port (`listen EPERM`), so
  navigator suites must run on the host; a filtered pipeline can print a clean
  line while the command failed.

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
`gh pr view <N> --json state` says `MERGED`,
`git rev-parse origin/<branch>` equals the head SHA recorded at merge time (the
cycle ledger's frozen SHA — the branch ref can gain commits after the merge, so
a value read after the fact proves nothing), and the squash commit is an
ancestor of `develop` (`gh pr view <N> --json mergeCommit -q .mergeCommit.oid`,
then `git merge-base --is-ancestor <oid> origin/develop`).
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
- **`process._getActiveHandles()` does not list JS timers.** A `setInterval`
  that runs no I/O is invisible there, so "only stdio pipes" is not proof the
  process is clean. Find it with `async_hooks` (`init` on `Timeout`, capture
  `new Error().stack` only when `_repeat` is true) or
  `process.getActiveResourcesInfo()`, then verify 10/10 runs exit without the
  warning. Real case (#105): `@sentry/react-native` 8.15.1 starts a 5 s
  `AsyncExpiringMap` cleanup interval at **import**, before `Sentry.init()`;
  short suites finish first and the timer keeps Node alive — intermittent
  because a cold import outlives the first tick. Do not `unref` or
  `--forceExit`; cancel exactly that interval in a Jest
  `testEnvironment`/`globalTeardown` and keep a cheap import fixture so the
  coupling to the dependency's internal filename is tested.
- **A flake that never reproduces locally does not clear the suspect: read the
  failure path in the dependency source (`rpc-reflector` `handleClose` rejects
  all in-flight calls with `ChannelClosedError` at close; `@comapeo/ipc`
  documents in-flight rejections as by-design). If teardown closes the channel
  while work is pending, the fix is deterministic draining (cancel queries,
  await in-flight RPCs before close) — never a fixed `sleep(N)` boundary.

## Harness and environment pitfalls

- **Never undo a mutation test with `git checkout -- <file>`.** That restores
  the HEAD version and silently discards uncommitted delegated work — in the
  #136 round it wiped an entire rewritten component and produced five
  unexplained test failures. Copy the file to a unique path outside the
  worktree (`cp x.tsx "${TMPDIR:-$HOME/dev}/backup-x.$$.tsx"`), mutate, run,
  then copy back from that same path and check `git diff --stat` afterwards.
  The `$$` stops concurrent worktrees from overwriting each other's backup; if
  the session dies before the copy-back, restore from that path before any
  other run or commit.
- **`@testing-library/react-native` v14 `render` is async.** Always
  `await render(...)`. Un-awaited renders make Suspense/pending assertions
  flaky: the suite passes in isolation and fails when run with siblings.
- **`findBy*` defaults to a 1 s timeout — too short after a real navigator
  mount.** Suites that boot `setupIntegrationTest` + the real navigator fail
  intermittently in CI with `Unable to find an element` for a
  `tabBarButton<X>` testID, about 1 s after the assertion starts, and pass on
  rerun. Sibling
  tests already pass `{timeout: 15_000}` (`ObservationFields/index.test.tsx`);
  match that instead of raising global `asyncUtilTimeout`. A timeout raise does
  not weaken the assertion — the test still fails if the element never renders.
- **CI reruns overwrite a failed attempt's conclusion and its logs.** After
  `gh run rerun --failed`, `gh run view <run> --log-failed` comes back empty and
  the job list shows success. The original output stays downloadable per
  attempt: `gh api repos/<owner>/<repo>/actions/runs/<run>/attempts/<n>/logs`
  (attempts are 1-based) — unzip it and grep the assertion. Capture that before
  rerunning if the failure text matters for a bug report.
- **Rerunning a flaky job is a diagnosis, not a fix.** Two occurrences of the
  same assertion on `develop` (different SHAs) mean a real race, not
  infrastructure noise — file the issue with the attempt-log evidence.
- **Linked worktrees need the ignored runtime inputs.** `node_modules`,
  `translations/` and `.env` are not in git; a fresh worktree fails every Jest
  suite with `Cannot find module './translations/index' from jest.setup.js`.
  Symlink all three from the main clone before running anything, and remember
  `git stash -u` in such a worktree stashes those symlinks too — baseline
  runs then fail for the wrong reason.
- **`/tmp` is a small tmpfs here (~1.9 GB) and Jest's transform cache grows to
  > 1 GB.** A 10-run loop ends in `ENOSPC: no space left on device` from
  > `jest-transform-cache`, which surfaces as "Test suite failed to run" with 0
  > tests — not as a test failure. `rm -rf /tmp/jest_*` or pass
  > `--cacheDirectory` on real disk before long repro loops; check `df -h /tmp`
  > when a suite that passed minutes ago stops even transforming.
- **`check:message-catalog` regenerates the catalogs.** It runs the generator
  and compares the committed `messages/` byte for byte, so it fails when
  generation fails, when the generated output differs, or when an uncommitted
  change sits under `messages/`. `messages/en-US/*.json` is generated — never
  edit it by hand. The English text is the `defaultMessage` in the component's
  `defineMessages`, so fix the component, run `npm run extract-messages`,
  review and commit the expected change, then rerun the check. `pt-BR` is
  hand-maintained and is not regenerated. Uncommitted files outside
  `messages/` don't fail it by themselves.
- **Storybook decorators compose with the FIRST entry innermost.** A decorator
  that never renders `<Story/>` — `withRealNavigator` is one; it mounts
  `NavigationContainer` and returns no `<Story/>` — swallows every decorator
  listed **before** it, plus story-level ones; entries after it wrap it and
  still render. To wrap the navigator (locale, providers), the wrapper goes
  LAST: `decorators: [withRealNavigator, withPtBrLocale]`. A membership check
  (`toContain`) passes with the wrong order, so assert the exact list with
  `toEqual([...])`; the symptom of getting it wrong is a capture frame that
  mixes pt-BR and en-US because the emulator's locale wins.
- **BrowserStack e2e does not run on the normal PR CI.** The workflow triggers
  on PRs to `release/**`, on the scheduled cron (Sun–Wed, on `develop`), and on
  `workflow_dispatch` with a `branch` input. So changing user-facing English
  copy can leave `tests/e2e/specs/**` asserting the old string with a green
  PR: grep `tests/e2e` for the old text whenever a `defaultMessage` changes —
  that check is mandatory. Dispatching the workflow on the PR branch is only a
  fallback, and it needs the BrowserStack and Expo secrets; `rebrand-comapeo`
  records that this fork has not run e2e successfully, so do not treat the
  dispatch as a substitute for the grep.
- **`/tmp` is a ~1.9 GB tmpfs on this box.** APKs (85-190 MB each), jest
  caches and onnxruntime temp dirs fill it and cause `No space left on device`
  mid-run. Keep artifacts, harness logs and mutation backups under a writable
  directory with room — `/root/dev/` here, `$HOME/dev` elsewhere, never inside
  the worktree; `df -h /tmp` reports the tmpfs, not the root disk.
- **`gh api graphql` intermittently answers with HTML** (`502 Bad Gateway`,
  then `invalid character '<'`). Transient: sleep 5-20s and retry; it is not an
  auth or permission failure.
- **Resolve bot threads, do not just reply.** After fixing, call
  `addPullRequestReviewThreadReply` and then `resolveReviewThread`, and verify
  `unresolved == 0` via GraphQL. A reply alone leaves the PR blocked.
- **`develop` protection requires only `all` + `frontend`**, with no mandatory
  reviewer. `mergeStateStatus: CLEAN` with an empty `reviewDecision` is ready,
  not awaiting approval.
- **Verify post-merge CI on the merge commit itself.** A green PR proves the
  PR head; only the post-merge run proves the merge result. Doc-only PRs still
  run `all` and `frontend`.
- **Verify every documented behavior claim against source.** In the #138 doc
  PR, four claims copied from an implementation summary were false: editing
  still normalizes tags, and the observer section depends on the author
  resolving, not on tags. Read the component before writing what it does.

## Pitfalls

- `gh pr view --json merged` is not a field; use `state`, `mergedAt` and
  `mergeCommit`. The error lists every valid field.
- Em-dashes in unquoted heredocs produce `\\xE2` GraphQL parse errors — use `--body-file`.
- `&` in `gh` `--label` args causes shell backgrounding — quote carefully.
- A branch checked out in a worktree (historically `/tmp/pr172`) cannot be deleted; use the safe cleanup procedure above.
