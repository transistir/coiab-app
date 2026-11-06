import * as React from 'react';
import {act, renderHook, waitFor} from '@testing-library/react-native';
import {useClientApi} from '@comapeo/core-react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import type {ComapeoCoreClientApi} from '@comapeo/ipc';
import type {ReactNode} from 'react';

import {CREATOR_ROLE_ID, MEMBER_ROLE_ID} from '../sharedTypes';
import {clienteDeCriacao} from '../lib/organization/clienteDeCriacao';
import type {EstadoOrganizacoes} from '../lib/organization/coiabOrganizations';
import {readyOrganization} from '../lib/organization/fixtures';
import {confirmarEntrada} from '../lib/organization/entrada';
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

// The real materializer runs; its factory is wrapped so a test can observe
// how many times `start`/`resume` were actually invoked — `retomar`'s guard
// must be observable at the materializer boundary, not through side effects.
// The provider reads the core client through `useClientApi`; a fake client
// keeps the test off IPC while the real creation adapter runs.
jest.mock('@comapeo/core-react', () => ({
  useClientApi: jest.fn(),
}));
jest.mock('../lib/organization/materializar', () => {
  const actual = jest.requireActual('../lib/organization/materializar') as {
    createMaterializer: (options: unknown) => {
      start: (name: string) => Promise<void>;
      resume: (id?: string) => Promise<void>;
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

// The origin dispatch calls the REAL `confirmarEntrada` (wrapped, so the
// dispatch itself stays observable at the boundary).
jest.mock('../lib/organization/entrada', () => {
  const actual = jest.requireActual('../lib/organization/entrada') as {
    confirmarEntrada: (options: unknown) => Promise<void>;
  };
  return {
    ...actual,
    confirmarEntrada: jest.fn(actual.confirmarEntrada),
  };
});

const useClientApiMock = useClientApi as unknown as jest.Mock;
const createMaterializerMock = createMaterializer as unknown as jest.Mock;
const confirmarEntradaMock = confirmarEntrada as unknown as jest.Mock;

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
      // #142: the journal's archive step reaches the project through the
      // injected network adapter built by the provider.
      addServerPeer: jest.fn(async () => {}),
    },
    $importCategories: jest.fn(),
    $setProjectSettings: jest.fn(async (next: typeof settings) => {
      Object.assign(settings, next);
    }),
    $getProjectSettings: jest.fn(async () => ({...settings})),
    // SPEC B §5.5: a joined project exposes the own-role read the entry
    // confirmation walks.
    $getOwnRole: jest.fn(async () => ({roleId: MEMBER_ROLE_ID})),
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
/**
 * Invite-entry journal (SPEC B §5.5): both areas hold an accepted project
 * id with NO creation snapshot and NO template — the shape that dispatches
 * to `confirmarEntrada` instead of the creation resume.
 */
function conviteDocument(): EstadoOrganizacoes {
  return {
    versao: 1,
    organizacoes: [
      {
        id: ORG_ID,
        nome: 'Por convite',
        estado: 'preparando',
        confirmacaoPendente: false,
        materializacao: {
          monitoramento: {
            etapa: 'criado',
            projectId: `${ORG_ID}-m`,
            template: null,
            idsAntesDaCriacao: null,
          },
          alertas: {
            etapa: 'criado',
            projectId: `${ORG_ID}-a`,
            template: null,
            idsAntesDaCriacao: null,
          },
        },
        areaEmExecucao: null,
        ultimoErro: null,
      },
    ],
    ativa: null,
  };
}

/**
 * Multi-organization document (comportamento 5): A settled, ready and
 * acknowledged (confirmacaoPendente false) FIRST, B still `preparando`
 * behind it. The resume must target B by id — the first slot no longer
 * owns the only journal.
 */
const ORG_ID_B = 'fedcba9876543210';

function twoOrganizationsDocument(): EstadoOrganizacoes {
  return {
    versao: 1,
    organizacoes: [
      readyOrganization(ORG_ID),
      {
        ...readyOrganization(ORG_ID_B),
        estado: 'preparando',
        confirmacaoPendente: false,
      },
    ],
    ativa: {organizacaoId: ORG_ID, area: 'alertas'},
  };
}

describe('OrganizationMaterializerContext', () => {
  let clientApi: {
    getDeviceInfo: jest.Mock;
    getProject: jest.Mock;
    listProjects?: jest.Mock;
    createProject?: jest.Mock;
  };

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
      listProjects: jest.fn(async () => []),
      createProject: jest.fn(
        async ({name}: {name: string}) => `criado-${name}`,
      ),
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

  test('retomar localiza pelo id no documento inteiro: pronta A não esconde preparando B', async () => {
    const store = createCoiabOrganizationsStore();
    store.instance.setState(twoOrganizationsDocument(), true);
    const {hook} = await renderMaterializador(store);

    await act(async () => {
      await hook.result.current!.retomar(ORG_ID_B);
    });

    // B's creation journal resumed; the dispatch stayed a creation resume
    // (B carries templates) and A's settled journal was left untouched.
    const materializer = createMaterializerMock.mock.results[0]!.value;
    expect(materializer.resume).toHaveBeenCalledTimes(1);
    expect(confirmarEntradaMock).not.toHaveBeenCalled();
    const [primeira, segunda] = store.instance.getState().organizacoes;
    expect(primeira).toMatchObject({
      id: ORG_ID,
      estado: 'pronta',
      confirmacaoPendente: false,
    });
    expect(segunda).toMatchObject({
      id: ORG_ID_B,
      estado: 'pronta',
      confirmacaoPendente: true,
    });

    await act(async () => {
      await hook.unmount();
    });
  });

  test('#85: retomar(B.id) com DUAS preparando retoma B e não toca A', async () => {
    const store = createCoiabOrganizationsStore();
    store.instance.setState(
      {
        versao: 1,
        organizacoes: [
          {
            ...readyOrganization(ORG_ID),
            estado: 'preparando',
            confirmacaoPendente: false,
          },
          {
            ...readyOrganization(ORG_ID_B),
            estado: 'preparando',
            confirmacaoPendente: false,
          },
        ],
        ativa: null,
      },
      true,
    );
    const {hook} = await renderMaterializador(store);

    await act(async () => {
      await hook.result.current!.retomar(ORG_ID_B);
    });

    // The id rides to the materializer: resume must target B, not the first
    // `preparando` entry in the array.
    const materializer = createMaterializerMock.mock.results[0]!.value;
    expect(materializer.resume).toHaveBeenCalledWith(ORG_ID_B);
    const [primeira, segunda] = store.instance.getState().organizacoes;
    expect(primeira).toMatchObject({
      id: ORG_ID,
      estado: 'preparando',
      confirmacaoPendente: false,
    });
    expect(segunda).toMatchObject({
      id: ORG_ID_B,
      estado: 'pronta',
      confirmacaoPendente: true,
    });

    await act(async () => {
      await hook.unmount();
    });
  });

  test('retomar continua recusando um id que não existe no documento', async () => {
    const store = createCoiabOrganizationsStore();
    store.instance.setState(twoOrganizationsDocument(), true);
    const {hook} = await renderMaterializador(store);

    await act(async () => {
      await expect(
        hook.result.current!.retomar('organizacao-inexistente'),
      ).rejects.toThrow('organization-not-resumable');
    });

    const resume = createMaterializerMock.mock.results[0]!.value.resume;
    expect(resume).not.toHaveBeenCalled();

    await act(async () => {
      await hook.unmount();
    });
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

  test('retomar despacha por origem: convite verifica a entrada e não retoma', async () => {
    // SPEC B §5.5 dispatch: a journal whose BOTH areas are accepted joins
    // (no creation snapshot, no template) is an INVITE entry — the resume
    // must CONFIRM it against the live device, never create again.
    const store = createCoiabOrganizationsStore();
    store.instance.setState(conviteDocument(), true);
    // The entry confirmation reads the join status from the core rows.
    clientApi.listProjects = jest.fn(async () => [
      {projectId: `${ORG_ID}-m`, status: 'joined' as const},
      {projectId: `${ORG_ID}-a`, status: 'joined' as const},
    ]);
    const {hook, invalidateQueries, templates} =
      await renderMaterializador(store);

    await act(async () => {
      await hook.result.current!.retomar(ORG_ID);
    });

    const materializer = createMaterializerMock.mock.results[0]!.value;
    expect(materializer.resume).not.toHaveBeenCalled();
    expect(confirmarEntradaMock).toHaveBeenCalledTimes(1);
    // The REAL creation adapter is the client: it is the one that offers
    // `iconeResolvivel`, the icon proof the verification relies on.
    const options = confirmarEntradaMock.mock.calls[0]![0] as {
      store: CoiabOrganizationsStore;
      client: unknown;
      templates: unknown;
      organizacaoId: string;
    };
    expect(options.organizacaoId).toBe(ORG_ID);
    expect(options.store).toBe(store);
    expect(options.templates).toBe(templates);
    expect(options.client).toBe(
      clienteDeCriacao(clientApi as unknown as ComapeoCoreClientApi),
    );
    // The confirmed entry publishes pronta with pending confirmation.
    expect(store.instance.getState().organizacoes[0]).toMatchObject({
      estado: 'pronta',
      confirmacaoPendente: true,
      materializacao: {
        monitoramento: {
          etapa: 'verificado',
          projectId: `${ORG_ID}-m`,
          template: {versao: '1', hash: 'monitoramento'},
        },
        alertas: {
          etapa: 'verificado',
          projectId: `${ORG_ID}-a`,
          template: {versao: '1', hash: 'alertas'},
        },
      },
    });
    expect(
      invalidateQueries.mock.calls.map(call => call[0]?.queryKey),
    ).toContainEqual(projectsQueryKey);

    await act(async () => {
      await hook.unmount();
    });
  });

  test('retomar despacha por origem: criação retoma e não verifica', async () => {
    // A creation journal (template journaled) keeps the creation resume —
    // verification would refuse to confirm an organization this device
    // created itself.
    const store = createCoiabOrganizationsStore();
    store.instance.setState(preparingDocument(), true);
    const {hook} = await renderMaterializador(store);

    await act(async () => {
      await hook.result.current!.retomar(ORG_ID);
    });

    const materializer = createMaterializerMock.mock.results[0]!.value;
    expect(materializer.resume).toHaveBeenCalledTimes(1);
    expect(confirmarEntradaMock).not.toHaveBeenCalled();

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

  // #142 fase B: the root executor is built from the SAME repository and the
  // real core network adapter, so the archive step lives in the journal even
  // for organizations that were already `pronta` when the app booted.
  function readyDocumentWithArchive(
    arquivoRemoto: NonNullable<
      ReturnType<typeof readyOrganization>['arquivoRemoto']
    >,
  ): EstadoOrganizacoes {
    return {
      versao: 1,
      organizacoes: [{...readyOrganization(ORG_ID), arquivoRemoto}],
      ativa: {organizacaoId: ORG_ID, area: 'monitoramento'},
    };
  }

  test('organização pronta com arquivo em falha_recuperavel é retomada no boot uma vez', async () => {
    const store = createCoiabOrganizationsStore();
    store.instance.setState(
      readyDocumentWithArchive({
        url: 'https://arquivo.example/',
        estado: 'falha_recuperavel',
        slots: {
          m: {estado: 'falha_recuperavel', tentativaId: 'tentativa-m'},
          a: {estado: 'concluido', tentativaId: 'tentativa-a'},
        },
      }),
      true,
    );
    const {hook} = await renderMaterializador(store);

    const monitoramento = (await clientApi.getProject(
      `${ORG_ID}-m`,
    )) as ReturnType<typeof fakeCreationProject>;
    const alertas = (await clientApi.getProject(`${ORG_ID}-a`)) as ReturnType<
      typeof fakeCreationProject
    >;

    await waitFor(() =>
      expect(
        store.instance.getState().organizacoes[0]?.arquivoRemoto?.estado,
      ).toBe('concluido'),
    );

    // Only the failed slot was sent; the concluded one is never re-sent.
    expect(monitoramento.$member.addServerPeer).toHaveBeenCalledTimes(1);
    expect(monitoramento.$member.addServerPeer).toHaveBeenCalledWith(
      'https://arquivo.example/',
    );
    expect(alertas.$member.addServerPeer).not.toHaveBeenCalled();
    expect(
      store.instance.getState().organizacoes[0]?.arquivoRemoto?.slots,
    ).toMatchObject({
      m: {estado: 'concluido'},
      a: {estado: 'concluido', tentativaId: 'tentativa-a'},
    });

    // A rerender of the same provider is not a second boot: nothing resends.
    // `renderHook().rerender` is async and already wraps the update in act;
    // awaiting it keeps the act scope from leaking into the next test (an
    // unawaited rerender left effects unflushed there, so the following
    // provider neither reported its handle nor ran its boot reconciliation).
    await hook.rerender(undefined as never);
    await act(async () => {
      await Promise.resolve();
    });
    expect(monitoramento.$member.addServerPeer).toHaveBeenCalledTimes(1);
  });

  test('retry por id não recria projeto nem reimporta categorias', async () => {
    const store = createCoiabOrganizationsStore();
    // `aplicando` with the replay budget already consumed: the boot pass can
    // only mark the durable failure — it must not send. The explicit retry
    // below is the one that talks to the server.
    store.instance.setState(
      readyDocumentWithArchive({
        url: 'https://arquivo.example/',
        estado: 'aplicando',
        slots: {
          m: {
            estado: 'aplicando',
            tentativaId: 'tentativa-m',
            iniciadaEm: 1,
            replayConsumido: true,
          },
          a: {
            estado: 'aplicando',
            tentativaId: 'tentativa-a',
            iniciadaEm: 1,
            replayConsumido: true,
          },
        },
      }),
      true,
    );
    const {hook} = await renderMaterializador(store);

    const monitoramento = (await clientApi.getProject(
      `${ORG_ID}-m`,
    )) as ReturnType<typeof fakeCreationProject>;
    const alertas = (await clientApi.getProject(`${ORG_ID}-a`)) as ReturnType<
      typeof fakeCreationProject
    >;

    await waitFor(() =>
      expect(
        store.instance.getState().organizacoes[0]?.arquivoRemoto?.slots.m
          .estado,
      ).toBe('falha_recuperavel'),
    );
    // The boot pass never sent: the replay budget was already spent.
    expect(monitoramento.$member.addServerPeer).not.toHaveBeenCalled();
    expect(alertas.$member.addServerPeer).not.toHaveBeenCalled();

    await act(async () => {
      await hook.result.current!.retomarArquivo(ORG_ID);
    });

    expect(monitoramento.$member.addServerPeer).toHaveBeenCalledWith(
      'https://arquivo.example/',
    );
    expect(alertas.$member.addServerPeer).toHaveBeenCalledWith(
      'https://arquivo.example/',
    );
    expect(
      store.instance.getState().organizacoes[0]?.arquivoRemoto?.estado,
    ).toBe('concluido');

    // A retry of the archive step is NEVER a second materialization: no
    // project is created, no package is imported and the entry is not
    // re-confirmed.
    expect(clientApi.createProject).not.toHaveBeenCalled();
    expect(monitoramento.$importCategories).not.toHaveBeenCalled();
    expect(alertas.$importCategories).not.toHaveBeenCalled();
    const materializer = createMaterializerMock.mock.results[0]!.value;
    expect(materializer.start).not.toHaveBeenCalled();
    expect(materializer.resume).not.toHaveBeenCalled();
    expect(confirmarEntradaMock).not.toHaveBeenCalled();
  });

  test('iniciar repassa a URL do arquivo remoto ao motor e grava no journal', async () => {
    const store = createCoiabOrganizationsStore();
    const {hook} = await renderMaterializador(store);

    await act(async () => {
      await hook.result.current!.iniciar('Nova', {
        arquivoRemotoUrl: 'arquivo.example',
      });
    });

    const materializer = createMaterializerMock.mock.results[0]!.value;
    expect(materializer.start).toHaveBeenCalledWith('Nova', {
      arquivoRemotoUrl: 'arquivo.example',
    });
    expect(
      store.instance.getState().organizacoes[0]?.arquivoRemoto,
    ).toMatchObject({
      url: 'https://arquivo.example/',
      estado: 'concluido',
    });
  });
});
