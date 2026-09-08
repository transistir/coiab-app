---
name: comapeo-storybook-capture
description: Generate and verify CoMapeo React Native Storybook flow screenshots with deterministic readiness and durable acceptance evidence.
---

# CoMapeo Storybook capture

Use this skill when regenerating the Storybook bundle, launching the
Android app, or collecting the documented user-flow screenshots.

**Screenshots mandatory when the PR touches `src/frontend/flows/`,
`.rnstorybook/`, or UI components; explicitly N/A with reason otherwise.**

Read `AGENTS.md` first. COIAB implementation and capture runs belong only in
`transistir/coiab-app`; the CoMapeo fork is for general CoMapeo/upstream work.

## Golden path

1. Generate the Storybook index:

   ```sh
   EXPO_PUBLIC_STORYBOOK_ENABLED=true npm run storybook-generate
   ```

   Treat a non-zero exit as a generation failure; do not claim capture
   evidence from a stale generated index.

2. Launch the native Storybook app on an available Android device or emulator:

   ```sh
   npm run storybook:android
   ```

3. Capture into a new, empty directory. The wrapper performs its own
   force-stop, log clear, launcher start, `Running "main"` check, and native
   readiness checks:

   ```sh
   STORYBOOK_PACKAGE_ID=org.coiab.dev \
     scripts/storybook-capture-all.sh /tmp/storybook-captures-<run>
   node scripts/storybook-report.mjs /tmp/storybook-captures-<run>
   ```

   Use the installed package: local development is `org.coiab.dev`; CI's
   Storybook profile uses `org.coiab.rc`. The wrapper's historical default,
   `com.comapeo.dev`, does not match COIAB, so set the override explicitly.

4. A usable run contains one PNG per manifest row — never a fixed number, the
   manifest is the source of truth and grows — plus `captures.tsv`, the flow
   reports and `cold-start-provenance.txt`. Historical acceptance also included
   a leaf-recovery PNG; the current wrapper does not generate that extra PNG:

   ```sh
   awk 'END {print NR-1}' /tmp/storybook-captures-<run>/captures.tsv
   wc -l < .rnstorybook/capture-manifest.tsv   # must match
   ```

   Compare ledger identity/order fields across independent cold runs before
   accepting the result. Inspect onboarding PNGs to ensure they show named
   screens rather than `FlowStatePlaceholder`.

## Disposable local environment

- If the Android emulator reports a pending snapshot and exits, a disposable
  development AVD may need a one-time reset before capture (for example,
  `emulator @Medium_Phone_API_35 -wipe-data -no-snapshot -no-boot-anim`).
- If Expo/Gradle cannot write the host caches, retry with writable temporary
  caches rather than changing repository files:

  ```sh
  GRADLE_USER_HOME=/tmp/storybook-gradle \
    __UNSAFE_EXPO_HOME_DIRECTORY=/tmp/storybook-expo-home \
    EXPO_PUBLIC_STORYBOOK_ENABLED=true npm run storybook:android
  ```

- A capture that stops at a current native readiness check is partial, even
  when earlier PNGs exist. Preserve that directory and record the first
  failing story; do not report it as a complete generation. A generation is
  complete only when every manifest row has a matching ledger entry and PNG,
  and all gates pass. Count ledger rows excluding the header; auxiliary
  recovery/failure PNGs must not inflate the coverage count.

## Known failure handling

- If Expo reports that `Medium_Phone_API_35` quit before opening, record the
  exact emulator command it prints in `TODO.md`. In a verification-only task,
  stop there and do not repair or restart the emulator.
- If the native run fails, keep its output directory for diagnosis but do not
  call it an accepted run. Report the first failing gate and whether any PNGs
  were produced.
- Do not treat a Storybook linking identity or historical route log alone as
  proof that the screenshot shows the target. The wrapper's current native
  marker/UI readiness checks must pass immediately around each screenshot.

## CI preflight — repo secrets and variables

`storybook-capture.yml` is `workflow_dispatch` only and its first real step,
`Setup EAS`, consumes `secrets.EXPO_TOKEN`. Without that secret the run dies
there, minutes in, having built nothing. Check before dispatching:

```sh
gh secret list -R transistir/coiab-app     # EXPO_TOKEN must appear
gh variable list -R transistir/coiab-app   # EAS_PROJECT_URL must appear
```

