import type {InitialState} from '@react-navigation/native';
import type {Meta, StoryObj} from '@storybook/react-native';
import {withRealNavigator} from '../../../.rnstorybook/decorators/withRealNavigator';
import {FLOW_STATES} from '../../../.rnstorybook/utils/flowState';

/**
 * The real navigator renders the journey; this placeholder only satisfies
 * Storybook's component requirement.
 */
const NoStoryComponent = () => null;

const meta = {
  title: 'Flows/Exchange',
  component: NoStoryComponent,
  decorators: [withRealNavigator],
} satisfies Meta<typeof NoStoryComponent>;

export default meta;
type Story = StoryObj<typeof meta>;

// `Sync` only exists in the navigator once both a device name and an active
// project are set (src/frontend/Navigation/Stack/index.tsx `getInitialRoute`
// / the `!deviceInfo.name || !activeProjectId` gate on `createAppScreens`).
// `FLOW_STATES.onboardedWithData` is the only preset that satisfies that.
const syncState: InitialState = {
  routes: [{name: 'Sync'}],
  index: 0,
};

const exchangeSettingsState: InitialState = {
  routes: [syncState.routes[0]!, {name: 'ExchangeSettingsBottomSheet'}],
  index: 1,
};

/**
 * 01 Main exchange screen (`Sync`). QA should see the screen the "Exchange"
 * menu entry opens, with a seeded named project and zero real peers.
 *
 * IMPORTANT CAVEAT: which of `ExchangeScreenContent` (the main sync UI) or
 * `NoWifiDisplay` actually renders here is NOT controlled by this flow
 * state. `SyncScreen` (screens/Exchange/index.tsx) picks between them using
 * `useLocalDiscoveryState().wifiStatus`, which reflects the CI emulator's
 * real, live-polled OS WiFi radio status (`LocalDiscoveryContext`, polled
 * from `NetInfo` every 2s) — there is no `FlowStateSpec` axis for it, and it
 * cannot be seeded. `ExchangeSoloScreen` (the solo-device screen) is *not*
 * reachable from this state either: it renders only when there is an active
 * project whose settings query resolves `name` to `undefined`, and no
 * current `FLOW_STATES` preset produces that (the "no project" presets
 * have no active project at all, so `Sync` isn't even a valid route under
 * them; `onboardedWithData` always seeds a *named* project). This story
 * therefore only certifies that navigation reaches the `Sync` route; it
 * does not certify which of the two branches is captured. See the flow
 * report for what a real fix (a `wifiStatus`/solo-project axis) would need.
 * CAVEATED CAPTURE: this manifest row is `route:Sync` only — a reviewer
 * MUST open the captured PNG to see whether it shows `NoWifiDisplay` or the
 * main sync UI; the row's readiness passing is not evidence of which one.
 */
export const MainScreen: Story = {
  name: '01 Main Screen (Sync)',
  parameters: {
    flow: {
      state: FLOW_STATES.onboardedWithData,
      initialState: syncState,
    },
  },
};

/**
 * 02 Exchange settings bottom sheet. QA should see the media-sync choice
 * sheet (Exchange Everything vs. Exchange Previews Only) opened on top of
 * the main exchange screen. Unlike `MainScreen`, this content does not
 * depend on WiFi/peer state — only on the device's own archive flag
 * (`useIsArchiveDevice`), which is `false` (regular device, not an archive
 * server) for a freshly seeded `onboardedWithData` project, so the
 * "Exchange Previews Only" option is deterministically preselected.
 */
export const ExchangeSettings: Story = {
  name: '02 Exchange Settings',
  parameters: {
    flow: {
      state: FLOW_STATES.onboardedWithData,
      initialState: exchangeSettingsState,
    },
  },
};
