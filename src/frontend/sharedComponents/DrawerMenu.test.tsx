import * as React from 'react';
import {StyleSheet} from 'react-native';
import {fireEvent, render, screen} from '@testing-library/react-native';
import {IntlProvider} from 'react-intl';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {useClientApi} from '@comapeo/core-react';
import type {ComapeoCoreClientApi} from '@comapeo/ipc';
import {createStore} from 'zustand';

import {useProjectRoleAndDetails} from '../hooks/useProjectRoleAndDetails';
import {
  ActiveProjectIdStoreProvider,
  createActiveProjectIdStore,
} from '../contexts/ActiveProjectIdStoreContext';
import {
  createDraftObservationStore,
  type DraftObservationStore,
} from '../contexts/PersistedStores/DraftObservationStore';
import {DraftObservationProvider} from '../contexts/DraftObservationContext';
import {
  createCoiabOrganizationsStore,
  CoiabOrganizationsStoreProvider,
  type CoiabOrganizationsStore,
} from '../contexts/CoiabOrganizationsStoreContext';
import {OrganizationActivationProvider} from '../contexts/OrganizationActivationContext';
import {OrganizationMaterializerProvider} from '../contexts/OrganizationMaterializerContext';
import {
  createEarlyAccessStore,
  EarlyAccessStoreProvider,
  type EarlyAccessStore,
} from '../contexts/EarlyAccessContext';
import {
  createTrackStore,
  TrackStoreProvider,
  type TrackStore,
} from '../contexts/TrackStoreContext';
import {
  type LocationState,
  useLocationContext,
} from '../contexts/LocationContext';
import {PermissionStatus} from 'expo-location';
import {
  organizationDocument,
  readyOrganization,
} from '../lib/organization/fixtures';
import type {OrganizacaoLocal} from '../lib/organization/coiabOrganizations';
import {DEFAULT_PROJECT_COLOR} from '../constants';

import {DrawerMenu} from './DrawerMenu';
import {COIAB_ORANGE, COIAB_RED, DARK_GREY, ORANGE, WHITE} from '../lib/styles';

// Sonda: o svg real viraria um View sem cor visível no test-renderer; o
// mock registra o color repassado pelo renderIcon do DrawerMenu.
jest.mock('../images/Exchange.svg', () => {
  const {createElement} = require('react');
  const {View} = require('react-native');
  return {
    __esModule: true,
    default: (props: {color?: string}) =>
      createElement(View, {testID: 'ExchangeProbe', probeColor: props.color}),
  };
});

const mockNavigation = {
  navigate: jest.fn(),
  popTo: jest.fn(),
  reset: jest.fn(),
};
jest.mock('../hooks/useNavigationWithTypes', () => ({
  useNavigationFromRoot: () => mockNavigation,
}));

const mockActiveProject = {projectId: 'p-atual'};
jest.mock('../contexts/ActiveProjectContext', () => ({
  useActiveProject: () => mockActiveProject,
}));

jest.mock('../hooks/useStorageReadingQuery', () => ({
  useStorageReadingQuery: () => ({
    data: {freeBytes: 64 * 1024 * 1024 * 1024, totalBytes: Infinity},
  }),
}));

jest.mock('../hooks/useProjectRoleAndDetails', () => ({
  useProjectRoleAndDetails: jest.fn(),
}));

// The real driver runs; only the client it reads through is faked.
jest.mock('@comapeo/core-react', () => ({
  useClientApi: jest.fn(),
}));

// The draft provider requires a location store; a fake keeps the test off
// expo-location while the real draft context wiring runs.
jest.mock('../contexts/LocationContext', () => {
  const actual = jest.requireActual('../contexts/LocationContext');
  return {
    ...actual,
    useLocationContext: jest.fn(),
  };
});

// The driver reports degraded boots to Sentry; the SDK itself stays off jest.
jest.mock('@sentry/react-native', () => ({
  captureException: jest.fn(),
}));

const useClientApiMock = useClientApi as unknown as jest.Mock;
const useProjectRoleAndDetailsMock = useProjectRoleAndDetails as jest.Mock;

