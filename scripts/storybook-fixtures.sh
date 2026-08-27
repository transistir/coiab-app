#!/usr/bin/env bash

# Fixture suite for the Storybook capture pipeline. Every target is exercised
# against fake `adb`/`sleep`/capture binaries on $PATH, so the whole suite runs
# on any machine in seconds with no emulator, no device and no network.
#
# Covers three targets:
#   1. scripts/storybook-capture.sh      — per-story device control flow
#   2. scripts/storybook-capture-all.sh  — manifest validation and the loop
#   3. scripts/storybook-report.mjs      — HTML report generation

set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
repo_root=$(cd -- "$script_dir/.." && pwd -P)
capture="$repo_root/scripts/storybook-capture.sh"
capture_all="$repo_root/scripts/storybook-capture-all.sh"
report_script="$repo_root/scripts/storybook-report.mjs"

fixture_root=$(mktemp -d "${TMPDIR:-/tmp}/storybook-fixtures.XXXXXX")
cleanup() {
  local status=$?
  if (( status == 0 )); then
    rm -rf -- "$fixture_root"
  else
    echo "storybook fixtures: leaving fixture root for inspection: $fixture_root" >&2
  fi
}
trap cleanup EXIT

# Shared by all three targets. `expected_status` is either an exact exit status
# or the literal `nonzero` when the target does not promise a specific one.
expect_failure() {
  local expected_status=$1
  local expected_message=$2
  shift 2
  local output_file="$fixture_root/failure-output.txt"
  local status
  set +e
  "$@" >"$output_file" 2>&1
  status=$?
  set -e
  if [[ $expected_status == nonzero ]]; then
    if [[ $status -eq 0 ]]; then
      echo "expected a non-zero exit status, got 0" >&2
      sed -n '1,120p' "$output_file" >&2
      exit 1
    fi
  elif [[ $status -ne $expected_status ]]; then
    echo "expected status $expected_status, got $status" >&2
    sed -n '1,120p' "$output_file" >&2
    exit 1
  fi
  if ! grep -Fq -- "$expected_message" "$output_file"; then
    echo "expected failure message not found: $expected_message" >&2
    sed -n '1,120p' "$output_file" >&2
    exit 1
  fi
}

###############################################################################
# scripts/storybook-capture.sh
###############################################################################

capture_root="$fixture_root/capture"
capture_bin="$capture_root/bin"
capture_out="$capture_root/frames"
capture_calls="$capture_root/adb-calls.txt"
capture_ime_counter="$capture_root/ime-count"
capture_dump_counter="$capture_root/dump-count"
capture_anr_state="$capture_root/anr-state"
mkdir -p -- "$capture_bin" "$capture_out"

# Fake `adb`. Records every invocation to $FAKE_ADB_CALLS so ordering
# invariants can be asserted, and drives readiness/keyboard state from the
# FAKE_* environment rather than from a device.
cat >"$capture_bin/adb" <<'FAKE_ADB'
#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' "$*" >>"$FAKE_ADB_CALLS"

if [[ ${1:-} == wait-for-device ]]; then exit 0; fi

if [[ ${1:-} == logcat && ${2:-} == -c ]]; then exit 0; fi

if [[ ${1:-} == logcat && ${2:-} == -d && ${4:-} == raw ]]; then
  story_id=$FAKE_STORY_ID
  if [[ -n ${FAKE_ADB_BAD_IDENTITY:-} ]]; then story_id=wrong-story; fi
  printf 'STORYBOOK: Linking event received, navigating to story: %s\n' "$story_id"
  exit 0
fi

if [[ ${1:-} == logcat && ${2:-} == -d && ${4:-} == time ]]; then
  printf 'fake logcat diagnostics\n'
  exit 0
fi

if [[ ${1:-} == shell && ${2:-} == am && ${3:-} == start ]]; then
  printf 'Starting: Intent { cmp=com.comapeo.dev/.MainActivity }\n'
  exit 0
fi