Initial setup had `EAS_PROJECT_URL` set and `EXPO_TOKEN` missing. Recheck the
live inventory; successful later runs may mean provisioning has changed.
An agent cannot mint an Expo account token. When it is missing, give the user the
exact command:

```sh
gh secret set EXPO_TOKEN -R transistir/coiab-app --body '<expo-access-token>'
# token from https://expo.dev/accounts/joarez/settings/access-tokens
```

Do not work around it by disabling the EAS step; the capture needs the APK that
step's toolchain builds. A fresh fork starts with zero secrets — `APP_VARIANT`
and `RELEASE_BOT_*` are missing for the same reason.

## The capture APK is not an artifact

The workflow builds a standalone Storybook APK on the runner
(`eas build --platform android --profile storybook --local --non-interactive`,
located into `$APK_PATH`) and installs it on the emulator, but the only thing it
uploads is `storybook-captures/`. There is no APK download link from this
workflow.

The GitHub-Actions paths that do produce an installable APK, and what each needs:

| Path | Trigger | Produces | Initial setup gap (recheck) |
|---|---|---|---|
| `build-rc.yml` | opening a PR whose base matches `release/**`, or `/build-rc` on such a PR via `build-bot.yml` | EAS **cloud** build, `release-candidate` profile → `.apk`, link commented on the PR | `EXPO_TOKEN`, `RELEASE_BOT_APP_ID` (var), `RELEASE_BOT_PRIVATE_KEY` (secret) |
| `build-release.yml` | merging a PR into `release/**` | production build + GitHub Release | same |
| `e2e-appium-browserstack.yml` | PR / `workflow_dispatch` | `test`-profile APK uploaded **to BrowserStack**, not as an artifact | BrowserStack credentials |

`build-rc.yml` has no `workflow_dispatch`, and it uploads no GitHub artifact —
it comments the EAS build page on the PR. Get the download URL with
`eas build:view <BUILD_ID> --json | jq -r '.artifacts.buildUrl'`.

So a testing APK for a `develop`-targeted feature PR means opening a second PR
from the same branch into a `release/**` branch and letting `build-rc.yml` run,
once those three values exist. That second PR needs explicit human consent —
see `comapeo-storybook-capture-gate` §7. Installable profiles in `eas.json` are
`release-candidate` (`org.coiab.rc`), `development` and `test`; `production`
builds an AAB, not an APK. Report the gap rather than inventing a path around
it — and never add or edit a workflow to route around a missing secret without
asking.

## CI build gotchas (`.github/workflows/storybook-capture.yml`, `ci.yml`)

Hard-won from getting the GitHub Actions capture run green. Check these first
before re-debugging from scratch:

- `ci.yml`'s frontend job must generate the Storybook index
  (`EXPO_PUBLIC_STORYBOOK_ENABLED=true npm run storybook-generate`) before
  `tsc --noEmit`, or a fresh checkout fails type-checking because
  `.rnstorybook/index.tsx` imports the gitignored `./storybook.requires`.
- `eas.json` is plain JSON — no `//` comments allowed, `JSON.parse` will
  reject them.
- The default release Gradle build plus `lintVitalRelease` running in
  parallel stalls the Kotlin/Gradle daemon on constrained CI runners (memory
  contention, presents as a hang, not an OOM crash). Fix: override
  `gradleCommand` to something like
  `:app:assembleRelease -x lintVitalRelease --no-parallel`.
- Expo config plugins that restrict native ABIs to ARM-only (e.g.
  `targetArmArchsOnly.js`) break installs on the x86_64 CI emulator.
  Env-gate them off when `EXPO_PUBLIC_STORYBOOK_ENABLED=true`.
- Under emulator resource pressure, Android's own "isn't responding" ANR
  system dialog (e.g. for Pixel Launcher, unrelated to the app under test)
  can cover the screen and block every readiness check indefinitely. Detect
  `resource-id="android:id/aerr_wait"` in the UI hierarchy dump and tap it
  (Wait) instead of treating it as a real failure — see
  `dismiss_anr_dialog_if_present` in `scripts/storybook-capture.sh`.
- Bash `set -euo pipefail`: a bare `cond && fn` statement (not inside `if`)
  still triggers errexit when `fn` returns non-zero — it does not behave as
  a silent no-op-on-false guard the way it looks. Verified:
  `bash -c 'set -euo pipefail; f(){ return 1; }; [[ -n "x" ]] && f; echo
  survived'` prints nothing and exits 1. Wrap in
  `if cond; then fn || true; fi` instead.
