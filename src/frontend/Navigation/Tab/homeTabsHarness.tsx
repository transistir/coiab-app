// Shared setup of the HomeTabs navigator suites (index.test.tsx and
// index.menu.test.tsx). The suite was split so each jest file mounts the full
// navigator fewer times: one worker running all of it was SIGTERMed in CI.
//
// `jest.mock` calls in a required module register for the whole test file, so
// this module must be the FIRST import of every suite that uses it.
import type {
  NavigationContainerRef,
  NavigatorScreenParams,
} from '@react-navigation/native';
import type {HomeTabsParamsList} from '../../sharedTypes/navigation';

// The engine's async publications (zustand → navigation resets) must run
// under React's act scheduler; RNTL toggles the flag only around its own
// calls, and this test's transitions arrive in core callbacks outside them.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The full navigator mounts the real Home tabs (MapScreen included) — the
// map stack is stubbed exactly like MapScreen.lowStorage.test.tsx does.
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
    RemoteDetectionAlertsMapLayer: () => null,
  }),
);
jest.mock('../../screens/MapScreen/CurrentTrack/CurrentTrackMapLayer', () => ({
  CurrentTrackMapLayer: () => null,
}));
jest.mock('../../screens/MapScreen/CurrentTrack/UserTooltipMarker', () => ({
  UserTooltipMarker: () => null,
}));

jest.mock('../../hooks/useStorageReadingQuery', () => ({
  useStorageReadingQuery: () => ({
    data: {
      freeBytes: 64 * 1024 * 1024 * 1024,
      totalBytes: 64 * 1024 * 1024 * 1024,
    },
  }),
}));

jest.mock('../../hooks/server/presets', () => ({
  usePresetsQuery: () => ({data: []}),
}));

// The merged MapScreen reads the location permission through a suspense
// query; stub it like MapScreen.test.tsx does so the tab suite never waits on
// the native permission module.
jest.mock('../../hooks/useLocationPermissionTracker', () => ({
  useLocationPermissionQuery: () => ({
    data: {granted: true, canAskAgain: true},
  }),
  useInvalidateLocationPermission: () => jest.fn(),
  requestLocationPermission: jest.fn(),
  useLocationPermissionWithoutPasscode: () => ({mutate: jest.fn()}),
}));

process.env.MAPBOX_ACCESS_TOKEN = 'test-token';

import * as React from 'react';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {View} from 'react-native';
import {render} from '@testing-library/react-native';

import type {MapeoManager} from '@comapeo/core';
import type {ComapeoCoreClientApi} from '@comapeo/ipc';

import {
  createManager,
  setUpIPC,
} from '../../../../tests/integration/helpers/core';
import {createAppProvidersWrapper} from '../../../../tests/integration/helpers/react';
import {executarEmOrdem} from '../../../../tests/integration/helpers/orderedTeardown';
import {ActiveProjectProvider} from '../../contexts/ActiveProjectContext';
import {sleep} from '../../lib/sleep';
import {HomeTabs} from './index';

type TestStackParamsList = {
  Home: NavigatorScreenParams<HomeTabsParamsList>;
  ObservationCategoryChooser: undefined;
  // Configurações alvo (AppSettings) stub: pressionar a engrenagem deve sair
  // das home tabs e chegar aqui.
  AppSettings: undefined;
  // ExportObservations alvo do headerRight do Paneiro: stub para observar a
  // navegação disparada pelo Download Observations.
  ExportObservations: undefined;
};

const Stack = createNativeStackNavigator<TestStackParamsList>();

// The observation-creation flow's first stop, stubbed: pressing the map's
// "+" must leave the home tabs, which is all this suite needs to observe.
function StubObservationCategoryChooser() {
  return <View testID="STUB.category-chooser" />;
}

// Configurações alvo (AppSettings) stub: pressionar a engrenagem deve sair
// das home tabs e chegar aqui.
function StubAppSettings() {
  return <View testID="STUB.app-settings" />;
}

// ExportObservations alvo do Download Observations do Paneiro: stub.
function StubExport() {
  return <View testID="STUB.export-observations" />;
}

export type HomeTabsHarness = {
  navigation: NavigationContainerRef<TestStackParamsList>;
  client: ComapeoCoreClientApi;
  projectId: string;
  renderHomeTabs: () => Promise<void>;
};

/**
 * Registers the per-test core/IPC setup and teardown on the surrounding
 * `describe` and returns the live harness: its fields are re-assigned on every
 * test, so read them inside the tests, never destructure them.
 */
export function useHomeTabsHarness(): HomeTabsHarness {
  let manager: MapeoManager;
  let onTeardown: Array<() => unknown> = [];
  let coreTeardown: Array<() => unknown> = [];

  const harness = {} as HomeTabsHarness;

  beforeEach(async () => {
    onTeardown = [];
    coreTeardown = [];
    const {manager: mgr, fastifyController} = await createManager({
      name: 'test-device',
      deviceType: 'mobile',
    });
    manager = mgr;

    await fastifyController.start();

    const ipc = setUpIPC({manager});
    harness.client = ipc.client;
    coreTeardown.push(ipc.stop);
    // Same order as setupIntegrationTest (ipc → discovery → fastify): the
    // manager's local-peer discovery server keeps listening until forced
    // closed, and an open server handle keeps the jest worker from exiting.
    coreTeardown.push(() =>
      manager.stopLocalPeerDiscoveryServer({force: true}),
    );
    coreTeardown.push(() => fastifyController.stop());

    harness.projectId = await harness.client.createProject({
      name: 'Monitoramento',
    });
  });

  afterEach(async () => {
    // Tree and providers first: their teardown clears the QueryClient, so
    // in-flight queries are cancelled before `ipc.stop` drains the RPCs and
    // closes the channel.
    await executarEmOrdem([...onTeardown, ...coreTeardown]);
  }, 15_000);

  harness.renderHomeTabs = async function renderHomeTabs() {
    const app = createAppProvidersWrapper({
      mapeoApi: harness.client,
      activeProjectId: harness.projectId,
    });
    onTeardown.push(app.teardown);

    const {unmount} = await render(
      <NavigationContainer<TestStackParamsList>
        ref={ref => {
          harness.navigation = ref!;
        }}>
        <React.Suspense fallback={null}>
          <ActiveProjectProvider activeProjectId={harness.projectId}>
            <Stack.Navigator screenOptions={{headerShown: false}}>
              <Stack.Screen name="Home" component={HomeTabs} />
              <Stack.Screen
                name="ObservationCategoryChooser"
                component={StubObservationCategoryChooser}
              />
              <Stack.Screen name="AppSettings" component={StubAppSettings} />
              <Stack.Screen name="ExportObservations" component={StubExport} />
            </Stack.Navigator>
          </ActiveProjectProvider>
        </React.Suspense>
      </NavigationContainer>,
      {wrapper: app.wrapper},
    );

    onTeardown.unshift(async () => {
      await unmount();
      await sleep(0);
    });
  };

  return harness;
}