if [[ ${1:-} == exec-out && ${2:-} == uiautomator && ${3:-} == dump ]]; then
  dump_count=$(<"$FAKE_DUMP_COUNTER")
  dump_count=$((dump_count + 1))
  printf '%s\n' "$dump_count" >"$FAKE_DUMP_COUNTER"

  if [[ -n ${FAKE_ADB_UNREADABLE_DUMP:-} ]]; then
    exit 0
  fi
  if [[ -n ${FAKE_ADB_NOT_READY:-} ]]; then
    printf '<hierarchy />\n'
    exit 0
  fi

  story_marker="STORYBOOK.flow-ready.$FAKE_STORY_ID"
  printf '<hierarchy><node resource-id="%s" />' "$story_marker"
  if [[ -n ${FAKE_READY_ROUTE:-} ]]; then
    ready_route=$FAKE_READY_ROUTE
    if [[ -n ${FAKE_ADB_ROUTE_CHANGES_AT:-} ]] && (( dump_count >= FAKE_ADB_ROUTE_CHANGES_AT )); then
      ready_route=WrongRoute
    fi
    printf '<node resource-id="%s.%s" />' "$story_marker" "$ready_route"
  fi
  if [[ -n ${FAKE_READY_TEST_ID:-} ]]; then
    ready_test_id=$FAKE_READY_TEST_ID
    if [[ -n ${FAKE_ADB_BAD_TEST_ID:-} ]]; then ready_test_id=wrong.test-id; fi
    printf '<node resource-id="%s" />' "$ready_test_id"
  fi
  # An ANR dialog on top of the ready screen (#67): included from the start
  # with FAKE_ANR_DIALOG=1, or from dump N with FAKE_ANR_DIALOG_FROM=N, until
  # the script taps its "Wait" button (which flips FAKE_ANR_STATE), unless
  # FAKE_ANR_DIALOG_STUCK=1 makes it survive every dismissal.
  if [[ -n ${FAKE_ANR_DIALOG:-} ||
    ( -n ${FAKE_ANR_DIALOG_FROM:-} && dump_count -ge ${FAKE_ANR_DIALOG_FROM} ) ]] &&
    [[ $(<"$FAKE_ANR_STATE") != dismissed ]]; then
    printf '<node resource-id="android:id/aerr_wait" bounds="[100,100][300,160]" />'
  fi
  printf '</hierarchy>\n'
  exit 0
fi

if [[ ${1:-} == shell && ${2:-} == dumpsys && ${3:-} == input_method ]]; then
  if [[ -n ${FAKE_IME_DUMPSYS_FAILS:-} ]]; then
    echo 'fake adb: dumpsys input_method is unavailable' >&2
    exit 1
  fi
  ime_count=$(<"$FAKE_IME_COUNTER")
  ime_count=$((ime_count + 1))
  printf '%s\n' "$ime_count" >"$FAKE_IME_COUNTER"
  shown=false
  for shown_at in ${FAKE_IME_SHOWN_AT:-}; do
    if (( shown_at == ime_count )); then shown=true; fi
  done
  if [[ -n ${FAKE_IME_SHOWN_FROM:-} ]] && (( ime_count >= FAKE_IME_SHOWN_FROM )); then
    shown=true
  fi
  printf '  mInputShown=%s\n' "$shown"
  exit 0
fi

if [[ ${1:-} == shell && ${2:-} == input ]]; then
  # Tapping the fake ANR dialog's "Wait" button dismisses it, unless the
  # fixture pins it as stuck.
  if [[ ${3:-} == tap && -z ${FAKE_ANR_DIALOG_STUCK:-} ]]; then
    printf 'dismissed\n' >"$FAKE_ANR_STATE"
  fi
  exit 0
fi

if [[ ${1:-} == shell && ${2:-} == screencap ]]; then exit 0; fi

if [[ ${1:-} == exec-out && ${2:-} == screencap ]]; then
  printf 'fake-failure-screenshot\n'
  exit 0
fi

if [[ ${1:-} == pull ]]; then
  # storybook-capture.sh rejects anything under 1024 bytes as a bad pull.
  head -c 2048 /dev/zero | tr '\0' 'P' >"$3"
  exit 0
fi

echo "unexpected fake adb invocation: $*" >&2
exit 2
FAKE_ADB

