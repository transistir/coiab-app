import {createCoiabOrganizationsStore} from '../../contexts/CoiabOrganizationsStoreContext';
import {
  COORDINATOR_ROLE_ID,
  CREATOR_ROLE_ID,
  MEMBER_ROLE_ID,
} from '../../sharedTypes';
import type {
  EstadoOrganizacoes,
  EtapaArea,
  OrganizacaoLocal,
} from './coiabOrganizations';
import {criarEtapaAreaAusente} from './coiabOrganizations';
import {
  ClienteDeEntrada,
  ProjetoDeEntrada,
  origemDaOrganizacao,
  verificarEntrada,
} from './entrada';
import type {TemplateSource} from './materializar';
import type {Pacote} from './pacotes';

/** 16 lowercase hex — the registered invite entry id must be marker-valid. */
const ORG_ID = '0123456789abcdef';

/**
 * Invite-entry organization (SPEC B §5.5): both areas journaled as `criado`
 * with the accepted project id, NO creation snapshot, NO template yet.
 */
function organizacaoPorConvite(
  overrides: Partial<OrganizacaoLocal> = {},
): OrganizacaoLocal {
  return {
    id: ORG_ID,
    nome: 'Por convite',
    estado: 'preparando',
    confirmacaoPendente: false,
    materializacao: {
      monitoramento: {
        ...criarEtapaAreaAusente(),
        etapa: 'criado',
        projectId: 'm-convite-1',
      },
      alertas: {
        ...criarEtapaAreaAusente(),
        etapa: 'criado',
        projectId: 'a-convite-1',
      },
    },
    areaEmExecucao: null,
    ultimoErro: null,
    ...overrides,
  };
}

const PACOTES = {
  monitoramento: {ref: {versao: '1', hash: 'm'}, filePath: '/local/m'},
  alertas: {ref: {versao: '1', hash: 'a'}, filePath: '/local/a'},
} as Record<'monitoramento' | 'alertas', Pacote>;

function harness({
  organizacao = organizacaoPorConvite(),
  rows,
  roleIds = {monitoramento: MEMBER_ROLE_ID, alertas: MEMBER_ROLE_ID},
  verifica = true,
}: {
  organizacao?: OrganizacaoLocal;
  rows?: Array<{projectId: string; status: 'joined' | 'joining'}>;
  roleIds?: {monitoramento: string; alertas: string};
  verifica?: boolean | ((projectId: string) => boolean);
} = {}) {
  const document: EstadoOrganizacoes = {
    versao: 1,
    organizacoes: [organizacao],
    ativa: null,
  };
  const store = createCoiabOrganizationsStore();
  store.instance.setState(document, true);

  const createProject = jest.fn();
  const projectsPorId = new Map<
    string,
    {
      $member: {getById: jest.Mock};
      $importCategories: jest.Mock;
      $setProjectSettings: jest.Mock;
      $getProjectSettings: jest.Mock;
      preset: {getMany: jest.Mock};
      field: {getMany: jest.Mock};
      $getOwnRole: jest.Mock;
    }
  >();
  const criarProjeto = (id: string) => {
    let projeto = projectsPorId.get(id);
    if (!projeto) {
      projeto = {
        $member: {getById: jest.fn()},
        $importCategories: jest.fn(),
        $setProjectSettings: jest.fn(),
        $getProjectSettings: jest.fn(),
        preset: {getMany: jest.fn()},
        field: {getMany: jest.fn()},
        $getOwnRole: jest.fn(async () => ({
          roleId:
            id === 'm-convite-1' ? roleIds.monitoramento : roleIds.alertas,
        })),
      };
      projectsPorId.set(id, projeto);
    }
    return projeto;
  };
  const client = {
    getDeviceInfo: jest.fn(async () => ({
      deviceId: 'device',
      name: 'Meu aparelho',
      deviceType: 'mobile' as const,
    })),
    setDeviceInfo: jest.fn(async () => {}),
    listProjects: jest.fn(
      async () =>
        rows ?? [
          {projectId: 'm-convite-1', status: 'joined' as const},
          {projectId: 'a-convite-1', status: 'joined' as const},
        ],
    ),
    createProject,
    getProject: jest.fn(async (id: string) => criarProjeto(id)),
  };
  const templates = {
    prepare: jest.fn(async () => PACOTES),
    verify: jest.fn(async (_project: unknown, _pacote: unknown, id: string) =>
      typeof verifica === 'function' ? verifica(id) : verifica,
    ),
  };
  return {
    store,
    client,
    createProject,
    templates,
    deps: {
      store,
      client: client as ClienteDeEntrada,
      templates: templates as TemplateSource<ProjetoDeEntrada, Pacote>,
      organizacaoId: ORG_ID,
    },
  };
}

