import {act, renderHook, waitFor} from '@testing-library/react-native';
import {useClientApi} from '@comapeo/core-react';
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
import {organizationDocument} from '../../lib/organization/fixtures';
import type {EstadoOrganizacoes} from '../../lib/organization/coiabOrganizations';
import {MEMBER_ROLE_ID} from '../../sharedTypes';
import {useOrganizationActivation} from './useOrganizationActivation';

// The hook reports degraded boots to Sentry; the SDK itself stays off jest.
jest.mock('@sentry/react-native', () => ({
  captureException: jest.fn(),
}));

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
  let clientApi: {getProject: jest.Mock};

  beforeEach(() => {
    jest.clearAllMocks();
    projects = {
      'A-m': fakeProject(),
      'A-a': fakeProject(),
      'B-m': fakeProject(),
      'B-a': fakeProject(),
    };
    clientApi = {getProject: jest.fn(async (id: ProjectId) => projects[id])};
    useClientApiMock.mockReturnValue(
      clientApi as unknown as ComapeoCoreClientApi,
    );
  });

  function createWrapper(store: CoiabOrganizationsStore, strict: boolean) {
    const Providers = ({children}: {children: ReactNode}) => (
      <CoiabOrganizationsStoreProvider store={store}>
        {children}
      </CoiabOrganizationsStoreProvider>
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
});