# Fake `sleep`. Records the requested duration in the same ledger as the adb
# calls, then really sleeps, so "the settle delay happens *here* in the
# sequence" is assertable without changing the script's real timing.
cat >"$capture_bin/sleep" <<'FAKE_SLEEP'
#!/usr/bin/env bash
set -euo pipefail
printf 'sleep %s\n' "$1" >>"$FAKE_ADB_CALLS"
command -p sleep "$@"
FAKE_SLEEP

chmod +x "$capture_bin/adb" "$capture_bin/sleep"

capture_story_id=flows-onboarding--intro
capture_frame=

run_capture() {
  local frame_name=$1
  shift
  capture_frame="$capture_out/$frame_name.png"
  rm -f -- "$capture_out/$frame_name."*
  : >"$capture_calls"
  printf '0\n' >"$capture_ime_counter"
  printf '0\n' >"$capture_dump_counter"
  printf 'none\n' >"$capture_anr_state"
  (
    cd -- "$capture_root"
    env \
      PATH="$capture_bin:$PATH" \
      FAKE_ADB_CALLS="$capture_calls" \
      FAKE_IME_COUNTER="$capture_ime_counter" \
      FAKE_DUMP_COUNTER="$capture_dump_counter" \
      FAKE_ANR_STATE="$capture_anr_state" \
      FAKE_STORY_ID="$capture_story_id" \
      FAKE_READY_ROUTE=IntroToCoMapeo \
      STORYBOOK_READY_TARGET=route:IntroToCoMapeo \
      STORYBOOK_READY_TIMEOUT=1 \
      STORYBOOK_SETTLE_DELAY=1.5 \
      "$@" \
      "$capture" "$capture_story_id" "$capture_frame"
  )
}

# The device-facing steps whose order is the invariant, with the volatile
# `mktemp` path in the `pull` line trimmed off.
capture_timeline() {
  grep -E '^(shell dumpsys input_method|shell input keyevent |shell screencap |exec-out uiautomator dump|sleep )' \
    "$capture_calls" | sed 's#^shell screencap -p .*#shell screencap -p#'
}

assert_timeline() {
  local expected=$1
  local actual
  actual=$(capture_timeline)
  if [[ $actual != "$expected" ]]; then
    echo 'unexpected capture call sequence' >&2
    diff <(printf '%s\n' "$expected") <(printf '%s\n' "$actual") >&2 || true
    exit 1
  fi
}

assert_call_count() {
  local pattern=$1
  local expected=$2
  local actual
  actual=$(grep -cFx -- "$pattern" "$capture_calls" || true)
  if [[ $actual -ne $expected ]]; then
    echo "expected $expected '$pattern' call(s), got $actual" >&2
    cat "$capture_calls" >&2
    exit 1
  fi
}

assert_frame_written() {
  if [[ ! -s $capture_frame ]]; then
    echo "expected a captured frame at $capture_frame" >&2
    exit 1
  fi
}

assert_no_frame_written() {
  if [[ -e $capture_frame ]]; then
    echo "a frame was written despite the capture failing: $capture_frame" >&2
    exit 1
  fi
}

assert_diagnostics_written() {
  local prefix="${capture_frame%.png}"
  local suffix
  for suffix in failure-logcat.txt failure-hierarchy.xml failure-screen.png; do
    if [[ ! -e "$prefix.$suffix" ]]; then
      echo "expected failure diagnostics at $prefix.$suffix" >&2
      exit 1
    fi
  done
}

# --- readiness ---------------------------------------------------------------

# A clean run. The expected sequence below is the whole point of this case: the
# settle delay sits *after* the first keyboard check, and the keyboard is
# re-checked after the delay, after the readiness probe, and after `screencap`.
run_capture ready-happy-path >/dev/null 2>&1
assert_frame_written
assert_timeline 'exec-out uiautomator dump /dev/tty
shell dumpsys input_method
sleep 1.5
shell dumpsys input_method
exec-out uiautomator dump /dev/tty
shell dumpsys input_method
shell screencap -p
exec-out uiautomator dump /dev/tty
shell dumpsys input_method'
assert_call_count 'shell input keyevent 111' 0

