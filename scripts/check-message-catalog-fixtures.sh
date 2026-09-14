#!/usr/bin/env bash

# Fixture suite for scripts/check-message-catalog.sh. Every case builds a
# throwaway git repository and drives the check with a fake generator command
# (`CHECK_MESSAGE_CATALOG_GENERATOR`), so the real `npm run extract-messages` —
# slow, and dependent on the whole dependency tree — never runs. Seconds,
# offline, no node_modules.
#
# The cases mirror the incident this gate exists for (#72): the generator and
# the committed catalog diverging in either direction (a tracked file rewritten
# or deleted, or a new file appearing) must fail the check, as must the
# generator itself failing, while a generator that reproduces the committed
# bytes exactly must pass even though it rewrote the file.

set -euo pipefail
# Without this, a failing command inside `$(make_fixture_repo ...)` is masked by
# the function's final `printf`, and the case would run against a half-built
# repository.
shopt -s inherit_errexit

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
repo_root=$(cd -- "$script_dir/.." && pwd -P)
check_script="$repo_root/scripts/check-message-catalog.sh"

fixture_root=$(mktemp -d "${TMPDIR:-/tmp}/message-catalog-fixtures.XXXXXX")
cleanup() {
  local status=$?
  if (( status == 0 )); then
    rm -rf -- "$fixture_root"
  else
    echo "message-catalog fixtures: leaving fixture root for inspection: $fixture_root" >&2
  fi
}
trap cleanup EXIT

failure_output="$fixture_root/failure-output.txt"

# `expected_status` is either an exact exit status or the literal `nonzero`.
expect_failure() {
  local expected_status=$1
  local expected_message=$2
  shift 2
  local status
  set +e
  "$@" >"$failure_output" 2>&1
  status=$?
  set -e
  if [[ $expected_status == nonzero ]]; then
    if [[ $status -eq 0 ]]; then
      echo "expected a non-zero exit status, got 0" >&2
      sed -n '1,120p' "$failure_output" >&2
      exit 1
    fi
  elif [[ $status -ne $expected_status ]]; then
    echo "expected status $expected_status, got $status" >&2
    sed -n '1,120p' "$failure_output" >&2
    exit 1
  fi
  if ! grep -Fq -- "$expected_message" "$failure_output"; then
    echo "expected failure message not found: $expected_message" >&2
    sed -n '1,120p' "$failure_output" >&2
    exit 1
  fi
}

assert_output_contains() {
  local expected=$1
  if ! grep -Fq -- "$expected" "$failure_output"; then
    echo "expected output to contain: $expected" >&2
    sed -n '1,120p' "$failure_output" >&2
    exit 1
  fi
}

# Builds a fixture repository with a committed messages/ catalog. By default
# the catalog files carry no trailing newline, matching what
# scripts/extract-messages.mjs emits (`JSON.stringify(..., null, 2)`).
# A non-empty second argument commits messages/en-US/primary.json *with* a
# trailing newline instead: the hand-edited byte from commit 30c2b3b4 (case E).
make_fixture_repo() {
  local name=$1
  local primary_trailing_newline=${2:-}
  local dir="$fixture_root/$name"
  mkdir -p -- "$dir/messages/en-US"
  if [[ -n $primary_trailing_newline ]]; then
    printf '{\n  "a": "one"\n}\n' >"$dir/messages/en-US/primary.json"
  else
    printf '{\n  "a": "one"\n}' >"$dir/messages/en-US/primary.json"
  fi
  printf '{\n  "b": "two"\n}' >"$dir/messages/en-US/secondary.json"
  git -C "$dir" init -q
  git -C "$dir" config user.email fixture@example.com
  git -C "$dir" config user.name fixture
  git -C "$dir" config commit.gpgsign false
  git -C "$dir" add -A
  git -C "$dir" commit -qm 'fixture catalog'
  printf '%s\n' "$dir"
}

# Runs the check against a fixture repo with the given generator command. The
# check hands the generator to `bash -c`, so shell-quote it: fixture paths come
# from `mktemp` and may contain characters the shell would otherwise act on.
run_check() {
  local repo=$1
  local generator=$2
  CHECK_MESSAGE_CATALOG_ROOT=$repo \
    CHECK_MESSAGE_CATALOG_GENERATOR=$(printf '%q' "$generator") \
    "$check_script"
}

generator_dir="$fixture_root/generators"
mkdir -p -- "$generator_dir"

# Rewrites a tracked catalog file (case B).
cat >"$generator_dir/rewrite-tracked.sh" <<'GEN'
#!/usr/bin/env bash
printf '{\n  "a": "changed"\n}' > messages/en-US/primary.json
GEN

# Creates a new, untracked catalog file (case C).
cat >"$generator_dir/create-untracked.sh" <<'GEN'
#!/usr/bin/env bash
printf '{\n  "c": "three"\n}' > messages/en-US/extra.json
GEN

