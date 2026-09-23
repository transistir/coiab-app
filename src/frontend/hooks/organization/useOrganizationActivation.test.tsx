import {act, renderHook, waitFor} from '@testing-library/react-native';
import {useClientApi} from '@comapeo/core-react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import type {ComapeoCoreClientApi} from '@comapeo/ipc';
import * as Sentry from '@sentry/react-native';
import React, {StrictMode, type ReactNode} from 'react';

import {
  COIAB_ORGANIZATIONS_STORAGE_KEY,
  CoiabOrganizationsStoreProvider,
  createCoiabOrganizationsStore,
  type CoiabOrganizationsStore,
} from '../../contexts/CoiabOrganizationsStoreContext';
import {MMKVStoreInitializer} from '../../hooks/persistedState/createPersistedState';
import {
  createOrganizationActivation,
  type ActivationOptions,
  type OrganizationActivation,
} from '../../lib/organization/activation';
import {
  organizationDocument,
  readyOrganization,
} from '../../lib/organization/fixtures';
import type {EstadoOrganizacoes} from '../../lib/organization/coiabOrganizations';
import type {
  CreationProject,
  TemplatePackage,
  TemplateSource,
} from '../../lib/organization/materializar';
import {projectsQueryKey} from '../../lib/organization/queryKeys';
import {CREATOR_ROLE_ID, MEMBER_ROLE_ID} from '../../sharedTypes';
import {OrganizationMaterializerProvider} from '../../contexts/OrganizationMaterializerContext';
import {useOrganizationActivation} from './useOrganizationActivation';
import {
  createDraftObservationStore,
  type DraftObservationStore,
} from '../../contexts/PersistedStores/DraftObservationStore';
import {DraftObservationProvider} from '../../contexts/DraftObservationContext';
import {
  createTrackStore,
  TrackStoreProvider,
  type TrackStore,
} from '../../contexts/TrackStoreContext';
import {
  type LocationState,
  useLocationContext,
} from '../../contexts/LocationContext';
import {PermissionStatus} from 'expo-location';
import {createStore} from 'zustand';
import {iniciarOperacao} from '../../lib/organization/operacoesEmAndamento';

// The hook reports degraded boots to Sentry; the SDK itself stays off jest.
jest.mock('@sentry/react-native', () => ({
  captureException: jest.fn(),
}));

// The draft provider requires a location store; a fake keeps the test off
// expo-location while the real draft context wiring runs.
jest.mock('../../contexts/LocationContext', () => {
  const actual = jest.requireActual('../../contexts/LocationContext');
  return {
    ...actual,
    useLocationContext: jest.fn(),
  };
});

// The hook reads the project API through `useClientApi`; a fake client keeps
// the test off IPC while still going through the real adapter.
jest.mock('@comapeo/core-react', () => ({
  useClientApi: jest.fn(),
}));

// The real engine runs; only its factory is wrapped so a test can observe how
// many engines the hook built and how many times each was initialized.
jest.mock('../../lib/organization/activation', () => {
  const actual = jest.requireActual('../../lib/organization/activation') as {
    createOrganizationActivation: (
      options: ActivationOptions,
    ) => OrganizationActivation;
  };
  return {
    ...actual,
    createOrganizationActivation: jest.fn((options: ActivationOptions) => {
      const engine = actual.createOrganizationActivation(options);
      return {...engine, initialize: jest.fn(engine.initialize)};
    }),
  };
});

const createOrganizationActivationMock =
  createOrganizationActivation as unknown as jest.Mock;
const useClientApiMock = useClientApi as unknown as jest.Mock;

type ProjectId = 'A-m' | 'A-a' | 'B-m' | 'B-a';

type FakeProject = {
  $getOwnRole: jest.Mock;
  $sync: {stop: jest.Mock; disconnectServers: jest.Mock};
};

function fakeProject(roleId = MEMBER_ROLE_ID): FakeProject {
  return {
    $getOwnRole: jest.fn(async () => ({roleId, reason: undefined})),
    $sync: {stop: jest.fn(), disconnectServers: jest.fn()},
  };
}

/**
 * `Promise.withResolvers` at runtime (Node 22 has it) with the typing the
 * project's older `lib` target still lacks.
 */
