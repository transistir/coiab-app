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

// `jest.mock` is file-scoped, so both tracking hooks delegate to the real
// implementation by default: the navigator suite keeps running the real
// track store, and only the TrackMapButton describe pins their return values.
jest.mock('../../hooks/useTracking', () => {
  const actual = jest.requireActual<typeof import('../../hooks/useTracking')>(
    '../../hooks/useTracking',
  );
  return {...actual, useTracking: jest.fn(actual.useTracking)};
});
jest.mock('../../hooks/useTrackTimer', () => {
  const actual = jest.requireActual<typeof import('../../hooks/useTrackTimer')>(
    '../../hooks/useTrackTimer',
  );
  return {...actual, useTrackTimer: jest.fn(actual.useTrackTimer)};
});

// The global SVG mock (src/frontend/__mocks__/svg.tsx) forwards only
// `testID`. As in ErrorBottomSheet.test.tsx, the track icon becomes a named
// host component instead, which keeps every prop (`color` included) visible.
jest.mock('../../images/Tracks.svg', () => 'TracksIcon');

process.env.MAPBOX_ACCESS_TOKEN = 'test-token';

import * as React from 'react';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {StyleSheet, View} from 'react-native';
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
import {sleep} from '../../lib/sleep';
import {COIAB_ORANGE, DARK_GREY, NEW_DARK_GREY, WHITE} from '../../lib/styles';
import {useTracking} from '../../hooks/useTracking';
import {useTrackTimer} from '../../hooks/useTrackTimer';
import {HomeTabs, TrackMapButton} from './index';

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

let mockNavigation: NavigationContainerRef<TestStackParamsList>;

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

