import {act, renderHook} from '@testing-library/react-native';
import React, {type ReactNode} from 'react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import type {ComapeoCoreClientApi} from '@comapeo/ipc';
import {ComapeoCoreProvider} from '@comapeo/core-react';

import {MapeoApiWrapper} from '../../../../tests/integration/helpers/MapeoApiWrapper';
import {
  ActiveProjectIdStoreProvider,
  createActiveProjectIdStore,
  useActiveProjectId,
  type ActiveProjectIdStore,
} from '../../contexts/ActiveProjectIdStoreContext';
import {
  CoiabOrganizationsStoreProvider,
  createCoiabOrganizationsStore,
  type CoiabOrganizationsStore,
} from '../../contexts/CoiabOrganizationsStoreContext';
import {
  createOrganizationInviteIdentityStore,
  OrganizationInviteIdentityStoreProvider,
  type OrganizationInviteIdentityStore,
} from '../../contexts/OrganizationInviteIdentityStoreContext';
import type {
  InviteLike,
  OrganizationInviteBundle,
} from '../../lib/organization/bundle';
import {OrganizationOperationError} from '../../lib/organization/fanout';
import type {OrganizacaoLocal} from '../../lib/organization/coiabOrganizations';
import {markerFor} from '../../lib/organization/marker';
import {
  invitesQueryKey,
  projectsQueryKey,
} from '../../lib/organization/queryKeys';
import {
  useAcceptOrganizationBundle,
  type AcceptOrganizationBundleResult,
} from './useAcceptOrganizationBundle';

// The activation engine is mounted once at the root; the accept hook only
// hands a registered entry to `retryPreparation`. A stubbed handle observes
// that hand-off without building a second engine in the test.
const mockRetryPreparation = jest.fn();
jest.mock('../../contexts/OrganizationActivationContext', () => ({
  useOrganizationActivationContext: () => ({
    retryPreparation: (...args: [string]) => mockRetryPreparation(...args),
  }),
}));

const ORG_ID = 'a1b2c3d4e5f60718';
const ORG_NAME = 'Org Um';

function makeInvite(slot: 'm' | 'a', inviteId: string): InviteLike {
  return {
    inviteId,
    projectDescription: markerFor(ORG_ID, slot, ORG_NAME),
    invitorDeviceId: 'invitor-1',
    roleName: 'Coordinator',
    receivedAt: 1,
    state: 'pending',
  };
}

function makeBundle(): OrganizationInviteBundle {
  return {
    organizationId: ORG_ID,
    organizationName: ORG_NAME,
    invitorDeviceId: 'invitor-1',
    roleName: 'Coordinator',
    invites: {
      m: makeInvite('m', 'invite-m'),
      a: makeInvite('a', 'invite-a'),
    },
    allInviteIds: ['invite-m', 'invite-a'],
    completeness: 'complete',
  };
}

type FakeProject = {
  projectId: string;
  projectDescription?: string;
};

function createFakeClient(projects: FakeProject[] = []) {
  const accept = jest.fn();
  const clientApi = {
    listProjects: async () =>
      projects.map(project => ({
        ...project,
        name: 'fake',
        createdAt: '',
        updatedAt: '',
        status: 'joined' as const,
      })),
    invite: {
      accept,
      addListener: jest.fn(),
      removeListener: jest.fn(),
    },
    on: jest.fn(),
  };
  return {
    clientApi: clientApi as unknown as ComapeoCoreClientApi,
    accept,
  };
}

