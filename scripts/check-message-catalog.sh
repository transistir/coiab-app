#!/usr/bin/env bash

# Why this check exists (#72): the committed messages/ catalog must always equal
# what `npm run extract-messages` produces. Commit 30c2b3b4 hand-edited
# messages/en-US/primary.json and added a trailing newline the generator does
# not emit; .github/workflows/build-apk.yml and storybook-capture.yml regenerate
# the catalog immediately before `eas build --local`, so the regenerated file
# differed from the committed one, the working tree went dirty, and EAS aborted
# with "This operation needs to be run on a clean working tree" — no APK, no
# capture. ci.yml never regenerated the catalog, so CI stayed green for 6 rounds
# of PR #62 while EAS could not build. This gate regenerates the catalog and
# fails loudly on any drift: tracked files rewritten (staged or not), tracked
# files deleted, or new files appearing.
#
# Environment (fixtures rely on these; both default to the real thing). The
# names are namespaced because this is a required gate: a generic, easily
# inherited name such as GENERATOR_CMD=true must not be able to turn it off.
#   CHECK_MESSAGE_CATALOG_ROOT       repository to check
#                                    (default: this script's repository)
#   CHECK_MESSAGE_CATALOG_GENERATOR  generator to run, via `bash -c`
#                                    (default: `npm run extract-messages`)

set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
repo_root=${CHECK_MESSAGE_CATALOG_ROOT:-$(cd -- "$script_dir/.." && pwd -P)}
generator_cmd=${CHECK_MESSAGE_CATALOG_GENERATOR:-npm run extract-messages}

cd -- "$repo_root"

if ! bash -c "$generator_cmd"; then
  echo "check-message-catalog: generator command failed: $generator_cmd" >&2
  exit 1
fi

# The generator must leave messages/ byte-identical to the committed catalog.
# A single `git status --porcelain` is the comparison because it reports every
# kind of drift at once — staged edits, unstaged edits, deletions, and
# untracked files — where an index-vs-worktree `git diff` plus
# `git ls-files --others` pair silently missed staged changes. Dirt that is
# already under messages/ before this run and is not something the generator
# overwrites (a staged edit, an untracked file, a deleted file it does not
# write) fails too; that is intended, because the catalog a build consumes must
# equal the committed one.
status_output=$(git status --porcelain --untracked-files=all -- messages/)

if [[ -z $status_output ]]; then
  echo "check-message-catalog: messages/ matches the output of: $generator_cmd" >&2
  exit 0
fi

{
  echo "check-message-catalog: FAIL - messages/ diverges from the output of: $generator_cmd"
  echo "Regenerate it ('$generator_cmd') and commit the result; never hand-edit messages/."
  echo
  echo "Paths under messages/ that differ from the committed catalog:"
  while IFS= read -r entry; do
    printf '  %s\n' "${entry:3}"
  done <<<"$status_output"
  echo
  # HEAD, not the index: for the staged drift this check exists to catch, an
  # index-vs-worktree diff prints an empty body while the header above names
  # the paths, which reads as "no changes".
  git --no-pager diff HEAD -- messages/
} >&2

exit 1
