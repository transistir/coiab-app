---
name: comapeo-storybook-capture-gate
description: Run the Storybook capture workflow for a PR, review every captured frame with vision, fix what it finds, and post the verdict plus an artifact download link on the PR. Use when a PR adds or changes Storybook stories, the capture manifest, or the capture scripts.
---

# Storybook capture gate for a PR

Advisory, not blocking. The capture workflow is `workflow_dispatch` only and
is deliberately not a required check — a run costs 30-50 minutes and the
emulator infrastructure produces spurious failures. This skill is the
procedure that makes it a real gate anyway: an agent runs it, *looks* at the
frames, fixes what it finds, and leaves the evidence on the PR.

For the capture pipeline's own mechanics and CI gotchas, see the
`comapeo-storybook-capture` skill
([`../comapeo-storybook-capture/SKILL.md`](../comapeo-storybook-capture/SKILL.md)).
This skill is the PR-cycle wrapper around it.

**Repo of record:** COIAB code, branches, PRs and runs belong only in
`transistir/coiab-app`. **Remote safety:** every `gh` write targets that repo.
See AGENTS.md — never write to `digidem/*`.

**Screenshots mandatory when the PR touches `src/frontend/flows/`,
`.rnstorybook/`, or UI components; explicitly N/A with reason otherwise.** State
which case applies before deciding whether to spend a capture run.

## Why the vision pass is the point

The capture pipeline's readiness checks assert that a story's marker and its
route/testID marker are present in the Android view hierarchy. They cannot
see occlusion. A run has reported 38/38 frames captured successfully while a
stuck soft keyboard covered ~45% of 20 consecutive frames. Every automated
gate was green. The only thing that caught it was opening the images.

Treat a green run as "the pipeline worked", never as "the screenshots are
good".

## 0. Where this sits in the issue→PR pipeline

This is the deliverables stage. It runs **after** the PR's required checks
(`all`, `frontend`) are green and the bot threads are resolved — a capture run
costs 30-50 minutes, so do not spend one on a branch that CI has not accepted
yet. Poll the exact head's check-runs as described in `AGENTS.md`; zero
checks or a pending state is not acceptance, and `ci.yml` cannot be manually
dispatched. Independent fresh-context verification review is mandatory before
readiness is declared; visual review does not replace code review.
Its output feeds the merge-readiness verdict (`pr-readiness-check`,
"Screenshots" dimension), the testing APK in step 7, and the Telegram delivery
in step 8 below.

## 1. Preflight — seconds, before burning a run

```sh
# Repo secrets: Setup EAS consumes secrets.EXPO_TOKEN.
gh secret list -R transistir/coiab-app     # EXPO_TOKEN must appear
gh variable list -R transistir/coiab-app   # EAS_PROJECT_URL must appear

npm run lint

# Every manifest story id must resolve against the source story index.
node -e "const {buildIndex}=require('@storybook/react-native/node');const fs=require('fs');const ids=fs.readFileSync('.rnstorybook/capture-manifest.tsv','utf8').trim().split('\n').map(l=>l.split('\t')[1]);buildIndex({configPath:'.rnstorybook'}).then(i=>{const m=ids.filter(id=>!(id in i.entries));console.log(m.length?'MISSING: '+m.join(', '):'ALL '+ids.length+' IDS PRESENT');if(m.length)process.exitCode=1})"

# Manifest shape: 5 tab-separated columns, unique ids, valid targets/delays.
awk -F'\t' 'NF!=5{print "BAD COLS line "NR; bad=1} {if(seen[$2]++){print "DUP id "$2; bad=1} if($3 !~ /^(route:[A-Za-z][A-Za-z0-9]*|testID:[A-Za-z0-9][A-Za-z0-9._:-]*)$/){print "BAD target "NR": "$3; bad=1} if($4 !~ /^[0-9]+([.][0-9]+)?$/){print "BAD delay "NR; bad=1}} END{if(!bad) print "MANIFEST OK ("NR" rows)"; exit bad}' .rnstorybook/capture-manifest.tsv
```

