import type {NavigationContainerRef} from '@react-navigation/native';
import type {AppStackParamsList} from '../../sharedTypes/navigation';

// The engine's async publications (zustand → navigation resets) must run
// under React's act scheduler; RNTL toggles the flag only around its own
// calls, and this suite's transitions arrive in core callbacks outside them.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let mockNavigation: NavigationContainerRef<AppStackParamsList>;
jest.mock('../../../../tests/integration/helpers/navigation', () => {
  const {AppNavigator} = require('../../AppNavigator');
  return {
    MockedAppNavigator: () => {
      return (
        <AppNavigator
          permissionAsked
          navigationIntegration={{
            registerNavigationContainer: (ref: {
              current: NavigationContainerRef<AppStackParamsList>;
            }) => {
              mockNavigation = ref.current;
            },
          }}
        />
      );
    },
  };
});
import {fireEvent, screen, waitFor} from '@testing-library/react-native';

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
    MapView: Stub,
    Camera: Stub,
    MarkerView: Stub,
    UserLocation: Stub,
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

import {MMKVStoreInitializer} from '../../hooks/persistedState/createPersistedState';
import {COIAB_ORGANIZATIONS_STORAGE_KEY} from '../../contexts/CoiabOrganizationsStoreContext';
import {BLOCKED_ROLE_ID} from '../../sharedTypes';
import {
  setupIntegrationTest,
  semearDocumentoPronta,
} from '../../../../tests/integration/helpers/setupIntegrationTest';

const nomesDasRotas = () =>
  mockNavigation.getRootState().routes.map(route => route.name);

/**
 * Review fronteira P2-3 at navigator level: the removal explanation must
 * survive the REAL surfaces it is presented over — the real
 * OrganizationProvisioning (whose own Home-reset effect sees A still
 * `ready` until the engine's revalidation publishes the loss) and the real
 * Home with its nested Tab navigator (whose cleanup overwrote partial
 * resets, 57b0d460). The removal itself is real too: the device's own role
 * document is rewritten to BLOCKED in core, which emits the real
 * `own-role-change` over IPC and makes every later `$getOwnRole` read the
 * blocked role.
 */
describe('remoção do dispositivo de um projeto (navigator real)', () => {
  const orgSetup = setupIntegrationTest();

  beforeEach(() => {
    MMKVStoreInitializer.removeItem(COIAB_ORGANIZATIONS_STORAGE_KEY);
  });
  afterEach(() => {
    MMKVStoreInitializer.removeItem(COIAB_ORGANIZATIONS_STORAGE_KEY);
  });

  test('o sheet de remoção sobrevive ao Provisioning real e à limpeza da Home com abas até o recovery', async () => {
    semearDocumentoPronta(
      orgSetup.projectId,
      orgSetup.alertasProjectId,
      orgSetup.orgId,
      orgSetup.orgName,
    );
    await orgSetup.renderNavigation();
    expect(
      await screen.findByTestId('MAIN.map-screen', {}, {timeout: 15_000}),
    ).toBeOnTheScreen();
    expect(nomesDasRotas()).toEqual(['Home']);

    // Watch every root state the navigator commits: the explanation must
    // never be dropped between its presentation and the recovery.
    const pilhas: string[][] = [];
    const unsubscribe = mockNavigation.addListener('state', () => {
      pilhas.push(nomesDasRotas());
    });
    try {
      const project = await orgSetup.client.getProject(orgSetup.projectId);
      await project.$member.assignRole(
        orgSetup.manager.deviceId,
        BLOCKED_ROLE_ID as Parameters<typeof project.$member.assignRole>[1],
      );

      // The engine's revalidation publishes the loss; the explanation is
      // still over the provisioning surface.
      expect(
        await screen.findByText('THIS DEVICE REMOVED FROM…', undefined, {
          timeout: 15_000,
        }),
      ).toBeOnTheScreen();
      await waitFor(
        () =>
          expect(nomesDasRotas()).toEqual([
            'OrganizationProvisioning',
            'RemovedFromProjectBottomSheet',
          ]),
        {timeout: 15_000},
      );
      // The engine published the loss: the provisioning surface under the
      // sheet (aria-hidden behind the modal) shows the recovery state, and
      // the explanation names the removed slot.
      expect(
        await screen.findByText(
          'Could not open your organization',
          {includeHiddenElements: true},
          {timeout: 15_000},
        ),
      ).toBeOnTheScreen();
      expect(nomesDasRotas()).toEqual([
        'OrganizationProvisioning',
        'RemovedFromProjectBottomSheet',
      ]);
      expect(
        await screen.findByText('Monitoramento', undefined, {
          timeout: 15_000,
        }),
      ).toBeOnTheScreen();

      // Once presented, the sheet is never taken down: no committed stack
      // after the first one carrying it lacks it (neither the provisioning
      // reset-to-Home nor the nested navigator's cleanup won).
      const primeira = pilhas.findIndex(pilha =>
        pilha.includes('RemovedFromProjectBottomSheet'),
      );
      expect(primeira).toBeGreaterThanOrEqual(0);
      expect(
        pilhas
          .slice(primeira)
          .filter(pilha => !pilha.includes('RemovedFromProjectBottomSheet')),
      ).toEqual([]);

      // Close leaves the removed slot (real core leave) and lands on the
      // provisioning surface alone, still in recovery.
      await fireEvent.press(screen.getByText('Close'));
      await waitFor(
        () => expect(nomesDasRotas()).toEqual(['OrganizationProvisioning']),
        {timeout: 15_000},
      );
      expect(
        await screen.findByText('Could not open your organization'),
      ).toBeOnTheScreen();
    } finally {
      unsubscribe();
    }
  }, 120_000);
});
