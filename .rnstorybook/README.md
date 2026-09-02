# Storybook flow stories

There are two different kinds of stories in this Storybook:

- **Leaf stories** exercise one screen or component in isolation. Use the
  `withNavigation` decorator when the component needs ordinary navigation
  context. The decorator mounts the story component inside its small stack,
  hides the header by default, and accepts per-story screen options through
  `parameters.navigation.options` when the real app header is part of the
  capture.
- **Flow stories** exercise a user journey through the app's real navigation.
  Use `withRealNavigator`. The real `RootStackNavigator` is mounted by the
  decorator, so the story function is only a Storybook placeholder and should
  render `null` (or a short, non-essential legend). The decorator renders
  everything visible; do not put a second screen or navigator in the story
  function.
- **Non-route flow stories** exercise something the capture manifest lists
  that isn't a navigation route — `DrawerMenu` (rendered by
  `react-native-drawer-layout` with component-local open/closed state, so
  `withRealNavigator`'s `initialState` can't reach it) or a full screen whose
  live presentation state cannot be seeded through `FlowStateSpec`. Use
  `withFlowState`, described below, combined with `withNavigation` (or another
  navigation decorator) when the component also calls navigation hooks.

## Flow story shape

```tsx
const NoStoryComponent = () => null;

const meta = {
  title: 'Flows/Onboarding',
  component: NoStoryComponent,
  decorators: [withRealNavigator],
} satisfies Meta<typeof NoStoryComponent>;

export const Intro: Story = {
  parameters: {
    flow: {
      state: FLOW_STATES.freshInstall,
      // Optional: seed a navigation back-stack for a specific step.
      initialState: navigationState,
    },
  },
};
```

`flow.state` describes the backend/device state that must be applied before
the navigator mounts. Use `flow.initialState` when a story needs to begin at a
particular step or reproduce a realistic back-stack. Every route in
`initialState` must exist in the screen set selected by that flow state; for
example, app routes require an authenticated, named device and an active
project. The decorator remounts the real navigator after state application so
its initial-route decision is made from the resolved state.

The `lockedApp`/`auth: 'unauthenticated'` preset is currently limited: changing
the passcode does not update `AuthContext`'s already-mounted auth state. Use a
fresh app boot when a flow must visibly start at `AuthScreen`.

## withFlowState (non-route flow stories)

`withFlowState` is the flow-state half of `withRealNavigator`, without the
navigator. It applies `parameters.flow.state` the same way, but doesn't mount
`RootStackNavigator` and has no `initialState` concept, since there's no
navigator to seed a back-stack in.

`scripts/storybook-capture.sh` requires the `STORYBOOK.flow-ready.<storyId>`
marker to be present in the Android UI hierarchy for **every** manifest row,
whatever readiness target that row uses. `withRealNavigator` was previously
the only decorator that rendered it; `withFlowState` now renders the same
marker, so any non-route story can be captured too.

`parameters.flow.state` is optional on `withFlowState`: a story that needs no
seeded backend state can use the decorator purely to obtain the marker
(`useFlowState(undefined)` resolves on the first render).

### Exchange full-screen state fixtures

`Exchange/Screen` replaces the removed `Exchange/DevicesAvailableHeader` and
`Exchange/WifiCard` leaf stories. Each story renders the complete
`ExchangeScreenContent` composition, including the app's real navigation
header, against an `onboardedWithData` project.

`ExchangeScreenContent` exposes an optional Storybook-only `overrides` prop for
live values that cannot be seeded on a CI emulator: Wi-Fi SSID, sync progress,
archive-device status, and remote-archive connection status. A story may use
this seam only when it renders the real full screen and the desired state has
no `FlowStateSpec` axis. Every field is optional; `undefined` preserves the
hook's live value, including for fields where `null` is a meaningful fixture.
The shipping `SyncScreen` never passes the prop.

That restriction is enforced rather than merely documented: the
`storybook/no-seam-outside-stories` ESLint rule
([`eslint-rules/storybook.js`](../eslint-rules/storybook.js)) errors on the
`overrides` prop and on any import of `ExchangeScreenContentOverrides` outside
`*.stories.tsx`. Without it a production call site would type-check, lint clean
and pass CI while rendering fixtured Wi-Fi and peer state to a real user.

After adding or renaming stories, regenerate Storybook's story index before
selecting or deep-linking to them:

```bash
EXPO_PUBLIC_STORYBOOK_ENABLED=true npm run storybook-generate
```

## Android capture workflow

Capture only on a disposable Android emulator or device. Storybook flow
stories seed and reset app/device state, and capture commands select stories
through a deep link; do not use a device that contains data you need to keep.

Generate the story index after adding or renaming a story, then install/run the
Storybook Android build with the Storybook environment enabled:

```bash
EXPO_PUBLIC_STORYBOOK_ENABLED=true npm run storybook-generate
npm run storybook:android
```

With an Android emulator/device connected through `adb`, capture the ordered
manifest into a new, empty directory. `STORYBOOK_PACKAGE_ID` defaults to
`com.comapeo.dev`; set it when the installed Storybook app has a different
package identifier. The manifest has five tab-separated columns:
`flow`, runtime `story_id`, readiness target, post-readiness settle delay in
seconds, and display label. A readiness target is either `route:<name>` for a
direct navigator screen or `testID:<id>` for a stable native view marker. A
route target is certified by story-specific and route-specific markers in the
current Android UI hierarchy. The markers are updated by the navigator's
current-state callbacks; a historical route log cannot certify a later frame.
The Home story uses the story-specific marker plus `MAIN.map-screen` because
the root route is `Home` while the visible nested tab is `Map`.

Choose `route:<Name>` for a story on a plain stack screen reached through
`withRealNavigator`'s `initialState`. Choose a `testID:` marker for anything
rendered inside `Home`'s nested tab navigator (as above, since its current
route isn't `Home`) or for any `withFlowState` story, since a non-route
story has no navigator route to certify against.

Before each screenshot the capture command dismisses the Android soft
keyboard if one is showing. Storybook switches stories through a deep link
and never closes the IME, so a keyboard raised by one story (an autofocused
`TextInput`, for example) otherwise stays up and covers the bottom of every
later story's frame — and no readiness marker catches it, because the markers
assert route/testID presence, not occlusion. A keyboard that will not close
fails the capture rather than producing an occluded frame. One consequence
worth knowing when reviewing frames: the text-entry screens (device name
edit, set passcode) are captured with their form fully visible and no
keyboard over it.

The capture command validates every runtime ID against the source story index,
requires exact story selection before checking the target, captures each row in
order, and writes the deterministic `captures.tsv` ledger. It rechecks the
current markers immediately before and after each screenshot. A flow-state
placeholder, changed route, wrong route, missing testID, or missing readiness
signal fails the run instead of producing a certified frame. These are
navigation/native-hierarchy checks, not screenshot text or OCR heuristics.
`STORYBOOK_READY_TIMEOUT` controls the readiness wait and defaults to 300
seconds so a cold project-and-observation seed can complete; the manifest delay
still begins only after the target is ready.

```bash
STORYBOOK_PACKAGE_ID=com.comapeo.dev \
  scripts/storybook-capture-all.sh /tmp/storybook-captures
node scripts/storybook-report.mjs /tmp/storybook-captures
```

The full-manifest wrapper performs and records the acceptance cold start before
selecting any story. It waits for the device, force-stops the package, clears
logcat, launches `MainActivity`, and waits for fresh `Running "main"` evidence.
The exact commands, outcomes, evidence line, relevant React Native log snapshot,
and timestamps are retained as
`/tmp/storybook-captures/cold-start-provenance.txt`. Keep that file with the
ledger and PNGs; a separate narrative or terminal transcript is not equivalent
provenance. `STORYBOOK_COLD_START_TIMEOUT` controls the startup wait and
defaults to 300 seconds.

The report command reads `captures.tsv` and writes a filmstrip at
`<output>/<flow>/index.html` for each flow. Use separate fresh output
directories for repeated runs, then compare the identity/order columns of the
two ledgers (`position`, `flow`, `story_id`, `label`, and
`relative_png_path`), not their image byte sizes.

Select a leaf story after the manifest completes to verify that Storybook
remains usable. If an emulator gets into an unrecoverable state, reset or wipe
that disposable emulator, reinstall the Storybook Android build, regenerate
the index, and repeat the cold-start capture.

Map, GPS, and camera hardware are intentionally limited on emulators: map tile
availability and GPS readouts are not visual evidence, while map chrome is;
camera previews are not meaningful evidence. The generated filmstrips flag the
affected frames with these caveats.