describe('useAcceptOrganizationBundle', () => {
  let store: ActiveProjectIdStore;
  let identityStore: OrganizationInviteIdentityStore;
  let coiabStore: CoiabOrganizationsStore;

  beforeEach(() => {
    store = createActiveProjectIdStore();
    identityStore = createOrganizationInviteIdentityStore();
    // Non-persisted and always fresh: `registrarEntradaPorConvite` refuses
    // any document that already holds an organization (SPEC A :127).
    coiabStore = createCoiabOrganizationsStore();
    mockRetryPreparation.mockClear();
  });

  function createWrapper(clientApi: ComapeoCoreClientApi) {
    return ({children}: {children: ReactNode}) => (
      <MapeoApiWrapper mapeoApi={clientApi}>
        <CoiabOrganizationsStoreProvider store={coiabStore}>
          <ActiveProjectIdStoreProvider store={store}>
            <OrganizationInviteIdentityStoreProvider store={identityStore}>
              {children}
            </OrganizationInviteIdentityStoreProvider>
          </ActiveProjectIdStoreProvider>
        </CoiabOrganizationsStoreProvider>
      </MapeoApiWrapper>
    );
  }

  /** Like `createWrapper`, but owns its query client — and spies on it. */
  function createSpiedWrapper(clientApi: ComapeoCoreClientApi) {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {gcTime: Infinity},
        mutations: {gcTime: Infinity},
      },
    });
    const invalidateQueries = jest.spyOn(queryClient, 'invalidateQueries');
    // Mock map server API for tests (mirrors MapeoApiWrapper).
    const getMapServerBaseUrl = async () => new URL('http://localhost:8080');
    const mockFetch = async () => ({}) as Response;
    return {
      wrapper: ({children}: {children: ReactNode}) => (
        <QueryClientProvider client={queryClient}>
          <ComapeoCoreProvider
            clientApi={clientApi}
            getMapServerBaseUrl={getMapServerBaseUrl}
            fetch={mockFetch}
            queryClient={queryClient}>
            <CoiabOrganizationsStoreProvider store={coiabStore}>
              <ActiveProjectIdStoreProvider store={store}>
                <OrganizationInviteIdentityStoreProvider store={identityStore}>
                  {children}
                </OrganizationInviteIdentityStoreProvider>
              </ActiveProjectIdStoreProvider>
            </CoiabOrganizationsStoreProvider>
          </ComapeoCoreProvider>
        </QueryClientProvider>
      ),
      invalidateQueries,
    };
  }

  test('a complete accept registers the entry by invite and does not force the active project', async () => {
    const {clientApi, accept} = createFakeClient();
    accept
      .mockResolvedValueOnce('project-monitoramento')
      .mockResolvedValueOnce('project-alertas');
    const registrarEntrada = jest.spyOn(
      coiabStore.actions,
      'registrarEntradaPorConvite',
    );
    const projetar = jest.spyOn(store.actions, 'projetar');

    const hook = await renderHook(
      () => ({
        acceptBundle: useAcceptOrganizationBundle(),
        activeProjectId: useActiveProjectId(),
      }),
      {wrapper: createWrapper(clientApi)},
    );

    let outcome: AcceptOrganizationBundleResult | undefined;
    await act(async () => {
      outcome = await hook.result.current.acceptBundle.start(makeBundle());
    });

    expect(hook.result.current.acceptBundle.status).toBe('success');
    expect(hook.result.current.acceptBundle.error).toBeUndefined();
    expect(accept).toHaveBeenCalledTimes(2);
    expect(accept).toHaveBeenCalledWith({inviteId: 'invite-m'});
    expect(accept).toHaveBeenCalledWith({inviteId: 'invite-a'});
    // SPEC B §5.5: both areas joined by invite — the durable document gets
    // the registered entry, and the ENGINE (retryPreparation) owns what
    // becomes active; the hook must not force a slot itself.
    expect(registrarEntrada).toHaveBeenCalledTimes(1);
    expect(registrarEntrada).toHaveBeenCalledWith({
      organizacaoId: ORG_ID,
      nome: ORG_NAME,
      projectIds: {
        monitoramento: 'project-monitoramento',
        alertas: 'project-alertas',
      },
    });
    expect(projetar).not.toHaveBeenCalled();
    expect(hook.result.current.activeProjectId).toBeUndefined();
    expect(mockRetryPreparation).toHaveBeenCalledWith(ORG_ID);
    expect(outcome).toMatchObject({
      ok: true,
      registeredOrganizationId: ORG_ID,
    });
    expect(coiabStore.instance.getState().organizacoes).toHaveLength(1);
    expect(coiabStore.instance.getState().organizacoes[0]).toMatchObject({
      id: ORG_ID,
      estado: 'preparando',
      confirmacaoPendente: false,
      materializacao: {
        monitoramento: {
          etapa: 'criado',
          projectId: 'project-monitoramento',
          template: null,
          idsAntesDaCriacao: null,
        },
        alertas: {
          etapa: 'criado',
          projectId: 'project-alertas',
          template: null,
          idsAntesDaCriacao: null,
        },
      },
    });

    hook.unmount();
  });
  test('a second invitation hands the retoma to the invited organization by id, leaving A and ativa untouched', async () => {
    // A is ready and acknowledged, selected as active. The retoma of B's
    // accept must point at B's id — never at the first entry of the
    // document — and must not touch A nor the persisted selection.
    const ORG_A_ID = '9c8b7a6d5e4f3210';
    const organizacaoA: OrganizacaoLocal = {
      id: ORG_A_ID,
      nome: 'Org A',
      estado: 'pronta',
      confirmacaoPendente: false,
      materializacao: {
        monitoramento: {
          etapa: 'verificado',
          projectId: 'A-monitoramento',
          template: {versao: '1', hash: 'hash-a-m'},
          idsAntesDaCriacao: null,
        },
        alertas: {
          etapa: 'verificado',
          projectId: 'A-alertas',
          template: {versao: '1', hash: 'hash-a-a'},
          idsAntesDaCriacao: null,
        },
      },
      areaEmExecucao: null,
      ultimoErro: null,
    };
    coiabStore.instance.setState(
      {
        versao: 1,
        organizacoes: [organizacaoA],
        ativa: {organizacaoId: ORG_A_ID, area: 'monitoramento'},
      },
      true,
    );
    const {clientApi, accept} = createFakeClient();
    accept
      .mockResolvedValueOnce('project-monitoramento')
      .mockResolvedValueOnce('project-alertas');
    const registrarEntrada = jest.spyOn(
      coiabStore.actions,
      'registrarEntradaPorConvite',
    );
    const projetar = jest.spyOn(store.actions, 'projetar');

    const hook = await renderHook(
      () => ({
        acceptBundle: useAcceptOrganizationBundle(),
        activeProjectId: useActiveProjectId(),
      }),
      {wrapper: createWrapper(clientApi)},
    );

    let outcome: AcceptOrganizationBundleResult | undefined;
    await act(async () => {
      outcome = await hook.result.current.acceptBundle.start(makeBundle());
    });

    expect(hook.result.current.acceptBundle.status).toBe('success');
    expect(accept).toHaveBeenCalledTimes(2);
    expect(registrarEntrada).toHaveBeenCalledTimes(1);
    expect(registrarEntrada).toHaveBeenCalledWith({
      organizacaoId: ORG_ID,
      nome: ORG_NAME,
      projectIds: {
        monitoramento: 'project-monitoramento',
        alertas: 'project-alertas',
      },
    });
    // The retoma points at B by id; the hook never projects a project id.
    expect(mockRetryPreparation).toHaveBeenCalledTimes(1);
    expect(mockRetryPreparation).toHaveBeenCalledWith(ORG_ID);
    expect(projetar).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({
      ok: true,
      registeredOrganizationId: ORG_ID,
    });
    // A preserved by reference; B appended; the persisted selection intact.
    const depois = coiabStore.instance.getState();
    expect(depois.organizacoes).toHaveLength(2);
    expect(depois.organizacoes[0]).toBe(organizacaoA);
    expect(depois.organizacoes[1]?.id).toBe(ORG_ID);
    expect(depois.ativa).toStrictEqual({
      organizacaoId: ORG_A_ID,
      area: 'monitoramento',
    });

    hook.unmount();
  });

  test('an accept whose organization is absent from the document at retoma time fails with invite-registration-missing and writes nothing', async () => {
    // The registration refuses (a projectId already associated with another
    // local organization), so the bundle's organization has NO entry in the
    // durable document at retoma time — an impossible state for the invite
    // flow. The hook must publish a typed error with NO write: no
    // projection, no retoma hand-off, the document byte-identical and the
    // pinned recovery identity untouched.
    const ORG_A_ID = '9c8b7a6d5e4f3210';
    const organizacaoA: OrganizacaoLocal = {
      id: ORG_A_ID,
      nome: 'Org A',
      estado: 'preparando',
      confirmacaoPendente: false,
      materializacao: {
        monitoramento: {
          etapa: 'criado',
          projectId: 'project-monitoramento',
          template: null,
          idsAntesDaCriacao: null,
        },
        alertas: {
          etapa: 'criado',
          projectId: 'A-alertas',
          template: null,
          idsAntesDaCriacao: null,
        },
      },
      areaEmExecucao: null,
      ultimoErro: null,
    };
    coiabStore.instance.setState(
      {versao: 1, organizacoes: [organizacaoA], ativa: null},
      true,
    );
    const {clientApi, accept} = createFakeClient();
    accept
      .mockResolvedValueOnce('project-monitoramento')
      .mockResolvedValueOnce('project-alertas');
    const registrarEntrada = jest.spyOn(
      coiabStore.actions,
      'registrarEntradaPorConvite',
    );
    const projetar = jest.spyOn(store.actions, 'projetar');

    const hook = await renderHook(
      () => ({
        acceptBundle: useAcceptOrganizationBundle(),
        activeProjectId: useActiveProjectId(),
      }),
      {wrapper: createWrapper(clientApi)},
    );

    let outcome: AcceptOrganizationBundleResult | undefined;
    await act(async () => {
      outcome = await hook.result.current.acceptBundle.start(makeBundle());
    });

    expect(hook.result.current.acceptBundle.status).toBe('error');
    const error = hook.result.current.acceptBundle.error;
    expect(error).toBeInstanceOf(OrganizationOperationError);
    expect((error as OrganizationOperationError).code).toBe(
      'invite-registration-missing',
    );
    expect((error as OrganizationOperationError).details?.organizationId).toBe(
      ORG_ID,
    );
    expect(registrarEntrada).toHaveBeenCalledTimes(1);
    expect(projetar).not.toHaveBeenCalled();
    expect(mockRetryPreparation).not.toHaveBeenCalled();
    // No write: A preserved by reference, nothing appended, ativa intact.
    const depois = coiabStore.instance.getState();
    expect(depois.organizacoes).toStrictEqual([organizacaoA]);
    expect(depois.organizacoes[0]).toBe(organizacaoA);
    expect(depois.ativa).toBeNull();
    // The failure must not unpin the recovery identity.
    expect(identityStore.instance.getState()).toStrictEqual({
      [ORG_ID]: {invitorDeviceId: 'invitor-1', roleName: 'Coordinator'},
    });
    expect(outcome).toMatchObject({ok: false});

    hook.unmount();
  });

  test('a re-delivery for an already-ready organization stays a success without a retoma hand-off', async () => {
    // The organization reached `pronta` in the document: the store REFUSES
    // the re-delivery with NO write, but the entry is present by id — the
    // organization is already durably entered, so the outcome stays a
    // success with NO retoma hand-off (the engine has nothing to prepare)
    // and NO projection. Not an `invite-registration-missing` error.
    const {clientApi, accept} = createFakeClient([
      {
        projectId: 'project-monitoramento',
        projectDescription: markerFor(ORG_ID, 'm', ORG_NAME),
      },
      {
        projectId: 'project-alertas',
        projectDescription: markerFor(ORG_ID, 'a', ORG_NAME),
      },
    ]);
    const pronta: OrganizacaoLocal = {
      id: ORG_ID,
      nome: ORG_NAME,
      estado: 'pronta',
      confirmacaoPendente: true,
      materializacao: {
        monitoramento: {
          etapa: 'verificado',
          projectId: 'project-monitoramento',
          template: {versao: '1', hash: 'hash-b-m'},
          idsAntesDaCriacao: null,
        },
        alertas: {
          etapa: 'verificado',
          projectId: 'project-alertas',
          template: {versao: '1', hash: 'hash-b-a'},
          idsAntesDaCriacao: null,
        },
      },
      areaEmExecucao: null,
      ultimoErro: null,
    };
    coiabStore.instance.setState(
      {versao: 1, organizacoes: [pronta], ativa: null},
      true,
    );
    const registrarEntrada = jest.spyOn(
      coiabStore.actions,
      'registrarEntradaPorConvite',
    );
    const projetar = jest.spyOn(store.actions, 'projetar');

    const hook = await renderHook(
      () => ({
        acceptBundle: useAcceptOrganizationBundle(),
        activeProjectId: useActiveProjectId(),
      }),
      {wrapper: createWrapper(clientApi)},
    );

    let outcome: AcceptOrganizationBundleResult | undefined;
    await act(async () => {
      outcome = await hook.result.current.acceptBundle.start(makeBundle());
    });

    // Every slot is already local — nothing is accepted again.
    expect(accept).not.toHaveBeenCalled();
    expect(hook.result.current.acceptBundle.status).toBe('success');
    expect(hook.result.current.acceptBundle.error).toBeUndefined();
    // The registration was attempted and REFUSED (asserted on its own
    // return, not inferred from the outcome); the entry is present and
    // `pronta`, so the hook neither hands off nor projects.
    expect(registrarEntrada).toHaveBeenCalledTimes(1);
    expect(registrarEntrada.mock.results[0]?.value).toBe(false);
    expect(mockRetryPreparation).not.toHaveBeenCalled();
    expect(projetar).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({
      ok: true,
      registeredOrganizationId: undefined,
    });
    // The document kept the `pronta` entry untouched (no downgrade).
    const depois = coiabStore.instance.getState();
    expect(depois.organizacoes[0]).toBe(pronta);
    // Both slots were already local — the recovery identity is cleared.
    expect(identityStore.instance.getState()).toStrictEqual({});

    hook.unmount();
  });

  test('a refusal that is not a re-delivery of a pronta entry fails with invite-registration-missing', async () => {
    // `entrada` proves only that an entry with that id EXISTS — not that the
    // registration's write landed. Here the id already exists by ANOTHER
    // origin (a local creation still `preparando`) and the registration is
    // refused by a projectId collision with a DIFFERENT local organization:
    // the outcome must be the typed error, not a success that swallows the
    // refusal.
    const ORG_B_ID = 'b2c3d4e5f6071899';
    const localPreparando: OrganizacaoLocal = {
      id: ORG_ID,
      nome: ORG_NAME,
      estado: 'preparando',
      confirmacaoPendente: false,
      materializacao: {
        monitoramento: {
          etapa: 'criado',
          projectId: 'local-monitoramento',
          template: null,
          idsAntesDaCriacao: null,
        },
        alertas: {
          etapa: 'criado',
          projectId: 'local-alertas',
          template: null,
          idsAntesDaCriacao: null,
        },
      },
      areaEmExecucao: null,
      ultimoErro: null,
    };
    const outraOrigem: OrganizacaoLocal = {
      id: ORG_B_ID,
      nome: 'Org B',
      estado: 'pronta',
      confirmacaoPendente: false,
      materializacao: {
        monitoramento: {
          etapa: 'verificado',
          projectId: 'project-monitoramento',
          template: {versao: '1', hash: 'hash-b-m'},
          idsAntesDaCriacao: null,
        },
        alertas: {
          etapa: 'verificado',
          projectId: 'project-b-alertas',
          template: {versao: '1', hash: 'hash-b-a'},
          idsAntesDaCriacao: null,
        },
      },
      areaEmExecucao: null,
      ultimoErro: null,
    };
    coiabStore.instance.setState(
      {versao: 1, organizacoes: [localPreparando, outraOrigem], ativa: null},
      true,
    );
    const {clientApi, accept} = createFakeClient();
    accept
      .mockResolvedValueOnce('project-monitoramento')
      .mockResolvedValueOnce('project-alertas');
    const registrarEntrada = jest.spyOn(
      coiabStore.actions,
      'registrarEntradaPorConvite',
    );

    const hook = await renderHook(
      () => ({
        acceptBundle: useAcceptOrganizationBundle(),
        activeProjectId: useActiveProjectId(),
      }),
      {wrapper: createWrapper(clientApi)},
    );

    let outcome: AcceptOrganizationBundleResult | undefined;
    await act(async () => {
      outcome = await hook.result.current.acceptBundle.start(makeBundle());
    });

    expect(hook.result.current.acceptBundle.status).toBe('error');
    const error = hook.result.current.acceptBundle.error;
    expect(error).toBeInstanceOf(OrganizationOperationError);
    expect((error as OrganizationOperationError).code).toBe(
      'invite-registration-missing',
    );
    expect((error as OrganizationOperationError).details?.organizationId).toBe(
      ORG_ID,
    );
    // The registration was attempted and refused.
    expect(registrarEntrada).toHaveBeenCalledTimes(1);
    expect(registrarEntrada.mock.results[0]?.value).toBe(false);
    expect(mockRetryPreparation).not.toHaveBeenCalled();
    // No write: both entries preserved by reference, ativa untouched.
    const depois = coiabStore.instance.getState();
    expect(depois.organizacoes[0]).toBe(localPreparando);
    expect(depois.organizacoes[1]).toBe(outraOrigem);
    expect(depois.ativa).toBeNull();
    // The failure must not unpin the recovery identity.
    expect(identityStore.instance.getState()).toStrictEqual({
      [ORG_ID]: {invitorDeviceId: 'invitor-1', roleName: 'Coordinator'},
    });
    expect(outcome).toMatchObject({ok: false});

    hook.unmount();
  });

  test('registers the entry from the pre-accepted local slot even when only slot a is accepted', async () => {
    // Slot m is already local; this accept only joins slot a (SPEC 8.2),
    // and the fresh read after the accept is stale — it still shows only
    // the pre-accept local project.
    const {clientApi, accept} = createFakeClient([
      {
        projectId: 'project-monitoramento',
        projectDescription: markerFor(ORG_ID, 'm', ORG_NAME),
      },
    ]);
    accept.mockResolvedValueOnce('project-alertas');
    // The ActiveProjectIdStoreProvider carries its own boot fallback (the
    // first local project becomes active). Seeding a placeholder keeps the
    // provider out of the way: only the hook's own writes reach the spy.
    store.actions.projetar('pre-existing-device-project');
    const registrarEntrada = jest.spyOn(
      coiabStore.actions,
      'registrarEntradaPorConvite',
    );
    const projetar = jest.spyOn(store.actions, 'projetar');

    const hook = await renderHook(
      () => ({
        acceptBundle: useAcceptOrganizationBundle(),
        activeProjectId: useActiveProjectId(),
      }),
      {wrapper: createWrapper(clientApi)},
    );

    await act(async () => {
      await hook.result.current.acceptBundle.start(makeBundle());
    });

    expect(hook.result.current.acceptBundle.status).toBe('success');
    expect(accept).toHaveBeenCalledTimes(1);
    expect(accept).toHaveBeenCalledWith({inviteId: 'invite-a'});
    // SPEC 8.6: the pre-accept local slot-m project completes the
    // organization, so the entry registers with BOTH project ids and the
    // engine takes over activation — the hook must not force a slot itself.
    expect(registrarEntrada).toHaveBeenCalledTimes(1);
    expect(registrarEntrada).toHaveBeenCalledWith({
      organizacaoId: ORG_ID,
      nome: ORG_NAME,
      projectIds: {
        monitoramento: 'project-monitoramento',
        alertas: 'project-alertas',
      },
    });
    expect(projetar).not.toHaveBeenCalled();
    // The hook left the placeholder untouched instead of forcing its own slot.
    expect(hook.result.current.activeProjectId).toBe(
      'pre-existing-device-project',
    );
    expect(mockRetryPreparation).toHaveBeenCalledWith(ORG_ID);

    hook.unmount();
  });

  test('an inconsistent bundle fails without accepting anything', async () => {
    const {clientApi, accept} = createFakeClient();
    const bundle = makeBundle();
    // The slot-a invite carries a slot-m marker — rejected in preflight.
    bundle.invites.a = makeInvite('m', 'invite-a');

    const hook = await renderHook(
      () => ({
        acceptBundle: useAcceptOrganizationBundle(),
        activeProjectId: useActiveProjectId(),
      }),
      {wrapper: createWrapper(clientApi)},
    );

    await act(async () => {
      await hook.result.current.acceptBundle.start(bundle);
    });

    expect(hook.result.current.acceptBundle.status).toBe('error');
    expect(hook.result.current.acceptBundle.error).toBeInstanceOf(
      OrganizationOperationError,
    );
    expect(
      (hook.result.current.acceptBundle.error as OrganizationOperationError)
        .code,
    ).toBe('slot-mismatch');
    expect(accept).not.toHaveBeenCalled();
    expect(hook.result.current.activeProjectId).toBeUndefined();

    hook.unmount();
  });

  test('a first-ever accept pins the identity, and a partial bundle fails closed on the absent slot', async () => {
    const {clientApi, accept} = createFakeClient();
    // Only slot a survived transit: with no identity yet stored, the hook
    // pins one from THIS bundle (PLAN-46 decision 6), and the absent slot
    // still fails closed before anything is accepted.
    const bundle = makeBundle();
    delete bundle.invites.m;
    bundle.completeness = 'incomplete-definitive';

    const hook = await renderHook(
      () => ({
        acceptBundle: useAcceptOrganizationBundle(),
        activeProjectId: useActiveProjectId(),
      }),
      {wrapper: createWrapper(clientApi)},
    );

    await act(async () => {
      await hook.result.current.acceptBundle.start(bundle);
    });

    expect(hook.result.current.acceptBundle.status).toBe('error');
    expect(
      (hook.result.current.acceptBundle.error as OrganizationOperationError)
        .code,
    ).toBe('missing-invite');
    expect(accept).not.toHaveBeenCalled();
    expect(hook.result.current.activeProjectId).toBeUndefined();
    // The attempt still pinned the identity for a later recovery accept.
    expect(identityStore.instance.getState()).toStrictEqual({
      [ORG_ID]: {invitorDeviceId: 'invitor-1', roleName: 'Coordinator'},
    });

    hook.unmount();
  });

  test('a partial bundle diverging from the stored identity fails closed with identity-mismatch', async () => {
    const {clientApi, accept} = createFakeClient();
    identityStore.actions.setIdentity(ORG_ID, {
      invitorDeviceId: 'invitor-original',
      roleName: 'Coordinator',
    });
    // A different device re-invites only slot a: the stored identity wins,
    // so this bundle must never complete the organization.
    const bundle = makeBundle();
    delete bundle.invites.m;
    bundle.completeness = 'incomplete-definitive';

    const hook = await renderHook(
      () => ({
        acceptBundle: useAcceptOrganizationBundle(),
        activeProjectId: useActiveProjectId(),
      }),
      {wrapper: createWrapper(clientApi)},
    );

    await act(async () => {
      await hook.result.current.acceptBundle.start(bundle);
    });

    expect(hook.result.current.acceptBundle.status).toBe('error');
    expect(
      (hook.result.current.acceptBundle.error as OrganizationOperationError)
        .code,
    ).toBe('identity-mismatch');
    expect(accept).not.toHaveBeenCalled();
    expect(identityStore.instance.getState()).toStrictEqual({
      [ORG_ID]: {invitorDeviceId: 'invitor-original', roleName: 'Coordinator'},
    });

    hook.unmount();
  });

  test('a failed accept keeps the pinned identity', async () => {
    const {clientApi, accept} = createFakeClient();
    accept.mockRejectedValue(new Error('network gone'));

    const hook = await renderHook(
      () => ({
        acceptBundle: useAcceptOrganizationBundle(),
        activeProjectId: useActiveProjectId(),
      }),
      {wrapper: createWrapper(clientApi)},
    );

    await act(async () => {
      await hook.result.current.acceptBundle.start(makeBundle());
    });

    expect(hook.result.current.acceptBundle.status).toBe('error');
    expect(identityStore.instance.getState()).toStrictEqual({
      [ORG_ID]: {invitorDeviceId: 'invitor-1', roleName: 'Coordinator'},
    });

    hook.unmount();
  });

  test('a successful accept clears the identity once the organization is fully local', async () => {
    // Core's accept joins the projects, which then show up in listProjects()
    // — the fresh read the hook reconstructs from.
    const localProjects: FakeProject[] = [];
    const accept = jest.fn(async ({inviteId}: {inviteId: string}) => {
      const projectId =
        inviteId === 'invite-m' ? 'project-monitoramento' : 'project-alertas';
      localProjects.push({
        projectId,
        projectDescription: markerFor(
          ORG_ID,
          inviteId === 'invite-m' ? 'm' : 'a',
          ORG_NAME,
        ),
      });
      return projectId;
    });
    const clientApi = {
      listProjects: async () =>
        localProjects.map(project => ({
          ...project,
          name: 'fake',
          createdAt: '',
          updatedAt: '',
          status: 'joined' as const,
        })),
      invite: {accept, addListener: jest.fn(), removeListener: jest.fn()},
      on: jest.fn(),
    } as unknown as ComapeoCoreClientApi;

    const hook = await renderHook(
      () => ({
        acceptBundle: useAcceptOrganizationBundle(),
        activeProjectId: useActiveProjectId(),
      }),
      {wrapper: createWrapper(clientApi)},
    );

    await act(async () => {
      await hook.result.current.acceptBundle.start(makeBundle());
    });

    expect(hook.result.current.acceptBundle.status).toBe('success');
    expect(identityStore.instance.getState()).toStrictEqual({});

    hook.unmount();
  });

  test('a stale fresh read still clears the identity when the pre-accept read saw the other slot', async () => {
    // P5 O4: slot a is already local BEFORE the accept; this accept joins
    // slot m; the fresh read after the accept is stale — it still shows only
    // the pre-accept slot-a project. The union of reads sees both slots, so
    // the recovery identity must be cleared anyway.
    const {clientApi, accept} = createFakeClient([
      {
        projectId: 'project-alertas',
        projectDescription: markerFor(ORG_ID, 'a', ORG_NAME),
      },
    ]);
    accept.mockResolvedValueOnce('project-monitoramento');

    const hook = await renderHook(
      () => ({
        acceptBundle: useAcceptOrganizationBundle(),
        activeProjectId: useActiveProjectId(),
      }),
      {wrapper: createWrapper(clientApi)},
    );

    await act(async () => {
      await hook.result.current.acceptBundle.start(makeBundle());
    });

    expect(hook.result.current.acceptBundle.status).toBe('success');
    expect(accept).toHaveBeenCalledWith({inviteId: 'invite-m'});
    expect(identityStore.instance.getState()).toStrictEqual({});

    hook.unmount();
  });

  test('accepting invalidates the project and invite caches', async () => {
    const {clientApi, accept} = createFakeClient();
    accept
      .mockResolvedValueOnce('project-monitoramento')
      .mockResolvedValueOnce('project-alertas');
    const {wrapper, invalidateQueries} = createSpiedWrapper(clientApi);

    const hook = await renderHook(
      () => ({
        acceptBundle: useAcceptOrganizationBundle(),
        activeProjectId: useActiveProjectId(),
      }),
      {wrapper},
    );

    await act(async () => {
      await hook.result.current.acceptBundle.start(makeBundle());
    });

    expect(hook.result.current.acceptBundle.status).toBe('success');
    const invalidations = invalidateQueries.mock.calls.map(
      call => call[0]?.queryKey,
    );
    expect(invalidations).toContainEqual(projectsQueryKey);
    expect(invalidations).toContainEqual(invitesQueryKey);

    hook.unmount();
  });

  test('registers the entry with the completed organization ids, not just this accept', async () => {
    // Slot m was accepted in an EARLIER attempt and is already local, so
    // this accept only joins slot a (SPEC 8.2).
    const localProjects: FakeProject[] = [
      {
        projectId: 'project-monitoramento',
        projectDescription: markerFor(ORG_ID, 'm', ORG_NAME),
      },
    ];
    const accept = jest.fn(async ({inviteId}: {inviteId: string}) => {
      if (inviteId === 'invite-m') return 'project-monitoramento';
      // Core's accept joins the project, which then shows up in
      // listProjects() — the fresh read the hook reconstructs from.
      localProjects.push({
        projectId: 'project-alertas',
        projectDescription: markerFor(ORG_ID, 'a', ORG_NAME),
      });
      return 'project-alertas';
    });
    const clientApi = {
      listProjects: async () =>
        localProjects.map(project => ({
          ...project,
          name: 'fake',
          createdAt: '',
          updatedAt: '',
          status: 'joined' as const,
        })),
      invite: {accept, addListener: jest.fn(), removeListener: jest.fn()},
      on: jest.fn(),
    } as unknown as ComapeoCoreClientApi;
    // Same as above: the provider's boot fallback stays disabled, so the
    // spy observes only the hook's own writes.
    store.actions.projetar('pre-existing-device-project');
    const registrarEntrada = jest.spyOn(
      coiabStore.actions,
      'registrarEntradaPorConvite',
    );
    const projetar = jest.spyOn(store.actions, 'projetar');

    const hook = await renderHook(
      () => ({
        acceptBundle: useAcceptOrganizationBundle(),
        activeProjectId: useActiveProjectId(),
      }),
      {wrapper: createWrapper(clientApi)},
    );

    await act(async () => {
      await hook.result.current.acceptBundle.start(makeBundle());
    });

    expect(hook.result.current.acceptBundle.status).toBe('success');
    expect(accept).toHaveBeenCalledTimes(1);
    expect(accept).toHaveBeenCalledWith({inviteId: 'invite-a'});
    // SPEC 8.6 ladder: the completed organization's Monitoramento project
    // (already local) supplies the registration's monitoramento id, even
    // though only slot a was part of THIS accept result.
    expect(registrarEntrada).toHaveBeenCalledTimes(1);
    expect(registrarEntrada).toHaveBeenCalledWith({
      organizacaoId: ORG_ID,
      nome: ORG_NAME,
      projectIds: {
        monitoramento: 'project-monitoramento',
        alertas: 'project-alertas',
      },
    });
    expect(projetar).not.toHaveBeenCalled();
    // The hook left the placeholder untouched instead of forcing its own slot.
    expect(hook.result.current.activeProjectId).toBe(
      'pre-existing-device-project',
    );
    expect(mockRetryPreparation).toHaveBeenCalledWith(ORG_ID);

    hook.unmount();
  });

  test('a rejected accept that core completed still registers the entry', async () => {
    // Reject-but-completed (Bug 46): slot m's accept times out on the reply
    // while core finished the join. The accept loop recovers that slot from
    // the local read and goes on to slot a, so the org is complete and the
    // hook publishes success — not a false partial error.
    const localProjects: FakeProject[] = [];
    const accept = jest.fn(async ({inviteId}: {inviteId: string}) => {
      if (inviteId === 'invite-m') {
        localProjects.push({
          projectId: 'project-monitoramento',
          projectDescription: markerFor(ORG_ID, 'm', ORG_NAME),
        });
        throw new Error('SYNC_TIMEOUT');
      }
      localProjects.push({
        projectId: 'project-alertas',
        projectDescription: markerFor(ORG_ID, 'a', ORG_NAME),
      });
      return 'project-alertas';
    });
    const clientApi = {
      listProjects: async () =>
        localProjects.map(project => ({
          ...project,
          name: 'fake',
          createdAt: '',
          updatedAt: '',
          status: 'joined' as const,
        })),
      invite: {accept, addListener: jest.fn(), removeListener: jest.fn()},
      on: jest.fn(),
    } as unknown as ComapeoCoreClientApi;
    const registrarEntrada = jest.spyOn(
      coiabStore.actions,
      'registrarEntradaPorConvite',
    );
    const projetar = jest.spyOn(store.actions, 'projetar');

    const hook = await renderHook(
      () => ({
        acceptBundle: useAcceptOrganizationBundle(),
        activeProjectId: useActiveProjectId(),
      }),
      {wrapper: createWrapper(clientApi)},
    );

    await act(async () => {
      await hook.result.current.acceptBundle.start(makeBundle());
    });

    expect(hook.result.current.acceptBundle.status).toBe('success');
    expect(hook.result.current.acceptBundle.error).toBeUndefined();
    expect(accept).toHaveBeenCalledTimes(2);
    // The reconciled success registers the entry from the local reads and
    // hands activation to the engine — it must not force a slot itself.
    expect(registrarEntrada).toHaveBeenCalledTimes(1);
    expect(registrarEntrada).toHaveBeenCalledWith({
      organizacaoId: ORG_ID,
      nome: ORG_NAME,
      projectIds: {
        monitoramento: 'project-monitoramento',
        alertas: 'project-alertas',
      },
    });
    expect(projetar).not.toHaveBeenCalled();
    expect(hook.result.current.activeProjectId).toBeUndefined();
    expect(mockRetryPreparation).toHaveBeenCalledWith(ORG_ID);
    // Both slots local — the recovery identity is no longer needed.
    expect(identityStore.instance.getState()).toStrictEqual({});

    hook.unmount();
  });

  test('a preflight identity-mismatch still errors even when both slots are already local', async () => {
    // The post-failure reconciliation rescues failures of the invite.accept
    // call itself only. A preflight identity-mismatch describes a bundle
    // that must not join — however complete the local organization already
    // is — so the local-state read must not convert it into a success (which
    // would also clear the recovery identity a genuine recovery accept
    // still needs).
    const {clientApi, accept} = createFakeClient([
      {
        projectId: 'project-monitoramento',
        projectDescription: markerFor(ORG_ID, 'm', ORG_NAME),
      },
      {
        projectId: 'project-alertas',
        projectDescription: markerFor(ORG_ID, 'a', ORG_NAME),
      },
    ]);
    identityStore.actions.setIdentity(ORG_ID, {
      invitorDeviceId: 'invitor-original',
      roleName: 'Coordinator',
    });
    // A different device re-invites only slot a: the stored identity wins,
    // so this bundle is rejected in the preflight — with the org already
    // complete locally, this is exactly the case the reconciliation must
    // not swallow.
    const bundle = makeBundle();
    delete bundle.invites.m;
    bundle.invites.a = {
      ...makeInvite('a', 'invite-a'),
      invitorDeviceId: 'invitor-divergent',
    };
    bundle.completeness = 'incomplete-definitive';

    const hook = await renderHook(
      () => ({
        acceptBundle: useAcceptOrganizationBundle(),
        activeProjectId: useActiveProjectId(),
      }),
      {wrapper: createWrapper(clientApi)},
    );

    await act(async () => {
      await hook.result.current.acceptBundle.start(bundle);
    });

    expect(hook.result.current.acceptBundle.status).toBe('error');
    expect(hook.result.current.acceptBundle.error).toBeInstanceOf(
      OrganizationOperationError,
    );
    expect(
      (hook.result.current.acceptBundle.error as OrganizationOperationError)
        .code,
    ).toBe('identity-mismatch');
    expect(accept).not.toHaveBeenCalled();
    // The divergent bundle must not unpin the recovery identity.
    expect(identityStore.instance.getState()).toStrictEqual({
      [ORG_ID]: {invitorDeviceId: 'invitor-original', roleName: 'Coordinator'},
    });

    hook.unmount();
  });

  test('a preflight invalid-local-state still errors even when both slots are present', async () => {
    // A duplicate-slot conflict (SPEC 10) is resolved by a human, never
    // extended: the reconciliation read sees the conflicting slots as
    // "present" and would otherwise report a success for an organization the
    // local state says is invalid.
    const {clientApi, accept} = createFakeClient([
      {
        projectId: 'project-m-first',
        projectDescription: markerFor(ORG_ID, 'm', ORG_NAME),
      },
      {
        projectId: 'project-m-duplicate',
        projectDescription: markerFor(ORG_ID, 'm', ORG_NAME),
      },
      {
        projectId: 'project-alertas',
        projectDescription: markerFor(ORG_ID, 'a', ORG_NAME),
      },
    ]);

    const hook = await renderHook(
      () => ({
        acceptBundle: useAcceptOrganizationBundle(),
        activeProjectId: useActiveProjectId(),
      }),
      {wrapper: createWrapper(clientApi)},
    );

    await act(async () => {
      await hook.result.current.acceptBundle.start(makeBundle());
    });

    expect(hook.result.current.acceptBundle.status).toBe('error');
    expect(hook.result.current.acceptBundle.error).toBeInstanceOf(
      OrganizationOperationError,
    );
    expect(
      (hook.result.current.acceptBundle.error as OrganizationOperationError)
        .code,
    ).toBe('invalid-local-state');
    expect(accept).not.toHaveBeenCalled();

    hook.unmount();
  });

  test('a half-completed accept fails with accept-partial naming the missing slot', async () => {
    // Slot m's reject-but-completed join landed, but slot a's accept failed
    // for real: the org is half-joined. The published error must say exactly
    // that (typed code + the missing slots) instead of the raw timeout, so
    // the UI can route to recovery instead of reporting a total failure.
    const localProjects: FakeProject[] = [];
    const accept = jest.fn(async ({inviteId}: {inviteId: string}) => {
      if (inviteId === 'invite-m') {
        localProjects.push({
          projectId: 'project-monitoramento',
          projectDescription: markerFor(ORG_ID, 'm', ORG_NAME),
        });
        throw new Error('SYNC_TIMEOUT');
      }
      throw new Error('NETWORK_GONE'); // slot a fails without joining
    });
    const clientApi = {
      listProjects: async () =>
        localProjects.map(project => ({
          ...project,
          name: 'fake',
          createdAt: '',
          updatedAt: '',
          status: 'joined' as const,
        })),
      invite: {accept, addListener: jest.fn(), removeListener: jest.fn()},
      on: jest.fn(),
    } as unknown as ComapeoCoreClientApi;

    const hook = await renderHook(
      () => ({
        acceptBundle: useAcceptOrganizationBundle(),
        activeProjectId: useActiveProjectId(),
      }),
      {wrapper: createWrapper(clientApi)},
    );

    await act(async () => {
      await hook.result.current.acceptBundle.start(makeBundle());
    });

    expect(hook.result.current.acceptBundle.status).toBe('error');
    const error = hook.result.current.acceptBundle.error;
    expect(error).toBeInstanceOf(OrganizationOperationError);
    expect((error as OrganizationOperationError).code).toBe('accept-partial');
    expect((error as OrganizationOperationError).details?.missingSlots).toEqual(
      ['a'],
    );
    // The underlying failure stays reachable for diagnostics.
    expect((error as OrganizationOperationError).details?.cause).toMatchObject({
      message: 'NETWORK_GONE',
    });
    // The org is still incomplete — the recovery identity stays pinned.
    expect(identityStore.instance.getState()).toStrictEqual({
      [ORG_ID]: {invitorDeviceId: 'invitor-1', roleName: 'Coordinator'},
    });

    hook.unmount();
  });

  test('an accept-partial writes nothing: an invite is not an entry', async () => {
    // One accepted slot is not an entered organization — a partial accept
    // must not register anything in the durable document, must not hand
    // activation to the engine and must not force a slot itself.
    const localProjects: FakeProject[] = [];
    const accept = jest.fn(async ({inviteId}: {inviteId: string}) => {
      if (inviteId === 'invite-m') {
        localProjects.push({
          projectId: 'project-monitoramento',
          projectDescription: markerFor(ORG_ID, 'm', ORG_NAME),
        });
        throw new Error('SYNC_TIMEOUT');
      }
      throw new Error('NETWORK_GONE'); // slot a fails without joining
    });
    const clientApi = {
      listProjects: async () =>
        localProjects.map(project => ({
          ...project,
          name: 'fake',
          createdAt: '',
          updatedAt: '',
          status: 'joined' as const,
        })),
      invite: {accept, addListener: jest.fn(), removeListener: jest.fn()},
      on: jest.fn(),
    } as unknown as ComapeoCoreClientApi;
    const registrarEntrada = jest.spyOn(
      coiabStore.actions,
      'registrarEntradaPorConvite',
    );
    const projetar = jest.spyOn(store.actions, 'projetar');

    const hook = await renderHook(
      () => ({
        acceptBundle: useAcceptOrganizationBundle(),
        activeProjectId: useActiveProjectId(),
      }),
      {wrapper: createWrapper(clientApi)},
    );

    await act(async () => {
      await hook.result.current.acceptBundle.start(makeBundle());
    });

    expect(hook.result.current.acceptBundle.status).toBe('error');
    const error = hook.result.current.acceptBundle.error;
    expect(error).toBeInstanceOf(OrganizationOperationError);
    expect((error as OrganizationOperationError).code).toBe('accept-partial');
    expect(registrarEntrada).not.toHaveBeenCalled();
    expect(projetar).not.toHaveBeenCalled();
    expect(mockRetryPreparation).not.toHaveBeenCalled();
    expect(coiabStore.instance.getState().organizacoes).toStrictEqual([]);

    hook.unmount();
  });

  test('a failed accept with zero local progress publishes the original error', async () => {
    // Nothing joined anywhere: there is no progress to reconcile, so the
    // reconciliation must not replace the failure the user saw with a
    // synthesized one.
    const {clientApi, accept} = createFakeClient();
    accept.mockRejectedValue(new Error('NETWORK_GONE'));

    const hook = await renderHook(
      () => ({
        acceptBundle: useAcceptOrganizationBundle(),
        activeProjectId: useActiveProjectId(),
      }),
      {wrapper: createWrapper(clientApi)},
    );

    await act(async () => {
      await hook.result.current.acceptBundle.start(makeBundle());
    });

    expect(hook.result.current.acceptBundle.status).toBe('error');
    expect(hook.result.current.acceptBundle.error).toMatchObject({
      message: 'NETWORK_GONE',
    });
    expect(hook.result.current.activeProjectId).toBeUndefined();

    hook.unmount();
  });
});