# Rewrites a tracked catalog file with byte-identical content (case D).
cat >"$generator_dir/rewrite-identical.sh" <<'GEN'
#!/usr/bin/env bash
printf '{\n  "a": "one"\n}' > messages/en-US/primary.json
GEN

# Rewrites a tracked catalog file without its committed trailing newline
# (case E): what scripts/extract-messages.mjs emits, byte for byte.
cat >"$generator_dir/strip-trailing-newline.sh" <<'GEN'
#!/usr/bin/env bash
printf '{\n  "a": "one"\n}' > messages/en-US/primary.json
GEN

# Deletes a tracked catalog file (case G).
cat >"$generator_dir/delete-tracked.sh" <<'GEN'
#!/usr/bin/env bash
rm messages/en-US/secondary.json
GEN

# Rewrites a tracked catalog file and stages the change (case H). Runs with the
# fixture repo as cwd, so `git add` targets the fixture's index.
cat >"$generator_dir/rewrite-tracked-staged.sh" <<'GEN'
#!/usr/bin/env bash
printf '{\n  "a": "changed"\n}' > messages/en-US/primary.json
git add messages/en-US/primary.json
GEN

chmod +x "$generator_dir/rewrite-tracked.sh" \
  "$generator_dir/create-untracked.sh" \
  "$generator_dir/rewrite-identical.sh" \
  "$generator_dir/strip-trailing-newline.sh" \
  "$generator_dir/delete-tracked.sh" \
  "$generator_dir/rewrite-tracked-staged.sh"

# --- case A: clean catalog, no-op generator ----------------------------------

clean_repo=$(make_fixture_repo clean)
run_check "$clean_repo" true >/dev/null

# --- case B: generator rewrites a tracked file -------------------------------

rewrite_repo=$(make_fixture_repo rewrite-tracked)
expect_failure 1 'diverges' run_check "$rewrite_repo" "$generator_dir/rewrite-tracked.sh"
assert_output_contains 'messages/en-US/primary.json'
assert_output_contains '+  "a": "changed"'

# --- case C: generator creates an untracked file -----------------------------

untracked_repo=$(make_fixture_repo create-untracked)
expect_failure 1 'diverges' run_check "$untracked_repo" "$generator_dir/create-untracked.sh"
assert_output_contains 'messages/en-US/extra.json'

# --- case D: generator rewrites a tracked file identically -------------------

# The regenerated bytes match the committed bytes, so the catalog has not
# diverged: the check must compare content, not merely notice that the
# generator ran or that the file's mtime moved.
identical_repo=$(make_fixture_repo rewrite-identical)
run_check "$identical_repo" "$generator_dir/rewrite-identical.sh" >/dev/null

# --- case E: generator drops a committed trailing newline --------------------

# The exact incident signature (#72, commit 30c2b3b4): primary.json was
# hand-edited to end with a trailing newline, which scripts/extract-messages.mjs
# does not emit. Committed and regenerated bytes are equal JSON and differ only
# at EOF, so the failure has to come from comparing bytes — the diff carries the
# "\ No newline at end of file" marker. A gate that compared JSON semantically
# would pass cases A-D and still miss the drift that aborted EAS.
newline_repo=$(make_fixture_repo trailing-newline newline)
expect_failure 1 'diverges' run_check "$newline_repo" "$generator_dir/strip-trailing-newline.sh"
assert_output_contains 'messages/en-US/primary.json'
assert_output_contains '\ No newline at end of file'

# --- case F: the generator itself fails --------------------------------------

# Pins the first failure path: a generator that exits non-zero must abort the
# check, not be treated as "no drift". Without this case a gate that swallowed
# the failure (for example by ignoring the command's exit status) would still
# pass every other case.
failed_repo=$(make_fixture_repo generator-fails)
expect_failure 1 'generator command failed' run_check "$failed_repo" false

# --- case G: generator deletes a tracked file --------------------------------

# The third direction of drift: the committed catalog has a file the generator
# does not write. Comparing file contents cannot see a deletion, so this case
# pins the path-existence half of the check.
deleted_repo=$(make_fixture_repo delete-tracked)
expect_failure 1 'diverges' run_check "$deleted_repo" "$generator_dir/delete-tracked.sh"
assert_output_contains 'messages/en-US/secondary.json'

# --- case H: generator stages the drift it introduces ------------------------

# The generator rewrites a tracked file and `git add`s it, so the drift lives in
# both the index and the worktree. Comparing the index to the worktree
# (`git diff --name-only` plus `git ls-files --others`) reports nothing here and
# the check would pass; only the porcelain status against HEAD sees it. This
# pins the comparison rather than leaving it to be inferred from cases B-G,
# none of which touch the index.
staged_repo=$(make_fixture_repo rewrite-tracked-staged)
expect_failure 1 'diverges' run_check "$staged_repo" "$generator_dir/rewrite-tracked-staged.sh"
assert_output_contains 'messages/en-US/primary.json'

echo 'check-message-catalog fixtures: PASS'
