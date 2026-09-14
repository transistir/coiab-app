import {
  COIAB_ORGANIZATIONS_STORAGE_KEY,
  createCoiabOrganizationsStore,
} from '../../contexts/CoiabOrganizationsStoreContext';
import {MMKVStoreInitializer} from '../../hooks/persistedState/createPersistedState';
import {
  criarEtapaAreaAusente,
  type EstadoOrganizacoes,
  type EtapaArea,
  type OrganizacaoLocal,
} from './coiabOrganizations';
import {createMaterializer} from './materializar';
import {markerFor} from './marker';
import {repositorioDoStore} from './repositorio';

const ORG_ID = '0123456789abcdef';

function lerRaw(): string | null {
  return MMKVStoreInitializer.getItem(COIAB_ORGANIZATIONS_STORAGE_KEY) as
    string | null;
}

function organizacaoPreparando(
  overrides: Partial<OrganizacaoLocal> = {},
): OrganizacaoLocal {
  return {
    id: ORG_ID,
    nome: 'Primeira',
    estado: 'preparando',
    confirmacaoPendente: false,
    materializacao: {
      monitoramento: criarEtapaAreaAusente(),
      alertas: criarEtapaAreaAusente(),
    },
    areaEmExecucao: null,
    ultimoErro: null,
    ...overrides,
  };
}

/** §4.2-valid ready organization: both areas verified with a pinned ref. */
function organizacaoPronta(): OrganizacaoLocal {
  const area = (projectId: string, hash: string): EtapaArea => ({
    etapa: 'verificado',
    projectId,
    template: {versao: '1', hash},
    idsAntesDaCriacao: null,
  });
  return {
    id: ORG_ID,
    nome: 'Primeira',
    estado: 'pronta',
    confirmacaoPendente: false,
    materializacao: {
      monitoramento: area(`${ORG_ID}-m`, 'monitoramento'),
      alertas: area(`${ORG_ID}-a`, 'alertas'),
    },
    areaEmExecucao: null,
    ultimoErro: null,
  };
}

function documentoComDuasOrganizacoes(): EstadoOrganizacoes {
  const primeira = organizacaoPreparando();
  return {
    versao: 1,
    organizacoes: [
      primeira,
      organizacaoPreparando({id: 'ffffffffffffffff', nome: 'Segunda'}),
    ],
    ativa: null,
  };
}

