import {
  EstadoOrganizacoes,
  OrganizacaoLocal,
  classificarDocumento,
  criarEtapaAreaAusente,
  derivarProjectIdAtivo,
  ordenarOrganizacoes,
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

describe('ordenarOrganizacoes (SPEC A §6.1 CA05)', () => {
  function congelar<T>(valor: T): T {
    if (valor !== null && typeof valor === 'object') {
      for (const propriedade of Object.values(valor)) congelar(propriedade);
      Object.freeze(valor);
    }
    return valor;
  }

  const pronta = (
    id: string,
    nome: string,
    overrides: Partial<OrganizacaoLocal> = {},
  ) => criarOrganizacaoPronta({id, nome, ...overrides});

  test('ativa primeiro mesmo com nome que ordenaria por último', () => {
    const estado: EstadoOrganizacoes = {
      versao: 1,
      organizacoes: [
        pronta('zulu-01', 'Zulu'),
        pronta('alfa-02', 'Alfa'),
        pronta('mike-03', 'Mike'),
      ],
      ativa: {organizacaoId: 'zulu-01', area: 'monitoramento'},
    };
    expect(
      ordenarOrganizacoes(congelar(estado)).map(o => [o.id, o.atual]),
    ).toEqual([
      ['zulu-01', true],
      ['alfa-02', false],
      ['mike-03', false],
    ]);
  });

  test('sem ativa: por nome, desempate pelo id', () => {
    const estado: EstadoOrganizacoes = {
      versao: 1,
      organizacoes: [
        pronta('charlie-3', 'Charlie'),
        pronta('alfa-7', 'Alfa'),
        pronta('alfa-2', 'Alfa'),
        pronta('bravo-1', 'Bravo'),
      ],
      ativa: null,
    };
    expect(ordenarOrganizacoes(estado).map(o => o.id)).toEqual([
      'alfa-2',
      'alfa-7',
      'bravo-1',
      'charlie-3',
    ]);
  });

  test('todos os que compartilham o nome recebem sufixo; nome único não', () => {
    const estado: EstadoOrganizacoes = {
      versao: 1,
      organizacoes: [
        pronta('aaaa-1', 'Alfa'),
        pronta('bbbb-2', 'Alfa'),
        pronta('cccc-3', 'Bravo'),
      ],
      ativa: {organizacaoId: 'aaaa-1', area: 'alertas'},
    };
    expect(
      ordenarOrganizacoes(estado).map(o => [o.id, o.rotulo, o.atual]),
    ).toEqual([
      ['aaaa-1', 'Alfa · aaaa', true],
      ['bbbb-2', 'Alfa · bbbb', false],
      ['cccc-3', 'Bravo', false],
    ]);
  });

  test('atual é exclusivo da organização ativa', () => {
    const estado: EstadoOrganizacoes = {
      versao: 1,
      organizacoes: [
        pronta('alfa-1', 'Alfa'),
        pronta('bravo-2', 'Bravo'),
        pronta('charlie-3', 'Charlie'),
      ],
      ativa: {organizacaoId: 'bravo-2', area: 'alertas'},
    };
    const listados = ordenarOrganizacoes(estado);
    expect(listados.filter(o => o.atual).map(o => o.id)).toEqual(['bravo-2']);
    expect(listados.find(o => o.id === 'alfa-1')?.atual).toBe(false);
    expect(listados.find(o => o.id === 'charlie-3')?.atual).toBe(false);
  });

  test('ativa null: ninguém é atual', () => {
    const estado: EstadoOrganizacoes = {
      versao: 1,
      organizacoes: [pronta('alfa-1', 'Alfa'), pronta('bravo-2', 'Bravo')],
      ativa: null,
    };
    expect(ordenarOrganizacoes(estado).every(o => o.atual === false)).toBe(
      true,
    );
  });

  test('ativavel: pronta sem pendência somente', () => {
    const casos = [
      ['pronta', false, true],
      ['pronta', true, false],
      ['preparando', false, false],
      ['falha_recuperavel', false, false],
    ] as const;
    const estado: EstadoOrganizacoes = {
      versao: 1,
      organizacoes: casos.map(([estado_, pendente], indice) =>
        pronta(`id-${indice}`, `Org ${indice}`, {
          estado: estado_,
          confirmacaoPendente: pendente,
        }),
      ),
      ativa: null,
    };
    const listados = ordenarOrganizacoes(estado);
    for (const [indice, [, , esperado]] of casos.entries()) {
      expect(listados.find(o => o.id === `id-${indice}`)?.ativavel).toBe(
        esperado,
      );
    }
  });

  test('não muta o documento nem a lista de organizações', () => {
    const estado: EstadoOrganizacoes = {
      versao: 1,
      organizacoes: [pronta('bravo-2', 'Bravo'), pronta('alfa-1', 'Alfa')],
      ativa: {organizacaoId: 'alfa-1', area: 'monitoramento'},
    };
    const copia = structuredClone(estado);
    expect(() => ordenarOrganizacoes(congelar(estado))).not.toThrow();
    expect(estado).toStrictEqual(copia);
  });
});
