---
name: comapeo-merge-and-cleanup
description: Use when merging an approved comapeo PR and doing cleanup.
---

# comapeo PR merge + cleanup

Read `AGENTS.md` first. COIAB implementation, PRs and cleanup belong only in
`transistir/coiab-app`, based on `develop`; never write to `digidem/*`.
Historical cloud-app procedures used `main` and a full `npm run validate`
pre-push hook (~8-13 min). Neither is the COIAB workflow; inspect current
`package.json` and hooks, preserve hooks and use a persistent tool session
for long operations rather than bypassing them with `HUSKY=0`.

## Merge-time traps

1. Run `gh pr merge <PR> -R transistir/coiab-app` from the main clone. A linked
   worktree can make local checkout/cleanup fail with
   `fatal: 'main' is already used by worktree`. Inspect worktree occupancy.
2. Fetch and merge the actual PR head if it diverged from the local branch;
   cherry-picking loses ancestry and review continuity. Keep the PR-branch
   version as the baseline for PR-owned conflicts, then reconcile integration
   changes. Bring the branch current with `origin/develop` using a real merge,
   rerun focused tests and `npx tsc --noEmit`, then push when authorized.
3. A foreground push timeout does not prove failure: a hook/push may still be
   running. Check the terminal process and remote SHA before retrying. The
   historical merge-up CI cost was ~25-40 min; poll actual status.
4. Poll exact-head check-runs per `AGENTS.md` before declaring checks green.
   A protected-branch push may leave zero check-runs and a pending state for
   minutes. `ci.yml` has no `workflow_dispatch`. An empty set is unverified;
   require successful `all` and `frontend` on the current PR head.
5. Independent fresh-context verification review is never optional. The same
   model may review; a fresh `gpt-6-astra` pass found a root cause and P2 in its
   own prior commit. Compare `git diff <reviewed-sha> HEAD -- <PR-owned-paths>`
   and inspect integration changes too. Changed content requires independent
   re-verification; record reviewed SHA and resolved findings.
6. After an authorized squash merge, verify
   `gh pr view <PR> -R transistir/coiab-app --json state,mergedAt,mergeCommit`.
   Check that `Closes #N` closed the intended issue with stateReason COMPLETED,
   then watch `develop` CI on the merge SHA to completion. PR CI alone does
   not verify the merged result.

## Local cleanup

`gh pr merge --delete-branch` can fail locally when the branch is checked out
in a worktree. Verify the remote PR merged before retrying anything. Inspect
`git worktree list` and each affected worktree's status; preserve local work.
For clean disposable worktrees, use `git worktree remove <path>` from the main
clone, then remove the authorized obsolete branch. Squash merges may require
`git branch -D <branch>` after verifying all intended content landed. Update a
clean local `develop` with `git pull --ff-only origin develop`; investigate
divergence instead of forcing it. Never force-remove a dirty worktree.

## Squash-merge note

Squash merges collapse the PR's fixes, doc nits and merge-ups into one commit
on `develop` (`main` in the historical cloud app). Original commits may remain
reachable through PR refs or reflogs, but those are not durable review
artifacts; retain the reviewed SHA and evidence on the PR.
