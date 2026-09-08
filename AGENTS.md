# AGENTS.md

## Remote layout and safety

Three remotes, each with one job:

| Remote | Repo | Role |
|--------|------|------|
| `origin` | `transistir/coiab-app` | **The working repo.** All day-to-day pushes, PRs, issues, and workflow runs go here. |
| `transistir` | `transistir/comapeo-mobile-1` | The CoMapeo fork. Receives general CoMapeo work and is the first stop for upstream syncs. |
| `digidem` | `digidem/comapeo-mobile` | Upstream. **Never write to it** — fetch, diff, and read only. |

**Never push, open/edit/close PRs or issues, comment, create releases,
trigger workflows, set secrets, or otherwise write to any `digidem/*`
repository on GitHub** — regardless of what permissions the credentials in
use happen to allow. In this clone the `digidem` remote's push URL is set
to `no-push`, so any write attempt fails loudly. Read-only operations
(fetching, diffing, checking CI, viewing issues/PRs for context) are fine,
and CI workflows may freely consume `digidem/*` GitHub Actions (e.g.
`digidem/npm-lockfile-version`) — using a published Action is a read.

### Repo of record for COIAB work

All COIAB product implementation lives in **`transistir/coiab-app`** — create
branches, commit, and push here (or in a worktree of this repo's branch). The
`transistir/comapeo-mobile-1` fork exists for CoMapeo/upstream work only; it is
never the implementation home for COIAB features, even when a spike started
there. If work history left code only in the fork, mirror it into coiab-app
first, then continue from coiab-app and stop using the fork for that feature.

### Upstream sync order

When `digidem/comapeo-mobile` has new commits, they land in two steps, in
order:

1. **First `transistir/comapeo-mobile-1`** — merge `digidem/develop` into
   develop and push to the `transistir` remote (direct push is allowed
   there).
2. **Then `transistir/coiab-app`** — bring the merged develop over as a PR.
   Coiab's `develop` is protected: direct pushes are rejected and required
   checks (`all`, `frontend`) must pass before merge. (`backend` was a
   required check until 2026-09-02 — the upstream `@comapeo/core-react-native`
   migration deleted `src/backend` and its CI job, so that check could never
   report again and was removed from the protection rule.) Push a branch
   like `sync/digidem-upstream` to `origin` and open a PR against `develop`.

Merging `digidem/*` branches into local branches is always fine — the
restriction is about where things get *pushed*.

### Upstream-merge verification

An upstream merge that deletes scripts or dependencies breaks fork-owned
files **without any textual conflict**. Before pushing a merge of
`digidem/develop`:

1. Grep fork-owned workflows and `package.json` scripts for references to
   anything the merge removed. Real case: the migration deleted the
   `build:backend` script and `src/backend`; the fork-owned
   `storybook-capture.yml` still had a `Build backend` step — clean merge,
   30-minute CI run to discover it.
2. Run `npx tsc --noEmit` and `npm run lint` locally — they catch broken
   imports and dead references the merge left behind.
3. After the PR merges, watch `develop`'s own CI run to completion. A green
   PR proves the PR head was good; only the post-merge run proves the merge
   commit is good.

### PR continuity and CI evidence

When a local branch and the existing PR head have diverged, fetch the PR
branch from its actual head repository and merge it into the working branch.
Use a real merge to preserve ancestry and review continuity; cherry-picking
is not a substitute. Resolve conflicts in PR-owned files using the PR-branch
version as the baseline, then reconcile required integration changes and
review the resulting diff. Do not apply a blanket `ours`/`theirs` resolution.

After a push or merge, poll the exact commit's checks:

```sh
gh api repos/transistir/coiab-app/commits/<SHA>/check-runs \
  --jq '{total_count, checks: [.check_runs[] | {name, status, conclusion}]}'
```

A protected-branch push can remain pending with zero check-runs for minutes.
Zero checks means CI is unverified, not success or a test failure; inspect
workflow runs and triggers before concluding. Poll at
30-60 second intervals and record the SHA, elapsed time and run URLs.
`ci.yml` has no `workflow_dispatch`; it cannot be force-started that way.
If checks remain absent, report CI as unverified with the evidence; never
merge on an empty check set. Verify required `all` and `frontend` checks on
the current head and the post-merge commit separately.

### Coiab CI environment

CI on `transistir/coiab-app` needs repo-level values that are not in the
code. Already set: `MAPBOX_ACCESS_TOKEN` (secret), `COMAPEO_METRICS_URL`
(variable, `https://metrics.invalid` placeholder), `COMAPEO_METRICS_API_KEY`
(secret, placeholder — only truthiness-asserted). At initial setup, `EXPO_TOKEN`
(secret) was missing — the storybook-capture workflow's Setup EAS step fails
without it. Recheck secret/variable names before a run; this is a setup
snapshot, not a live inventory.
A fresh repo fork starts with zero secrets/vars; expect this class of gap
when wiring workflows that the fork already had configured
(`APP_VARIANT`, `RELEASE_BOT_*` are also uncopied).

### `gh` targeting rules

`gh` has no default repo set in this clone, so never rely on implicit
resolution — name the repo every time:

- `gh pr create/edit/close/merge`, `gh issue ...`, `gh release create`,
  `gh workflow run`, `gh secret set`, `gh run ...` accept
  `-R/--repo transistir/coiab-app` (or `transistir/comapeo-mobile-1` for
  fork-side work).
- `gh repo edit` takes the repository as a **positional** argument:
  `gh repo edit transistir/coiab-app ...`.
- `gh api` has **no `--repo`/`-R` flag**. Use a fully-qualified endpoint
  path (`gh api repos/transistir/coiab-app/...`) or set
  `GH_REPO=transistir/coiab-app`. This applies to any write method
  (`-X POST/PATCH/PUT/DELETE`, or `-f`/`-F` fields, which default to POST).
- Never point any of the above at `digidem/*`. If a task seems to require
  it, stop and ask instead.

### Hardening the clone

Already applied here; reapply on a fresh clone:

```sh
git remote set-url --push digidem no-push
gh repo set-default transistir/coiab-app
```

## Independent verification and regression evidence

Independent verification review is never optional before declaring a change
ready. Use a reviewer with fresh context, the exact diff/spec and relevant
source/tests; do not seed it with the implementer's conclusions. The same
model is valid: on 2026-09-05, a fresh-context `gpt-6-astra` review of its own
prior commit found a missed root cause and P2. Record the reviewed SHA,
findings and disposition; verify claims against source, fix actionable
findings, and have the changed result independently re-verified.

For navigation races, reproduce at navigator level: use the real navigator,
seeded navigation state and delayed query refresh. Capture a real RED failure
on the buggy source, then GREEN on the fix with the same test. Route pruning
can fall back to the original initial route; code reading ranked this only
as hypothesis H5/H1 until the regression test reproduced it. Screen-level
navigation mocks cannot prove that route reconciliation is correct.

## Storybook screenshot capture

Deterministic QA screenshots of user flows are generated by the Storybook
capture pipeline. Two skills cover it. They live in `.agents/skills/`, the
harness-neutral location, and each agent tool's own skills directory
symlinks to them — so `.claude/skills/comapeo-storybook-capture` is a link,
not a copy, and every harness reads one source of truth:

- [`.agents/skills/comapeo-storybook-capture/SKILL.md`](./.agents/skills/comapeo-storybook-capture/SKILL.md) — the golden
  path, disposable-emulator notes, CI build gotchas, and the offline checks
  that catch a bad manifest in seconds instead of 30-50 minutes into a CI
  run.
- [`.agents/skills/comapeo-storybook-capture-gate/SKILL.md`](./.agents/skills/comapeo-storybook-capture-gate/SKILL.md) — the
  pull-request procedure: run the capture workflow against the branch, review
  every frame, fix what that finds, and comment the verdict plus the artifact
  download link.

Read both before changing anything under `src/frontend/flows/`,
`.rnstorybook/`, or `scripts/storybook-*`.

One thing to carry into any review of captured frames: the pipeline's
readiness checks assert that markers are present in the Android view
hierarchy. They cannot see something covering the screen. A run has reported
38/38 frames captured successfully while a stuck soft keyboard hid roughly
45% of 20 consecutive frames, with every automated check green. A green run
means the pipeline worked, never that the screenshots are good — open them.
Repeated same-row readiness failures with correct diagnostic frames can be
infrastructure flakes; apply the capture gate's retry budget and evidence
requirements rather than retrying indefinitely.

Before sharing a GitHub Actions artifact link, verify
`GET /repos/transistir/coiab-app/actions/runs/<RUN>/artifacts` returns
`total_count >= 1`, select the expected unexpired artifact, and download it.
An upload-success log is insufficient: artifacts have disappeared and their
API requests returned 404. If absent, re-dispatch the producing build where
supported and authorized, then verify the replacement; never hand out the
missing artifact's link. Stop and report if the replacement is also absent.

## Consulting approved designs (Figma)

Approved MVP designs live in the Figma file "Kutary App V2":

```
https://www.figma.com/design/lfGdmeMSB7PoJGIvE0NtTM/Kutary-App---V2?node-id=2668-4449
```

The same URL is registered on coiab-app#53 and on every `design-pending`
issue. `node-id` scopes the link to one screen; drop it (or replace it) to
address a sibling screen in the same file.

Agents read that file through the `figma-pat` MCP server
(`figma-developer-mcp --stdio`, read-only, personal access token). Before
fetching anything, read
[`.agents/skills/figma-pat/SKILL.md`](./.agents/skills/figma-pat/SKILL.md) —
it covers URL parsing, why `nodeId` must always be passed (a full file
serializes to hundreds of KB), image/asset downloads, and render gotchas.
Prefer `figma-pat` for reads; the official Figma server (enabled via
`.claude/settings.json`) is only needed for current-editor selection, Code
Connect, or design generation.

Machine setup (per clone, not in the repo): `figma-developer-mcp` on PATH
(`npm i -g figma-developer-mcp`), `FIGMA_TOKEN` exported in the shell
(scopes: `file_content:read`), and the server registered as `figma-pat` in
`~/.claude.json` with `FIGMA_API_KEY: "${FIGMA_TOKEN}"`.

## Adding a skill

Skills live in `.agents/skills/<name>/SKILL.md`. That is the location Codex,
Cursor, OpenCode, Zed and Gemini CLI all read (Codex scans it from the
working directory up to the repo root). Claude Code reads only
`.claude/skills/`, so each skill is symlinked there — it follows symlinks and
loads the target, which is the same arrangement used at the user level. Add a
harness by symlinking its skills directory at `.agents/skills/`, never by
copying the file.

Keep frontmatter to the six fields the open Agent Skills spec defines:
`name`, `description`, `license`, `compatibility`, `metadata`,
`allowed-tools`. Only the first two are required. Claude Code accepts roughly
twenty additional fields, but a file using any of them is rejected outright
by the Skills API and by other tools — so a Claude-only field silently costs
portability. The skills here use `name` and `description` only.
