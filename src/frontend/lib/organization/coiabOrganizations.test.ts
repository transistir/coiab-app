import {
  EstadoOrganizacoes,
  OrganizacaoLocal,
  classificarDocumento,
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

describe('classificarDocumento (SPEC B §3.3 critério de navegação)', () => {
  test('documento sem organizações → nenhum', () => {
    expect(
      classificarDocumento({versao: 1, organizacoes: [], ativa: null}),
    ).toBe('nenhum');
  });

  test('organização com estado ≠ pronta → preparando', () => {
    for (const estado of ['preparando', 'falha_recuperavel'] as const) {
      expect(
        classificarDocumento({
          versao: 1,
          organizacoes: [criarOrganizacaoPronta({estado})],
          ativa: null,
        }),
      ).toBe('preparando');
    }
  });

  test('pronta com confirmação pendente → confirmacao', () => {
    expect(
      classificarDocumento({
        versao: 1,
        organizacoes: [criarOrganizacaoPronta({confirmacaoPendente: true})],
        ativa: null,
      }),
    ).toBe('confirmacao');
  });

  test('pronta sem pendência → pronta', () => {
    expect(
      classificarDocumento({
        versao: 1,
        organizacoes: [criarOrganizacaoPronta()],
        ativa: null,
      }),
    ).toBe('pronta');
  });

  test('preparando vence prontas na mesma lista', () => {
    expect(
      classificarDocumento({
        versao: 1,
        organizacoes: [
          criarOrganizacaoPronta(),
          criarOrganizacaoPronta({id: 'org-2', estado: 'preparando'}),
        ],
        ativa: null,
      }),
    ).toBe('preparando');
  });

  test('confirmação pendente vence prontas resolvidas, mas não vence preparando', () => {
    const mistas = (segunda: OrganizacaoLocal) => ({
      versao: 1 as const,
      organizacoes: [criarOrganizacaoPronta(), segunda],
      ativa: null,
    });
    // A pendência ainda é confirmacao enquanto NADA está em preparação.
    expect(
      classificarDocumento(
        mistas(
          criarOrganizacaoPronta({id: 'org-2', confirmacaoPendente: true}),
        ),
      ),
    ).toBe('confirmacao');
    // A preparação em curso vem antes de qualquer confirmação.
    expect(
      classificarDocumento(
        mistas(criarOrganizacaoPronta({id: 'org-2', estado: 'preparando'})),
      ),
    ).toBe('preparando');
  });
});
