---
name: comapeo-spec-publication
description: Use when publishing a reviewed comapeo spec to GitHub.
---

# Comapeo Spec Publication Workflow

Canonical strategy (Opus 5 consult, 2026-08-29): **the spec file in `docs/superpowers/specs/` is the single source of truth; the GitHub issue is a workflow-state stub.** Never maintain two independently-edited prose copies.

## Scope and repository

Read `AGENTS.md`: COIAB specs and implementation belong in
`transistir/coiab-app`, based on `origin/develop`; the CoMapeo fork is not an
implementation home. Qualify every GitHub command with the intended repo and
never write to `digidem/*`. The #283 / PR #310 examples, `origin/main`, models,
labels and cloud-app timings below are historical provenance. Check the target
repo's actual labels, dependencies, hooks and scripts before applying them.

## Publication sequence (historically validated on #283 / PR #310)

1. **Independently review the spec with fresh context**: exact spec + relevant
   source, strategy questions and P1/P2/P3 + verdict block. This stage is never
   optional; model diversity is not required. A fresh-context `gpt-6-astra`
   review found a missed root cause and P2 in its own earlier commit. Keep
   implementation conclusions out of the initial review briefing.
2. **Verify reviewer code claims against source before applying fixes** — reviewers cite real file:line facts; check each (`sed -n`, grep). All claims on #283 were real; one flaw in an earlier draft (re-seeding progress `total` to bytes) was caught only because the reviewer read `DownloadPanel.tsx`.
3. **Apply all P1/P2 + cheap P3s to the spec file**, then re-review the new head (round 2 briefing: list each fix, quote edited regions, require `FINAL VERDICT:` line). Do not publish on "fixes applied" alone.
4. **Commit the spec and relevant skill changes as one PR** from a fresh
   branch off `origin/develop` for COIAB (`origin/main` was the historical
   cloud-app base). Inspect status first; do not stack accidentally on a stale
   worktree branch such as `pr-284`. When updating an existing diverged PR,
   fetch and merge its actual head instead of cherry-picking: preserve review
   continuity, keep PR-owned conflict versions as the baseline, and re-review
   the resolved content.
5. **Sync the issue body to a stub**: SHA-pinned spec link + tiebreak sentence ("where issue body and spec file disagree, the spec file at the linked SHA wins") + summary + acceptance-criteria checklist + review-evidence comment.
6. **Labels are a separate step AFTER spec-PR merge AND after every implementation-start-gate dependency merges.** While a dependency (e.g. #279) is unmerged: hold `lane:spec`, remove `agent:ready-for-spec`, post a comment naming the exact merge gate. Never apply `agent:ready-for-implementation` — agents read labels first; a prose gate in the body is not a gate.
7. After merge: repoint the issue permalink to `blob/<merge-SHA>/...`
   (historically replacing `blob/main/...`; COIAB uses `develop`). Verify the
   merge commit's CI as well as the PR head: poll check-runs per `AGENTS.md`.
   Zero checks can persist for minutes; `ci.yml` has no `workflow_dispatch`.

## Historical companion (`.agents/skills/issue-to-spec/SKILL.md`)

This companion is not present in coiab-app. The rules below describe its
historical sections; use the publication sequence above without assuming
that this file or its labels exists here.

- "Durable reviewed-spec checkpoint" section owns the canonical-file procedure (5 steps).
- Step 5 of the split section owns unmerged-dependency label hold.
- "Treat the first write-path permission/integration failure as a publication failure, not a transient success" sits in the label-contract section (the 403-integration lesson).

## Review-evidence conventions

Post ONE authorized comment on the issue naming reviewer/model, session id (if available), reviewed SHA, finding counts (e.g. "6 P1 + 5 P2 + 3 P3"), and one-line summaries of key fixes. This is what future agents use to distinguish the published reviewed body from drafts.

## Pitfalls

- **Historical Opus probe `--max-budget-usd 0.05` failed**: fixed cache overhead (~$0.22: 20k cache-creation + 8k cache-read tokens) exceeds the cap before a single token generates. This did not prove the model unreachable; the historical retry used `--max-budget-usd 0.50` or just send the real briefing.
- **`visual-regression` (Playwright screenshots) is the long pole** (~20 min) and the only check the CI concurrency group cancels when two runs race the same SHA. Before treating a red `visual-regression` as real: check the run's sibling run for the same headSha — if one is `cancelled` (job has no failed steps) and the other `success`, the check-settled signal is the surviving run. Verify per-job with `gh api repos/.../actions/runs/<id>/jobs --paginate`.
- **Two PR-CI runs race one SHA** when the PR is pushed twice in quick succession; `gh pr checks` then shows a phantom `pending`/`fail` from the cancelled run even though `gh run list` shows `success`. The surviving run's jobs are the verdict.
- **Historical cloud-app Husky pre-push runs full `npm run validate`** (~8-13 min incl. coverage + formatjs). Always push via `terminal(background=true, notify=true)`; foreground `timeout 120 git push` lies about failure (it times out mid-hook but the hook keeps running and the push may land).
- **`git status --short` before checkout**: preserve untracked dirs (e.g. `tests/unit/public`) in place using an isolated worktree, or stash explicitly scoped files when appropriate; checkout can carry them onto the wrong branch.
- **Fresh spec branch** — use `origin/develop` for COIAB. The historical
  `origin/main` + cherry-pick approach only isolates work before a PR exists;
  it does not apply to a diverged existing PR, which requires a real merge.
- COIAB has no `npm run validate` or `visual-regression` job. Use its actual
  scripts and required checks; the preceding CI timings are cloud-app lessons.
- If review evidence includes Actions artifacts, verify the run artifacts API
  returns `total_count >= 1`, select the expected unexpired artifact and
  download it before publishing links. Upload logs can outlive missing/404
  artifacts. Re-dispatch a supported, authorized build once if absent, then
  verify its replacement; escalate if evidence is still unavailable.

## Historical Opus invocation (validated in the originating environment)

```bash
# Round 1 — full briefing piped (spec text inline, code facts inlined for spot-checks)
claude -p "$(cat /tmp/opus-briefing.md)" --model opus --max-budget-usd 2.50 --output-format json \
  > /tmp/opus-response.json 2> /tmp/opus-err.txt
# Round 2+ — fresh-eyes re-verify, file-backed, skip permissions (needed for Read tool)
claude --model claude-opus-5 --dangerously-skip-permissions -p "$(cat /tmp/opus-review.md)" \
  > /tmp/opus-out.txt 2>&1
```

Use an available reviewer/tool under current permissions; these historical
model names and CLI flags are not prerequisites or permission to bypass
current controls. A fresh review must not resume the implementer's context.

Briefing must include: exact reviewed artifact, evaluation focus, and a strict output contract (P1/P2/P3 counts + `VERDICT:` line, or `<blockers>`/`<pre_merge_fixes>`/`<post_merge_issues>` + `FINAL VERDICT:` for PR reviews). Cost observed: $0.83 (8 turns) for strategy consult + spec review; ~$3 for fresh-eyes re-verify rounds.