# Readiness markers never appear: time out rather than shoot a wrong screen.
expect_failure 1 'timed out waiting for current native route: IntroToCoMapeo' \
  run_capture ready-never FAKE_ADB_NOT_READY=1
assert_no_frame_written
assert_diagnostics_written
assert_call_count 'shell screencap -p /sdcard/storybook-capture.png' 0

# The story marker is present but the requested testID is not.
expect_failure 1 'timed out waiting for native testID: MAIN.map-screen' \
  run_capture ready-wrong-test-id \
  STORYBOOK_READY_TARGET=testID:MAIN.map-screen \
  FAKE_READY_TEST_ID=MAIN.map-screen \
  FAKE_ADB_BAD_TEST_ID=1
assert_no_frame_written

# The story marker never becomes readable at all.
expect_failure 1 'timed out waiting for story selection' \
  run_capture ready-wrong-identity FAKE_ADB_BAD_IDENTITY=1
assert_no_frame_written

# The route changes between the readiness wait and the screenshot. Nothing
# else in the pipeline re-checks this, so the frame must never be taken.
expect_failure 1 'current native readiness check failed immediately before screenshot' \
  run_capture ready-route-changed-before FAKE_ADB_ROUTE_CHANGES_AT=2
assert_no_frame_written
assert_call_count 'shell screencap -p /sdcard/storybook-capture.png' 0

# The route changes after the screenshot: the frame was taken but is not
# trustworthy, so it must not be published.
expect_failure 1 'current native readiness check failed immediately after screenshot' \
  run_capture ready-route-changed-after FAKE_ADB_ROUTE_CHANGES_AT=3
assert_no_frame_written
assert_call_count 'shell screencap -p /sdcard/storybook-capture.png' 1

# --- soft keyboard occlusion -------------------------------------------------

# An IME raised *during* the settle delay is invisible to the readiness
# markers. It must be dismissed and the delay re-run, not shot through.
run_capture ime-during-settle FAKE_IME_SHOWN_AT='2 3' >/dev/null 2>&1
assert_frame_written
assert_timeline 'exec-out uiautomator dump /dev/tty
shell dumpsys input_method
sleep 1.5
shell dumpsys input_method
shell dumpsys input_method
shell input keyevent 111
shell dumpsys input_method
sleep 1.5
shell dumpsys input_method
exec-out uiautomator dump /dev/tty
shell dumpsys input_method
shell screencap -p
exec-out uiautomator dump /dev/tty
shell dumpsys input_method'
# KEYCODE_ESCAPE (111), never KEYCODE_BACK (4): BACK would pop the navigation
# stack on the majority of rows, where no keyboard is showing at all.
assert_call_count 'shell input keyevent 111' 1
assert_call_count 'shell input keyevent 4' 0

# An IME raised *during* the readiness probe, whose `uiautomator dump` retry
# can run for ~30s. Checking only before the probe would miss it.
run_capture ime-during-readiness FAKE_IME_SHOWN_AT=3 >/dev/null 2>&1
assert_frame_written
assert_timeline 'exec-out uiautomator dump /dev/tty
shell dumpsys input_method
sleep 1.5
shell dumpsys input_method
exec-out uiautomator dump /dev/tty
shell dumpsys input_method
shell dumpsys input_method
sleep 1.5
shell dumpsys input_method
exec-out uiautomator dump /dev/tty
shell dumpsys input_method
shell screencap -p
exec-out uiautomator dump /dev/tty
shell dumpsys input_method'

# An IME that appears around `screencap` itself. The frame is already taken, so
# there is nothing to retry: fail rather than publish an occluded frame.
expect_failure 1 'because a soft keyboard appeared around the screenshot' \
  run_capture ime-after-screencap FAKE_IME_SHOWN_AT=4
assert_no_frame_written
assert_diagnostics_written
assert_call_count 'shell screencap -p /sdcard/storybook-capture.png' 1

# A keyboard that survives KEYCODE_ESCAPE fails the capture, with the same
# diagnostics any other capture failure writes.
expect_failure 1 'because a soft keyboard would occlude the screenshot' \
  run_capture ime-stuck FAKE_IME_SHOWN_FROM=1 STORYBOOK_SETTLE_DELAY=0
