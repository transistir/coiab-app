import * as React from 'react';
import {act, renderHook} from '@testing-library/react-native';
import {useClientApi} from '@comapeo/core-react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import type {ComapeoCoreClientApi} from '@comapeo/ipc';
import type {ReactNode} from 'react';

import {CREATOR_ROLE_ID} from '../sharedTypes';
import type {EstadoOrganizacoes} from '../lib/organization/coiabOrganizations';
import {readyOrganization} from '../lib/organization/fixtures';
import {
  createMaterializer,
  type CreationProject,
  type TemplatePackage,
  type TemplateSource,
} from '../lib/organization/materializar';
import {projectsQueryKey} from '../lib/organization/queryKeys';
import {
  CoiabOrganizationsStoreProvider,
  createCoiabOrganizationsStore,
  type CoiabOrganizationsStore,
} from './CoiabOrganizationsStoreContext';
import {
  OrganizationMaterializerProvider,
  useOrganizationMaterializer,
} from './OrganizationMaterializerContext';

// The provider reads the core client through `useClientApi`; a fake client
// keeps the test off IPC while the real creation adapter runs.
jest.mock('@comapeo/core-react', () => ({
  useClientApi: jest.fn(),
}));

// The real materializer runs; its factory is wrapped so a test can observe
// how many times `start`/`resume` were actually invoked — `retomar`'s guard
// must be observable at the materializer boundary, not through side effects.
jest.mock('../lib/organization/materializar', () => {
  const actual = jest.requireActual('../lib/organization/materializar') as {
    createMaterializer: (options: unknown) => {
      start: (name: string) => Promise<void>;
      resume: () => Promise<void>;
    };
  };
  return {
    ...actual,
    createMaterializer: jest.fn((options: unknown) => {
      const materializer = actual.createMaterializer(options);
      return {
        ...materializer,
        start: jest.fn(materializer.start),
        resume: jest.fn(materializer.resume),
      };
    }),
  };
});

const useClientApiMock = useClientApi as unknown as jest.Mock;
const createMaterializerMock = createMaterializer as unknown as jest.Mock;

/** Stable project surface per id: settings written by the materializer must
 * read back identical in the final conferência. */
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

/** The fake template source verifies everything instantly (no disk). */
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

// The document id IS the marker's organization id (SPEC B §4.1): `markerFor`
// mints markers for it on every materialize pass, so the fixture must carry a
// 16-lowercase-hex id exactly like the production generator produces.
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

describe('OrganizationMaterializerContext', () => {
  let clientApi: {getDeviceInfo: jest.Mock; getProject: jest.Mock};

  beforeEach(() => {
    jest.clearAllMocks();
    const projectsById = new Map<string, unknown>();
    clientApi = {
      getDeviceInfo: jest.fn(async () => ({
        deviceId: 'device-1',
        name: 'Teste',
        deviceType: 'mobile',
      })),
      getProject: jest.fn(async (id: string) => {
        let project = projectsById.get(id);
        if (!project) {
          project = fakeCreationProject();
          projectsById.set(id, project);
        }
        return project;
      }),
    };
    useClientApiMock.mockReturnValue(
      clientApi as unknown as ComapeoCoreClientApi,
    );
  });

  /** Renders the provider with a hook probe that captures the handle. */
  async function renderMaterializador(store: CoiabOrganizationsStore) {
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
        <CoiabOrganizationsStoreProvider store={store}>
          <OrganizationMaterializerProvider templates={templates}>
            {children}
          </OrganizationMaterializerProvider>
        </CoiabOrganizationsStoreProvider>
      </QueryClientProvider>
    );
    const hook = await renderHook(() => useOrganizationMaterializer(), {
      wrapper,
    });
    return {hook, invalidateQueries, templates};
  }

  test('retomar recusa um id que não é o da primeira organização e não retoma', async () => {
    const store = createCoiabOrganizationsStore();
    store.instance.setState(preparingDocument(), true);
    const {hook} = await renderMaterializador(store);

    await act(async () => {
      await expect(
        hook.result.current!.retomar('organizacao-errada'),
      ).rejects.toThrow('organization-not-resumable');
    });

    const resume = createMaterializerMock.mock.results[0]!.value.resume;
    expect(resume).not.toHaveBeenCalled();
    // Nothing touched the journal: no prepare, no writes.
    expect(store.instance.getState().organizacoes[0]).toMatchObject({
      estado: 'preparando',
      confirmacaoPendente: false,
    });
  });

  test('retomar recusa quando a coleção está vazia', async () => {
    const store = createCoiabOrganizationsStore();
    const {hook} = await renderMaterializador(store);

    await act(async () => {
      await expect(hook.result.current!.retomar(ORG_ID)).rejects.toThrow(
        'organization-not-resumable',
      );
    });

    const resume = createMaterializerMock.mock.results[0]!.value.resume;
    expect(resume).not.toHaveBeenCalled();
  });

  test('retomar retoma a organização persistida e invalida a consulta de projetos', async () => {
    const store = createCoiabOrganizationsStore();
    store.instance.setState(preparingDocument(), true);
    const {hook, invalidateQueries} = await renderMaterializador(store);

    await act(async () => {
      await hook.result.current!.retomar(ORG_ID);
    });

    const materializer = createMaterializerMock.mock.results[0]!.value;
    // Exactly one resume — the exclusive operation joined, not duplicated.
    expect(materializer.resume).toHaveBeenCalledTimes(1);
    expect(store.instance.getState().organizacoes[0]).toMatchObject({
      estado: 'pronta',
      confirmacaoPendente: true,
    });
    expect(
      invalidateQueries.mock.calls.map(call => call[0]?.queryKey),
    ).toContainEqual(projectsQueryKey);

    await act(async () => {
      await hook.unmount();
    });
  });

  test('useOrganizationMaterializer fora do provider é null', async () => {
    const hook = await renderHook(() => useOrganizationMaterializer(), {
      wrapper: ({children}: {children: ReactNode}) => (
        <QueryClientProvider client={new QueryClient()}>
          {children}
        </QueryClientProvider>
      ),
    });

    expect(hook.result.current).toBeNull();
  });
});
