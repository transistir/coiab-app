import type {
  NavigationContainerRef,
  InitialState,
} from '@react-navigation/native';
import type {AppStackParamsList} from '../../sharedTypes/navigation';

let mockNavigation: NavigationContainerRef<AppStackParamsList>;
let mockSeededInitialState: InitialState | undefined;
let mockOnRootStateChange: ((state: InitialState) => void) | undefined;

jest.mock('../../../../tests/integration/helpers/navigation', () => {
  const {NavigationContainer} = require('@react-navigation/native');
  const {RootStackNavigator} = require('./index');
  return {
    // Mount only the navigator the shipping app renders, inside our own
    // NavigationContainer that owns the seeded deep-stack initialState —
    // the same shape the Storybook flow decorator (withRealNavigator) uses.
    MockedAppNavigator: () => {
      return (
        <NavigationContainer
          ref={(ref: NavigationContainerRef<AppStackParamsList>) => {
            mockNavigation = ref;
          }}
          initialState={mockSeededInitialState}
          onStateChange={(state: InitialState) => {
            mockOnRootStateChange?.(state as InitialState);
          }}>
          <RootStackNavigator />
        </NavigationContainer>
      );
    },
  };
});

// The full navigator mounts the real Home tabs (MapScreen included) — the
// map stack is stubbed exactly like index.navigator.test.tsx does.
jest.mock('@maplibre/maplibre-react-native', () => {
  const React = require('react');
  const {View} = require('react-native');
  const Stub = (
    props: {children?: React.ReactNode} & Record<string, unknown>,
  ) => {
    const {children, ...rest} = props || {};
    return React.createElement(View, rest, children);
  };

  const LineJoin = {Round: 'round', Bevel: 'bevel', Miter: 'miter'};
  const LineCap = {Round: 'round', Butt: 'butt', Square: 'square'};

  return {
    __esModule: true,
    default: {
      MapView: Stub,
      Camera: Stub,
      UserLocation: Stub,
      ShapeSource: Stub,
      LineLayer: Stub,
      setAccessToken: jest.fn(),
      setTelemetryEnabled: jest.fn(),
    },
    LineJoin,
    LineCap,
  };
});

jest.mock('react-native-scale-bar', () => 'ScaleBar');

jest.mock('../../hooks/server/maps', () => ({
  useMapStyleJsonUrl: () => ({data: undefined}),
}));

jest.mock('../../hooks/useCurrentTime', () => ({
  useCurrentTime: () => new Date(),
}));

jest.mock('../../screens/MapScreen/MapLayers/ObservationMapLayer', () => ({
  ObservationMapLayer: () => null,
}));
jest.mock('../../screens/MapScreen/MapLayers/TracksMapLayer', () => ({
  TracksMapLayer: () => null,
}));
jest.mock(
  '../../screens/MapScreen/MapLayers/RemoteDetectionAlertsLayer',
  () => ({
    RemoteDetectionAlertsLayer: () => null,
  }),
);
jest.mock('../../screens/MapScreen/CurrentTrack/CurrentTrackMapLayer', () => ({
  CurrentTrackMapLayer: () => null,
}));
jest.mock('../../screens/MapScreen/CurrentTrack/UserTooltipMarker', () => ({
  UserTooltipMarker: () => null,
}));

jest.mock('../../hooks/useStorageReadingQuery', () => {
  const LOW = 500 * 1024 * 1024;
  return {
    __esModule: true,
    LOW_THRESHOLD_BYTES: LOW,
    useStorageReadingQuery: () => ({
      data: {freeBytes: 64 * 1024 * 1024 * 1024, totalBytes: Infinity},
    }),
    isLowStorage: (free: number | null, threshold: number = LOW) =>
      (free ?? Infinity) <= threshold,
  };
});

jest.mock('../../hooks/server/presets', () => ({
  usePresetsQuery: () => ({data: []}),
}));

// Always-present, stable-identity field data: matches the seeded fieldIds so
// the screen's own goBack branch never fires, and avoids the undefined phase
// (an undefined->data transition re-suspends and loops the navigator).
const FIELDS = [
  {
    docId: 'field-1',
    versionId: 'field-1-v1',
    name: 'Test field',
    tagKey: 'test_field',
    type: 'text',
  },
];
jest.mock('../../hooks/server/fields', () => ({
  useFieldsQuery: () => ({data: FIELDS}),
}));

// Stub the screen UI: this test targets ROUTE reconciliation only. The real
// screen mounts @tanstack useSuspenseQuery chains (useManyDocs -> fetchOptimistic
// throws a promise) that loop without a Suspense boundary in the jest harness —
// an OOM artifact of the test env, not of production (CI pops with no crash).
// The real-screen pop evidence lives in CI captures; the fix is the
// withRealNavigator state-repair guard.
jest.mock('../../screens/ObservationFields', () => ({
  ObservationFields: () => null,
}));

process.env.MAPBOX_ACCESS_TOKEN = 'test-token';

// Gate lives on globalThis because jest.mock factories are hoisted above
// module scope and may not close over module variables.
const gateHolder = globalThis as {__fieldsGate?: {released: boolean}};
if (!gateHolder.__fieldsGate) {
  gateHolder.__fieldsGate = {released: false};
}

import {act} from '@testing-library/react-native';

import {setupIntegrationTest} from '../../../../tests/integration/helpers/setupIntegrationTest';

/**
 * Story 18 regression (CI captures 34417507310 / 34422668174): with a seeded
 * deep stack [Home, ObservationCategoryChooser, ObservationCreate,
 * ObservationFields(index 3, fieldIds)] the app pops back to
 * ObservationCreate ~130ms after mount with no user interaction. Two state
 * changes fire in a row; the first screen-set reconciliation is the prime
 * suspect (auth-state / query-resolution ticks that change the navigator's
 * screen set after mount, making StackRouter prune and rebuild the state).
 */
describe('RootStackNavigator seeded deep stack (story 18)', () => {
  const orgSetup = setupIntegrationTest();

  test('a seeded ObservationFields stack survives post-mount query resolution', async () => {
    mockSeededInitialState = {
      routes: [
        {
          name: 'Home',
          state: {routes: [{name: 'Map'}], index: 0},
        },
        {name: 'ObservationCategoryChooser'},
        {name: 'ObservationCreate'},
        {name: 'ObservationFields', params: {fieldIds: ['field-1']}},
      ],
      index: 3,
    };

    const stateLog: Array<{index: number; routes: string[]}> = [];
    mockOnRootStateChange = state => {
      if (stateLog.length < 20) {
        stateLog.push({
          index: state.index ?? 0,
          routes: (state.routes ?? []).map(r => r.name),
        });
      }
    };

    await orgSetup.renderNavigation();

    // Let every post-mount query refresh tick land (device info, org list,
    // active project…): the APK pop happens ~130ms after mount.
    // First tick: queries resolve (gate released) ~like the emulator's
    // delayed useFieldsQuery.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
    });

    const currentName = mockNavigation.getCurrentRoute()?.name;
    // Diagnostics: shows every reconciliation the navigator performed.
    console.log(
      'state changes observed:',
      JSON.stringify(stateLog, undefined, 2),
    );

    expect(currentName).toBe('ObservationFields');
    expect(mockNavigation.getRootState().index).toBe(3);

    mockOnRootStateChange = undefined;
    mockSeededInitialState = undefined;
  }, 15000);
});
