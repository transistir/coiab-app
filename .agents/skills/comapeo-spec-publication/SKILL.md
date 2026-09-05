---
name: comapeo-spec-publication
description: Use when publishing a reviewed comapeo spec to GitHub.
---

# Comapeo Spec Publication Workflow

Canonical strategy (Opus 5 consult, 2026-08-29): **the spec file in `docs/superpowers/specs/` is the single source of truth; the GitHub issue is a workflow-state stub.** Never maintain two independently-edited prose copies.

## Publication sequence (validated on #283 / PR #310)

1. **Review the spec** (Opus 5 piped briefing: strategy questions + full spec text, ask for P1/P2/P3 + verdict block).
2. **Verify reviewer code claims against source before applying fixes** — reviewers cite real file:line facts; check each (`sed -n`, grep). All claims on #283 were real; one flaw in an earlier draft (re-seeding progress `total` to bytes) was caught only because the reviewer read `DownloadPanel.tsx`.
3. **Apply all P1/P2 + cheap P3s to the spec file**, then re-review the new head (round 2 briefing: list each fix, quote edited regions, require `FINAL VERDICT:` line). Do not publish on "fixes applied" alone.
4. **Commit the spec + skill changes as one PR** from a fresh branch off `origin/main` (NOT the current local branch — it may be a stale worktree branch like `pr-284`).
5. **Sync the issue body to a stub**: SHA-pinned spec link + tiebreak sentence ("where issue body and spec file disagree, the spec file at the linked SHA wins") + summary + acceptance-criteria checklist + review-evidence comment.
6. **Labels are a separate step AFTER spec-PR merge AND after every implementation-start-gate dependency merges.** While a dependency (e.g. #279) is unmerged: hold `lane:spec`, remove `agent:ready-for-spec`, post a comment naming the exact merge gate. Never apply `agent:ready-for-implementation` — agents read labels first; a prose gate in the body is not a gate.
7. After merge: repoint the issue permalink from `blob/main/...` to `blob/<merge-SHA>/...`.

## Skill text (`.agents/skills/issue-to-spec/SKILL.md`)

- "Durable reviewed-spec checkpoint" section owns the canonical-file procedure (5 steps).
- Step 5 of the split section owns unmerged-dependency label hold.
- "Treat the first write-path permission/integration failure as a publication failure, not a transient success" sits in the label-contract section (the 403-integration lesson).

## Review-evidence conventions

Post ONE comment on the issue naming reviewer/model, session id, finding counts (e.g. "6 P1 + 5 P2 + 3 P3"), and one-line summaries of key fixes. This is what future agents use to distinguish the published reviewed body from drafts.

## Pitfalls

- **Opus probe `--max-budget-usd 0.05` always fails**: fixed cache overhead (~$0.22: 20k cache-creation + 8k cache-read tokens) exceeds the cap before a single token generates. The model IS reachable; re-probe with `--max-budget-usd 0.50` or just send the real briefing.
- **`visual-regression` (Playwright screenshots) is the long pole** (~20 min) and the only check the CI concurrency group cancels when two runs race the same SHA. Before treating a red `visual-regression` as real: check the run's sibling run for the same headSha — if one is `cancelled` (job has no failed steps) and the other `success`, the check-settled signal is the surviving run. Verify per-job with `gh api repos/.../actions/runs/<id>/jobs --paginate`.
- **Two PR-CI runs race one SHA** when the PR is pushed twice in quick succession; `gh pr checks` then shows a phantom `pending`/`fail` from the cancelled run even though `gh run list` shows `success`. The surviving run's jobs are the verdict.
- **Husky pre-push runs full `npm run validate`** (~8-13 min incl. coverage + formatjs). Always push via `terminal(background=true, notify=true)`; foreground `timeout 120 git push` lies about failure (it times out mid-hook but the hook keeps running and the push may land).
- **`git status --short` before checkout**: stash untracked dirs (e.g. `tests/unit/public`) or the checkout may carry them onto the wrong branch.
- **Fresh spec branch off `origin/main`, then cherry-pick the commit** — avoids stacking on whatever stale branch the shared worktree had checked out.

## Opus invocation (validated)

```bash
# Round 1 — full briefing piped (spec text inline, code facts inlined for spot-checks)
claude -p "$(cat /tmp/opus-briefing.md)" --model opus --max-budget-usd 2.50 --output-format json \
  > /tmp/opus-response.json 2> /tmp/opus-err.txt
# Round 2+ — fresh-eyes re-verify, file-backed, skip permissions (needed for Read tool)
claude --model claude-opus-5 --dangerously-skip-permissions -p "$(cat /tmp/opus-review.md)" \
  > /tmp/opus-out.txt 2>&1
```

Briefing must include: exact reviewed artifact, evaluation focus, and a strict output contract (P1/P2/P3 counts + `VERDICT:` line, or `<blockers>`/`<pre_merge_fixes>`/`<post_merge_issues>` + `FINAL VERDICT:` for PR reviews). Cost observed: $0.83 (8 turns) for strategy consult + spec review; ~$3 for fresh-eyes re-verify rounds.