Also confirm every route name used in an `initialState` is really registered
in `Navigation/Stack/AppScreens.tsx`. `RootStackParamsList` declares at least
one key (`Settings`) that is never registered and is not navigable.

At initial setup, `EAS_PROJECT_URL` was set and `EXPO_TOKEN` was missing;
recheck rather than treating this as live inventory. No agent can mint an
Expo account token. Without it the `Setup EAS` step fails
and the whole run is wasted. Stop and hand the user the exact command:

```sh
gh secret set EXPO_TOKEN -R transistir/coiab-app --body '<expo-access-token>'
# token from https://expo.dev/accounts/joarez/settings/access-tokens
```

Do not edit the workflow to skip the EAS step — the capture needs the APK that
step's toolchain builds.

## 2. Trigger and wait

```sh
gh workflow run storybook-capture.yml -R transistir/coiab-app --ref <branch>
sleep 15
gh run list -R transistir/coiab-app --workflow storybook-capture.yml --branch <branch> --event workflow_dispatch --limit 5 --json databaseId,headSha,createdAt,status,url
# Set RUN to the new run matching the intended SHA and dispatch time.
```

Wait in the background rather than blocking a foreground call for the whole
run:

```sh
until [ "$(gh run view $RUN -R transistir/coiab-app --json status -q .status)" = "completed" ]; do sleep 30; done
gh run view $RUN -R transistir/coiab-app --json conclusion -q .conclusion
```

## 3. If the run fails, classify before re-running

Do not blindly retry, and do not assume a failure means the code is wrong.
Verify the artifact inventory (step 6), then download any partial artifact
into a fresh directory and look:

```sh
gh run download $RUN -R transistir/coiab-app -D ./caps/$RUN
gh run view $RUN -R transistir/coiab-app --log-failed | rg -i "storybook-capture" | tail -25
```

- **Correct frame, failed identity check** — inspect retained
  `*.failure-reactnative-logcat.txt`; log eviction is a known cause, not a
  diagnosis to assume from the image alone.
- **Repeated ANR dialogs** — emulator resource pressure may justify a retry.
- **Wrong screen or `FlowStatePlaceholder`** — fix the story/flow defect.
- **Readiness timeout with the correct final screen** — inspect the failure
  screenshot, UI dump and logcat before blaming app state. Three same-row
  failures showed `onActivityRestartAttempt` mid-wait despite correct frames.

Retry budget: two retries (three runs total) for an unchanged failure. A
documented flake with N same-position failures and correct frames is grounds
to stop and escalate; do not spend further CI hours without a new diagnosis
or intervention. Report N, run URLs/SHAs, manifest row/story id, failing gate,
reviewed diagnostic frames, relevant logcat timestamps and UI dumps, plus
uncaptured rows. This is a partial/blocked capture verdict, never a pass.
Artifact-loss rebuilds also need a bound: one replacement, then escalate if
its artifact is absent too.

## 4. Vision review — every frame, not a sample

```sh
gh run download $RUN -R transistir/coiab-app -D ./caps/$RUN
D=$(find ./caps/$RUN -name captures.tsv | head -1 | xargs dirname)
awk 'END {print NR-1}' "$D/captures.tsv" # must equal the manifest row count
node scripts/storybook-report.mjs "$D"    # validates ledger and referenced PNGs
find "$D" -name '*failure*'              # must be empty
awk -F'\t' 'NR>1{print $1, $3, $6}' "$D/captures.tsv"
```

Read every PNG. Reject a frame for any of:

- **Occlusion** — soft keyboard, a system dialog, an ANR window, a bottom
  sheet that should not be open.