function withResolvers<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  // Node 22 ships `Promise.withResolvers`; the project's TS `lib` predates
  // it, so the constructor is viewed through the exact shape it exposes.
  const typedPromise = Promise as unknown as PromiseWithResolvers;
  return typedPromise.withResolvers<T>();
}

type PromiseWithResolvers = {
  withResolvers<T>(): {promise: Promise<T>; resolve: (value: T) => void};
};

describe('useOrganizationActivation', () => {
  let projects: Record<ProjectId, FakeProject>;
  let clientApi: {
    getProject: jest.Mock;
    getDeviceInfo: jest.Mock;
    setDeviceInfo: jest.Mock;
  };
  let queryClient: QueryClient;
  let trackStore: TrackStore;
  let draftStore: DraftObservationStore;

  beforeEach(() => {
    jest.clearAllMocks();
    projects = {
      'A-m': fakeProject(),
      'A-a': fakeProject(),
      'B-m': fakeProject(),
      'B-a': fakeProject(),
    };
    clientApi = {
      getProject: jest.fn(async (id: ProjectId) => projects[id]),
      getDeviceInfo: jest.fn(async () => ({
        deviceId: 'device-1',
        name: 'Teste',
        deviceType: 'mobile',
      })),
      setDeviceInfo: jest.fn(async () => {}),
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

  function createWrapper(store: CoiabOrganizationsStore, strict: boolean) {
    const Providers = ({children}: {children: ReactNode}) => (
      <QueryClientProvider client={queryClient}>
        <TrackStoreProvider value={trackStore}>
          <DraftObservationProvider draftObservationStore={draftStore}>
            <CoiabOrganizationsStoreProvider store={store}>
              {children}
            </CoiabOrganizationsStoreProvider>
          </DraftObservationProvider>
        </TrackStoreProvider>
      </QueryClientProvider>
    );
    return ({children}: {children: ReactNode}) =>
      strict ? (
        <StrictMode>
          <Providers>{children}</Providers>
        </StrictMode>
      ) : (
        <Providers>{children}</Providers>
      );
  }

  /** The persisted document (`organizationDocument`) selects organization A,
   * area Alertas — activation must publish `A-a`. */
  async function renderActivation({strict = false} = {}) {
    const store = createCoiabOrganizationsStore();
    store.instance.setState(organizationDocument(), true);
    const hook = await renderHook(() => useOrganizationActivation(), {
      wrapper: createWrapper(store, strict),
    });
    return {hook, store};
  }

  test('inicializa uma única vez e não reinicializa em re-render', async () => {
    const {hook} = await renderActivation();

    await waitFor(() => expect(hook.result.current.status).toBe('ready'));

    expect(hook.result.current.projectId).toBe('A-a');
    expect(hook.result.current.generation).toBe(1);
    expect(clientApi.getProject.mock.calls.map(([id]) => id)).toEqual([
      'A-m',
      'A-a',
    ]);

    const engine = createOrganizationActivationMock.mock.results[0]!.value;
    expect(createOrganizationActivationMock).toHaveBeenCalledTimes(1);
    expect(engine.initialize).toHaveBeenCalledTimes(1);

    await hook.rerender(undefined);
    await hook.rerender(undefined);

    expect(createOrganizationActivationMock).toHaveBeenCalledTimes(1);
    expect(engine.initialize).toHaveBeenCalledTimes(1);
    expect(clientApi.getProject).toHaveBeenCalledTimes(2);
    expect(hook.result.current.status).toBe('ready');
    // A healthy boot publishes nothing to the error channel (P3-8).
    expect(jest.mocked(Sentry.captureException)).not.toHaveBeenCalled();

    await hook.unmount();
  });

  test('montagem dupla (StrictMode) compartilha uma única ativação', async () => {
    const {hook} = await renderActivation({strict: true});

    await waitFor(() => expect(hook.result.current.status).toBe('ready'));

    // Two full initializations would validate both projects twice.
    expect(clientApi.getProject.mock.calls.map(([id]) => id)).toEqual([
      'A-m',
      'A-a',
    ]);
    expect(hook.result.current.generation).toBe(1);

    await hook.unmount();
  });

  test('a validação de papel vem do cliente de core: papel não-membro → recovery', async () => {
    projects['A-m'].$getOwnRole.mockResolvedValue({
      roleId: 'sem-papel',
      reason: undefined,
    });

    const {hook} = await renderActivation();

    await waitFor(() => expect(hook.result.current.status).toBe('recovery'));

    expect(clientApi.getProject).toHaveBeenCalledWith('A-m');
    expect(hook.result.current.error).toBe('unavailable');
    // P3-8: the degraded boot is not swallowed — it reaches the repo's
    // error-reporting convention with status and error code in the message.
    expect(jest.mocked(Sentry.captureException).mock.calls).toHaveLength(1);
    expect(
      jest.mocked(Sentry.captureException).mock.calls[0]![0],
    ).toMatchObject({
      message: expect.stringContaining('status=recovery error=unavailable'),
    });

    await hook.unmount();
  });

  test('activate encerra a origem pelo $sync do cliente e publica o novo projeto', async () => {
    const {hook, store} = await renderActivation();

    await waitFor(() => expect(hook.result.current.status).toBe('ready'));

    let switched!: boolean;
    await act(async () => {
      switched = await hook.result.current.activate('B');
    });

    expect(switched).toBe(true);
    expect(store.instance.getState().ativa).toEqual({
      organizacaoId: 'B',
      area: 'monitoramento',
    });
    expect(hook.result.current.projectId).toBe('B-m');
    expect(hook.result.current.generation).toBe(2);

    for (const projectId of ['A-m', 'A-a'] as const) {
      expect(projects[projectId].$sync.stop).toHaveBeenCalledTimes(1);
      expect(projects[projectId].$sync.disconnectServers).toHaveBeenCalledTimes(
        1,
      );
    }
    // Only the origin is torn down — the destination stays untouched.
    expect(projects['B-m'].$sync.stop).not.toHaveBeenCalled();
    expect(projects['B-a'].$sync.disconnectServers).not.toHaveBeenCalled();

    await hook.unmount();
  });

  test('recoverPendingWork é inerte sem trabalho pendente e preserva o contexto pronto', async () => {
    const {hook} = await renderActivation();

    await waitFor(() => expect(hook.result.current.status).toBe('ready'));

    let recovered!: boolean;
    await act(async () => {
      recovered = await hook.result.current.recoverPendingWork();
    });

    expect(recovered).toBe(false);
    expect(hook.result.current.status).toBe('ready');
    expect(hook.result.current.projectId).toBe('A-a');

    await hook.unmount();
  });

  test('revalidate exposto no handle: negação de acesso publica recovery sem geração nova', async () => {
    const {hook, store} = await renderActivation();

    await waitFor(() => expect(hook.result.current.status).toBe('ready'));
    expect(hook.result.current.generation).toBe(1);

    // A perda aparece DEPOIS do contexto pronto: revalidate reobserva as duas
    // áreas e publica a perda pelo próprio motor.
    projects['A-m'].$getOwnRole.mockResolvedValue({
      roleId: 'sem-papel',
      reason: undefined,
    });

    let revalidated!: boolean;
    await act(async () => {
      revalidated = await hook.result.current.revalidate();
    });

    expect(revalidated).toBe(false);
    expect(hook.result.current.status).toBe('recovery');
    expect(hook.result.current.error).toBe('access-unavailable');
    // Nenhuma geração nova: a revalidação nunca empurra o usuário para
    // Home/Map — nem no sucesso (nenhuma publicação), nem na falha.
    expect(hook.result.current.generation).toBe(1);
    // Regra 8: indisponível nunca apaga `ativa`.
    expect(store.instance.getState().ativa).toEqual({
      organizacaoId: 'A',
      area: 'alertas',
    });

    await hook.unmount();
  });

  // ---- Pending-work guard (Fase 8a) ---------------------------------------

  test('rascunho presente: troca de área recusada com pending-work e ativa inalterado', async () => {
    const {hook, store} = await renderActivation();

    await waitFor(() => expect(hook.result.current.status).toBe('ready'));

    draftStore.setProjectResolver(() => 'A-a');
    await act(async () => {
      draftStore.actions.createDraft();
    });

    let switched!: boolean;
    await act(async () => {
      switched = await hook.result.current.activate('B', {area: 'alertas'});
    });

    expect(switched).toBe(false);
    expect(hook.result.current.error).toBe('pending-work');
    // O guard é global: a troca nem chega a validar o destino — a seleção
    // persistida continua exatamente onde estava.
    expect(store.instance.getState().ativa).toEqual({
      organizacaoId: 'A',
      area: 'alertas',
    });

    await hook.unmount();
  });

  test('convite em voo: a opção chega ao motor e a ativação é recusada com pending-work', async () => {
    const {hook, store} = await renderActivation();

    await waitFor(() => expect(hook.result.current.status).toBe('ready'));

    // Uma operação em voo (o que `start()` dos hooks de convite registra) —
    // o guard a lê via `hasPendingWork` no momento da ativação.
    const encerrarOperacao = iniciarOperacao();
    let switched!: boolean;
    await act(async () => {
      switched = await hook.result.current.activate('B', {area: 'alertas'});
    });
    encerrarOperacao();

    expect(switched).toBe(false);
    expect(hook.result.current.error).toBe('pending-work');
    expect(store.instance.getState().ativa).toEqual({
      organizacaoId: 'A',
      area: 'alertas',
    });

    await hook.unmount();
  });

  test('unmount durante uma ativação em voo: nenhuma escrita após o unmount', async () => {
    // The assertion reads the durable document itself (in-memory state and
    // the MMKV raw), not engine spies: a motor running past its unmount must
    // never persist a selection the mounted hook did not commit.
    MMKVStoreInitializer.setItem(
      COIAB_ORGANIZATIONS_STORAGE_KEY,
      JSON.stringify({state: organizationDocument(), version: 1}),
    );
    const store = createCoiabOrganizationsStore({persist: true});
    const hook = await renderHook(() => useOrganizationActivation(), {
      wrapper: createWrapper(store, false),
    });

    await waitFor(() => expect(hook.result.current.status).toBe('ready'));

    // Park the destination's revalidation: the switch to `B` stays in flight
    // across the unmount until the resolver below fires.
    const {promise: destinationProject, resolve} = withResolvers<FakeProject>();
    clientApi.getProject.mockImplementation((id: ProjectId) =>
      id === 'B-m' ? destinationProject : Promise.resolve(projects[id]),
    );
    let switching!: Promise<boolean>;
    await act(async () => {
      switching = hook.result.current.activate('B');
    });
    await hook.unmount();
    resolve(projects['B-m']);
    await act(async () => {
      await switching;
      // A macrotask so every subscription side effect of the motor's
      // continuation also runs before the durable assertions.
      const settle = withResolvers<void>();
      setTimeout(settle.resolve, 0);
      await settle.promise;
    });

    // The motor did keep running (it fetched the destination), but neither
    // the in-memory copy nor the persisted raw moved away from `A`/alertas.
    expect(clientApi.getProject).toHaveBeenCalledWith('B-m');
    expect(store.instance.getState().ativa).toEqual({
      organizacaoId: 'A',
      area: 'alertas',
    });
    expect(
      (
        JSON.parse(
          MMKVStoreInitializer.getItem(
            COIAB_ORGANIZATIONS_STORAGE_KEY,
          ) as string,
        ).state as EstadoOrganizacoes
      ).ativa,
    ).toEqual({organizacaoId: 'A', area: 'alertas'});
  });

  // ---- Materializer adapter (Phase 4) -------------------------------------

  /** The document id IS the marker's organization id (SPEC B §4.1), so the
   * fixture carries a 16-lowercase-hex id like the production generator. */
  const ORG_ID = '0123456789abcdef';

  function preparingDocument(): EstadoOrganizacoes {
    return {
      versao: 1,
      organizacoes: [
        {
          ...readyOrganization(ORG_ID),
          estado: 'preparando',
          confirmacaoPendente: false,
        },
      ],
      ativa: {organizacaoId: ORG_ID, area: 'alertas'},
    };
  }

  /** Project surface the materializer's creation client reaches: settings
   * written by the flow must read back identical in the conferência. */
  function fakeCreationProject() {
    const settings: {
      name?: string;
      sendStats?: boolean;
      projectDescription?: string;
    } = {};
    return {
      $member: {
        getById: jest.fn(async () => ({
          name: 'Teste',
          deviceType: 'mobile',
          role: {roleId: CREATOR_ROLE_ID},
        })),
      },
      $importCategories: jest.fn(),
      $setProjectSettings: jest.fn(async (next: typeof settings) => {
        Object.assign(settings, next);
      }),
      $getProjectSettings: jest.fn(async () => ({...settings})),
    };
  }

  function fakeTemplates(): TemplateSource<CreationProject, TemplatePackage> {
    return {
      prepare: jest.fn(async () => ({
        monitoramento: {
          ref: {versao: '1', hash: 'monitoramento'},
          filePath: '/fake/monitoramento.comapeocat',
        },
        alertas: {
          ref: {versao: '1', hash: 'alertas'},
          filePath: '/fake/alertas.comapeocat',
        },
      })),
      verify: jest.fn(async () => true),
    } as unknown as TemplateSource<CreationProject, TemplatePackage>;
  }

  function createMaterializerWrapper(store: CoiabOrganizationsStore) {
    const templates = fakeTemplates();
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {gcTime: Infinity},
        mutations: {gcTime: Infinity},
      },
    });
    const invalidateQueries = jest.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({children}: {children: ReactNode}) => (
      <QueryClientProvider client={queryClient}>
        <TrackStoreProvider value={trackStore}>
          <DraftObservationProvider draftObservationStore={draftStore}>
            <CoiabOrganizationsStoreProvider store={store}>
              <OrganizationMaterializerProvider templates={templates}>
                {children}
              </OrganizationMaterializerProvider>
            </CoiabOrganizationsStoreProvider>
          </DraftObservationProvider>
        </TrackStoreProvider>
      </QueryClientProvider>
    );
    return {wrapper, invalidateQueries, templates};
  }

  test('retoma a preparação persistida através do materializador e publica confirmation', async () => {
    const store = createCoiabOrganizationsStore();
    store.instance.setState(preparingDocument(), true);
    // The resumed journal holds stable project ids: the creation client must
    // hand back one project object per id so settings survive both passes.
    const projectsById = new Map<string, unknown>();
    clientApi.getProject.mockImplementation(async (id: string) => {
      let project = projectsById.get(id);
      if (!project) {
        project = fakeCreationProject();
        projectsById.set(id, project);
      }
      return project;
    });
    const {wrapper, invalidateQueries, templates} =
      createMaterializerWrapper(store);

    const hook = await renderHook(() => useOrganizationActivation(), {
      wrapper,
    });

    await waitFor(() =>
      expect(hook.result.current.status).toBe('confirmation'),
    );

    expect(store.instance.getState().organizacoes[0]).toMatchObject({
      estado: 'pronta',
      confirmacaoPendente: true,
    });
    // Exactly one resume: the engine's startup adapter ran once (and the
    // materializer's prepare is the once-per-resume observable).
    expect(templates.prepare).toHaveBeenCalledTimes(1);
    // SPEC B §5.4 step 7: the project cache is invalidated after the resume.
    expect(
      invalidateQueries.mock.calls.map(call => call[0]?.queryKey),
    ).toContainEqual(projectsQueryKey);

    await hook.unmount();
  });

  test('sem o materializador não há retomada: unavailable com preparation-adapter-required e documento intacto', async () => {
    const store = createCoiabOrganizationsStore();
    store.instance.setState(preparingDocument(), true);

    const hook = await renderHook(() => useOrganizationActivation(), {
      wrapper: createWrapper(store, false),
    });

    await waitFor(() => expect(hook.result.current.status).toBe('unavailable'));
    expect(hook.result.current.error).toBe('preparation-adapter-required');
    // A missing adapter is absent capability, not a failed attempt: the
    // persisted document stays exactly as it was ('preparando', journal
    // intact, no 'falha_recuperável' write).
    expect(store.instance.getState().organizacoes[0]).toMatchObject({
      estado: 'preparando',
      confirmacaoPendente: false,
      areaEmExecucao: null,
    });

    await hook.unmount();
  });
});