assert_no_frame_written
assert_diagnostics_written
assert_call_count 'shell screencap -p /sdcard/storybook-capture.png' 0
assert_call_count 'shell input keyevent 4' 0

# A keyboard that is dismissed but comes straight back gives up after exactly
# three settle passes — 8 keyboard checks and 2 dismissals, not a hot loop.
expect_failure 1 'because the soft keyboard kept reappearing during the settle delay or readiness probe' \
  run_capture ime-reappears FAKE_IME_SHOWN_AT='2 3 5 6 8' STORYBOOK_SETTLE_DELAY=0
assert_no_frame_written
assert_call_count 'shell dumpsys input_method' 8
assert_call_count 'shell input keyevent 111' 2
assert_call_count 'shell screencap -p /sdcard/storybook-capture.png' 0

# A `dumpsys input_method` that fails outright must read as "no keyboard".
# Treating a dump failure as an occlusion would fail every capture on any
# device where that command is unavailable.
run_capture ime-dumpsys-unavailable FAKE_IME_DUMPSYS_FAILS=1 >/dev/null 2>&1
assert_frame_written
assert_call_count 'shell input keyevent 111' 0

# --- ANR dialog occlusion (#67) ----------------------------------------------

# An ANR dialog on top of an otherwise-ready screen during the readiness wait:
# the probe dump contains both the markers and `aerr_wait`, so pre-#67 code
# declared the screen ready and shot through the dialog. Now: the probe must
# refuse, dismiss, re-probe clean, and only then capture. The 0.5s poll sleeps
# between probes make an exact timeline brittle here, so assert the tap, the
# dump count and the frame instead.
run_capture anr-during-wait FAKE_ANR_DIALOG=1 STORYBOOK_READY_TIMEOUT=8 >/dev/null 2>&1
assert_frame_written
assert_call_count 'shell input tap 200 130' 1
assert_call_count 'exec-out uiautomator dump /dev/tty' 4
assert_call_count 'shell screencap -p /sdcard/storybook-capture.png' 1

# The dialog appears only at settle time (dump 2 is the 'immediately before
# screenshot' check): markers+dialog must not pass, one dismissal happens, and
# the re-dump clean returns success. Exact ordering assertable: the dismiss
# pause sits between the two dumps of the assert's retry loop.
run_capture anr-at-settle FAKE_ANR_DIALOG_FROM=2 >/dev/null 2>&1
assert_frame_written
assert_timeline 'exec-out uiautomator dump /dev/tty
shell dumpsys input_method
sleep 1.5
shell dumpsys input_method
exec-out uiautomator dump /dev/tty
sleep 1
exec-out uiautomator dump /dev/tty
shell dumpsys input_method
shell screencap -p
exec-out uiautomator dump /dev/tty
shell dumpsys input_method'
assert_call_count 'shell input tap 200 130' 1

# A dialog that survives dismissal: exactly three taps, then the capture fails
# as a stuck keyboard. The sixth dump is write_capture_failure_diagnostics
# re-reading the hierarchy for the failure artifact.
expect_failure 1 'kept occluding the screen immediately before screenshot' \
  run_capture anr-stuck FAKE_ANR_DIALOG_FROM=2 FAKE_ANR_DIALOG_STUCK=1
assert_no_frame_written
assert_diagnostics_written
assert_call_count 'shell input tap 200 130' 3
assert_call_count 'shell screencap -p /sdcard/storybook-capture.png' 0

echo 'storybook-capture fixtures: PASS'

###############################################################################
# scripts/storybook-capture-all.sh
###############################################################################

capture_all_root="$fixture_root/capture-all"
capture_all_bin="$capture_all_root/bin"
mkdir -p -- "$capture_all_bin"

