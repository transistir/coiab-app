import {
  EstadoOrganizacoes,
  OrganizacaoLocal,
  criarEtapaAreaAusente,
  derivarProjectIdAtivo,
} from './coiabOrganizations';

function criarOrganizacaoPronta(
  overrides: Partial<OrganizacaoLocal> = {},
): OrganizacaoLocal {
  return {
    id: 'org-1',
    nome: 'Primeira',
    estado: 'pronta',
    confirmacaoPendente: false,
    materializacao: {
      monitoramento: {
        ...criarEtapaAreaAusente(),
        etapa: 'verificado',
        projectId: 'proj-m-1',
        template: {versao: '1', hash: 'm'},
      },
      alertas: {
        ...criarEtapaAreaAusente(),
        etapa: 'verificado',
        projectId: 'proj-a-1',
        template: {versao: '1', hash: 'a'},
      },
    },
    areaEmExecucao: null,
    ultimoErro: null,
    ...overrides,
  };
}

describe('derivarProjectIdAtivo (SPEC A §4.2 regra 5)', () => {
  const semSelecao: EstadoOrganizacoes = {
    versao: 1,
    organizacoes: [criarOrganizacaoPronta()],
    ativa: null,
  };

  test('sem seleção persistida não há projeto operacional', () => {
    expect(derivarProjectIdAtivo(semSelecao)).toBeNull();
  });

  test('deriva da área selecionada da organização ativa', () => {
    expect(
      derivarProjectIdAtivo({
        ...semSelecao,
        ativa: {organizacaoId: 'org-1', area: 'alertas'},
      }),
    ).toBe('proj-a-1');
  });

  test('busca pelo ID da organização, não pelo índice', () => {
    // A ativa é a SEGUNDA da coleção; um índiceNumérico pegaria o projeto errado.
    const estado: EstadoOrganizacoes = {
      versao: 1,
      organizacoes: [
        readyOrganization('org-0'),
        criarOrganizacaoPronta({id: 'org-1'}),
      ],
      ativa: {organizacaoId: 'org-1', area: 'monitoramento'},
    };
    expect(derivarProjectIdAtivo(estado)).toBe('proj-m-1');
  });

  test('ativa apontando para organização inexistente deriva null', () => {
    expect(
      derivarProjectIdAtivo({
        ...semSelecao,
        ativa: {organizacaoId: 'fantasma', area: 'monitoramento'},
      }),
    ).toBeNull();
  });

  test('organização não pronta não autoriza projeto operacional', () => {
    const estado: EstadoOrganizacoes = {
      versao: 1,
      organizacoes: [
        criarOrganizacaoPronta({
          estado: 'falha_recuperavel',
          confirmacaoPendente: false,
          materializacao: {
            monitoramento: {
              ...criarEtapaAreaAusente(),
              etapa: 'criado',
              projectId: 'proj-m-1',
              template: {versao: '1', hash: 'm'},
            },
            alertas: criarEtapaAreaAusente(),
          },
        }),
      ],
      ativa: {organizacaoId: 'org-1', area: 'monitoramento'},
    };
    expect(derivarProjectIdAtivo(estado)).toBeNull();
  });

  test('pronta com confirmação pendente ainda não opera', () => {
    const estado: EstadoOrganizacoes = {
      versao: 1,
      organizacoes: [criarOrganizacaoPronta({confirmacaoPendente: true})],
      ativa: {organizacaoId: 'org-1', area: 'monitoramento'},
    };
    expect(derivarProjectIdAtivo(estado)).toBeNull();
  });

  test('área sem projectId deriva null', () => {
    const estado: EstadoOrganizacoes = {
      versao: 1,
      organizacoes: [
        criarOrganizacaoPronta({
          materializacao: {
            monitoramento: {
              ...criarEtapaAreaAusente(),
              etapa: 'verificado',
              projectId: 'proj-m-1',
              template: {versao: '1', hash: 'm'},
            },
            alertas: criarEtapaAreaAusente(),
          },
        }),
      ],
      ativa: {organizacaoId: 'org-1', area: 'alertas'},
    };
    expect(derivarProjectIdAtivo(estado)).toBeNull();
  });
});

describe('invariantes do documento (CA09/CA10)', () => {
  test.each(['duplicado', 'template', 'etapa', 'nome', 'identidade'])(
    'rejeita pronta com %s inválido',
    kind => {
      const state = organizationDocument();
      const org = state.organizacoes[0]!;
      if (kind === 'duplicado') org.materializacao.alertas.projectId = 'B-m';
      if (kind === 'template') org.materializacao.alertas.template = null;
      if (kind === 'etapa') org.materializacao.alertas.etapa = 'importando';
      if (kind === 'nome') org.nome = '  ';
      if (kind === 'identidade') org.id = 'A-m';
      expect(parseEstadoOrganizacoes(state)).toBeNull();
      expect(derivarProjectIdAtivo(state)).toBeNull();
    },
  );
});

import {parseEstadoOrganizacoes} from './coiabOrganizations';
import {organizationDocument, readyOrganization} from './fixtures';
