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
  within,
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
import {COIAB_ORGANIZATIONS_STORAGE_KEY} from '../../contexts/CoiabOrganizationsStoreContext';
import {MMKVStoreInitializer} from '../../hooks/persistedState/createPersistedState';
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

describe('HomeTabs — barra de 4 abas (#32)', () => {
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
    await executarEmOrdem([
      ...onTeardown,
      ...coreTeardown,
      () => MMKVStoreInitializer.removeItem(COIAB_ORGANIZATIONS_STORAGE_KEY),
    ]);
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

  test('a tab bar mostra exatamente 4 abas, Organização (ícone-só) ativa por padrão', async () => {
    await renderHomeTabs();

    // As quatro abas da barra (IDs de rota preservados: Map e
    // ObservationsList continuam Map e ObservationsList).
    const tabButtons = [
      'tabBarButtonOrganizacao',
      'tabBarButtonMap',
      'tabBarButtonNotificacoes',
      'tabBarButtonPaneiro',
    ];
    for (const testID of tabButtons) {
      expect(await screen.findByTestId(testID)).toBeTruthy();
    }
    // A Camera deixou de ser aba (só o botão some; a rota continua).
    expect(screen.queryByTestId('tabBarButtonCamera')).toBeNull();
    // Filtros e tracking saíram da tab bar (#32 feedback).
    expect(screen.queryByTestId('tabBarButtonFiltros')).toBeNull();
    expect(screen.queryByTestId('tabBarButtonTracking')).toBeNull();

    // A aba principal é ícone-só: sem texto visível (nem 'Entroncamento', nem
    // 'Organização', nem o nome do projeto). A acessibilidade vem do
    // accessibilityLabel do botão, não de um rótulo renderizado.
    const botaoOrg = await screen.findByTestId('tabBarButtonOrganizacao');
    expect(botaoOrg.props.accessibilityLabel).toBe('Organização');
    expect(within(botaoOrg).queryByText('Entroncamento')).toBeNull();
    expect(within(botaoOrg).queryByText('Organização')).toBeNull();
    expect(within(botaoOrg).queryByText('Monitoramento')).toBeNull();
    expect(screen.queryByText('Entroncamento')).toBeNull();
    expect(screen.queryByText('Filtros')).toBeNull();

    // Ativa por padrão: a bolinha teal indicadora aparece sob o logo.
    expect(
      within(botaoOrg).getByTestId('tabBarActiveDotOrganizacao'),
    ).toBeTruthy();

    // As outras três abas mantêm rótulo visível.
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

  test("aba principal não renderiza o texto 'Entroncamento' e leva à tela da organização", async () => {
    await renderHomeTabs();

    const botaoOrg = await screen.findByTestId('tabBarButtonOrganizacao');

    // Decisão de campo: a aba principal não tem rótulo visível 'Entroncamento'
    // em lugar nenhum da tela — nem no botão da aba, nem no header.
    expect(screen.queryByText('Entroncamento')).toBeNull();
    expect(within(botaoOrg).queryByText('Entroncamento')).toBeNull();

    // Seu conteúdo é a tela da organização (o hub Entroncamento), que é a rota
    // inicial e mostra seu placeholder.
    expect(mockNavigation.getCurrentRoute()?.name).toBe('Entroncamento');
    expect(await screen.findByTestId('ENTRONCAMENTO.scrn')).toBeTruthy();

    // Partindo de outra aba, tocar a aba principal volta para a tela da
    // organização — sem nunca renderizar o texto 'Entroncamento'.
    const user = userEvent.setup();
    await user.press(await screen.findByTestId('tabBarButtonMap'));
    expect(await screen.findByTestId('MAIN.map-screen')).toBeTruthy();

    await user.press(botaoOrg);
    expect(await screen.findByTestId('ENTRONCAMENTO.scrn')).toBeTruthy();
    expect(mockNavigation.getCurrentRoute()?.name).toBe('Entroncamento');
    expect(screen.queryByText('Entroncamento')).toBeNull();
  });

  test('o botão de trilha fica acessível dentro do mapa', async () => {
    await renderHomeTabs();
    const user = userEvent.setup();

    await user.press(await screen.findByTestId('tabBarButtonMap'));

    const trackBtn = await screen.findByTestId('mapTrackButton');
    expect(trackBtn).toBeTruthy();

    await user.press(trackBtn);
    expect(await screen.findByText('Ready to record new track?')).toBeTruthy();
  });

  // Mantido por último de propósito: a CameraScreen real segura recursos
  // assíncronos que só drenam no afterEach, então qualquer teste que montasse
  // a tab bar logo depois dela não acharia os botões. Como nada roda depois,
  // o vazamento não afeta outro teste.
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
