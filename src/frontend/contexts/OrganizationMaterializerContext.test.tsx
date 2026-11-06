import * as React from 'react';
import {act, renderHook, waitFor} from '@testing-library/react-native';
import {useClientApi} from '@comapeo/core-react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import type {ComapeoCoreClientApi} from '@comapeo/ipc';
import type {ReactNode} from 'react';

import {CREATOR_ROLE_ID, MEMBER_ROLE_ID} from '../sharedTypes';
import type {ResultadoArquivoRemoto} from '../lib/organization/arquivoRemoto';
import {clienteDeCriacao} from '../lib/organization/clienteDeCriacao';
import type {
  EstadoOrganizacoes,
  EstadoSlotArquivoRemoto,
} from '../lib/organization/coiabOrganizations';
import {readyOrganization} from '../lib/organization/fixtures';
import {confirmarEntrada} from '../lib/organization/entrada';
import {
  createMaterializer,
  type CreationProject,
  type TemplatePackage,
  type TemplateSource,
} from '../lib/organization/materializar';
import {projectsQueryKey} from '../lib/organization/queryKeys';
import {MMKVStoreInitializer} from '../hooks/persistedState/createPersistedState';
import {
  COIAB_ORGANIZATIONS_STORAGE_KEY,
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

  test('falha recuperável não é reenviada no boot; o retry é explícito', async () => {
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

    // Boot is automatic: a recorded failure waits for the user, never a
    // watchdog resend that could reset the durable replay budget.
    await act(async () => {
      await Promise.resolve();
    });
    expect(monitoramento.$member.addServerPeer).not.toHaveBeenCalled();
    expect(alertas.$member.addServerPeer).not.toHaveBeenCalled();
    expect(
      store.instance.getState().organizacoes[0]?.arquivoRemoto?.estado,
    ).toBe('falha_recuperavel');

    // The explicit retry is the one action that talks to the server.
    await act(async () => {
      await hook.result.current!.retomarArquivo(ORG_ID);
    });

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
    await hook.rerender(undefined);
    await act(async () => {
      await Promise.resolve();
    });
    expect(monitoramento.$member.addServerPeer).toHaveBeenCalledTimes(1);
  });

  test('#142 P2: duas aberturas consecutivas não reenviam o arquivo após replay esgotado', async () => {
    // Real persistence proof: the first opening writes the failed checkpoints
    // to the test storage, and the second opening is a NEW store rehydrated
    // from that storage — reusing one in-memory store proves nothing.
    MMKVStoreInitializer.removeItem(COIAB_ORGANIZATIONS_STORAGE_KEY);
    const primeiroStore = createCoiabOrganizationsStore({persist: true});
    // The durable journal already spent its one replay: the first boot can
    // only record the failure. The SECOND opening must not choose `retry`
    // merely because the aggregate state is now `falha_recuperavel`.
    primeiroStore.instance.setState(
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
          a: {estado: 'concluido', tentativaId: 'tentativa-a'},
        },
      }),
      true,
    );

    const primeiro = await renderMaterializador(primeiroStore);
    const monitoramento = (await clientApi.getProject(
      `${ORG_ID}-m`,
    )) as ReturnType<typeof fakeCreationProject>;

    await waitFor(() =>
      expect(
        primeiroStore.instance.getState().organizacoes[0]?.arquivoRemoto?.slots
          .m.estado,
      ).toBe('falha_recuperavel'),
    );
    expect(monitoramento.$member.addServerPeer).not.toHaveBeenCalled();

    await act(async () => {
      await primeiro.hook.unmount();
    });

    // The raw slice the on-device MMKV holds — not the in-memory state.
    const cru = MMKVStoreInitializer.getItem(
      COIAB_ORGANIZATIONS_STORAGE_KEY,
    ) as string | null;
    expect(typeof cru).toBe('string');
    const gravado = JSON.parse(cru as string).state as EstadoOrganizacoes;
    expect(gravado.organizacoes[0]?.arquivoRemoto?.slots.m).toMatchObject({
      estado: 'falha_recuperavel',
      replayConsumido: true,
    });

    // Second opening over the SAME persisted document, built fresh.
    const segundoStore = createCoiabOrganizationsStore({persist: true});
    const segundo = await renderMaterializador(segundoStore);
    await act(async () => {
      await Promise.resolve();
    });

    expect(monitoramento.$member.addServerPeer).not.toHaveBeenCalled();
    expect(
      segundoStore.instance.getState().organizacoes[0]?.arquivoRemoto?.slots.m,
    ).toMatchObject({
      estado: 'falha_recuperavel',
      replayConsumido: true,
    });
    // No creation was started either: the archive boot is never a new
    // materialization.
    const materializer = createMaterializerMock.mock.results[0]!.value;
    expect(materializer.start).not.toHaveBeenCalled();

    await act(async () => {
      await segundo.hook.unmount();
    });
    MMKVStoreInitializer.removeItem(COIAB_ORGANIZATIONS_STORAGE_KEY);
  });

  test('#142 2ª rodada P2: remover reabre só o slot removido e reenviar a mesma URL envia de verdade', async () => {
    const store = createCoiabOrganizationsStore();
    store.instance.setState(
      readyDocumentWithArchive({
        url: 'https://arquivo.example/',
        estado: 'concluido',
        slots: {
          m: {estado: 'concluido', tentativaId: 'tentativa-m'},
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

    // A concluded journal is not resent just because the provider mounted.
    await act(async () => {
      await Promise.resolve();
    });
    expect(monitoramento.$member.addServerPeer).not.toHaveBeenCalled();
    expect(alertas.$member.addServerPeer).not.toHaveBeenCalled();

    // The real removal flow (RemoveRemoteArchive): durable mark BEFORE the
    // Core call, then finalize after it succeeds.
    let anterior: EstadoSlotArquivoRemoto | undefined;
    await act(async () => {
      anterior = hook.result.current!.marcarRemocao(`${ORG_ID}-m`);
      expect(
        store.instance.getState().organizacoes[0]?.arquivoRemoto?.slots.m
          .estado,
      ).toBe('removendo');
      expect(hook.result.current!.removerArquivo(`${ORG_ID}-m`)).toBe(true);
    });
    expect(anterior!).toMatchObject({estado: 'concluido'});
    const aposRemocao =
      store.instance.getState().organizacoes[0]!.arquivoRemoto!;
    // Reopened only for an explicit request (never auto-sent by the boot).
    expect(aposRemocao.estado).toBe('pendente');
    expect(aposRemocao.slots.m).toEqual({
      estado: 'pendente',
      erro: 'removido',
    });
    // The untouched project keeps its successful slot byte-identical.
    expect(aposRemocao.slots.a).toMatchObject({
      estado: 'concluido',
      tentativaId: 'tentativa-a',
    });

    // Requesting the SAME URL again must produce a real send for the removed
    // slot — and only for it.
    const resultado = await hook.result.current!.solicitarArquivo(
      ORG_ID,
      'https://arquivo.example/',
    );

    expect(resultado.estado).toBe('concluido');
    expect(monitoramento.$member.addServerPeer).toHaveBeenCalledTimes(1);
    expect(monitoramento.$member.addServerPeer).toHaveBeenCalledWith(
      'https://arquivo.example/',
    );
    expect(alertas.$member.addServerPeer).not.toHaveBeenCalled();
    expect(
      store.instance.getState().organizacoes[0]?.arquivoRemoto?.estado,
    ).toBe('concluido');

    await act(async () => {
      await hook.unmount();
    });
  });

  test('#142 2ª rodada P2: conclusão tardia após o prazo invalida membros na resposta real', async () => {
    jest.useFakeTimers();
    try {
      let liberar!: () => void;
      const pendente = new Promise<void>(resolve => {
        liberar = resolve;
      });
      const addServerPeer = jest.fn(() => pendente);
      clientApi.getProject = jest.fn(async () => ({
        $member: {addServerPeer},
      }));

      const store = createCoiabOrganizationsStore();
      store.instance.setState(
        readyDocumentWithArchive({
          url: 'https://arquivo.example/',
          estado: 'pendente',
          slots: {m: {estado: 'pendente'}, a: {estado: 'pendente'}},
        }),
        true,
      );

      const {hook, invalidateQueries} = await renderMaterializador(store);
      const projetosInvalidados = () =>
        invalidateQueries.mock.calls
          .map(([arg]) => arg?.queryKey)
          .filter(
            (queryKey): queryKey is unknown[] =>
              Array.isArray(queryKey) && queryKey[3] === 'members',
          )
          .map(queryKey => queryKey[2]);

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(addServerPeer).toHaveBeenCalledTimes(2);
      expect(projetosInvalidados()).toEqual([]);

      // The deadline releases the presentation without being a server effect:
      // the journal becomes recoverable, but the member cache stays untouched.
      await act(async () => {
        jest.advanceTimersByTime(60_000);
        await Promise.resolve();
      });
      expect(
        store.instance.getState().organizacoes[0]?.arquivoRemoto?.slots.m
          .estado,
      ).toBe('falha_recuperavel');
      expect(projetosInvalidados()).toEqual([]);

      // The REAL late response still lands and concludes the journal; now the
      // member cache of each project that received the archive is refreshed.
      await act(async () => {
        liberar();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(
        store.instance.getState().organizacoes[0]?.arquivoRemoto?.estado,
      ).toBe('concluido');
      expect(new Set(projetosInvalidados())).toEqual(
        new Set([`${ORG_ID}-m`, `${ORG_ID}-a`]),
      );

      await act(async () => {
        await hook.unmount();
      });
    } finally {
      jest.useRealTimers();
    }
  });

  test('#142 3ª rodada P2: criação com arquivo remoto invalida membros só na conclusão real', async () => {
    jest.useFakeTimers();
    try {
      const pendentes: Array<{
        projectId: string;
        liberar: () => void;
        addServerPeer: jest.Mock;
      }> = [];
      const projetos = new Map<
        string,
        ReturnType<typeof fakeCreationProject>
      >();
      clientApi.getProject = jest.fn(async (id: string) => {
        let projeto = projetos.get(id);
        if (!projeto) {
          const base = fakeCreationProject();
          let liberar!: () => void;
          const pendente = new Promise<void>(resolve => {
            liberar = resolve;
          });
          const addServerPeer = jest.fn(() => pendente);
          projeto = {
            ...base,
            $member: {...base.$member, addServerPeer},
          } as ReturnType<typeof fakeCreationProject>;
          projetos.set(id, projeto);
          pendentes.push({projectId: id, liberar, addServerPeer});
        }
        return projeto;
      });

      const store = createCoiabOrganizationsStore();
      const {hook, invalidateQueries} = await renderMaterializador(store);

      // Invalidating the project-list PREFIX also reaches every member query;
      // the test counts that as a member invalidation unless the call is
      // exact. Explicit member keys always count. A prefix call is represented
      // by a sentinel so it cannot hide behind an empty member-id list.
      const projetosComMembrosInvalidados = () =>
        invalidateQueries.mock.calls
          .map(([arg]) => arg as {queryKey?: unknown[]; exact?: boolean})
          .flatMap(arg => {
            const queryKey = arg.queryKey;
            if (!Array.isArray(queryKey)) return [];
            if (queryKey[3] === 'members') return [queryKey[2] as string];
            const prefixoDeProjetos = projectsQueryKey.every(
              (parte, indice) => queryKey[indice] === parte,
            );
            return prefixoDeProjetos && arg.exact !== true
              ? ['__prefixo__']
              : [];
          });

      let iniciar!: Promise<void>;
      await act(async () => {
        iniciar = hook.result.current!.iniciar('Nova', {
          arquivoRemotoUrl: 'https://arquivo.example/',
        });
        for (let i = 0; i < 200; i += 1) await Promise.resolve();
      });

      expect(pendentes.map(p => p.projectId).sort()).toEqual([
        'criado-Alertas',
        'criado-Monitoramento',
      ]);
      expect(
        pendentes.every(p => p.addServerPeer.mock.calls.length === 1),
      ).toBe(true);
      expect(projetosComMembrosInvalidados()).toEqual([]);

      // The deadline is not a server effect: it opens the slots for recovery
      // and must not refresh any member cache, not even through the project
      // list prefix.
      await act(async () => {
        jest.advanceTimersByTime(60_000);
        for (let i = 0; i < 50; i += 1) await Promise.resolve();
      });
      expect(
        store.instance.getState().organizacoes[0]?.arquivoRemoto?.slots.m
          .estado,
      ).toBe('falha_recuperavel');
      expect(projetosComMembrosInvalidados()).toEqual([]);

      // The REAL responses still settle each slot; now the member cache of
      // every project that received the archive is refreshed.
      await act(async () => {
        for (const pendente of pendentes) pendente.liberar();
        for (let i = 0; i < 50; i += 1) await Promise.resolve();
      });
      await iniciar;

      expect(
        store.instance.getState().organizacoes[0]?.arquivoRemoto?.estado,
      ).toBe('concluido');
      expect(new Set(projetosComMembrosInvalidados())).toEqual(
        new Set(['criado-Alertas', 'criado-Monitoramento']),
      );

      await act(async () => {
        await hook.unmount();
      });
    } finally {
      jest.useRealTimers();
    }
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

  test('#142 P2: segunda URL durante execução viva preserva o journal e não executa', async () => {
    let liberar!: () => void;
    const pendente = new Promise<void>(resolve => {
      liberar = resolve;
    });
    const addServerPeer = jest.fn(() => pendente);
    // Both slots reach the same pending native operation, so the first pass
    // is live (envios > 0) while the second URL is requested.
    clientApi.getProject = jest.fn(async () => ({
      $member: {addServerPeer},
    }));

    const store = createCoiabOrganizationsStore();
    store.instance.setState(
      readyDocumentWithArchive({
        url: 'https://primeiro.example/',
        estado: 'pendente',
        slots: {m: {estado: 'pendente'}, a: {estado: 'pendente'}},
      }),
      true,
    );
    const {hook} = await renderMaterializador(store);

    await waitFor(() => expect(addServerPeer).toHaveBeenCalledTimes(2));
    const antes = store.instance.getState().organizacoes[0]!.arquivoRemoto!;
    expect(antes.slots.m.estado).toBe('aplicando');

    // A DIFFERENT URL arrives while the first pass is alive: the shared lock
    // refuses it. The journal must stay byte-identical — new URL, previous
    // tentativaIds and states — and no new execution may start.
    const resultado = await hook.result.current!.solicitarArquivo(
      ORG_ID,
      'https://segundo.example/',
    );
    expect(resultado.estado).toBe('em-andamento');

    const depois = store.instance.getState().organizacoes[0]!.arquivoRemoto!;
    expect(depois).toBe(antes);
    expect(depois.url).toBe('https://primeiro.example/');
    expect(addServerPeer).toHaveBeenCalledTimes(2);

    await act(async () => {
      liberar();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(
        store.instance.getState().organizacoes[0]?.arquivoRemoto?.estado,
      ).toBe('concluido'),
    );
    await act(async () => {
      await hook.unmount();
    });
  });

  test('#142 5ª rodada P2: outra URL não apaga remoção não reconciliada', async () => {
    jest.useFakeTimers();
    try {
      let coreOffline = true;
      const addServerPeer = jest.fn(async (url: string) => url);
      clientApi.getProject = jest.fn(async () => ({
        $member: {
          addServerPeer,
          getMany: jest.fn(async () => {
            if (coreOffline) throw new Error('core-offline');
            // Core no longer has the archive server: the removal landed.
            return [];
          }),
        },
      }));

      // Durable intent survived a failed checkpoint write / restart: the slot
      // is `removendo` and NO in-memory removal guard exists at boot.
      const store = createCoiabOrganizationsStore();
      store.instance.setState(
        readyDocumentWithArchive({
          url: 'https://primeiro.example/',
          estado: 'pendente',
          slots: {
            m: {estado: 'removendo'},
            a: {estado: 'concluido', tentativaId: 'tentativa-a'},
          },
        }),
        true,
      );
      const {hook} = await renderMaterializador(store);
      await act(async () => {
        for (let i = 0; i < 20; i += 1) await Promise.resolve();
      });
      expect(addServerPeer).not.toHaveBeenCalled();

      const antes = store.instance.getState().organizacoes[0]!.arquivoRemoto!;
      let resultado!: ResultadoArquivoRemoto;
      await act(async () => {
        resultado = await hook.result.current!.solicitarArquivo(
          ORG_ID,
          'https://segundo.example/',
        );
        for (let i = 0; i < 20; i += 1) await Promise.resolve();
      });

      // Core cannot confirm the removal. The new URL is refused BEFORE any
      // send, and the durable intention stays byte-identical in the journal.
      expect(resultado.estado).toBe('em-andamento');
      expect(resultado.estado).not.toBe('concluido');
      expect(addServerPeer).not.toHaveBeenCalled();
      const durante = store.instance.getState().organizacoes[0]!.arquivoRemoto!;
      expect(durante).toBe(antes);
      expect(durante.url).toBe('https://primeiro.example/');
      expect(durante.slots.m.estado).toBe('removendo');

      // Core is reachable again and confirms the server is gone. The next
      // request reconciles FIRST (slot becomes `pendente`/`removido`), then
      // the new URL is journalized and really sent to both slots.
      coreOffline = false;
      await act(async () => {
        resultado = await hook.result.current!.solicitarArquivo(
          ORG_ID,
          'https://segundo.example/',
        );
        for (let i = 0; i < 50; i += 1) await Promise.resolve();
      });

      expect(resultado.estado).toBe('concluido');
      expect(addServerPeer).toHaveBeenCalledTimes(2);
      expect(addServerPeer.mock.calls.map(([url]) => url)).toEqual([
        'https://segundo.example/',
        'https://segundo.example/',
      ]);
      const final = store.instance.getState().organizacoes[0]!.arquivoRemoto!;
      expect(final.url).toBe('https://segundo.example/');
      expect(final.estado).toBe('concluido');

      await act(async () => {
        await hook.unmount();
      });
    } finally {
      jest.useRealTimers();
    }
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