# Stands in for scripts/storybook-capture.sh, which has its own fixtures above.
# Records the arguments and environment it was handed so the orchestrator's
# per-row wiring can be asserted without a device.
fake_capture="$capture_all_bin/fake-capture"
cat >"$fake_capture" <<'FAKE_CAPTURE'
#!/usr/bin/env bash
set -euo pipefail
story_id=$1
output_path=$2
printf "%s\t%s\t%s\t%s\n" "$story_id" "$STORYBOOK_SETTLE_DELAY" "$STORYBOOK_READY_TARGET" "$output_path" >>"$FAKE_CAPTURE_CALLS"
if [[ ${FAKE_CAPTURE_FAIL_ID:-} == "$story_id" ]]; then exit 23; fi
printf "fake-png:%s\n" "$story_id" >"$output_path"
printf "%s\t%s\n" "$story_id" "$STORYBOOK_READY_TARGET" >"$FAKE_ADB_STORY_FILE"
FAKE_CAPTURE

fake_adb="$capture_all_bin/adb"
cat >"$fake_adb" <<'FAKE_ADB_ALL'
#!/usr/bin/env bash
set -euo pipefail
if [[ ${1:-} == wait-for-device ]]; then exit 0; fi
if [[ ${1:-} == shell && ${2:-} == am && ${3:-} == force-stop ]]; then
  : >"$FAKE_ADB_STORY_FILE"
  exit 0
fi
if [[ ${1:-} == shell && ${2:-} == am && ${3:-} == start ]]; then
  printf "__startup__\n" >"$FAKE_ADB_STORY_FILE"
  printf "Starting: Intent { cmp=com.comapeo.dev/.MainActivity }\n"
  exit 0
fi
if [[ ${1:-} == logcat && ${2:-} == -c ]]; then
  : >"$FAKE_ADB_STORY_FILE"
  exit 0
fi
if [[ ${1:-} == logcat && ${2:-} == -G ]]; then exit 0; fi
if [[ ${1:-} == shell && ${2:-} == pm && ${3:-} == grant ]]; then exit 0; fi
if [[ ${1:-} == logcat && ${2:-} == -d ]]; then
  IFS=$'\t' read -r story_id ready_target <"$FAKE_ADB_STORY_FILE" || true
  if [[ $story_id == __startup__ ]]; then
    printf 'Running "main" with {"rootTag":1}\n'
    exit 0
  fi
  if [[ -n ${FAKE_ADB_BAD_IDENTITY:-} ]]; then story_id=wrong-story; fi
  printf "STORYBOOK: Linking event received, navigating to story: %s\n" "$story_id"
  exit 0
fi
echo "unexpected fake adb invocation: $*" >&2
exit 2
FAKE_ADB_ALL
chmod +x "$fake_capture" "$fake_adb"

calls_file="$capture_all_root/calls.tsv"
story_file="$capture_all_root/current-story"
: >"$calls_file"
: >"$story_file"

run_capture_all() {
  local manifest=$1
  local output=$2
  shift 2
  (
    cd -- "$capture_all_root"
    env \
      PATH="$capture_all_bin:$PATH" \
      STORYBOOK_CAPTURE_MANIFEST="$manifest" \
      STORYBOOK_CAPTURE_COMMAND="$fake_capture" \
      FAKE_CAPTURE_CALLS="$calls_file" \
      FAKE_ADB_STORY_FILE="$story_file" \
      "$@" \
      "$capture_all" "$output"
  )
}

manifest="$capture_all_root/comments-and-blanks.tsv"
printf '# fixture manifest\n\n   # space-indented comment\n\t# tab-indented comment\nonboarding\tflows-onboarding--intro\troute:IntroToCoMapeo\t0\t01 Intro\n\nother-flow\tflows-onboarding--success\troute:Success\t1.5\t05 Success\n' >"$manifest"
output_with_spaces="$capture_all_root/output with spaces"
run_capture_all "$manifest" "$output_with_spaces" >/dev/null
[[ -s "$output_with_spaces/onboarding/001-flows-onboarding--intro.png" ]]
[[ -s "$output_with_spaces/other-flow/002-flows-onboarding--success.png" ]]
expected_ledger="$capture_all_root/expected-ledger.tsv"
printf 'position\tflow\tstory_id\tlabel\trelative_png_path\tbyte_size\n001\tonboarding\tflows-onboarding--intro\t01 Intro\tonboarding/001-flows-onboarding--intro.png\t33\n002\tother-flow\tflows-onboarding--success\t05 Success\tother-flow/002-flows-onboarding--success.png\t35\n' >"$expected_ledger"
cmp "$expected_ledger" "$output_with_spaces/captures.tsv"
grep -Fq 'force_stop_status=passed' "$output_with_spaces/cold-start-provenance.txt"
grep -Fq 'log_clear_status=passed' "$output_with_spaces/cold-start-provenance.txt"
grep -Fq 'launcher_status=passed' "$output_with_spaces/cold-start-provenance.txt"
grep -Fq 'running_main_status=passed' "$output_with_spaces/cold-start-provenance.txt"
grep -Fq 'Running "main"' "$output_with_spaces/cold-start-provenance.txt"
grep -Fq 'permission_grants_failed=0' "$output_with_spaces/cold-start-provenance.txt"
grep -Fq $'flows-onboarding--intro\t0\t' "$calls_file"
grep -Fq $'flows-onboarding--success\t1.5\t' "$calls_file"