describe('repositorioDoStore', () => {
  beforeEach(() => {
    MMKVStoreInitializer.removeItem(COIAB_ORGANIZATIONS_STORAGE_KEY);
  });

  test('o mesmo store devolve o mesmo objeto de repositório', () => {
    // The materializer's lock registry keys on the repository object: two
    // lookups for one store must return ONE instance (WeakMap-cached).
    const store = createCoiabOrganizationsStore({persist: true});
    expect(repositorioDoStore(store)).toBe(repositorioDoStore(store));
  });

  test('read devolve o documento sem a flag de hidratação', () => {
    const store = createCoiabOrganizationsStore({persist: true});
    const repositorio = repositorioDoStore(store);

    expect(repositorio.read()).toStrictEqual({
      versao: 1,
      organizacoes: [],
      ativa: null,
    });
  });

  test('write persiste sob a chave CoiabOrganizations', () => {
    const store = createCoiabOrganizationsStore({persist: true});
    const repositorio = repositorioDoStore(store);

    const org = organizacaoPronta();
    repositorio.write({
      versao: 1,
      organizacoes: [org],
      ativa: {organizacaoId: ORG_ID, area: 'monitoramento'},
    });

    // The durable value keeps the exact §4.2 shape (no runtime flags).
    const raw = lerRaw();
    expect(JSON.parse(raw as string)).toStrictEqual({
      state: {
        versao: 1,
        organizacoes: [org],
        ativa: {organizacaoId: ORG_ID, area: 'monitoramento'},
      },
      version: 1,
    });

    const state = store.instance.getState();
    // Published state carries the written document by reference.
    expect(state.organizacoes).toStrictEqual([org]);
    expect(state.organizacoes[0]).toBe(org);
    expect(state.ativa).toStrictEqual({
      organizacaoId: ORG_ID,
      area: 'monitoramento',
    });
  });

  test('write persiste um documento que um novo store reidrata', () => {
    const repositorio = repositorioDoStore(
      createCoiabOrganizationsStore({persist: true}),
    );
    const org = organizacaoPronta();
    repositorio.write({versao: 1, organizacoes: [org], ativa: null});

    const reidratado = createCoiabOrganizationsStore({persist: true});
    expect(reidratado.instance.getState()).toMatchObject({
      versao: 1,
      organizacoes: [org],
      ativa: null,
      hidratacaoFalhou: false,
    });
  });

  test('write lança com hidratação falhada, deixando o valor cru intacto', () => {
    const corrompido = '{unreadable registry';
    MMKVStoreInitializer.setItem(COIAB_ORGANIZATIONS_STORAGE_KEY, corrompido);
    const repositorio = repositorioDoStore(
      createCoiabOrganizationsStore({persist: true}),
    );
    expect(repositorio.read).toThrow('hydration-failed');

    const antes = lerRaw();
    expect(() =>
      repositorio.write({
        versao: 1,
        organizacoes: [organizacaoPreparando()],
        ativa: null,
      }),
    ).toThrow('hydration-failed');

    // A hydration failure must never clobber the raw value it is reporting.
    expect(lerRaw()).toBe(antes);
  });

  test('write lança quando a gravação em MMKV lança, e o store fica inalterado', () => {
    const store = createCoiabOrganizationsStore({persist: true});
    const repositorio = repositorioDoStore(store);
    const antes = store.instance.getState();

    const write = jest
      .spyOn(MMKVStoreInitializer, 'setItem')
      .mockImplementationOnce(() => {
        throw new Error('disk full');
      });

    try {
      expect(() =>
        repositorio.write({
          versao: 1,
          organizacoes: [organizacaoPreparando()],
          ativa: null,
        }),
      ).toThrow('disk full');
    } finally {
      write.mockRestore();
    }

    // MMKV is written before publishing: the failed write left the store
    // untouched, so the previous document stays intact (materializer's
    // "throwing leaves the previous document intact" contract).
    expect(store.instance.getState()).toBe(antes);
    expect(store.instance.getState().organizacoes).toStrictEqual([]);
  });

  test('read e write recusam duas organizações', () => {
    MMKVStoreInitializer.setItem(
      COIAB_ORGANIZATIONS_STORAGE_KEY,
      JSON.stringify({state: documentoComDuasOrganizacoes(), version: 1}),
    );
    const repositorio = repositorioDoStore(
      createCoiabOrganizationsStore({persist: true}),
    );

    // Index-0 clobbering: a second organization must never be silently
    // replaced by a single-organization write.
    expect(repositorio.read).toThrow('multiple-organizations-unsupported');

    const antes = lerRaw();
    expect(() =>
      repositorio.write({
        versao: 1,
        organizacoes: [organizacaoPreparando()],
        ativa: null,
      }),
    ).toThrow('multiple-organizations-unsupported');
    expect(lerRaw()).toBe(antes);
  });

  test('write recusa um documento que o parser §4.2 rejeita', () => {
    const repositorio = repositorioDoStore(
      createCoiabOrganizationsStore({persist: true}),
    );
    const antes = lerRaw();

    // A ready organization with a pending confirmation is invalid per §4.2.
    expect(() =>
      repositorio.write({
        versao: 1,
        organizacoes: [organizacaoPreparando({estado: 'pronta'})],
        ativa: null,
      }),
    ).toThrow('invalid-document');

    expect(lerRaw()).toBe(antes);
  });

  test('write lança organization-write-rejected quando a escrita não pousa', () => {
    const store = createCoiabOrganizationsStore({persist: true});
    const repositorio = repositorioDoStore(store);
    // A silent no-op of the guarded setState (e.g. the hydration block it
    // also owns) must be CAUGHT, never reported as success: success would
    // let createProject run on a lost `criando` checkpoint and the next
    // resume would create a duplicate. Force the no-op to isolate the
    // reference-equality confirmation.
    const setState = jest
      .spyOn(store.instance, 'setState')
      .mockImplementation(() => undefined);

    try {
      expect(() =>
        repositorio.write({
          versao: 1,
          organizacoes: [organizacaoPreparando()],
          ativa: null,
        }),
      ).toThrow('organization-write-rejected');
    } finally {
      setState.mockRestore();
    }

    expect(store.instance.getState().organizacoes).toStrictEqual([]);
  });

  test('integração: o materializador publica pronta sobre o repositório do store', async () => {
    const store = createCoiabOrganizationsStore({persist: true});
    const repositorio = repositorioDoStore(store);

    const projects: string[] = [];
    const settings = new Map<
      string,
      {name?: string; sendStats?: boolean; projectDescription?: string}
    >();
    const imported = new Set<string>();
    const client = {
      listProjects: jest.fn(async () =>
        projects.map(projectId => ({projectId})),
      ),
      createProject: jest.fn(
        async ({
          name,
          projectDescription,
        }: {
          name: string;
          configPath: string;
          projectDescription: string;
        }) => {
          const id = `id-${projects.length}`;
          projects.push(id);
          settings.set(id, {name, sendStats: false, projectDescription});
          return id;
        },
      ),
      getDeviceInfo: jest.fn(async () => ({
        deviceId: 'device',
        name: 'Meu aparelho',
        deviceType: 'mobile' as const,
      })),
      setDeviceInfo: jest.fn(async () => {}),
      getProject: jest.fn(async (id: string) => ({
        $importCategories: jest.fn(async () => {
          imported.add(id);
        }),
        // Core MERGES settings ({...existing, ...new}).
        $setProjectSettings: jest.fn(
          async (next: {
            name: string;
            sendStats: boolean;
            projectDescription: string;
          }) => {
            settings.set(id, {...settings.get(id), ...next});
          },
        ),
        $getProjectSettings: jest.fn(async () => ({...settings.get(id)})),
        $member: {
          getById: jest.fn(async () => ({
            name: 'Meu aparelho',
            deviceType: 'mobile',
            role: {roleId: 'a12a6702b93bd7ff'},
          })),
        },
      })),
    };
    const templates = {
      prepare: jest.fn(async () => ({
        monitoramento: {ref: {versao: '1', hash: 'm'}, filePath: '/local/m'},
        alertas: {ref: {versao: '1', hash: 'a'}, filePath: '/local/a'},
      })),
      verify: jest.fn(async (_project: unknown, _t: unknown, id: string) =>
        imported.has(id),
      ),
    };

    const materializador = createMaterializer({
      client,
      templates,
      repository: repositorio,
      generateId: () => ORG_ID,
    });

    await materializador.start('Acme');

    // The journal is DURABLE: read the raw MMKV value, not the in-memory state.
    const raw = JSON.parse(lerRaw() as string) as {state: EstadoOrganizacoes};
    const org = raw.state.organizacoes[0]!;
    expect(org.id).toBe(ORG_ID);
    expect(org.nome).toBe('Acme');
    expect(org.estado).toBe('pronta');
    expect(org.confirmacaoPendente).toBe(true);
    expect(org.materializacao.monitoramento).toMatchObject({
      etapa: 'verificado',
      projectId: 'id-0',
    });
    expect(org.materializacao.alertas).toMatchObject({
      etapa: 'verificado',
      projectId: 'id-1',
    });
    // SPEC B §5.4 step 7: publication never selects the organization — the
    // "Abrir organização" tap does (the marker's legacy projection is null).
    expect(raw.state.ativa).toBeNull();
    // The client surface the materializer exercised, over the real adapter.
    expect(client.createProject).toHaveBeenCalledWith({
      name: 'Monitoramento',
      configPath: '',
      projectDescription: markerFor(ORG_ID, 'm', 'Acme'),
    });
  });
});