- **`FlowStatePlaceholder`** instead of a real screen.
- **Blank or near-blank** frames where content was expected.
- **Wrong screen for the label** — the Storybook footer in each frame prints
  the story title; check it matches the manifest label.
- **Content cut off** at the bottom, which is usually occlusion by another
  name.

Byte-size triage from `captures.tsv` narrows where to look first: a sharp,
sustained change partway through the run, or an unexpectedly large frame for
a screen you know is mostly empty.

Some frames are legitimately not byte-stable between runs — compare those by
eye, never by size: any screen showing native device-info values (About) or
live location (the coordinate-format examples).

## 5. Fix, then re-run

Fix defects at the right layer. A defect that affects one story belongs in
that story; a defect that affects every frame after some point belongs in
`scripts/storybook-capture.sh`. The stuck-keyboard defect was the second
kind — fixing it per story would have left the next contributor to rediscover
it.

Re-run from step 2 and re-review. Do not comment a pass verdict on a run you
have not actually looked at.

## 6. Comment on the PR

Post a pass only after every frame passes review; an escalation comment must
clearly state partial/blocked status and missing coverage. Comment only when
posting to the PR is authorized by the task. Before sharing any artifact link,
verify the inventory again and successfully download the expected artifact.
Upload-success logs are not proof: the API has returned 404 for artifacts
that logs claimed were uploaded. Require `total_count >= 1` and an expected,
unexpired entry. If missing, re-dispatch the producing build (step 2), verify
its SHA and replacement artifact, and review that run's frames. Never reuse
the vanished artifact's link. Include the verified download link —
`https://github.com/transistir/coiab-app/actions/runs/<RUN>/artifacts/<ARTIFACT_ID>`:

```sh
gh api repos/transistir/coiab-app/actions/runs/$RUN/artifacts \
  --jq '{total_count, artifacts: [.artifacts[] | {id, name, expired}]}'
# Set ART and NAME from the expected unexpired entry, not blindly artifacts[0].
gh run download $RUN -R transistir/coiab-app -n "$NAME" -D ./verified-caps/$RUN
gh pr comment <PR> -R transistir/coiab-app --body-file <review-comment.md>
```

The comment must state:

- The run id and conclusion, and that the frames were reviewed by eye rather
  than trusted from the exit code.
- The direct artifact download link and the frame count.
- Anything reviewed and deliberately accepted — frames that are not
  byte-stable, rows that certify a route but not which branch rendered,
  states that are not covered and why.
- If earlier runs failed, what they were and why they were not regressions.

A verdict with no stated limits is a weaker signal than one that names them.

## 7. Testing APK (release-candidate)

**The deliverable APK is the release-candidate build. There is no other
installable APK from CI.**

The `test` profile builds are uploaded straight to BrowserStack by
`e2e-appium-browserstack.yml` and produce **no downloadable APK** — never
promise one from that path. The storybook capture workflow builds an APK on the
runner but uploads only `storybook-captures/`.

### The path