describe('DrawerMenu com as áreas da organização (SPEC A §6.1/D12)', () => {
  let clientApi: {
    getProject: jest.Mock;
    getDeviceInfo: jest.Mock;
    setDeviceInfo: jest.Mock;
    listProjects: jest.Mock;
  };
  let queryClient: QueryClient;
  let trackStore: TrackStore;
  let draftStore: DraftObservationStore;
  const closeMenu = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    useProjectRoleAndDetailsMock.mockReturnValue({
      role: 'coordinator',
      projectHeader: 'Monitoramento',
      projectName: 'Monitoramento',
      projectColor: '#232323',
      projectDescription: undefined,
    });
    clientApi = {
      getProject: jest.fn(async (id: string) => {
        throw new Error(`getProject inesperado: ${id}`);
      }),
      getDeviceInfo: jest.fn(async () => ({
        deviceId: 'device-1',
        name: 'Teste',
        deviceType: 'mobile',
      })),
      setDeviceInfo: jest.fn(async () => {}),
      // The ActiveProjectIdStoreProvider init reads this on mount.
      listProjects: jest.fn(async () => []),
    };
    useClientApiMock.mockReturnValue(
      clientApi as unknown as ComapeoCoreClientApi,
    );
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {gcTime: Infinity},
        mutations: {gcTime: Infinity},
      },
    });
    trackStore = createTrackStore();
    draftStore = createDraftObservationStore({persist: false});
    (useLocationContext as jest.Mock).mockReturnValue(
      createStore<LocationState>()(() => ({
        location: undefined,
        throttledMapLocation: undefined,
        locationPermission: PermissionStatus.DENIED,
        providerStatus: {
          locationServicesEnabled: false,
          backgroundModeEnabled: false,
          gpsAvailable: false,
          networkAvailable: false,
          passiveAvailable: false,
        },
      })),
    );
  });

  /** The real driver, mirroring AppProviders' nesting; the drawers's
   * OrganizationAreaAccesses consumes the shared activation context. */
  function Providers({
    store,
    earlyAccessStore,
  }: {
    store: CoiabOrganizationsStore;
    earlyAccessStore: EarlyAccessStore;
  }) {
    return (
      <QueryClientProvider client={queryClient}>
        <TrackStoreProvider value={trackStore}>
          <DraftObservationProvider draftObservationStore={draftStore}>
            <ActiveProjectIdStoreProvider store={createActiveProjectIdStore()}>
              <EarlyAccessStoreProvider value={earlyAccessStore}>
                <CoiabOrganizationsStoreProvider store={store}>
                  <OrganizationMaterializerProvider>
                    <OrganizationActivationProvider>
                      <IntlProvider locale="en" messages={{}}>
                        <DrawerMenu closeMenu={closeMenu} />
                      </IntlProvider>
                    </OrganizationActivationProvider>
                  </OrganizationMaterializerProvider>
                </CoiabOrganizationsStoreProvider>
              </EarlyAccessStoreProvider>
            </ActiveProjectIdStoreProvider>
          </DraftObservationProvider>
        </TrackStoreProvider>
      </QueryClientProvider>
    );
  }

  async function renderDrawer(
    operatingOrganization: boolean,
    {
      earlyAccess = false,
      organizacoes,
      ativa,
    }: {
      earlyAccess?: boolean;
      organizacoes?: OrganizacaoLocal[];
      ativa?: {organizacaoId: string; area: 'monitoramento' | 'alertas'};
    } = {},
  ) {
    const earlyAccessStore = createEarlyAccessStore({persist: false});
    if (earlyAccess) earlyAccessStore.actions.setEarlyAccessEnabled(true);
    const store = createCoiabOrganizationsStore();
    if (operatingOrganization) {
      store.instance.setState(
        {
          ...organizationDocument(),
          ...(organizacoes ? {organizacoes} : {}),
          ...(ativa ? {ativa} : {}),
        },
        true,
      );
    }
    await render(
      <Providers store={store} earlyAccessStore={earlyAccessStore} />,
    );
    return {store};
  }

  test('com organização operável: os dois cards substituem as linhas de área', async () => {
    await renderDrawer(true);

    // CA16 no menu: os dois acessos fixos são cards testáveis, com a
    // área corrente (Alertas na fixture) marcada.
    expect(
      await screen.findByTestId('MENU.area-monitoramento'),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('MENU.area-alertas')).toBeOnTheScreen();
    expect(
      screen.getByTestId('MENU.area-monitoramento').props.accessibilityState,
    ).toEqual({selected: false});
    expect(
      screen.getByTestId('MENU.area-alertas').props.accessibilityState,
    ).toEqual({selected: true});
    // O nome da organização é texto VISIBLE na saudação (review 2, P1-1:
    // o `projectHeader` da área — "Monitoramento" — não deve aparecer).
    expect(screen.getByText('Organização A')).toBeOnTheScreen();

    // A troca crua de projeto do CoMapeo (SPEC A §6.1:197) saiu do menu.
    expect(screen.queryByText('Switch Project')).not.toBeOnTheScreen();
  });

  test('os dois cards da página: fundos #FF9500 e #B90B0B (Figma 2668:4539)', async () => {
    await renderDrawer(true);

    await screen.findByTestId('MENU.area-monitoramento');
    expect(
      StyleSheet.flatten(
        screen.getByTestId('MENU.area-monitoramento').props.style,
      ),
    ).toEqual(expect.objectContaining({backgroundColor: COIAB_ORANGE}));
    expect(
      StyleSheet.flatten(screen.getByTestId('MENU.area-alertas').props.style),
    ).toEqual(expect.objectContaining({backgroundColor: COIAB_RED}));
  });

  test('saudação mostra o nome da ORGANIZAÇÃO com organização operável (review 2, P1-1)', async () => {
    await renderDrawer(true);

    expect(await screen.findByText('Olá, Parente')).toBeOnTheScreen();
    // `projectHeader` (área materializada) é "Monitoramento"; a saudação
    // deve mostrar o nome da organização em vez dele.
    expect(screen.getByText('Organização A')).toBeOnTheScreen();
    expect(screen.queryByText('Monitoramento')).not.toBeOnTheScreen();
  });

  test('toque no card da área corrente (Monitoramento): volta ao mapa sem ativar', async () => {
    // Fixture default: a corrente é Alertas; semeamos Monitoramento como
    // corrente para o card de Monitoramento ser o atual.
    await renderDrawer(true, {
      ativa: {organizacaoId: 'A', area: 'monitoramento'},
    });

    await screen.findByTestId('MENU.area-monitoramento');
    const consultasAntes = clientApi.getProject.mock.calls.length;
    await fireEvent.press(screen.getByTestId('MENU.area-monitoramento'));

    expect(mockNavigation.popTo).toHaveBeenCalledWith('Home', {
      screen: 'Map',
    });
    expect(mockNavigation.navigate).not.toHaveBeenCalled();
    expect(mockNavigation.reset).not.toHaveBeenCalled();
    // Nenhuma ativação: o motor nem consulta o core de novo.
    expect(clientApi.getProject.mock.calls).toHaveLength(consultasAntes);
  });

  test('sem organização operável: saudação presente, cards ausentes e o resto intacto', async () => {
    await renderDrawer(false);

    expect(await screen.findByText('Olá, Parente')).toBeOnTheScreen();
    expect(screen.getByTestId('MENU.main-action-button')).toBeOnTheScreen();
    expect(
      screen.queryByTestId('MENU.area-monitoramento'),
    ).not.toBeOnTheScreen();
    expect(screen.queryByTestId('MENU.area-alertas')).not.toBeOnTheScreen();
    expect(screen.queryByText('Switch Project')).not.toBeOnTheScreen();
  });

  test('projeto solo (sem documento de organização): saudação presente, sem cards nem Convidar', async () => {
    useProjectRoleAndDetailsMock.mockReturnValue({
      role: 'solo',
      projectHeader: 'Meu projeto',
      projectName: 'Meu projeto',
      projectColor: '#232323',
      projectDescription: undefined,
    });
    await renderDrawer(false);

    expect(await screen.findByText('Olá, Parente')).toBeOnTheScreen();
    expect(screen.getByText('Meu projeto')).toBeOnTheScreen();
    expect(screen.getByTestId('MENU.main-action-button')).toBeOnTheScreen();
    expect(
      screen.queryByTestId('MENU.area-monitoramento'),
    ).not.toBeOnTheScreen();
    expect(screen.queryByTestId('MENU.area-alertas')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('MENU.convidar')).not.toBeOnTheScreen();
  });

  test('projeto sem organização: a linha de descrição legada sai com o cartão', async () => {
    useProjectRoleAndDetailsMock.mockReturnValue({
      role: 'coordinator',
      projectHeader: 'Projeto X',
      projectName: 'Projeto X',
      projectColor: '#232323',
      projectDescription: 'Descrição do projeto',
    });
    await renderDrawer(false);

    expect(await screen.findByText('Projeto X')).toBeOnTheScreen();
    expect(screen.queryByText('Descrição do projeto')).not.toBeOnTheScreen();
    expect(
      screen.queryByTestId('MENU.area-monitoramento'),
    ).not.toBeOnTheScreen();
    expect(screen.queryByTestId('MENU.area-alertas')).not.toBeOnTheScreen();
  });

  test('acesso antecipado desligado, duas organizações: a entrada de troca existe', async () => {
    // O documento default já traz duas organizações (A ativa, B); a única
    // condição da entrada de troca é haver duas ou mais organizações.
    await renderDrawer(true);

    expect(
      await screen.findByTestId('MENU.trocar-organizacao'),
    ).toBeOnTheScreen();
    expect(screen.getByText('Trocar de organização')).toBeOnTheScreen();
  });

  test('acesso antecipado ligado, uma única organização: a entrada de troca não existe', async () => {
    // §8:247 — "Habilitado quando houver duas ou mais; uma única não
    // precisa de seletor". As áreas continuam; só a troca não existe.
    await renderDrawer(true, {
      earlyAccess: true,
      organizacoes: [readyOrganization('A')],
    });

    await screen.findByTestId('MENU.area-alertas');
    expect(
      screen.queryByTestId('MENU.trocar-organizacao'),
    ).not.toBeOnTheScreen();
  });

  test('acesso antecipado ligado, duas organizações: a entrada de troca existe', async () => {
    await renderDrawer(true, {earlyAccess: true});

    expect(
      await screen.findByTestId('MENU.trocar-organizacao'),
    ).toBeOnTheScreen();
  });

  test('toque na entrada de troca: fecha o menu e abre o seletor Organizations', async () => {
    await renderDrawer(true, {earlyAccess: true});

    await fireEvent.press(await screen.findByTestId('MENU.trocar-organizacao'));

    expect(closeMenu).toHaveBeenCalledTimes(1);
    expect(mockNavigation.navigate).toHaveBeenCalledWith('Organizations');
  });

  test('acesso antecipado ligado, organização operável: a entrada de criar existe', async () => {
    await renderDrawer(true, {earlyAccess: true});

    expect(
      await screen.findByTestId('MENU.criar-organizacao'),
    ).toBeOnTheScreen();
  });

  test('acesso antecipado desligado, organização operável: a entrada de criar existe', async () => {
    // A única condição da entrada de criar é haver organização operável.
    await renderDrawer(true);

    expect(
      await screen.findByTestId('MENU.criar-organizacao'),
    ).toBeOnTheScreen();
    expect(screen.getByText('Criar organização')).toBeOnTheScreen();
  });

  test('acesso antecipado desligado, uma única organização operável: criar existe e troca não', async () => {
    // Uma organização não precisa de seletor, mas ainda pode criar outra.
    await renderDrawer(true, {organizacoes: [readyOrganization('A')]});

    expect(
      await screen.findByTestId('MENU.criar-organizacao'),
    ).toBeOnTheScreen();
    expect(
      screen.queryByTestId('MENU.trocar-organizacao'),
    ).not.toBeOnTheScreen();
  });

  test('acesso antecipado ligado, sem organização operável: criar não existe', async () => {
    await renderDrawer(false, {earlyAccess: true});

    await screen.findByTestId('MENU.main-action-button');
    expect(
      screen.queryByTestId('MENU.criar-organizacao'),
    ).not.toBeOnTheScreen();
  });

  test('toque em criar: fecha o menu e abre CreateOrganization', async () => {
    await renderDrawer(true, {earlyAccess: true});

    await fireEvent.press(await screen.findByTestId('MENU.criar-organizacao'));

    expect(closeMenu).toHaveBeenCalledTimes(1);
    expect(mockNavigation.navigate).toHaveBeenCalledWith('CreateOrganization');
  });

  test('não-regressão com a entrada de troca: áreas, nome e proibidas ausentes', async () => {
    // §6.1:197 — "Trocar de projeto" e "Nova colaboração" não voltam com o
    // seletor; os dois cards e o nome da organização na saudação continuam
    // como estavam (review 2, P2-1: o rótulo assistivo do card saiu).
    await renderDrawer(true, {earlyAccess: true});

    expect(screen.getByText('Organização A')).toBeOnTheScreen();
    expect(screen.getByTestId('MENU.area-monitoramento')).toBeOnTheScreen();
    expect(screen.getByTestId('MENU.area-alertas')).toBeOnTheScreen();
    expect(screen.queryByText('Switch Project')).not.toBeOnTheScreen();
    expect(screen.queryByText('Collaborate')).not.toBeOnTheScreen();
  });

  test('ícone do PrimaryButton herda a cor repassada (nunca WHITE sobre ORANGE)', async () => {
    // Issue #19 (correção pós-review): o Exchange no drawer ignorava o
    // color que o PrimaryButton passa ao renderIcon e fixava WHITE —
    // contraste 1.69 sobre laranja. O renderIcon repassa; o ícone fica em
    // DARK_GREY (6.77).
    await renderDrawer(true);
    const botao = await screen.findByTestId('MENU.main-action-button');
    expect(botao.props.style).toEqual(
      expect.objectContaining({backgroundColor: ORANGE}),
    );
    // O renderIcon do DrawerMenu repassa a cor recebida (não fixa WHITE):
    // o PrimaryButton entrega DARK_GREY e o Exchange carrega.
    expect(screen.getByTestId('ExchangeProbe').props.probeColor).toBe(
      DARK_GREY,
    );
  });

  test('entradas legadas removidas e fundo do tema (remodelagem Entroncamento)', async () => {
    await renderDrawer(true, {earlyAccess: true});

    // Fundo do tema (Figma Kutary App V2) na raiz do conteúdo do menu.
    expect(screen.getByTestId('MENU.conteudo').props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({backgroundColor: DARK_GREY}),
      ]),
    );

    await screen.findByTestId('MENU.area-monitoramento');
    // As 5 entradas legadas do CoMapeo saíram da página de Menu.
    for (const texto of [
      'Team',
      'Coordinator Tools',
      'Gather Observations',
      'Background Map',
      'CoiabApp Settings',
    ] as const) {
      expect(screen.queryByText(texto)).not.toBeOnTheScreen();
    }
    for (const icone of [
      'MENU.icone.team',
      'MENU.icone.coordinator-tools',
      'MENU.icone.gather-observations',
      'MENU.icone.background-map',
      'MENU.icone.settings',
    ] as const) {
      expect(screen.queryByTestId(icone)).not.toBeOnTheScreen();
    }

    // O botão Exchange permanece.
    expect(screen.getByTestId('MENU.main-action-button')).toBeOnTheScreen();
  });

  test('Convidar presente p/ coordinator e navega para YourTeam', async () => {
    await renderDrawer(true, {earlyAccess: true});

    await fireEvent.press(await screen.findByTestId('MENU.convidar'));

    expect(mockNavigation.navigate).toHaveBeenCalledWith('YourTeam');
  });

  test('Convidar ausente p/ participant (entradas de troca seguem)', async () => {
    useProjectRoleAndDetailsMock.mockReturnValue({
      role: 'participant',
      projectHeader: 'Monitoramento',
      projectName: 'Monitoramento',
      projectColor: '#232323',
      projectDescription: undefined,
    });
    await renderDrawer(true, {earlyAccess: true});

    await screen.findByTestId('MENU.area-monitoramento');
    expect(screen.queryByTestId('MENU.convidar')).not.toBeOnTheScreen();
    // Predicados/testIDs preservados para participant também.
    expect(screen.getByTestId('MENU.trocar-organizacao')).toBeOnTheScreen();
    expect(screen.getByTestId('MENU.criar-organizacao')).toBeOnTheScreen();
  });

  test('entradas de organização em branco sobre o fundo escuro (remodelagem)', async () => {
    // A página inteira vive agora no fundo DARK_GREY: os títulos das
    // entradas precisam ser WHITE (o DARK_GREY legado sumiria no fundo
    // escuro), mesmo com o projectColor claro no mock.
    useProjectRoleAndDetailsMock.mockReturnValue({
      role: 'coordinator',
      projectHeader: 'Monitoramento',
      projectName: 'Monitoramento',
      projectColor: DEFAULT_PROJECT_COLOR,
      projectDescription: undefined,
    });
    await renderDrawer(true, {earlyAccess: true});

    for (const texto of ['Trocar de organização', 'Criar organização']) {
      expect(screen.getByText(texto).props.style).toEqual(
        expect.arrayContaining([expect.objectContaining({color: WHITE})]),
      );
    }
  });
});
