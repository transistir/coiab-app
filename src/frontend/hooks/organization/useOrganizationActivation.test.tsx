import {act, renderHook, waitFor} from '@testing-library/react-native';
import {useClientApi} from '@comapeo/core-react';
import type {ComapeoCoreClientApi} from '@comapeo/ipc';
import React, {StrictMode, type ReactNode} from 'react';

import {
  CoiabOrganizationsStoreProvider,
  createCoiabOrganizationsStore,
  type CoiabOrganizationsStore,
} from '../../contexts/CoiabOrganizationsStoreContext';
import {
  createOrganizationActivation,
  type ActivationOptions,
  type OrganizationActivation,
} from '../../lib/organization/activation';
import {organizationDocument} from '../../lib/organization/fixtures';
import {MEMBER_ROLE_ID} from '../../sharedTypes';
import {useOrganizationActivation} from './useOrganizationActivation';

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
});
