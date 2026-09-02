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
  title: 'Flows/Menu',
  component: NoStoryComponent,
  decorators: [withRealNavigator],
} satisfies Meta<typeof NoStoryComponent>;

export default meta;
type Story = StoryObj<typeof meta>;

const onboardedNoDraft = {
  ...FLOW_STATES.onboardedWithData,
  draftObservation: 'none' as const,
};

const mapState: InitialState = {
  routes: [
    {
      name: 'Home',
      state: {
        routes: [{name: 'Map'}],
        index: 0,
      },
    },
  ],
  index: 0,
};

const observationsListState: InitialState = {
  routes: [
    {
      name: 'Home',
      state: {
        routes: [{name: 'ObservationsList'}],
        index: 0,
      },
    },
  ],
  index: 0,
};

const cameraState: InitialState = {
  routes: [
    {
      name: 'Home',
      state: {
        routes: [{name: 'Camera'}],
        index: 0,
      },
    },
  ],
  index: 0,
};

/**
 * `Map` accepts `undefined | {trackingOpen: boolean}`
 * (`HomeTabsParamsList`); `trackingOpen: true` renders `<TrackBottomSheet
 * />` over the map (see `src/frontend/screens/MapScreen/index.tsx`).
 */
const mapTrackingOpenState: InitialState = {
  routes: [
    {
      name: 'Home',
      state: {
        routes: [{name: 'Map', params: {trackingOpen: true}}],
        index: 0,
      },
    },
  ],
  index: 0,
};

/** The complete Home-tabs journey, starting at the map. */
export const Walkthrough: Story = {
  parameters: {
    flow: {state: onboardedNoDraft},
  },
};

/** The map tab — the default Home surface. */
export const Map: Story = {
  name: '01 Map',
  parameters: {
    flow: {state: onboardedNoDraft, initialState: mapState},
  },
};

/** The observations-list tab, showing the seeded observations. */
export const ObservationsList: Story = {
  name: '02 Observations List',
  parameters: {
    flow: {state: onboardedNoDraft, initialState: observationsListState},
  },
};

/**
 * The camera tab. Kept as a story for manual/dev use, but deliberately left
 * out of `.rnstorybook/capture-manifest.tsv`: the CI capture emulator runs with
 * `-camera-back none` (`.github/workflows/storybook-capture.yml`),
 * `.rnstorybook/README.md` states camera previews aren't meaningful
 * evidence, and `src/frontend/screens/CameraScreen.tsx` has no testID to
 * certify readiness against.
 */
export const Camera: Story = {
  name: '03 Camera',
  parameters: {
    flow: {state: onboardedNoDraft, initialState: cameraState},
  },
};

/** The map tab with the tracking bottom sheet open. */
export const MapTrackingOpen: Story = {
  name: '04 Map Tracking Open',
  parameters: {
    flow: {state: onboardedNoDraft, initialState: mapTrackingOpenState},
  },
};
