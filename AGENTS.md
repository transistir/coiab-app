# AGENTS.md

## Remote safety — never write to digidem repos

This repo's `origin` remote points to `digidem/comapeo-mobile`, the upstream
project. **Never push, open/edit/close PRs or issues, comment, create
releases, trigger workflows, set secrets, or otherwise write to any
`digidem/*` repository on GitHub.** This applies to `origin` and to any
other `digidem/...` repo (e.g. `digidem/comapeo-cloud-app`), regardless of
what permissions the credentials in use happen to allow.

All work in this repo — pushes, branches, PRs — goes to the
**`transistir/comapeo-mobile-1`** fork only (remote name `transistir`).

Concretely:

- `git push` must target the `transistir` remote, never `origin`. This
  includes tags (`git push --tags`), deletes (`git push --delete`), and
  force pushes — any write verb, not just plain pushes.
- Any `gh` write operation must target `transistir/comapeo-mobile-1`, never
  `digidem/comapeo-mobile` — but the flag for doing so differs by
  subcommand, so use the form that command actually accepts:
  - `gh pr create/edit/close/merge`, `gh issue create/comment/close`,
    `gh release create`, `gh workflow run`, and `gh secret set` all accept
    `-R/--repo transistir/comapeo-mobile-1`.
  - `gh repo edit` takes the repository as a **positional** argument, not
    `--repo`: `gh repo edit transistir/comapeo-mobile-1 ...`.
  - `gh api` has **no `--repo`/`-R` flag at all**. Either use a
    fully-qualified endpoint path — `gh api
    repos/transistir/comapeo-mobile-1/...` — or set `GH_REPO=transistir/comapeo-mobile-1`
    for the call. This applies to any write method (`-X POST/PATCH/PUT/DELETE`,
    or `-f`/`-F` fields, which switch the request to `POST` by default).
    Don't rely on the endpoint's placeholder expansion (`{owner}`/`{repo}`)
    from the current directory — since `origin` still points at
    `digidem/comapeo-mobile`, that would resolve to the upstream repo.
  - `gh repo fork` is not applicable in this repo — `transistir` is already
    the fork, so there's nothing to fork.
- Before any push or `gh` write operation, double-check the target repo in
  the command itself — don't rely on defaults, since `gh` and bare `git push`
  both default to `origin`/the upstream-tracked repo unless told otherwise.
- Read-only operations against `digidem/comapeo-mobile` (fetching, diffing,
  checking CI, viewing issues/PRs for context) are fine. Only writes are
  off-limits. This also means CI workflows in this repo may freely consume
  `digidem/*` GitHub Actions (e.g. `digidem/npm-lockfile-version`) — using
  a published Action is a read, not a write.
- Merging any `origin/*` branch (e.g. `origin/main`, `origin/develop`) into
  a local branch or into `transistir`'s branches is fine and expected, to
  stay in sync with upstream — the restriction is about where things get
  *pushed*, not about reading or merging upstream content in.

If a task seems to require writing to a `digidem/*` repo, stop and ask
instead of doing it.

## Hardening the clone against accidental pushes

Because `origin` still points at `digidem/comapeo-mobile` and `main`/
`develop` track it, a bare `git push` on those branches would go straight
upstream. Run once per clone to make that fail loudly instead:

```sh
git remote set-url --push origin DISABLED_no_push
gh repo set-default transistir/comapeo-mobile-1
```