// Antes do suite do navigator: o último teste dele (câmera) tem de continuar
// sendo o último do arquivo.
describe('TrackMapButton — estado de gravação (#32)', () => {
  const realUseTracking = jest.mocked(useTracking).getMockImplementation()!;
  const realUseTrackTimer = jest.mocked(useTrackTimer).getMockImplementation()!;

  beforeEach(() => {
    jest
      .mocked(useTracking)
      .mockReturnValue({isTracking: false} as ReturnType<typeof useTracking>);
    jest.mocked(useTrackTimer).mockReturnValue('00:01:23');
  });

  afterEach(() => {
    // Devolve os hooks reais ao suite do navigator.
    jest.mocked(useTracking).mockImplementation(realUseTracking);
    jest.mocked(useTrackTimer).mockImplementation(realUseTrackTimer);
  });

  test('parado: sem cronômetro, sem indicador verde e ícone cinza', async () => {
    await render(<TrackMapButton onPress={jest.fn()} />);

    expect(screen.getByLabelText('Track recording')).toBeTruthy();
    // O hook do cronômetro devolve um valor, mas parado ele não aparece.
    expect(screen.queryByText('00:01:23')).toBeNull();
    expect(screen.queryByTestId('mapTrackButton.indicator')).toBeNull();
    expect(screen.getByTestId('mapTrackButton.icon').props.color).toBe(
      NEW_DARK_GREY,
    );
  });

  test('gravando: cronômetro, indicador verde e ícone laranja', async () => {
    jest
      .mocked(useTracking)
      .mockReturnValue({isTracking: true} as ReturnType<typeof useTracking>);

    await render(<TrackMapButton onPress={jest.fn()} />);

    expect(screen.getByLabelText('Track recording')).toBeTruthy();
    expect(screen.getByText('00:01:23')).toBeTruthy();
    expect(screen.getByTestId('mapTrackButton.indicator')).toBeTruthy();
    expect(
      StyleSheet.flatten(
        screen.getByTestId('mapTrackButton.indicator').props.style,
      ).backgroundColor,
    ).toBe('#59A553');
    expect(screen.getByTestId('mapTrackButton.icon').props.color).toBe(
      COIAB_ORANGE,
    );
  });
});

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
  }

  test('a tab bar mostra exatamente 5 itens (menu, paneiro, map, notificações, configurações), sem rótulo de texto, Menu ativo por padrão', async () => {
    await renderHomeTabs();

    // Os cinco itens da barra do Figma `footer-menu`, na ordem
    // esquerda→direita. Paneiro usa a rota ObservationsList (funil ≠ filtro);
    // Configurações navega para AppSettings na root stack (não é aba).
    const tabButtons = [
      'tabBarButtonMenu',
      'tabBarButtonPaneiro',
      'tabBarButtonMap',
      'tabBarButtonNotificacoes',
      'tabBarButtonConfiguracoes',
    ];
    for (const testID of tabButtons) {
      expect(await screen.findByTestId(testID)).toBeTruthy();
    }
    // A Camera deixou de ser aba (só o botão some; a rota continua).
    expect(screen.queryByTestId('tabBarButtonCamera')).toBeNull();
    // Itens que saíram no v3: perfil nunca existiu; a trilha/download não
    // vive na barra (a trilha é ação DENTRO do mapa); Filtros deixou de ser
    // aba (o funil agora é o Paneiro).
    expect(screen.queryByTestId('tabBarButtonTracking')).toBeNull();
    expect(screen.queryByTestId('tabBarButtonFiltros')).toBeNull();
    expect(screen.queryByTestId('tabBarButtonEntroncamento')).toBeNull();

    // Sem rótulo de texto na barra (ícones apenas, como no Figma).
    expect(screen.queryByText('Menu')).toBeNull();
    expect(screen.queryByText('Paneiro')).toBeNull();
    expect(screen.queryByText('Filtros')).toBeNull();
    expect(screen.queryByText('Entroncamento')).toBeNull();

    // Menu é a rota inicial pós-login e renderiza a página de menu (o
    // conteúdo que o CoMapeo mostrava na drawer do header).
    expect(mockNavigation.getCurrentRoute()?.name).toBe('Menu');
    expect(await screen.findByTestId('MENU.scrn')).toBeTruthy();
    // Continuidade de testes de navigator (#32): a Home pós-login carrega o
    // testID ENTRONCAMENTO.scrn.
    expect(screen.getByTestId('ENTRONCAMENTO.scrn')).toBeTruthy();
  });

  test('o botão funil (paneiro) navega para a ObservationsList', async () => {
    await renderHomeTabs();
    const user = userEvent.setup();

    await user.press(await screen.findByTestId('tabBarButtonPaneiro'));

    expect(mockNavigation.getCurrentRoute()?.name).toBe('ObservationsList');
    // Sem observações no projeto novo, a lista existente cai na view vazia.
    expect(await screen.findByTestId('observationsEmptyView')).toBeTruthy();
  });

  test('o botão engrenagem navega para a tela de configurações (AppSettings)', async () => {
    await renderHomeTabs();
    const user = userEvent.setup();

    await user.press(await screen.findByTestId('tabBarButtonConfiguracoes'));

    await waitFor(() =>
      expect(mockNavigation.getCurrentRoute()?.name).toBe('AppSettings'),
    );
    expect(await screen.findByTestId('STUB.app-settings')).toBeTruthy();
  });

  test('o botão menu abre a página de menu (conteúdo da drawer atual)', async () => {
    await renderHomeTabs();
    const user = userEvent.setup();

    // Sai da Home para o mapa e volta pelo botão de menu.
    await user.press(await screen.findByTestId('tabBarButtonMap'));
    expect(await screen.findByTestId('MAIN.map-screen')).toBeTruthy();

    await user.press(await screen.findByTestId('tabBarButtonMenu'));

    expect(mockNavigation.getCurrentRoute()?.name).toBe('Menu');
    // A página de menu mostra o conteúdo do menu: o botão de ação (Exchange)
    // e o cartão da organização, que vivem no DrawerMenu reaproveitado.
    expect(
      within(screen.getByTestId('MENU.scrn')).getByTestId(
        'MENU.main-action-button',
      ),
    ).toBeTruthy();
  });

  test('a página de Menu usa o fundo do tema (#118)', async () => {
    await renderHomeTabs();

    // O container da Home pós-login (ENTRONCAMENTO.scrn) carrega o fundo
    // do tema em volta do conteúdo do menu.
    const menu = await screen.findByTestId('ENTRONCAMENTO.scrn');
    expect(menu.props.style).toEqual(
      expect.objectContaining({backgroundColor: DARK_GREY}),
    );
  });

  test('a página de Menu não tem header nenhum (headerShown: false)', async () => {
    await renderHomeTabs();
    const user = userEvent.setup();

    // Menu é a superfície inicial e não tem header algum: o DrawerMenu aplica
    // `insets.top` no topo do conteúdo. Sem HomeHeader não existe o antigo
    // chip transparente de organização flutuando sobre a saudação.
    await screen.findByTestId('MENU.scrn');
    expect(screen.queryByTestId('HOME.header-container')).toBeNull();
    expect(screen.queryByTestId('HOME.header')).toBeNull();
    expect(screen.queryByTestId('HOME.header-title')).toBeNull();

    // Escopo: as abas de conteúdo continuam com o header sólido.
    await user.press(await screen.findByTestId('tabBarButtonPaneiro'));
    const paneiroHeader = await screen.findByTestId('HOME.header-container');
    expect(StyleSheet.flatten(paneiroHeader.props.style)).toEqual(
      expect.objectContaining({
        backgroundColor: WHITE,
        borderBottomWidth: 1,
      }),
    );
    expect(await screen.findByTestId('HOME.header-title')).toBeTruthy();

    // Map mantém o header transparente (mapa sob a status bar).
    await user.press(await screen.findByTestId('tabBarButtonMap'));
    const mapHeader = await screen.findByTestId('HOME.header-container');
    expect(StyleSheet.flatten(mapHeader.props.style)).toEqual(
      expect.objectContaining({
        backgroundColor: 'transparent',
        borderBottomWidth: 0,
      }),
    );
  });

  test('a aba Menu anima com slide-in rápido da esquerda (#121)', async () => {
    await renderHomeTabs();
    await screen.findByTestId('tabBarButtonMenu');

    const menuOptions = mockNavigation.getCurrentOptions();
    expect(menuOptions).toEqual(
      expect.objectContaining({
        headerShown: false,
        animation: 'shift',
        sceneStyleInterpolator: expect.any(Function),
        transitionSpec: expect.objectContaining({animation: 'timing'}),
      }),
    );

    // As demais abas mantêm o comportamento atual: nenhum slide horizontal.
    const user = userEvent.setup();
    await user.press(await screen.findByTestId('tabBarButtonPaneiro'));
    await waitFor(() =>
      expect(mockNavigation.getCurrentRoute()?.name).toBe('ObservationsList'),
    );

    const paneiroOptions = mockNavigation.getCurrentOptions() as
      Record<string, unknown> | undefined;
    expect(paneiroOptions?.animation).not.toBe('shift');
    expect(paneiroOptions?.sceneStyleInterpolator).toBeUndefined();
    expect(paneiroOptions?.transitionSpec).toBeUndefined();
  });

  test('Notificações usa fundo do tema e texto branco (#118)', async () => {
    await renderHomeTabs();
    const user = userEvent.setup();

    await user.press(await screen.findByTestId('tabBarButtonNotificacoes'));

    const notificacoes = await screen.findByTestId('NOTIFICACOES.scrn');
    expect(notificacoes.props.style).toEqual(
      expect.objectContaining({backgroundColor: DARK_GREY}),
    );
    expect(screen.getByText('Notificações (em breve)').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({color: WHITE})]),
    );
  });

  test('a aba Map renderiza a MapScreen existente', async () => {
    await renderHomeTabs();
    const user = userEvent.setup();

    await user.press(await screen.findByTestId('tabBarButtonMap'));

    expect(await screen.findByTestId('MAIN.map-screen')).toBeTruthy();
  });

  test('o botão de trilha fica acessível dentro do mapa', async () => {
    await renderHomeTabs();
    const user = userEvent.setup();

    await user.press(await screen.findByTestId('tabBarButtonMap'));

    // Pelo testID primeiro (o ponto de RED do critério de aceite); o rótulo
    // de acessibilidade aponta para o mesmo elemento.
    const trackBtn = await screen.findByTestId('mapTrackButton');
    expect(trackBtn).toBeTruthy();
    expect(await screen.findByLabelText('Track recording')).toBe(trackBtn);

    await user.press(trackBtn);
    expect(await screen.findByText('Ready to record new track?')).toBeTruthy();
  });

  test('o botão de trilha só aparece na aba Map (#32)', async () => {
    await renderHomeTabs();
    const user = userEvent.setup();

    // O Map é aberto primeiro: a cena dele continua montada (inativa) ao
    // trocar de aba, então a ausência nas demais abas não é trivial.
    await user.press(await screen.findByTestId('tabBarButtonMap'));
    expect(await screen.findByLabelText('Track recording')).toBeTruthy();

    for (const [tabButton, conteudo] of [
      ['tabBarButtonPaneiro', 'observationsEmptyView'],
      ['tabBarButtonNotificacoes', 'NOTIFICACOES.scrn'],
      ['tabBarButtonMenu', 'MENU.scrn'],
    ] as const) {
      await user.press(await screen.findByTestId(tabButton));
      expect(await screen.findByTestId(conteudo)).toBeTruthy();
      await waitFor(() =>
        expect(screen.queryByLabelText('Track recording')).toBeNull(),
      );
      expect(screen.queryByTestId('mapTrackButton')).toBeNull();
    }
  });

  test('nenhuma aba tem botão de abrir menu (#118)', async () => {
    await renderHomeTabs();
    const user = userEvent.setup();

    // Header sólido (Paneiro, Notificações) e transparente (Map): nenhum
    // header home mostra mais o hambúrguer que abria a drawer. O Menu não tem
    // header algum (headerShown:false), então fica fora deste loop.
    for (const testID of [
      'tabBarButtonPaneiro',
      'tabBarButtonMap',
      'tabBarButtonNotificacoes',
    ]) {
      await user.press(await screen.findByTestId(testID));
      expect(await screen.findByTestId('HOME.header-title')).toBeTruthy();
      expect(screen.queryByLabelText('Open Menu')).toBeNull();
      expect(screen.queryByTestId('HOME.header-button')).toBeNull();
    }

    // O loop só termina na aba Notificações: nenhum teste sai de outra aba
    // e volta ao Menu pela tab bar. A rota inicial (`Menu`) tem de ser
    // alcançável de qualquer aba — sem drawer, é o único caminho de volta.
    await user.press(await screen.findByTestId('tabBarButtonMenu'));
    expect(mockNavigation.getCurrentRoute()?.name).toBe('Menu');
    expect(await screen.findByTestId('MENU.scrn')).toBeTruthy();
  });

  test('o conteúdo do menu monta uma única vez (#118)', async () => {
    await renderHomeTabs();
    const user = userEvent.setup();

    // No código antigo isso abria a gaveta; no novo não existe o botão de
    // menu em nenhum header — o conteúdo só é alcançado pela tab Menu.
    await user.press(await screen.findByTestId('tabBarButtonMenu'));

    // A página de Menu é a única superfície com o conteúdo (cartão,
    // itens e botão Exchange) — sem a cópia da drawer do CoMapeo.
    const copias = await screen.findAllByTestId('MENU.main-action-button', {
      includeHiddenElements: true,
    });
    expect(copias).toHaveLength(1);
  });

  test('o download do Paneiro segue funcionando sem o drawer (#118)', async () => {
    // Proteção contra regressão do headerRight durante a reescrita do
    // HomeHeader: passa antes e depois, sem RED (registrado no PR).
    await renderHomeTabs();
    const user = userEvent.setup();

    await user.press(await screen.findByTestId('tabBarButtonPaneiro'));
    // Sem observação nem trilha, o botão de download não existe.
    expect(screen.queryByLabelText('Download Observations')).toBeNull();
  });
  test('o download do Paneiro leva ao ExportObservations com observação (#118)', async () => {
    // Proteção contra regressão (sem RED): observação real criada na sessão
    // do core ANTES do render — a query do useObservations resolve com ela.
    const projectApi = await client.getProject(projectId);
    await projectApi.observation.create({
      schemaName: 'observation',
      lat: 12,
      lon: 34,
      attachments: [],
      tags: {},
    });
    await renderHomeTabs();
    const user = userEvent.setup();

    await user.press(await screen.findByTestId('tabBarButtonPaneiro'));

    const download = await screen.findByLabelText('Download Observations');
    await user.press(download);

    expect(mockNavigation.getCurrentRoute()?.name).toBe('ExportObservations');
  });
  // Último do suite por um motivo real: o navigate encaixado da câmera
  // (rota de aba via navigation ref) deixa o PreventRemoveProvider do
  // react-navigation com remoção pendente no worker sob jest, e o PRÓXIMO
  // mount do navigator fica pêndulo para sempre (nenhuma aba renderiza).
  // Cobertura da câmera intacta; o efeito morre junto com o worker.
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