1. A PR whose **base matches `release/**`** is opened (created from the merged
   develop PR's branch, or from `develop`).
2. `build-rc.yml` runs **automatically** on that PR. It has **no
   `workflow_dispatch`** — you cannot dispatch it. The other entry point is an
   admin commenting the `/build-rc` trigger (`BUILD_COMMENT_TRIGGER`) on such a
   PR, which `build-bot.yml` picks up.
3. It starts an EAS `release-candidate` cloud build and comments the **EAS
   build-page URL** on the PR. **No APK artifact is uploaded to GitHub.**
4. Get the download URL from EAS, taking `BUILD_ID` from the run logs or from
   the EAS page URL the bot commented:

```sh
gh run list -R transistir/coiab-app --workflow build-rc.yml --limit 3 \
  --json databaseId,headBranch,conclusion,url

eas build:view <BUILD_ID> --json | jq -r '.artifacts.buildUrl'
```

`.artifacts.buildUrl` is the APK download URL. That is the link to deliver.

### Required secrets and variables

The RC path consumes:

| Name | Kind | Initial setup status (recheck) |
|---|---|---|
| `EXPO_TOKEN` | secret | **missing** |
| `RELEASE_BOT_PRIVATE_KEY` | secret | **missing** |
| `RELEASE_BOT_APP_ID` | variable | **missing** |
| `EAS_PROJECT_URL` | variable | set |

(`RELEASE_BOT_USER_ID` is only used by `build-bot.yml`'s `workflow_call` path,
for the release-notes commit identity.)

Check, and **hard stop** if any is missing — do not open the PR, do not edit the
workflow to route around it. Hand the user the exact commands:

```sh
gh secret list -R transistir/coiab-app
gh variable list -R transistir/coiab-app

gh secret set EXPO_TOKEN -R transistir/coiab-app --body '<expo-access-token>'
gh secret set RELEASE_BOT_PRIVATE_KEY -R transistir/coiab-app --body "$(cat <app-private-key.pem>)"
gh variable set RELEASE_BOT_APP_ID -R transistir/coiab-app --body '<github-app-id>'
```

### Authorization gate — the `release/**` PR is a second PR

**"implemente issue X" authorizes exactly one branch and one PR to `develop`. It
does NOT cover the `release/**` PR.** That PR is a separate, outward-facing
mutation that starts a cloud build under the project's Expo account.

Check existing session authorization before creating it. If the release PR
and its build are already authorized, proceed; otherwise ask once, explaining
that this second PR starts an Expo cloud build. A green PR or silence does not
grant consent. Report an unbuilt APK and the missing authorization accurately.

## 8. Deliver to the Telegram group — the agent posts, not CI

Use this delivery path only when the user explicitly authorized sending to
that group and the Hermes transport is available; otherwise report local
artifacts to the user. No workflow posts to Telegram, and none should. **Delivery is the orchestrating
agent's job, never a GitHub Actions step.** The Hermes agent running profile
`coiab-app` posts to the Telegram group **"CoiabApp Group"**
(`-1004294281081`) by writing `MEDIA:/absolute/path` lines in its reply:

```
MEDIA:/absolute/path/to/coiab-rc.apk        # .apk  → sent as a document
MEDIA:/absolute/path/to/frames/01-home.png  # .png  → sent as a photo
MEDIA:/absolute/path/to/frames/02-map.png
```

One `MEDIA:` line per file, absolute paths only. `.apk` goes as a document,
`.png` as photos. Send once, after the PR comment exists, so the message and the
audit trail on the PR agree.

Alongside the media, the message carries:

1. Issue and PR number, with the **PR link**.
2. Required-check status (`all`, `frontend`) and the **run link**.
3. The **EAS build URL** and the APK download URL from
   `eas build:view <BUILD_ID> --json` (`.artifacts.buildUrl`). If no RC build
   exists, say so plainly and name what is missing — a `release/**` PR that was
   not authorized, or `EXPO_TOKEN` / `RELEASE_BOT_APP_ID` /
   `RELEASE_BOT_PRIVATE_KEY` — rather than shipping a message that implies an
   APK exists.
4. **The relevant frames themselves** as `MEDIA:` lines — the screens the issue
   actually changed, two or three of them. A group chat will not download a zip.
   Keep the artifact link in the text as the full record.
5. The frame count, the fact that they were reviewed by eye, and any limits that
   were accepted.

Attach images from the downloaded artifact directory (`$D/*.png`); do not
re-host them anywhere else.

**Delivery is confirmed only when the message actually appears in the group.** A
send that returns nothing is not a delivery. On a send failure — flood control,
"chat not found" — retry **once after 60 s**; if that also fails, save the
artifact paths locally and report the failure with those paths. Never claim a
delivery you did not see land.

If the frames failed review, deliver that instead — what failed, at which row,
and what is being fixed. A silent gate is worse than a bad one.
