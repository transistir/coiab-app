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

process.env.MAPBOX_ACCESS_TOKEN = 'test-token';

import * as React from 'react';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {View} from 'react-native';
import {
  act,
  render,
  screen,
  userEvent,
  waitFor,
} from '@testing-library/react-native';

import type {MapeoManager} from '@comapeo/core';
import type {ComapeoCoreClientApi} from '@comapeo/ipc';

import {
  createManager,
  setUpIPC,
} from '../../../../tests/integration/helpers/core';
import {createAppProvidersWrapper} from '../../../../tests/integration/helpers/react';
import {executarEmOrdem} from '../../../../tests/integration/helpers/setupIntegrationTest';
import {ActiveProjectProvider} from '../../contexts/ActiveProjectContext';
import {sleep} from '../../lib/sleep';
import {HomeTabs} from './index';

type TestStackParamsList = {
  Home: NavigatorScreenParams<HomeTabsParamsList>;
  ObservationCategoryChooser: undefined;
};

const Stack = createNativeStackNavigator<TestStackParamsList>();

let mockNavigation: NavigationContainerRef<TestStackParamsList>;

// The observation-creation flow's first stop, stubbed: pressing the map's
// "+" must leave the home tabs, which is all this suite needs to observe.
function StubObservationCategoryChooser() {
  return <View testID="STUB.category-chooser" />;
}

describe('HomeTabs — barra de 5 abas (#32)', () => {
  let manager: MapeoManager;
  let client: ComapeoCoreClientApi;
  let projectId: string;
  let onTeardown: Array<() => unknown> = [];
  let coreTeardown: Array<() => unknown> = [];

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
    client = ipc.client;
    coreTeardown.push(ipc.stop);
    coreTeardown.push(() => fastifyController.stop());

    projectId = await client.createProject({name: 'Monitoramento'});
  });

  afterEach(async () => {
    // Tree and providers first: their teardown clears the QueryClient, so
    // in-flight queries are cancelled before `ipc.stop` drains the RPCs and
    // closes the channel.
    await executarEmOrdem([...onTeardown, ...coreTeardown]);
  }, 15_000);

  async function renderHomeTabs() {
    const app = createAppProvidersWrapper({
      mapeoApi: client,
      activeProjectId: projectId,
    });
    onTeardown.push(app.teardown);

    const {unmount} = await render(
      <NavigationContainer<TestStackParamsList>
        ref={ref => {
          mockNavigation = ref!;
        }}>
        <React.Suspense fallback={null}>
          <ActiveProjectProvider activeProjectId={projectId}>
            <Stack.Navigator screenOptions={{headerShown: false}}>
              <Stack.Screen name="Home" component={HomeTabs} />
              <Stack.Screen
                name="ObservationCategoryChooser"
                component={StubObservationCategoryChooser}
              />
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
  }

  test('a tab bar mostra exatamente 5 abas com labels, Entroncamento ativa por padrão', async () => {
    await renderHomeTabs();

    // As cinco abas da barra (IDs de rota preservados: Map e
    // ObservationsList continuam Map e ObservationsList).
    const tabButtons = [
      'tabBarButtonEntroncamento',
      'tabBarButtonFiltros',
      'tabBarButtonMap',
      'tabBarButtonNotificacoes',
      'tabBarButtonPaneiro',
    ];
    for (const testID of tabButtons) {
      expect(await screen.findByTestId(testID)).toBeTruthy();
    }
    // A Camera deixou de ser aba (só o botão some; a rota continua).
    expect(screen.queryByTestId('tabBarButtonCamera')).toBeNull();

    // Labels visíveis nas 5 abas.
    expect(screen.getByText('Entroncamento')).toBeTruthy();
    expect(screen.getByText('Filtros')).toBeTruthy();
    expect(screen.getByText('Map')).toBeTruthy();
    expect(screen.getByText('Notificações')).toBeTruthy();
    expect(screen.getByText('Paneiro')).toBeTruthy();

    // Entroncamento é a rota inicial pós-login e seu placeholder aparece.
    expect(mockNavigation.getCurrentRoute()?.name).toBe('Entroncamento');
    expect(screen.getByText('Olá')).toBeTruthy();
    expect(screen.getByText('4 módulos em breve')).toBeTruthy();
  });

  test('a aba Map renderiza a MapScreen existente', async () => {
    await renderHomeTabs();
    const user = userEvent.setup();

    await user.press(await screen.findByTestId('tabBarButtonMap'));

    expect(await screen.findByTestId('MAIN.map-screen')).toBeTruthy();
  });

  test('a aba Paneiro renderiza a ObservationsList existente', async () => {
    await renderHomeTabs();
    const user = userEvent.setup();

    await user.press(await screen.findByTestId('tabBarButtonPaneiro'));

    // Sem observações no projeto novo, a lista existente cai na view vazia
    // dela — é a ObservationsList montando, não uma tela nova.
    expect(await screen.findByTestId('observationsEmptyView')).toBeTruthy();
  });

  test('a criação de observação continua acessível e a rota Camera não sumiu', async () => {
    await renderHomeTabs();
    const user = userEvent.setup();

    // Fluxo atual de criação: o "+" do mapa continua navegando.
    await user.press(await screen.findByTestId('tabBarButtonMap'));
    await user.press(await screen.findByTestId('MAIN.add-observation-btn'));
    expect(await screen.findByTestId('STUB.category-chooser')).toBeTruthy();

    // A rota Camera segue registrada e montável dentro das home tabs.
    act(() => {
      mockNavigation.navigate('Home', {screen: 'Camera'});
    });
    await waitFor(() =>
      expect(mockNavigation.getCurrentRoute()?.name).toBe('Camera'),
    );
    expect(await screen.findByTestId('MAIN.camera-scrn')).toBeTruthy();
  });
});
