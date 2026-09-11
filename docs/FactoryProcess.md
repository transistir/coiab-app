# Agent Factory Process: issue → SPEC → implementation → review → QA

The written process for work produced by the agent factory ("fábrica de
agentes") during the MVP: every stage, where evidence artifacts live, which
labels mark state, and the exact format in which agents hand off a delivery
for human approval. Human decision at the start (issue/SPEC) and at the end
(merge) — everything in between is agent-executable.

(transistir/coiab-app#16; merges the older scope of
transistir/comapeo-mobile-1#20 and transistir/comapeo-mobile-1#51.)

## 1. The flow

| # | Stage | Who | Artifact | Done when |
|---|-------|-----|----------|-----------|
| 1 | **Issue** — create/refine on the board (transistir/coiab-app, project 2) | Hermes (PM agent) + humans | Issue with objetivo, perguntas em aberto, evidência esperada | Refinement labels triage it: `product-decision`, `technical-discovery`, `ready-for-refinement` |
| 2 | **SPEC** — turn the refined issue into a testable spec | agent | `docs/specs/SPEC-<issue>-<slug>.md`, merged via docs PR | SPEC PR merged **by a human** — SPEC PRs follow the same never-merge rule as delivery PRs; the agent applies `spec-approved` only after observing that merge (issue was `spec-pending` meanwhile) |
| 3 | **Implementation** — one branch per issue (`type/slug`), conventional commits, issue-linked | agent | PR to `transistir/comapeo-mobile-1` `develop` | code complete, self-reviewed |
| 4 | **Review** — two reviewer families over the same diff | Codex (`@codex review` PR comment) + a second family (Opus subagent) | review comments / threads | both families report clean, **zero unresolved threads** |
| 5 | **CI** — all checks on the PR head | GitHub Actions | green runs | all checks green; UI changes additionally need the Storybook Flow Capture workflow green |
| 6 | **Evidence handoff** — post the evidence comment on the coiab-app issue in the template below | agent | one evidence comment per issue | comment posted; PR body links to it |
| 7 | **Human QA** — human reads evidence, merges or rejects | human | merge / rejection notes | entry: issue carries `ready-for-human-review` (applied at the end of stage 6). Exit: the human merges the PR or rejects with notes. **The factory never merges — delivery PRs and SPEC PRs alike.** After a successful merge the same human closes the coiab-app issue (the board is the source of truth — an open `ready-for-human-review` issue reads as still awaiting approval); if the issue is left open deliberately, remove the label so the board stops counting it as pending. |

Stage rules that are easy to get wrong:

- **PRs target `transistir/comapeo-mobile-1` `develop`.** coiab-app `develop`
  receives them through sync PRs; `digidem/*` is never written to
  (fetch/diff/read only). This is a deliberate sprint decision, not an
  oversight of the AGENTS.md remote table ("origin = the working repo"):
  code changes sit next to the upstream-sync base they will eventually ride
  (every implementation PR since #56 has targeted it), while the board side
  of the factory — issues, evidence comments, labels — stays on coiab-app.
  If the human owner wants code PRs on coiab-app instead, change this bullet
  and the stage-3 row together.
- **Workflow dispatches run in the repo that owns the branch.** `gh workflow
  run --ref <branch>` resolves the ref inside the `-R` repo, so a
  Storybook capture for an implementation PR head dispatches on
  comapeo-mobile-1, where the branch lives — a coiab-app dispatch cannot see
  it. coiab-app dispatches only make sense for branches that exist there
  (sync branches), and coiab-app additionally needs its `EXPO_TOKEN` secret
  set before its own captures pass Setup EAS.
- Review severity: **BUG/RISK fixed immediately; every NIT verified against
  the code before applying** — reviewer claims are hypotheses.
- Codex mechanics: `@codex review` comment on the PR; 👀 reaction = working,
  a "no major issues" reply = clean; **no reaction = silent no-op —
  re-prompt**. After every push, re-request both families.
- Blocked >2h on anything: post a precise blocker comment on the issue, apply
  the `blocked` label (labels are the board's source of truth — a parked item
  must not still read as active), park it, move on. On resume: remove
  `blocked` and restore the state label the item carried before parking.

## 2. Where artifacts live

| Artifact | Location | Lifetime |
|----------|----------|----------|
| Per-item source of truth | the coiab-app issue (labels = state) | permanent |
| SPEC | `docs/specs/SPEC-<issue>-<slug>.md` in this repo, merged via PR | permanent (in git) |
| Code delivery | PR on `transistir/comapeo-mobile-1` | permanent |
| **Evidence** | **one evidence comment on the coiab-app issue**, updated in place as the delivery progresses (not one comment per push). It is the comment whose body starts with the `## Handoff` heading — a later agent on the same issue edits that comment, never re-posts | permanent |
| Screenshots / short logs | pasted into the evidence comment; logs inside `<details>` blocks | permanent |
| CI runs / build artifacts | linked runs; APKs etc. as GitHub Actions artifacts | 30 days — fine for the MVP cycle |
| Per-delivery learnings | "Notes for next agent" section of the evidence comment | permanent |
| Cross-delivery learnings | appendix of this document, appended via PR | permanent |

Note on SPECs: committing them via docs PR is the rule from now on. This PR
also seeds `docs/specs/` with the one existing SPEC —
`SPEC-46-organizacao-camada-produto.md`, previously untracked at the repo
root — so the directory starts non-empty and #46's evidence links stay
resolvable.

## 3. Labels are the state machine

Existing board labels already cover triage (`product-decision`,
`technical-discovery`, `ready-for-refinement`, `design-pending`,
`design-approved`, `blocked`) and scheduling (sprint / critical-path labels —
never remove those). Three labels complete the flow:

| Label | Meaning | Applied when |
|-------|---------|--------------|
| `spec-pending` | SPEC being written or awaiting approval | SPEC work starts |
| `spec-approved` | **SPEC approved** — ready for implementation | SPEC PR merged (answer to "qual label significa SPEC aprovado?") |
| `ready-for-human-review` | delivery complete with evidence; waiting on the human OK | evidence comment posted, both review families clean, CI green, 0 unresolved threads |

State labels are replaced as the flow advances (`spec-pending` →
`spec-approved`; final state `ready-for-human-review`).

After a stage-7 rejection, the human removes `ready-for-human-review` and
re-applies `spec-approved` — or, for SPEC-n/a items (decision records and
docs), whatever pre-review state the item actually carried — so the delivery
reads as implemented but not accepted; the agent resumes at **stage 3**
(implementation and self-review — the table assigns rework there, not to
the reviewer families), then repeats stages 4–7 against the reworked head:
both reviewer families review the new diff, CI runs on it, and the evidence
comment is updated in place before the label is re-applied. A final
rejection — no rework wanted — closes
the issue with the rejection notes as the record; no further label
transition.

## 4. Handoff template

This is the format every agent delivery uses — same fields, same order, in
the evidence comment on the coiab-app issue (board language there is
Portuguese; keep field names in English for grep-ability):

```markdown
## Handoff — <issue title>

**PR:** <link> (head <sha>)
**SPEC:** <link, or "n/a"> — n/a only when the issue itself is the deliverable
(a decision record or doc with no implementation to follow); if an
implementation follows, a SPEC is required

### What changed
<one short paragraph>

### How verified
- CI: <run links> — all green
- Review: Codex <clean | link to review>, second family (Opus) <clean | link> —
  both families clean, 0 unresolved threads
- <UI changes only:> Storybook Flow Capture: <run link>, screenshots: <links>
- <direct artifact inspection: what the agent itself opened/ran, e.g. test
  output, screenshots opened, APK>

### Assumed decisions
<every product/technical default assumed when the issue left questions open —
each one is a decision the human reviewer is implicitly approving>

### Residual risks / known gaps
<honest list; "none" only if truly none>

### Notes for next agent
<learnings from this delivery the next agent will need>

### For human reviewer
- [ ] <the specific things to check before merging>
- [ ] ...
```

"Verified" means the agent inspected the artifact itself — green checks alone
prove nothing about artifact quality; screenshots opened, output read.

## 5. Worked example

The first real delivery through this template: coiab-app#46 (organization
layer spike) — SPEC-46 existed, the spike was implemented as integration
tests + verdict doc (PR transistir/comapeo-mobile-1#74), CI green, both
review families run, evidence comment posted on coiab-app#46 in exactly the
template above. See the evidence comment on coiab-app#46 for the filled-in
instance.

Grandfathering note: #46 predates the stage-2 gate defined here — its SPEC
was an untracked file until this PR committed it, and the issue never
carried `spec-pending`/`spec-approved`. Do not read that as the labels being
optional; every implementation issue from now on goes through stage 2.

## 6. Defaults assumed while writing this document

- This document is in English (repo convention); board comments continue in
  Portuguese.
- SPECs become committed repo files under `docs/specs/` (previously SPEC-46
  lived untracked at the repo root).
- Evidence = one updatable comment per issue; build binaries as Actions
  artifacts (30-day retention is acceptable for the MVP cycle).

## Appendix — cross-delivery learnings

Durable learnings that span deliveries, appended one entry per finding via
PR. (Empty until the first entry; a "Notes for next agent" section that
repeats across deliveries graduates here.)
