import * as React from 'react';
import {StyleSheet} from 'react-native';
import {
  act,
  render,
  screen,
  userEvent,
  waitFor,
} from '@testing-library/react-native';
import {IntlProvider} from 'react-intl';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {useClientApi} from '@comapeo/core-react';
import type {ComapeoCoreClientApi} from '@comapeo/ipc';
import {createStore} from 'zustand';

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
  createTrackStore,
  TrackStoreProvider,
  type TrackStore,
} from '../contexts/TrackStoreContext';
import {
  type LocationState,
  useLocationContext,
} from '../contexts/LocationContext';
import {PermissionStatus} from 'expo-location';
import {MEMBER_ROLE_ID} from '../sharedTypes';
import {organizationDocument} from '../lib/organization/fixtures';
import {parseEstadoOrganizacoes} from '../lib/organization/coiabOrganizations';
import {COIAB_ORANGE, COIAB_RED, WHITE} from '../lib/styles';

import {OrganizationAreaAccesses} from './OrganizationAreaAccesses';

// The driver reports degraded boots to Sentry; the SDK itself stays off jest.
jest.mock('@sentry/react-native', () => ({
  captureException: jest.fn(),
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

// The real driver runs; only the client it reads through is faked, so the
// activation, the pending-work guard and the projection are all the real
// production paths.
jest.mock('@comapeo/core-react', () => ({
  useClientApi: jest.fn(),
}));

jest.mock('../hooks/useNavigationWithTypes', () => ({
  useNavigationFromRoot: () => mockNavigation,
}));

const useClientApiMock = useClientApi as unknown as jest.Mock;

const reset = jest.fn();
const popTo = jest.fn();
const mockNavigation = {
  reset,
  navigate: jest.fn(),
  popTo,
};

/**
 * `Promise.withResolvers` at runtime (Node 22 has it) with the typing the
 * project's older `lib` target still lacks.
 */
type PromiseWithResolvers = {
  withResolvers<T>(): {promise: Promise<T>; resolve: (value: T) => void};
};

function withResolvers<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  return (Promise as unknown as PromiseWithResolvers).withResolvers<T>();
}

type ProjectId = 'A-m' | 'A-a';

function fakeProject(roleId = MEMBER_ROLE_ID) {
  return {
    $getOwnRole: jest.fn(async () => ({roleId, reason: undefined})),
    $sync: {stop: jest.fn(), disconnectServers: jest.fn()},
  };
}

describe('OrganizationAreaAccesses — os dois cards da Entroncamento (SPEC A §6.1/D12, CA16)', () => {
  let projects: Record<ProjectId, ReturnType<typeof fakeProject>>;
  let clientApi: {
    getProject: jest.Mock;
    getDeviceInfo: jest.Mock;
    setDeviceInfo: jest.Mock;
    listProjects: jest.Mock;
  };
  let queryClient: QueryClient;
  let trackStore: TrackStore;
  let draftStore: DraftObservationStore;

  beforeEach(() => {
    jest.clearAllMocks();
    projects = {'A-m': fakeProject(), 'A-a': fakeProject()};
    clientApi = {
      getProject: jest.fn(async (id: ProjectId) => projects[id]),
      getDeviceInfo: jest.fn(async () => ({
        deviceId: 'device-1',
        name: 'Teste',
        deviceType: 'mobile',
      })),
      setDeviceInfo: jest.fn(async () => {}),
      // The ActiveProjectIdStore provider seeds itself from this on mount.
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

  /** The real driver and providers, mirroring AppProviders' nesting; only
   * the core client and the location store are faked. */
  function Providers({store}: {store: CoiabOrganizationsStore}) {
    return (
      <QueryClientProvider client={queryClient}>
        <TrackStoreProvider value={trackStore}>
          <DraftObservationProvider draftObservationStore={draftStore}>
            <ActiveProjectIdStoreProvider store={createActiveProjectIdStore()}>
              <CoiabOrganizationsStoreProvider store={store}>
                <OrganizationMaterializerProvider>
                  <OrganizationActivationProvider>
                    <IntlProvider locale="en" messages={{}}>
                      <OrganizationAreaAccesses />
                    </IntlProvider>
                  </OrganizationActivationProvider>
                </OrganizationMaterializerProvider>
              </CoiabOrganizationsStoreProvider>
            </ActiveProjectIdStoreProvider>
          </DraftObservationProvider>
        </TrackStoreProvider>
      </QueryClientProvider>
    );
  }

  /** The fixture document selects organization A, area Alertas. */
  async function renderAreaAccesses() {
    const store = createCoiabOrganizationsStore();
    store.instance.setState(organizationDocument(), true);
    await render(<Providers store={store} />);
    return {store};
  }

  async function renderWithoutOperableOrganization() {
    await render(<Providers store={createCoiabOrganizationsStore()} />);
  }

  test('mostra os dois cards com a corrente marcada e os títulos como texto', async () => {
    await renderAreaAccesses();

    // Os dois acessos fixos viram cards testáveis; a área corrente é
    // Alertas (documento), marcada como selecionada.
    expect(
      await screen.findByTestId('MENU.area-monitoramento'),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('MENU.area-alertas')).toBeOnTheScreen();
    expect(
      screen.getByTestId('MENU.area-alertas').props.accessibilityState,
    ).toEqual({selected: true});
    expect(
      screen.getByTestId('MENU.area-monitoramento').props.accessibilityState,
    ).toEqual({selected: false});
    // Review 3 (P2-1): rótulo a11y composto nos DOIS cards — título + nome
    // da organização; o título visível continua sendo o texto do card.
    expect(
      screen.getByTestId('MENU.area-monitoramento').props.accessibilityLabel,
    ).toBe('Monitoramento Territorial — Organização A');
    expect(
      screen.getByTestId('MENU.area-alertas').props.accessibilityLabel,
    ).toBe('Alertas — Organização A');
    expect(screen.getByText('Monitoramento Territorial')).toBeOnTheScreen();
    expect(screen.getByText('Alertas')).toBeOnTheScreen();
  });

  test('fundos dos cards #FF9500/#B90B0B e títulos brancos sobre o fundo escuro (Figma 2668:4539)', async () => {
    await renderAreaAccesses();

    await screen.findByTestId('MENU.area-monitoramento');
    expect(
      StyleSheet.flatten(
        screen.getByTestId('MENU.area-monitoramento').props.style,
      ),
    ).toEqual(expect.objectContaining({backgroundColor: COIAB_ORANGE}));
    expect(
      StyleSheet.flatten(screen.getByTestId('MENU.area-alertas').props.style),
    ).toEqual(expect.objectContaining({backgroundColor: COIAB_RED}));
    for (const titulo of ['Monitoramento Territorial', 'Alertas']) {
      expect(screen.getByText(titulo).props.style).toEqual(
        expect.arrayContaining([expect.objectContaining({color: WHITE})]),
      );
    }
  });

  test('toque no card da área corrente não ativa: popTo de volta ao Home/Map', async () => {
    const user = userEvent.setup();
    await renderAreaAccesses();

    await screen.findByTestId('MENU.area-alertas');
    // A montagem já validou a organização (o driver inicializa o motor); o
    // toque NÃO pode adicionar nenhuma consulta ao core.
    const consultasAntes = clientApi.getProject.mock.calls.length;
    await user.press(screen.getByTestId('MENU.area-alertas'));

    // Nenhuma ativação: sem consultas novas, sem reset — o toque volta ao
    // mapa (novo comportamento da página: popTo `Home/Map`).
    expect(clientApi.getProject.mock.calls).toHaveLength(consultasAntes);
    expect(reset).not.toHaveBeenCalled();
    expect(popTo).toHaveBeenCalledWith('Home', {screen: 'Map'});
  });

  test('toque duplo na outra área ativa uma vez: reset para Home/Map', async () => {
    const user = userEvent.setup();
    const {store} = await renderAreaAccesses();

    await screen.findByTestId('MENU.area-monitoramento');
    // O toque duplo cai com a primeira ativação EM VOO: a validação do
    // motor fica presa no gate até o release. O guard de ref é síncrono —
    // o segundo toque não pode nem começar outra ativação.
    const {promise: validacaoPresa, resolve: liberarValidacao} = withResolvers<{
      roleId: string;
      reason: undefined;
    }>();
    projects['A-m'].$getOwnRole.mockImplementation(() => validacaoPresa);
    await user.press(screen.getByTestId('MENU.area-monitoramento'));
    await user.press(screen.getByTestId('MENU.area-monitoramento'));

    // EXATAMENTE uma ativação: uma sequência de validação (A-m, A-a) e o
    // encerramento da origem (A-a), sem repetição.
    await act(async () => {
      liberarValidacao({roleId: MEMBER_ROLE_ID, reason: undefined});
    });
    expect(clientApi.getProject.mock.calls.map(([id]) => id)).toEqual([
      'A-m',
      'A-a',
      'A-m',
      'A-a',
      'A-a',
    ]);
    expect(store.instance.getState().ativa).toEqual({
      organizacaoId: 'A',
      area: 'monitoramento',
    });
    expect(parseEstadoOrganizacoes(store.instance.getState())).not.toBeNull();
    expect(reset).toHaveBeenCalledTimes(1);
    expect(reset.mock.calls[0]![0]).toEqual({
      index: 0,
      routes: [{name: 'Home', params: {screen: 'Map'}}],
    });
  });

  test('trabalho pendente: a troca é recusada e a string canônica §4.4 renderiza legível no fundo escuro', async () => {
    const user = userEvent.setup();
    const {store} = await renderAreaAccesses();

    await screen.findByTestId('MENU.area-monitoramento');
    draftStore.setProjectResolver(() => 'A-a');
    await act(async () => {
      draftStore.actions.createDraft();
    });

    await user.press(screen.getByTestId('MENU.area-monitoramento'));

    expect(await screen.findByText(/discard the record/)).toBeOnTheScreen();
    // Aviso legível no fundo escuro da página: branco, não o NEW_DARK_GREY
    // do cartão claro legado.
    expect(screen.getByText(/discard the record/).props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({color: WHITE})]),
    );
    // Recusada: nada trocou, nada resetou.
    expect(store.instance.getState().ativa).toEqual({
      organizacaoId: 'A',
      area: 'alertas',
    });
    expect(reset).not.toHaveBeenCalled();
  });

  test('a recusa não trava os cards: limpo o pendente, o próximo toque ativa e o reset acontece (review 2, P2-3)', async () => {
    const user = userEvent.setup();
    const {store} = await renderAreaAccesses();

    await screen.findByTestId('MENU.area-monitoramento');
    // Trabalho pendente: rascunho no projeto ativo bloqueia a troca.
    draftStore.setProjectResolver(() => 'A-a');
    await act(async () => {
      draftStore.actions.createDraft();
    });

    // 1º toque: activate retorna false, o aviso canônico renderiza e nada
    // se move.
    await user.press(screen.getByTestId('MENU.area-monitoramento'));
    expect(await screen.findByText(/discard the record/)).toBeOnTheScreen();
    expect(reset).not.toHaveBeenCalled();

    // Limpeza: descarta o rascunho — o bloqueio de trabalho some (a
    // mensagem do 1º toque persiste até a próxima ativação publicar).
    await act(async () => {
      draftStore.actions.clearDraft();
    });

    // 2º toque: se o `finally` NÃO tivesse liberado a trava, este toque
    // morreria no guard síncrono (nenhuma 2ª ativação, nenhum reset).
    await user.press(screen.getByTestId('MENU.area-monitoramento'));
    await waitFor(() => {
      expect(reset).toHaveBeenCalledTimes(1);
    });
    expect(reset.mock.calls[0]![0]).toEqual({
      index: 0,
      routes: [{name: 'Home', params: {screen: 'Map'}}],
    });
    expect(store.instance.getState().ativa).toEqual({
      organizacaoId: 'A',
      area: 'monitoramento',
    });
    // A publicação da 2ª ativação limpa o erro de recusa.
    await waitFor(() => {
      expect(screen.queryByText(/discard the record/)).not.toBeOnTheScreen();
    });
  });

  test('sem organização operável (derivação nula) renderiza null', async () => {
    await renderWithoutOperableOrganization();

    // Nada na tela: nem cards, nem aviso.
    await waitFor(() => {
      expect(
        screen.queryByTestId('MENU.area-monitoramento'),
      ).not.toBeOnTheScreen();
    });
    expect(screen.queryByTestId('MENU.area-alertas')).not.toBeOnTheScreen();
    expect(screen.queryByText(/discard the record/)).not.toBeOnTheScreen();
  });
});
