---
name: comapeo-merge-and-cleanup
description: Use when merging an approved comapeo PR and doing cleanup.
---

# comapeo PR merge + cleanup

## Merge-time traps

1. **Run `gh pr merge` from the repo root, never from a linked worktree** — the worktree checkout makes `gh` fail with `fatal: 'main' is already used by worktree`.
2. **Bring branch current before merging:** `git fetch origin main && git merge origin/main --no-edit`, re-run focused tests + tsc locally, push with `HUSKY=0 git push` (pre-push = full validate ~8-13 min; HUSKY=0 skips it — CI re-runs everything anyway).
3. **Push hook timeout:** plain foreground `git push` dies at the tool timeout mid-validate and can hang. Use background + `HUSKY=0`.
4. **CI after a merge-up push takes ~25-40 min.** Poll with `gh pr checks <n> | grep -vE 'pass|skipping'` (rc=1 → all green). Sleep ≤300s per call.
5. **Merge gate before merge:** verify `git diff <opus-cleared-sha> HEAD -- src tests` is empty for the PR's files; only merge-commit parents may differ. If real content changed, a new Opus confirming round is required.
6. **Post-merge verify:** `gh pr view <n> --json state,mergedAt,mergeCommit` shows MERGED + squash oid. Issue auto-closes via 'Closes #N' → stateReason COMPLETED.

## Local cleanup

`gh pr merge --delete-branch` fails locally when the branch is checked out in a worktree: `git worktree remove --force <path>` then `git branch -D <branch>` from the main clone, then `git pull origin main`.

## Squash-merge note

comapeo uses squash merges: the PR's commit chain (fixes, doc nits, merge-ups) collapses into one commit on main; branch commits exist only in the reflog.