- On a capture timeout, write failure diagnostics (logcat, UI hierarchy
  dump, screenshot) next to the expected output before exiting 1 — otherwise
  the uploaded CI artifact gives no clue why it failed. The same applies to
  the runtime identity check in `storybook-capture-all.sh`: it used to fail
  with nothing retained, which cost two full CI cycles to diagnose.
- The `STORYBOOK: Linking event received` line the identity check looks for
  has to survive in logcat's ring buffer for the whole capture, because that
  check re-reads logcat *after* the capture command exits. A chatty interval
  evicts it, and an evicted line is indistinguishable from the app never
  having received the deep link — the run fails while the frame it produced
  is perfectly correct. The buffer is enlarged once per session
  (`adb logcat -G 16M`) to prevent this.
- Storybook switches stories through a deep link and never dismisses the
  IME, so a keyboard raised by one story (an autofocused `TextInput`) stays
  up and covers the bottom of every later frame. `storybook-capture.sh`
  now checks `dumpsys input_method` for `mInputShown` and hides it with
  KEYCODE_ESCAPE — not KEYCODE_BACK, which would pop the navigation stack
  on the majority of rows where no keyboard is showing.

## Verify before burning a CI run

A full capture run costs roughly 30-50 minutes (a local EAS build plus one
emulator interaction per manifest row; 12 rows ran in ~29 min, 38 rows fits
inside a 90-minute job). The story-index check below and the manifest-shape check in the gate skill run
in seconds and catch
the mistakes that otherwise fail the run at row 1:

```sh
# Every manifest story id must resolve against the source story index —
# the same check the capture wrapper runs before it touches a device.
node -e "const {buildIndex}=require('@storybook/react-native/node');const fs=require('fs');const ids=fs.readFileSync('.rnstorybook/capture-manifest.tsv','utf8').trim().split('\n').map(l=>l.split('\t')[1]);buildIndex({configPath:'.rnstorybook'}).then(i=>{const m=ids.filter(id=>!(id in i.entries));console.log(m.length?'MISSING: '+m.join(', '):'ALL '+ids.length+' IDS PRESENT');if(m.length)process.exitCode=1})"
```

A runtime story id is the kebab-cased meta `title` path plus `--` plus the
kebab-cased **export name**; a `name:` override does not change it. Also
confirm every route name used in an `initialState` is actually registered as
a screen in `Navigation/Stack/AppScreens.tsx` — `RootStackParamsList`
declares at least one key (`Settings`) that is never registered and is not
navigable.

## A green capture run does not mean good frames

The readiness checks assert that a story's marker and its route/testID marker
are present in the Android view hierarchy. They say nothing about whether
something is *covering* the screen. A run can report 38/38 passed while half
the frames are occluded — this happened, with a stuck soft keyboard hiding
~45% of 20 consecutive frames, and every check green.

Always open the PNGs before accepting a run. Cheap signals that something is
wrong without looking at all of them:

- A sharp, sustained change in ledger byte sizes partway through the run.
- Frames from a screen you know is mostly empty coming back unexpectedly
  large.

Note also that some frames are legitimately not byte-stable between runs, so
compare those by eye rather than by size: any screen showing native
device-info values (About) or live location (the coordinate-format examples).

## Artifact delivery and repeated readiness flakes

Before delivering a link, query
`gh api repos/transistir/coiab-app/actions/runs/$RUN/artifacts` and require
`total_count >= 1`, the expected unexpired capture artifact, and a successful
download. Upload logs have claimed success while the artifact API returned
404. Re-dispatch the build on the intended branch/SHA if the artifact is
absent, then verify the replacement; stop if it also disappears.

A readiness timeout alone does not prove a story defect. Three runs failed
at the same row with the final screen correct; logcat showed
`onActivityRestartAttempt` mid-wait. Preserve the diagnostic PNG, UI dump,
logcat and row identity. Follow the gate skill's two-retry budget: repeated
same-position failures with correct frames warrant escalation with evidence,
not unlimited reruns or a passing verdict.

## Provenance

The accepted workflow has passed two independent 12-frame cold runs with
matching ledger fields and durable cold-start provenance. Long captures should
run in a persistent tool-managed terminal session so the controlling command
is not killed while waiting on a slow first-load flow.
