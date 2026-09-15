import * as React from 'react';
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
const mockNavigation = {
  reset,
  navigate: jest.fn(),
  popTo: jest.fn(),
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

describe('OrganizationAreaAccesses (SPEC A §6.1/D12, CA16)', () => {
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
  const closeMenu = jest.fn();

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
                      <OrganizationAreaAccesses closeMenu={closeMenu} />
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

  test('mostra o nome da organização, as duas áreas e marca a corrente como Atual', async () => {
    await renderAreaAccesses();

    // O nome completo está no texto e na leitura de acessibilidade
    // (SPEC A §6.1:195).
    expect(await screen.findByText('Organização A')).toBeOnTheScreen();
    expect(screen.getByLabelText('Organização A')).toBeOnTheScreen();
    expect(screen.getByTestId('MENU.area-monitoramento')).toBeOnTheScreen();
    expect(screen.getByTestId('MENU.area-alertas')).toBeOnTheScreen();
    // A área corrente é Alertas (documento): marcada como selecionada e com o
    // texto visível.
    expect(
      screen.getByTestId('MENU.area-alertas').props.accessibilityState,
    ).toEqual({selected: true});
    expect(
      screen.getByTestId('MENU.area-monitoramento').props.accessibilityState,
    ).toEqual({selected: false});
    expect(screen.getByText('Alerts')).toBeOnTheScreen();
    expect(screen.getByText('Monitoring')).toBeOnTheScreen();
    expect(screen.getByText('Current')).toBeOnTheScreen();
  });

  test('toque na área corrente não ativa: só fecha o menu', async () => {
    const user = userEvent.setup();
    await renderAreaAccesses();

    await screen.findByTestId('MENU.area-alertas');
    // A montagem já validou a organização (o driver inicializa o motor); o
    // toque NÃO pode adicionar nenhuma consulta ao core.
    const consultasAntes = clientApi.getProject.mock.calls.length;
    await user.press(screen.getByTestId('MENU.area-alertas'));

    // Nenhuma ativação: o motor nem consulta o core de novo.
    expect(clientApi.getProject.mock.calls).toHaveLength(consultasAntes);
    expect(reset).not.toHaveBeenCalled();
    expect(closeMenu).toHaveBeenCalledTimes(1);
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
    expect(closeMenu).toHaveBeenCalledTimes(1);
  });

  test('trabalho pendente: a troca é recusada e a string canônica §4.4 renderiza', async () => {
    const user = userEvent.setup();
    const {store} = await renderAreaAccesses();

    await screen.findByTestId('MENU.area-monitoramento');
    draftStore.setProjectResolver(() => 'A-a');
    await act(async () => {
      draftStore.actions.createDraft();
    });

    await user.press(screen.getByTestId('MENU.area-monitoramento'));

    expect(await screen.findByText(/discard the record/)).toBeOnTheScreen();
    // Recusada: nada trocou, nada resetou — mas o menu fecha (o contrato
    // fecha o menu após a tentativa).
    expect(store.instance.getState().ativa).toEqual({
      organizacaoId: 'A',
      area: 'alertas',
    });
    expect(reset).not.toHaveBeenCalled();
    expect(closeMenu).toHaveBeenCalledTimes(1);
  });

  test('sem organização operável (derivação nula) renderiza null', async () => {
    await renderWithoutOperableOrganization();

    // Nada na tela: nem o nome, nem as linhas.
    await waitFor(() => {
      expect(screen.queryByText('Organização A')).not.toBeOnTheScreen();
    });
    expect(
      screen.queryByTestId('MENU.area-monitoramento'),
    ).not.toBeOnTheScreen();
    expect(screen.queryByTestId('MENU.area-alertas')).not.toBeOnTheScreen();
  });
});
