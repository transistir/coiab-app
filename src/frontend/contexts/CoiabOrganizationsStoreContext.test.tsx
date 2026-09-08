import {act, renderHook} from '@testing-library/react-native';
import {type ReactNode} from 'react';

import {
  COIAB_ORGANIZATIONS_STORAGE_KEY,
  CoiabOrganizationsStoreProvider,
  createCoiabOrganizationsStore,
  useCoiabOrganizationsActions,
  useCoiabOrganizationsState,
  type CoiabOrganizationsStore,
} from './CoiabOrganizationsStoreContext';
import type {
  EstadoOrganizacoes,
  OrganizacaoLocal,
} from '../lib/organization/coiabOrganizations';
import {criarEtapaAreaAusente} from '../lib/organization/coiabOrganizations';

function criarOrganizacaoPreparando(
  overrides: Partial<OrganizacaoLocal> = {},
): OrganizacaoLocal {
  return {
    id: 'org-1',
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

function createWrapper(store: CoiabOrganizationsStore) {
  return ({children}: {children: ReactNode}) => {
    return (
      <CoiabOrganizationsStoreProvider store={store}>
        {children}
      </CoiabOrganizationsStoreProvider>
    );
  };
}

describe('CoiabOrganizationsStore', () => {
  // SPEC A §4.2/D3: um único documento versionado, chave MMKV 'CoiabOrganizations'.
  test('documento inicial vazio e versionado', () => {
    const store = createCoiabOrganizationsStore();

    expect(store.instance.getState()).toStrictEqual({
      versao: 1,
      organizacoes: [],
      ativa: null,
      hidratacaoFalhou: false,
    });
  });

  test('chave de persistência é CoiabOrganizations', () => {
    expect(COIAB_ORGANIZATIONS_STORAGE_KEY).toBe('CoiabOrganizations');
  });

  test('estado persistido é reidratado por um novo store (mesma chave)', () => {
    const persistido: EstadoOrganizacoes = {
      versao: 1,
      organizacoes: [
        {
          id: 'org-1',
          nome: 'Primeira',
          estado: 'pronta',
          confirmacaoPendente: false,
          materializacao: {
            monitoramento: {
              etapa: 'verificado',
              projectId: 'proj-m',
              template: {versao: '1.0.0', hash: 'abc'},
              idsAntesDaCriacao: null,
            },
            alertas: {
              etapa: 'verificado',
              projectId: 'proj-a',
              template: {versao: '1.0.0', hash: 'abc'},
              idsAntesDaCriacao: null,
            },
          },
          areaEmExecucao: null,
          ultimoErro: null,
        },
      ],
      ativa: {organizacaoId: 'org-1', area: 'monitoramento'},
    };

    const primeiro = createCoiabOrganizationsStore({persist: true});
    primeiro.instance.setState(persistido, true);

    const segundo = createCoiabOrganizationsStore({persist: true});
    expect(segundo.instance.getState()).toStrictEqual({
      ...persistido,
      hidratacaoFalhou: false,
    });
  });

  test('hooks expõem estado e ações sob o provider', async () => {
    const store = createCoiabOrganizationsStore();
    const wrapper = createWrapper(store);

    const stateHook = await renderHook(() => useCoiabOrganizationsState(), {
      wrapper,
    });
    const actionsHook = await renderHook(() => useCoiabOrganizationsActions(), {
      wrapper,
    });

    expect(stateHook.result.current).toStrictEqual({
      versao: 1,
      organizacoes: [],
      ativa: null,
      hidratacaoFalhou: false,
    });
    expect(typeof actionsHook.result.current.ativar).toBe('function');

    await act(async () => {
      actionsHook.result.current.ativar({
        organizacaoId: 'org-1',
        area: 'alertas',
      });
    });

    expect(stateHook.result.current.ativa).toBeNull();
  });
});

describe('CoiabOrganizationsStore.publicarPronta (SPEC A §4.2 regras 2, 3 e 9)', () => {
  function storeComOrganizacao(organizacao: OrganizacaoLocal) {
    const store = createCoiabOrganizationsStore();
    store.instance.setState({
      versao: 1,
      organizacoes: [organizacao],
      ativa: null,
    });
    return store;
  }

  const parValido = {
    monitoramento: {projectId: 'proj-m-1', template: {versao: '1', hash: 'h1'}},
    alertas: {projectId: 'proj-a-1', template: {versao: '1', hash: 'h1'}},
  };

  test('publica pronta + confirmação pendente + journal verificado numa escrita', () => {
    const store = storeComOrganizacao(
      criarOrganizacaoPreparando({
        materializacao: {
          monitoramento: {
            ...criarEtapaAreaAusente(),
            etapa: 'criado',
            projectId: 'proj-m-1',
            idsAntesDaCriacao: ['antigo-1'],
          },
          alertas: {
            ...criarEtapaAreaAusente(),
            etapa: 'importando',
            projectId: 'proj-a-1',
          },
        },
        areaEmExecucao: 'alertas',
        ultimoErro: {
          codigo: 'tentativa-anterior',
          area: 'monitoramento',
          ocorridoEm: '2026-09-06T00:00:00.000Z',
        },
      }),
    );

    store.actions.publicarPronta('org-1', parValido);

    expect(store.instance.getState().organizacoes[0]).toStrictEqual({
      id: 'org-1',
      nome: 'Primeira',
      estado: 'pronta',
      confirmacaoPendente: true,
      materializacao: {
        monitoramento: {
          etapa: 'verificado',
          projectId: 'proj-m-1',
          template: {versao: '1', hash: 'h1'},
          idsAntesDaCriacao: ['antigo-1'],
        },
        alertas: {
          etapa: 'verificado',
          projectId: 'proj-a-1',
          template: {versao: '1', hash: 'h1'},
          idsAntesDaCriacao: null,
        },
      },
      areaEmExecucao: null,
      ultimoErro: null,
    });
    // Nenhuma outra parte do documento muda na mesma gravação.
    expect(store.instance.getState().ativa).toBeNull();
  });

  test('par com projeto ausente não grava pronta', () => {
    const store = storeComOrganizacao(criarOrganizacaoPreparando());

    store.actions.publicarPronta('org-1', {
      monitoramento: parValido.monitoramento,
      alertas: {projectId: null, template: parValido.alertas.template},
    } as never);

    expect(store.instance.getState().organizacoes[0]?.estado).toBe(
      'preparando',
    );
    expect(store.instance.getState().organizacoes[0]?.confirmacaoPendente).toBe(
      false,
    );
  });

  test('o mesmo projeto não pode ocupar as duas áreas (regra 2)', () => {
    const store = storeComOrganizacao(criarOrganizacaoPreparando());

    store.actions.publicarPronta('org-1', {
      monitoramento: parValido.monitoramento,
      alertas: {projectId: 'proj-m-1', template: parValido.alertas.template},
    });

    expect(store.instance.getState().organizacoes[0]?.estado).toBe(
      'preparando',
    );
  });

  test('projeto já associado a outra organização não publica (regra 2)', () => {
    const store = createCoiabOrganizationsStore();
    store.instance.setState({
      versao: 1,
      organizacoes: [
        criarOrganizacaoPreparando({id: 'org-1'}),
        criarOrganizacaoPreparando({
          id: 'org-2',
          nome: 'Segunda',
          materializacao: {
            monitoramento: {
              ...criarEtapaAreaAusente(),
              etapa: 'verificado',
              projectId: 'ocupado-m',
            },
            alertas: {
              ...criarEtapaAreaAusente(),
              etapa: 'verificado',
              projectId: 'ocupado-a',
            },
          },
        }),
      ],
      ativa: null,
    });

    store.actions.publicarPronta('org-1', {
      monitoramento: {
        projectId: 'ocupado-m',
        template: {versao: '1', hash: 'h1'},
      },
      alertas: parValido.alertas,
    });

    expect(store.instance.getState().organizacoes[0]?.estado).toBe(
      'preparando',
    );
  });

  test('organização inexistente não grava nada', () => {
    const store = storeComOrganizacao(criarOrganizacaoPreparando());
    const antes = store.instance.getState();

    store.actions.publicarPronta('fantasma', parValido);

    expect(store.instance.getState()).toBe(antes);
  });

  // P1-1: um template com hash/versao vazios grava um documento que o próprio
  // parser (§4.2) rejeitaria na próxima abertura — publicarPronta deve rejeitar.
  test('template com hash/versao vazios não grava pronta', () => {
    const store = storeComOrganizacao(criarOrganizacaoPreparando());
    const publish = jest.fn();
    store.instance.subscribe(publish);

    store.actions.publicarPronta('org-1', {
      monitoramento: {projectId: 'proj-m-1', template: {versao: '1', hash: ''}},
      alertas: parValido.alertas,
    });
    expect(store.instance.getState().organizacoes[0]?.estado).toBe(
      'preparando',
    );

    store.actions.publicarPronta('org-1', {
      monitoramento: parValido.monitoramento,
      alertas: {projectId: 'proj-a-1', template: {versao: '', hash: 'h1'}},
    });
    expect(store.instance.getState().organizacoes[0]?.estado).toBe(
      'preparando',
    );
    expect(store.instance.getState().organizacoes[0]?.confirmacaoPendente).toBe(
      false,
    );
    // Sem mudança de estado, nenhuma notificação é publicada.
    expect(publish).not.toHaveBeenCalled();
  });

  // P1 (greptile it2): uma organização recuperável já tem projectId
  // journalizado; publicar com outro ID apagaria o vínculo com o projeto já
  // criado no core (vazamento de projeto órfão + perda da recuperação).
  test('ID divergente do journal não-nulo não publica nem sobrescreve o journal', () => {
    const store = storeComOrganizacao(
      criarOrganizacaoPreparando({
        estado: 'falha_recuperavel',
        materializacao: {
          monitoramento: {
            ...criarEtapaAreaAusente(),
            etapa: 'criado',
            projectId: 'journaled-monitoring-project',
          },
          alertas: criarEtapaAreaAusente(),
        },
      }),
    );
    const publish = jest.fn();
    store.instance.subscribe(publish);

    store.actions.publicarPronta('org-1', {
      monitoramento: {
        projectId: 'recovered-monitoring-project',
        template: {versao: '1', hash: 'h1'},
      },
      alertas: parValido.alertas,
    });

    const organizacao = store.instance.getState().organizacoes[0];
    expect(organizacao?.estado).toBe('falha_recuperavel');
    expect(organizacao?.confirmacaoPendente).toBe(false);
    // O journal permanece intacto: o vínculo de recuperação não é perdido.
    expect(organizacao?.materializacao.monitoramento).toStrictEqual({
      etapa: 'criado',
      projectId: 'journaled-monitoring-project',
      template: null,
      idsAntesDaCriacao: null,
    });
    expect(publish).not.toHaveBeenCalled();
  });

  test('journal nulo nas duas áreas aceita os IDs fornecidos (comportamento normal)', () => {
    const store = storeComOrganizacao(criarOrganizacaoPreparando());

    store.actions.publicarPronta('org-1', parValido);

    const organizacao = store.instance.getState().organizacoes[0];
    expect(organizacao?.estado).toBe('pronta');
    expect(organizacao?.materializacao.monitoramento.projectId).toBe(
      'proj-m-1',
    );
    expect(organizacao?.materializacao.alertas.projectId).toBe('proj-a-1');
  });

  test('IDs idênticos ao journal não-nulo das duas áreas publicam pronta', () => {
    const store = storeComOrganizacao(
      criarOrganizacaoPreparando({
        estado: 'falha_recuperavel',
        materializacao: {
          monitoramento: {
            ...criarEtapaAreaAusente(),
            etapa: 'criado',
            projectId: 'proj-m-1',
          },
          alertas: {
            ...criarEtapaAreaAusente(),
            etapa: 'importando',
            projectId: 'proj-a-1',
          },
        },
      }),
    );

    store.actions.publicarPronta('org-1', parValido);

    const organizacao = store.instance.getState().organizacoes[0];
    expect(organizacao?.estado).toBe('pronta');
    expect(organizacao?.confirmacaoPendente).toBe(true);
    expect(organizacao?.materializacao.monitoramento.etapa).toBe('verificado');
    expect(organizacao?.materializacao.alertas.etapa).toBe('verificado');
  });

  test('template nulo ou somente whitespace não grava pronta', () => {
    const store = storeComOrganizacao(criarOrganizacaoPreparando());

    store.actions.publicarPronta('org-1', {
      monitoramento: {projectId: 'proj-m-1', template: null},
      alertas: parValido.alertas,
    } as never);
    expect(store.instance.getState().organizacoes[0]?.estado).toBe(
      'preparando',
    );

    store.actions.publicarPronta('org-1', {
      monitoramento: {
        projectId: 'proj-m-1',
        template: {versao: ' ', hash: '  '},
      },
      alertas: {projectId: 'proj-a-1', template: {versao: '\t', hash: 'h1'}},
    });
    expect(store.instance.getState().organizacoes[0]?.estado).toBe(
      'preparando',
    );
    expect(store.instance.getState().organizacoes[0]?.confirmacaoPendente).toBe(
      false,
    );
  });
});

describe('confirmação atômica e falha de persistência (CA02/CA09/CA14)', () => {
  test('Abrir organização reconhece e seleciona Monitoramento em uma escrita, sobrevive à reabertura', () => {
    const store = createCoiabOrganizationsStore({persist: true});
    const org = {...readyOrganization(), confirmacaoPendente: true};
    store.instance.setState(
      {versao: 1, organizacoes: [org], ativa: null},
      true,
    );
    const write = jest.spyOn(MMKVStoreInitializer, 'setItem');
    store.actions.confirmarAbertura('A');
    expect(write).toHaveBeenCalledTimes(1);
    expect(
      createCoiabOrganizationsStore({persist: true}).instance.getState(),
    ).toEqual({
      versao: 1,
      organizacoes: [{...org, confirmacaoPendente: false}],
      ativa: {organizacaoId: 'A', area: 'monitoramento'},
      hidratacaoFalhou: false,
    });
    write.mockRestore();
  });

  test('erro MMKV não publica seleção nem reconhecimento em memória', () => {
    const store = createCoiabOrganizationsStore({persist: true});
    store.instance.setState(organizationDocument(), true);
    const before = store.instance.getState();
    const publish = jest.fn();
    store.instance.subscribe(publish);
    const write = jest
      .spyOn(MMKVStoreInitializer, 'setItem')
      .mockImplementationOnce(() => {
        throw new Error('disk full');
      });
    expect(() =>
      store.actions.ativar({organizacaoId: 'B', area: 'monitoramento'}),
    ).toThrow('disk full');
    expect(store.instance.getState()).toBe(before);
    expect(publish).not.toHaveBeenCalled();
    write.mockRestore();
  });
});

describe('falha de hidratação (SPEC A §5.3)', () => {
  const documentoInvalido = JSON.stringify({
    state: {versao: 1, organizacoes: 'lixo'},
    version: 1,
  });

  afterEach(() => {
    MMKVStoreInitializer.removeItem(COIAB_ORGANIZATIONS_STORAGE_KEY);
  });

  test('documento inválido persistido expõe falha de hidratação e bloqueia escritas', () => {
    MMKVStoreInitializer.setItem(
      COIAB_ORGANIZATIONS_STORAGE_KEY,
      documentoInvalido,
    );
    const store = createCoiabOrganizationsStore({persist: true});

    expect(store.instance.getState()).toStrictEqual({
      versao: 1,
      organizacoes: [],
      ativa: null,
      hidratacaoFalhou: true,
    });

    const antes = store.instance.getState();
    const publish = jest.fn();
    store.instance.subscribe(publish);
    store.actions.ativar({organizacaoId: 'org-1', area: 'monitoramento'});
    store.actions.publicarPronta('org-1', {
      monitoramento: {
        projectId: 'proj-m-1',
        template: {versao: '1', hash: 'h1'},
      },
      alertas: {projectId: 'proj-a-1', template: {versao: '1', hash: 'h1'}},
    });
    store.actions.confirmarAbertura('org-1');
    // Qualquer setState de ação também fica bloqueado até a resolução.
    store.instance.setState(organizationDocument(), true);

    expect(store.instance.getState()).toBe(antes);
    expect(publish).not.toHaveBeenCalled();
    // O cadastro real permanece no MMKV: nada sobrescreveu o raw original.
    expect(MMKVStoreInitializer.getItem(COIAB_ORGANIZATIONS_STORAGE_KEY)).toBe(
      documentoInvalido,
    );
  });

  test('resolverFalhaHidratacao limpa e destrava', () => {
    MMKVStoreInitializer.setItem(
      COIAB_ORGANIZATIONS_STORAGE_KEY,
      documentoInvalido,
    );
    const store = createCoiabOrganizationsStore({persist: true});
    expect(store.instance.getState().hidratacaoFalhou).toBe(true);

    store.actions.resolverFalhaHidratacao();

    expect(store.instance.getState()).toStrictEqual({
      versao: 1,
      organizacoes: [],
      ativa: null,
      hidratacaoFalhou: false,
    });
    expect(
      MMKVStoreInitializer.getItem(COIAB_ORGANIZATIONS_STORAGE_KEY),
    ).toBeNull();

    // Escritas normais voltam a funcionar e persistem de novo.
    store.instance.setState(organizationDocument(), true);
    expect(store.instance.getState()).toStrictEqual({
      ...organizationDocument(),
      hidratacaoFalhou: false,
    });
    expect(
      MMKVStoreInitializer.getItem(COIAB_ORGANIZATIONS_STORAGE_KEY),
    ).not.toBeNull();

    const reidratado = createCoiabOrganizationsStore({persist: true});
    expect(reidratado.instance.getState().hidratacaoFalhou).toBe(false);
    expect(reidratado.instance.getState().organizacoes).toHaveLength(2);
  });

  test('raw corrompido (JSON inválido) também expõe falha', () => {
    const rawCorrompido = '{estado: quebrado';
    MMKVStoreInitializer.setItem(
      COIAB_ORGANIZATIONS_STORAGE_KEY,
      rawCorrompido,
    );
    const store = createCoiabOrganizationsStore({persist: true});

    expect(store.instance.getState()).toStrictEqual({
      versao: 1,
      organizacoes: [],
      ativa: null,
      hidratacaoFalhou: true,
    });
    expect(MMKVStoreInitializer.getItem(COIAB_ORGANIZATIONS_STORAGE_KEY)).toBe(
      rawCorrompido,
    );
  });
});

import {MMKVStoreInitializer} from '../hooks/persistedState/createPersistedState';
import {
  organizationDocument,
  readyOrganization,
} from '../lib/organization/fixtures';

describe('resolverFalhaHidratacao sobre cadastro saudável', () => {
  afterEach(() => {
    MMKVStoreInitializer.removeItem(COIAB_ORGANIZATIONS_STORAGE_KEY);
  });

  test('sem falha de hidratação é no-op: não apaga o cadastro nem o MMKV', () => {
    const store = createCoiabOrganizationsStore({persist: true});
    store.instance.setState(organizationDocument(), true);
    const antes = store.instance.getState();
    const remove = jest.spyOn(MMKVStoreInitializer, 'removeItem');

    store.actions.resolverFalhaHidratacao();

    expect(store.instance.getState()).toBe(antes);
    expect(remove).not.toHaveBeenCalled();
    remove.mockRestore();
    expect(
      MMKVStoreInitializer.getItem(COIAB_ORGANIZATIONS_STORAGE_KEY),
    ).not.toBeNull();
  });

  test('store não persistido não toca no MMKV ao resolver falha', () => {
    const store = createCoiabOrganizationsStore();
    // Força o flag para exercitar o caminho de resolução sem persistência.
    store.instance.setState({hidratacaoFalhou: true});
    expect(store.instance.getState().hidratacaoFalhou).toBe(true);
    const remove = jest.spyOn(MMKVStoreInitializer, 'removeItem');

    store.actions.resolverFalhaHidratacao();

    expect(remove).not.toHaveBeenCalled();
    remove.mockRestore();
    expect(store.instance.getState().hidratacaoFalhou).toBe(false);
  });
});