describe('verificarEntrada (SPEC B §5.5)', () => {
  test('nunca cria nem importa, mesmo com categorias divergentes', async () => {
    const h = harness({verifica: false});

    await expect(verificarEntrada(h.deps)).rejects.toThrow(
      'categories-not-synced',
    );
    expect(h.createProject).not.toHaveBeenCalled();
    // The import/settings writes NEVER happen: this is an entry into an
    // EXISTING organization, not a creation.
    const project = await h.client.getProject('m-convite-1');
    expect(project.$importCategories).not.toHaveBeenCalled();
    expect(project.$setProjectSettings).not.toHaveBeenCalled();
    // The document is untouched: still `preparando`, no confirmation.
    const org = h.store.instance.getState().organizacoes[0];
    expect(org?.estado).toBe('preparando');
    expect(org?.confirmacaoPendente).toBe(false);
    expect(org?.materializacao.monitoramento.template).toBeNull();
  });

  test('linha joining lança join-pending e não escreve nada', async () => {
    const h = harness({
      rows: [
        {projectId: 'm-convite-1', status: 'joining'},
        {projectId: 'a-convite-1', status: 'joined'},
      ],
    });
    const antes = h.store.instance.getState();
    const publish = jest.fn();
    h.store.instance.subscribe(publish);

    await expect(verificarEntrada(h.deps)).rejects.toThrow('join-pending');

    expect(h.store.instance.getState()).toBe(antes);
    expect(publish).not.toHaveBeenCalled();
    expect(h.createProject).not.toHaveBeenCalled();
    // The role read never ran: the joined gate comes first.
    const project = await h.client.getProject('m-convite-1');
    expect(project.$getOwnRole).not.toHaveBeenCalled();
  });

  test('papéis indisponíveis lançam access-unavailable', async () => {
    const h = harness({
      roleIds: {monitoramento: 'sem-papel', alertas: 'sem-papel'},
    });

    await expect(verificarEntrada(h.deps)).rejects.toThrow(
      'access-unavailable',
    );
    const org = h.store.instance.getState().organizacoes[0];
    expect(org?.estado).toBe('preparando');
    expect(h.createProject).not.toHaveBeenCalled();
  });
  test('categorias verificadas publicam pronta com confirmação pendente e refs embarcadas', async () => {
    const h = harness({
      roleIds: {monitoramento: COORDINATOR_ROLE_ID, alertas: CREATOR_ROLE_ID},
    });

    await verificarEntrada(h.deps);

    const org = h.store.instance.getState().organizacoes[0];
    expect(org?.estado).toBe('pronta');
    expect(org?.confirmacaoPendente).toBe(true);
    expect(org?.materializacao).toStrictEqual({
      monitoramento: {
        etapa: 'verificado',
        projectId: 'm-convite-1',
        template: {versao: '1', hash: 'm'},
        idsAntesDaCriacao: null,
      },
      alertas: {
        etapa: 'verificado',
        projectId: 'a-convite-1',
        template: {versao: '1', hash: 'a'},
        idsAntesDaCriacao: null,
      },
    });
    expect(org?.areaEmExecucao).toBeNull();
    expect(org?.ultimoErro).toBeNull();
  });
  const estadosDeCriacao: Array<[EtapaArea['etapa'], EtapaArea]> = [
    [
      'ausente',
      {
        etapa: 'ausente',
        projectId: null,
        template: null,
        idsAntesDaCriacao: null,
      },
    ],
    [
      'criando',
      {
        etapa: 'criando',
        projectId: null,
        template: null,
        idsAntesDaCriacao: [],
      },
    ],
    [
      'criado',
      {
        etapa: 'criado',
        projectId: 'p-m',
        template: null,
        idsAntesDaCriacao: ['antigo-1'],
      },
    ],
    [
      'importando',
      {
        etapa: 'importando',
        projectId: 'p-m',
        template: null,
        idsAntesDaCriacao: ['antigo-1'],
      },
    ],
    [
      'verificado',
      {
        etapa: 'verificado',
        projectId: 'p-m',
        template: {versao: '1', hash: 'h'},
        idsAntesDaCriacao: ['antigo-1'],
      },
    ],
  ];
  test.each(estadosDeCriacao)(
    'estado de criação %s → origem criacao',
    (_etapa, area) => {
      expect(
        origemDaOrganizacao(
          organizacaoPorConvite({
            materializacao: {monitoramento: area, alertas: area},
          }),
        ),
      ).toBe('criacao');
    },
  );

  test('tabela de origem: entrada por convite vs estados de criação', () => {
    // Convite registrado: journal criado, sem snapshot e sem template.
    expect(origemDaOrganizacao(organizacaoPorConvite())).toBe('convite');

    // Convite que falhou a conferência: mesmo journal, estado recuperável.
    expect(
      origemDaOrganizacao(
        organizacaoPorConvite({
          estado: 'falha_recuperavel',
          ultimoErro: {
            codigo: 'access-unavailable',
            area: 'alertas',
            ocorridoEm: '2026-09-15T00:00:00.000Z',
          },
        }),
      ),
    ).toBe('convite');

    // Uma área sem projeto ainda: criação.
    expect(
      origemDaOrganizacao(
        organizacaoPorConvite({
          materializacao: {
            monitoramento: criarEtapaAreaAusente(),
            alertas: {
              ...criarEtapaAreaAusente(),
              etapa: 'criado',
              projectId: 'a-convite-1',
            },
          },
        }),
      ),
    ).toBe('criacao');

    // Snapshot de criação presente em uma área: criação.
    expect(
      origemDaOrganizacao(
        organizacaoPorConvite({
          materializacao: {
            monitoramento: {
              ...criarEtapaAreaAusente(),
              etapa: 'criado',
              projectId: 'm-convite-1',
              idsAntesDaCriacao: ['antigo-1'],
            },
            alertas: {
              ...criarEtapaAreaAusente(),
              etapa: 'criado',
              projectId: 'a-convite-1',
            },
          },
        }),
      ),
    ).toBe('criacao');
  });
});
