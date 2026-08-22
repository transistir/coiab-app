---
name: comapeo-storybook-capture
description: Generate and verify CoMapeo React Native Storybook flow screenshots with deterministic readiness and durable acceptance evidence.
---

# CoMapeo Storybook capture

Use this project skill when regenerating the Storybook bundle, launching the
Android app, or collecting the documented user-flow screenshots.

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
   STORYBOOK_PACKAGE_ID=com.comapeo.dev \
     scripts/storybook-capture-all.sh /tmp/storybook-captures-<run>
   node scripts/storybook-report.mjs /tmp/storybook-captures-<run>
   ```

4. A usable run contains 12 PNGs, `captures.tsv`, the flow reports,
   `cold-start-provenance.txt`, and the leaf-recovery PNG. Compare ledger
   identity/order fields across independent cold runs before accepting the
   result. Inspect onboarding PNGs to ensure they show named screens rather
   than `FlowStatePlaceholder`.

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
  failing story; do not report it as a complete 12-screen generation.

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
  the uploaded CI artifact gives no clue why it failed.

## Provenance

The accepted workflow has passed two independent 12-frame cold runs with
matching ledger fields and durable cold-start provenance. Long captures should
run in a persistent tool-managed terminal session so the controlling command
is not killed while waiting on a slow first-load flow.