: >"$calls_file"
default_manifest_output="$capture_all_root/default manifest output"
default_manifest_row_count=$(awk '
  /^[[:space:]]*$/ || /^[[:space:]]*#/ { next }
  { count += 1 }
  END { print count + 0 }
' "$repo_root/.rnstorybook/capture-manifest.tsv")
(
  cd -- "$capture_all_root"
  unset STORYBOOK_CAPTURE_MANIFEST
  PATH="$capture_all_bin:$PATH" \
    STORYBOOK_CAPTURE_COMMAND="$fake_capture" \
    FAKE_CAPTURE_CALLS="$calls_file" \
    FAKE_ADB_STORY_FILE="$story_file" \
    "$capture_all" "$default_manifest_output" >/dev/null
)
[[ $(wc -l <"$default_manifest_output/captures.tsv") -eq $((default_manifest_row_count + 1)) ]]
[[ $(wc -l <"$calls_file") -eq $default_manifest_row_count ]]

: >"$calls_file"
malformed_manifest="$capture_all_root/malformed.tsv"
printf 'onboarding\tflows-onboarding--intro\troute:IntroToCoMapeo\t2\n' >"$malformed_manifest"
expect_failure 1 'must contain exactly five tab-separated columns' \
  run_capture_all "$malformed_manifest" "$capture_all_root/malformed-output"
[[ ! -s $calls_file ]]

duplicate_manifest="$capture_all_root/duplicate.tsv"
printf 'onboarding\tflows-onboarding--intro\troute:IntroToCoMapeo\t2\tIntro\nonboarding\tflows-onboarding--intro\troute:IntroToCoMapeo\t2\tIntro again\n' >"$duplicate_manifest"
expect_failure 1 'repeats story id: flows-onboarding--intro' \
  run_capture_all "$duplicate_manifest" "$capture_all_root/duplicate-output"
[[ ! -s $calls_file ]]

invalid_target_manifest="$capture_all_root/invalid-target.tsv"
printf 'onboarding\tflows-onboarding--intro\tnot-a-target\t2\tIntro\n' >"$invalid_target_manifest"
expect_failure 1 'has an invalid readiness target: not-a-target' \
  run_capture_all "$invalid_target_manifest" "$capture_all_root/invalid-target-output"
[[ ! -s $calls_file ]]

invalid_delay_manifest="$capture_all_root/invalid-delay.tsv"
printf 'onboarding\tflows-onboarding--intro\troute:IntroToCoMapeo\t-1\tIntro\n' >"$invalid_delay_manifest"
expect_failure 1 'has an invalid settle delay: -1' \
  run_capture_all "$invalid_delay_manifest" "$capture_all_root/invalid-delay-output"
[[ ! -s $calls_file ]]

missing_story_manifest="$capture_all_root/missing-story.tsv"
printf 'onboarding\tnot-in-source-index--missing\troute:IntroToCoMapeo\t2\tMissing\n' >"$missing_story_manifest"
expect_failure 1 'manifest stories missing from source index: not-in-source-index--missing' \
  run_capture_all "$missing_story_manifest" "$capture_all_root/missing-story-output"
[[ ! -s $calls_file ]]

failure_manifest="$capture_all_root/capture-failure.tsv"
printf 'onboarding\tflows-onboarding--intro\troute:IntroToCoMapeo\t0\tIntro\nonboarding\tflows-onboarding--success\troute:Success\t0\tSuccess\n' >"$failure_manifest"
failure_output="$capture_all_root/capture-failure-output"
expect_failure 23 'capture failed at position 2 for story: flows-onboarding--success' \
  run_capture_all "$failure_manifest" "$failure_output" \
    FAKE_CAPTURE_FAIL_ID=flows-onboarding--success
[[ $(wc -l <"$calls_file") -eq 2 ]]
[[ $(wc -l <"$failure_output/captures.tsv") -eq 2 ]]
if grep -Fq $'002\tonboarding\tflows-onboarding--success' "$failure_output/captures.tsv"; then
  echo 'failed capture was written to the ledger' >&2
  exit 1
fi

: >"$calls_file"
identity_output="$capture_all_root/identity-failure-output"
expect_failure 1 'runtime identity check failed at position 1 for story: flows-onboarding--intro' \
  run_capture_all "$failure_manifest" "$identity_output" FAKE_ADB_BAD_IDENTITY=1
[[ $(wc -l <"$calls_file") -eq 1 ]]
[[ $(wc -l <"$identity_output/captures.tsv") -eq 1 ]]
[[ -s "$identity_output/onboarding/001-flows-onboarding--intro.failure-reactnative-logcat.txt" ]]

: >"$calls_file"
test_id_manifest="$capture_all_root/test-id.tsv"
printf 'create-observation\tflows-createobservation--home\ttestID:MAIN.map-screen\t0\tHome\n' >"$test_id_manifest"
test_id_output="$capture_all_root/test-id-output"
run_capture_all "$test_id_manifest" "$test_id_output" >/dev/null
[[ $(wc -l <"$test_id_output/captures.tsv") -eq 2 ]]
grep -Fq $'flows-createobservation--home\t0\ttestID:MAIN.map-screen\t' "$calls_file"

: >"$calls_file"
nonempty_output="$capture_all_root/nonempty-output"
mkdir -p -- "$nonempty_output"
printf 'keep\n' >"$nonempty_output/existing.txt"
expect_failure 1 'output directory is not empty' \
  run_capture_all "$failure_manifest" "$nonempty_output"
[[ -f "$nonempty_output/existing.txt" ]]
[[ ! -s $calls_file ]]

echo 'storybook-capture-all fixtures: PASS'

###############################################################################
# scripts/storybook-report.mjs
###############################################################################

report_root="$fixture_root/report"
mkdir -p -- "$report_root/outside"

make_capture_output() {
  local output=$1
  mkdir -p -- "$output/flow"
  printf 'PNG' >"$output/flow/001-story.png"
  printf 'position\tflow\tstory_id\tlabel\trelative_png_path\tbyte_size\n001\tflow\tstory\tStory\tflow/001-story.png\t3\n' >"$output/captures.tsv"
}

flow_escape="$report_root/flow-escape"
printf 'keep-flow\n' >"$report_root/outside/marker"
mkdir -p -- "$flow_escape" "$flow_escape/target"
printf 'PNG' >"$flow_escape/target/001-story.png"
printf 'position\tflow\tstory_id\tlabel\trelative_png_path\tbyte_size\n001\tflow\tstory\tStory\tflow/001-story.png\t3\n' >"$flow_escape/captures.tsv"
ln -s -- "$flow_escape/target" "$flow_escape/flow"
expect_failure nonzero 'flow report directory is a symlink' node "$report_script" "$flow_escape"
[[ $(<"$report_root/outside/marker") == 'keep-flow' ]]
[[ ! -e "$report_root/outside/index.html" ]]

file_escape="$report_root/file-escape"
make_capture_output "$file_escape"
printf 'do-not-overwrite\n' >"$report_root/outside/sentinel"
ln -s -- "$report_root/outside/sentinel" "$file_escape/flow/index.html"
expect_failure nonzero 'flow report file is a symlink' node "$report_script" "$file_escape"
[[ $(<"$report_root/outside/sentinel") == 'do-not-overwrite' ]]

echo 'storybook-report fixtures: PASS'
