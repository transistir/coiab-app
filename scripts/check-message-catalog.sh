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
# fails loudly on any drift: tracked files rewritten, or new files appearing.
#
# Environment (fixtures rely on these; both default to the real thing):
#   CATALOG_REPO_ROOT  repository to check (default: this script's repository)
#   GENERATOR_CMD      generator to run, via `bash -c`
#                      (default: `npm run extract-messages`)

set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
repo_root=${CATALOG_REPO_ROOT:-$(cd -- "$script_dir/.." && pwd -P)}
generator_cmd=${GENERATOR_CMD:-npm run extract-messages}

cd -- "$repo_root"

if ! bash -c "$generator_cmd"; then
  echo "check-message-catalog: generator command failed: $generator_cmd" >&2
  exit 1
fi

# Compare against the index rather than HEAD: on CI the checkout is clean, so
# index and HEAD agree, and the generator only writes to the working tree.
tracked_changes=$(git diff --name-only -- messages/)
untracked_changes=$(git ls-files --others --exclude-standard -- messages/)

if [[ -z $tracked_changes && -z $untracked_changes ]]; then
  echo "check-message-catalog: messages/ matches the output of: $generator_cmd" >&2
  exit 0
fi

{
  echo "check-message-catalog: FAIL - messages/ diverges from the output of: $generator_cmd"
  echo "Regenerate it ('$generator_cmd') and commit the result; never hand-edit messages/."
  if [[ -n $tracked_changes ]]; then
    echo
    echo "Tracked files changed by the generator:"
    while IFS= read -r path; do
      printf '  %s\n' "$path"
    done <<<"$tracked_changes"
    echo
    git diff -- messages/
  fi
  if [[ -n $untracked_changes ]]; then
    echo
    echo "New untracked files under messages/:"
    while IFS= read -r path; do
      printf '  %s\n' "$path"
    done <<<"$untracked_changes"
  fi
} >&2

exit 1
