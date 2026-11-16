import type {
  NavigationContainerRef,
  InitialState,
} from '@react-navigation/native';
import type {AppStackParamsList} from '../../sharedTypes/navigation';

// Shared mocks: see seededDeepStack.helpers.tsx for why each one exists.
jest.mock('react-native/Libraries/Utilities/BackHandler', () =>
  jest
    .requireActual<typeof import('./seededDeepStack.helpers')>(
      './seededDeepStack.helpers',
    )
    .mockBackHandlerModule(),
);

let mockNavigation: NavigationContainerRef<AppStackParamsList>;
let mockSeededInitialState: InitialState | undefined;
let mockOnRootStateChange: ((state: InitialState) => void) | undefined;

jest.mock('../../../../tests/integration/helpers/navigation', () =>
  jest
    .requireActual<typeof import('./seededDeepStack.helpers')>(
      './seededDeepStack.helpers',
    )
    .mockSeededNavigatorModule({
      onRef: ref => {
        mockNavigation = ref;
      },
      getInitialState: () => mockSeededInitialState,
      onStateChange: state => {
        mockOnRootStateChange?.(state);
      },
    }),
);

jest.mock('@maplibre/maplibre-react-native', () =>
  jest
    .requireActual<typeof import('./seededDeepStack.helpers')>(
      './seededDeepStack.helpers',
    )
    .mockMaplibreModule(),
);

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

jest.mock('../../hooks/useStorageReadingQuery', () =>
  jest
    .requireActual<typeof import('./seededDeepStack.helpers')>(
      './seededDeepStack.helpers',
    )
    .mockStorageReadingQueryModule(),
);

jest.mock('../../hooks/server/presets', () => ({
  usePresetsQuery: () => ({data: []}),
}));

jest.mock('../../hooks/server/fields', () =>
  jest
    .requireActual<typeof import('./seededDeepStack.helpers')>(
      './seededDeepStack.helpers',
    )
    .mockFieldsModule(),
);

jest.mock('../../screens/ObservationFields', () =>
  jest
    .requireActual<typeof import('./seededDeepStack.helpers')>(
      './seededDeepStack.helpers',
    )
    .mockObservationFieldsModule(),
);

process.env.MAPBOX_ACCESS_TOKEN = 'test-token';

// Gate lives on globalThis because jest.mock factories are hoisted above
// module scope and may not close over module variables.
const gateHolder = globalThis as {__fieldsGate?: {released: boolean}};
if (!gateHolder.__fieldsGate) {
  gateHolder.__fieldsGate = {released: false};
}

import {act} from '@testing-library/react-native';

import {
  setupIntegrationTest,
  semearDocumentoPronta,
} from '../../../../tests/integration/helpers/setupIntegrationTest';

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

    semearDocumentoPronta(
      orgSetup.projectId,
      orgSetup.alertasProjectId,
      orgSetup.orgId,
      orgSetup.orgName,
    );
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
    expect(mockNavigation.getRootState()!.index).toBe(3);

    mockOnRootStateChange = undefined;
    mockSeededInitialState = undefined;
  }, 15000);
});
