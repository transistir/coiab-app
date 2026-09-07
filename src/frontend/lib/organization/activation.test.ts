import {createCoiabOrganizationsStore} from '../../contexts/CoiabOrganizationsStoreContext';
import {organizationDocument, readyOrganization} from './fixtures';
import {
  createOrganizationActivation,
  type ActivationProject,
} from './activation';
import {MEMBER_ROLE_ID} from '../../sharedTypes';

function setup() {
  const store = createCoiabOrganizationsStore();
  store.instance.setState(organizationDocument(), true);
  const role = jest.fn(async () => ({roleId: MEMBER_ROLE_ID}));
  const getProject = jest.fn<Promise<ActivationProject>, [id: string]>(
    async () => ({$getOwnRole: role}),
  );
  const activation = createOrganizationActivation({store, getProject});
  return {store, role, getProject, activation};
}

describe('ativação centralizada (CA02/CA10/CA13)', () => {
  test('restaura a área persistida somente após revalidar os dois projetos', async () => {
    const {store, activation, getProject} = setup();
    expect(activation.instance.getState().projectId).toBeUndefined();
    await activation.initialize();
    expect(getProject.mock.calls.map(call => call[0])).toEqual(['A-m', 'A-a']);
    expect(activation.instance.getState()).toMatchObject({
      status: 'ready',
      projectId: 'A-a',
    });
    expect(store.instance.getState().ativa?.area).toBe('alertas');
  });

  test('uma pronta sem seleção inicia em Monitoramento; múltiplas exigem escolha', async () => {
    const {store, activation} = setup();
    store.instance.setState({ativa: null});
    await activation.initialize();
    expect(activation.instance.getState().status).toBe('selection');
    store.instance.setState({organizacoes: [readyOrganization()]});
    await activation.initialize();
    expect(store.instance.getState().ativa).toEqual({
      organizacaoId: 'A',
      area: 'monitoramento',
    });
  });

  test('confirmação sobrevive ao reinício até reconhecimento explícito', async () => {
    const {store, activation, getProject} = setup();
    store.instance.setState({
      organizacoes: [{...readyOrganization(), confirmacaoPendente: true}],
      ativa: null,
    });
    await activation.initialize();
    expect(activation.instance.getState().status).toBe('confirmation');
    expect(getProject).not.toHaveBeenCalled();
    await activation.activate('A', {acknowledge: true});
    expect(activation.instance.getState().projectId).toBe('A-m');
    expect(store.instance.getState().organizacoes[0]?.confirmacaoPendente).toBe(
      false,
    );
  });

  test.each(['erro', 'bloqueado', 'ausente'])(
    'falha na área não selecionada: %s preserva seleção e cadastro',
    async kind => {
      const {store, activation, getProject} = setup();
      const before = store.instance.getState();
      getProject.mockImplementation(async id => {
        if (id === 'A-m') {
          if (kind !== 'bloqueado') throw new Error(kind);
          return {$getOwnRole: jest.fn(async () => ({roleId: 'blocked'}))};
        }
        return {$getOwnRole: jest.fn(async () => ({roleId: MEMBER_ROLE_ID}))};
      });
      await activation.initialize();
      // A-v4-2: sem origem validada NESTA sessão (nenhum ready publicado), o
      // catch nunca restaura contexto — a falha de revalidação no cold start é
      // situação de recuperação (§5.3:189), preservando a seleção (regra 8).
      expect(activation.instance.getState().status).toBe('recovery');
      expect(store.instance.getState()).toBe(before);
      expect(activation.instance.getState().projectId).toBeUndefined();
    },
  );
});

describe('troca serializada e encerramento da origem (CA06/CA08/CA11/CA14)', () => {
  function switchSetup() {
    const store = createCoiabOrganizationsStore();
    store.instance.setState(organizationDocument(), true);
    const calls: string[] = [];
    const getProject = jest.fn(async (id: string) => ({
      $getOwnRole: async () => ({roleId: MEMBER_ROLE_ID}),
      $sync: {
        stop: async () => {
          calls.push(`stop:${id}`);
        },
      },
      disconnectServers: async () => {
        calls.push(`disconnect:${id}`);
      },
    }));
    const hasPendingWork = jest.fn(() => false);
    const cancelPresentation = jest.fn(async () => {});
    return {
      store,
      calls,
      getProject,
      hasPendingWork,
      cancelPresentation,
      activation: createOrganizationActivation({
        store,
        getProject,
        hasPendingWork,
        cancelPresentation,
      }),
    };
  }

  test('troca A/Alertas → B/Monitoramento encerra ambos de A e invalida callback tardio', async () => {
    const {activation, calls, cancelPresentation, store} = switchSetup();
    await activation.initialize();
    const origin = activation.captureContext();
    await activation.activate('B');
    expect(calls).toEqual([
      'stop:A-m',
      'disconnect:A-m',
      'stop:A-a',
      'disconnect:A-a',
    ]);
    expect(cancelPresentation).toHaveBeenCalledWith(['A-m', 'A-a']);
    expect(activation.isCurrent(origin)).toBe(false);
    expect(store.instance.getState().ativa).toEqual({
      organizacaoId: 'B',
      area: 'monitoramento',
    });
    calls.length = 0;
    const generation = activation.instance.getState().generation;
    await activation.activate('B');
    expect(activation.instance.getState().generation).toBe(generation);
    expect(calls).toEqual([]);
    await activation.activate('B', {area: 'alertas'});
    expect(calls).toEqual(['stop:B-m', 'disconnect:B-m']);
  });

  test.each([
    'trilha gravando',
    'trilha parada',
    'rascunho',
    'edição',
    'mídia',
    'mutação',
    'convite',
    'arquivo',
  ])(
    'bloqueia %s sem modificar origem e não continua automaticamente',
    async () => {
      const {activation, hasPendingWork, store, calls} = switchSetup();
      await activation.initialize();
      hasPendingWork.mockReturnValue(true);
      const before = store.instance.getState();
      expect(await activation.activate('B')).toBe(false);
      expect(store.instance.getState()).toBe(before);
      expect(activation.instance.getState().error).toBe('pending-work');
      expect(calls).toEqual([]);
      hasPendingWork.mockReturnValue(false);
      expect(store.instance.getState()).toBe(before);
      expect(await activation.activate('B')).toBe(true);
    },
  );

  test('duplo toque compartilha uma intenção; trabalho surgido durante validação impede commit', async () => {
    const {activation, getProject, hasPendingWork, store} = switchSetup();
    await activation.initialize();
    const original = getProject.getMockImplementation()!;
    let release!: () => void;
    const delay = new Promise<void>(resolve => {
      release = resolve;
    });
    getProject.mockImplementation(async id => {
      if (id === 'B-m') await delay;
      return original(id);
    });
    const first = activation.activate('B');
    const second = activation.activate('B');
    hasPendingWork.mockReturnValue(true);
    release();
    await Promise.all([first, second]);
    expect(getProject.mock.calls.filter(([id]) => id === 'B-m')).toHaveLength(
      1,
    );
    expect(store.instance.getState().ativa?.organizacaoId).toBe('A');
  });

  test('perda de acesso à própria organização encaminha à recuperação', async () => {
    const {activation, getProject, store} = switchSetup();
    await activation.initialize();
    expect(activation.instance.getState()).toMatchObject({
      status: 'ready',
      projectId: 'A-a',
    });
    const openContext = activation.captureContext();
    getProject.mockImplementation(async (id: string) => {
      if (id === 'A-m') {
        return {
          $getOwnRole: async () => ({roleId: 'blocked'}),
          $sync: {stop: async () => {}},
          disconnectServers: async () => {},
        };
      }
      return {
        $getOwnRole: async () => ({roleId: MEMBER_ROLE_ID}),
        $sync: {stop: async () => {}},
        disconnectServers: async () => {},
      };
    });
    expect(await activation.activate('A', {area: 'monitoramento'})).toBe(false);
    expect(activation.instance.getState().status).toBe('recovery');
    // FIX-D: recovery NÃO limpa o projectId — a identidade da origem é o que o
    // cleanup da próxima ativação usa para encerrar os projetos de A.
    expect(activation.instance.getState().projectId).toBe('A-a');
    // FIX-C: o status 'recovery' (não 'ready') já impede usar o contexto velho.
    expect(activation.isCurrent(openContext)).toBe(false);
    // Perda de acesso não destrói o cadastro persistido.
    expect(store.instance.getState().ativa).toEqual({
      organizacaoId: 'A',
      area: 'alertas',
    });
  });

  test('erro genérico de consulta na organização aberta → recovery (FIX-C)', async () => {
    const {activation, getProject, store} = switchSetup();
    await activation.initialize();
    expect(activation.instance.getState()).toMatchObject({
      status: 'ready',
      projectId: 'A-a',
    });
    const openContext = activation.captureContext();
    // Uma falha temporária de consulta (regra 4 do §4.2) que NÃO carrega a
    // string 'access-unavailable' ainda assim não pode deixar o contexto em uso.
    getProject.mockImplementation(async (id: string) => {
      if (id === 'A-m') throw new Error('Project not found');
      return {
        $getOwnRole: async () => ({roleId: MEMBER_ROLE_ID}),
        $sync: {stop: async () => {}},
        disconnectServers: async () => {},
      };
    });
    expect(await activation.activate('A', {area: 'monitoramento'})).toBe(false);
    expect(activation.instance.getState().status).toBe('recovery');
    expect(activation.isCurrent(openContext)).toBe(false);
    // Regra 4/8: a falha temporária preserva o cadastro, nunca apaga a seleção.
    expect(store.instance.getState().ativa).toEqual({
      organizacaoId: 'A',
      area: 'alertas',
    });
  });

  test('recovery preserva a origem para o encerramento na troca seguinte (FIX-D)', async () => {
    const {activation, getProject, calls, cancelPresentation} = switchSetup();
    await activation.initialize();
    expect(activation.instance.getState()).toMatchObject({
      status: 'ready',
      projectId: 'A-a',
    });
    // Papel bloqueado em A-m → recovery, mas a origem (A-a) permanece.
    getProject.mockImplementation(async (id: string) => {
      return {
        $getOwnRole: async () => ({
          roleId: id === 'A-m' ? 'blocked' : MEMBER_ROLE_ID,
        }),
        $sync: {
          stop: async () => {
            calls.push(`stop:${id}`);
          },
        },
        disconnectServers: async () => {
          calls.push(`disconnect:${id}`);
        },
      };
    });
    expect(await activation.activate('A', {area: 'monitoramento'})).toBe(false);
    expect(activation.instance.getState().status).toBe('recovery');
    expect(activation.instance.getState().projectId).toBe('A-a');
    // Acesso restabelecido: ativar B encerra AMBAS as áreas da origem A.
    calls.length = 0;
    getProject.mockImplementation(async (id: string) => {
      return {
        $getOwnRole: async () => ({roleId: MEMBER_ROLE_ID}),
        $sync: {
          stop: async () => {
            calls.push(`stop:${id}`);
          },
        },
        disconnectServers: async () => {
          calls.push(`disconnect:${id}`);
        },
      };
    });
    expect(await activation.activate('B')).toBe(true);
    expect(calls).toEqual([
      'stop:A-m',
      'disconnect:A-m',
      'stop:A-a',
      'disconnect:A-a',
    ]);
    expect(cancelPresentation).toHaveBeenCalledWith(['A-m', 'A-a']);
  });

  test('bloqueio em outra organização preserva o contexto ready da própria', async () => {
    const {activation, getProject} = switchSetup();
    await activation.initialize();
    getProject.mockImplementation(async (id: string) => {
      if (id.startsWith('B')) {
        return {
          $getOwnRole: async () => ({roleId: 'blocked'}),
          $sync: {stop: async () => {}},
          disconnectServers: async () => {},
        };
      }
      return {
        $getOwnRole: async () => ({roleId: MEMBER_ROLE_ID}),
        $sync: {stop: async () => {}},
        disconnectServers: async () => {},
      };
    });
    expect(await activation.activate('B')).toBe(false);
    expect(activation.instance.getState()).toMatchObject({
      status: 'ready',
      projectId: 'A-a',
    });
    expect(activation.instance.getState().error).toBe('unavailable');
  });
});

describe('confirmação em Monitoramento e trabalho pendente na inicialização', () => {
  test('reconhecimento grava Monitoramento e ignora área pedida (SPEC A §4.2 regra 9)', async () => {
    const {store, activation} = setup();
    store.instance.setState({
      organizacoes: [{...readyOrganization(), confirmacaoPendente: true}],
      ativa: null,
    });
    expect(
      await activation.activate('A', {acknowledge: true, area: 'alertas'}),
    ).toBe(true);
    const documento = store.instance.getState();
    // Regra 9: o reconhecimento grava confirmacaoPendente:false e a área
    // Monitoramento em UMA única escrita — o reconhecimento não escolhe área.
    expect(documento.organizacoes[0]?.confirmacaoPendente).toBe(false);
    expect(documento.ativa).toEqual({
      organizacaoId: 'A',
      area: 'monitoramento',
    });
    // O projeto operacional publicado é o de Monitoramento (A-m), nunca A-a.
    expect(activation.instance.getState()).toMatchObject({
      status: 'ready',
      projectId: 'A-m',
    });
    expect(
      documento.organizacoes[0]?.materializacao[documento.ativa!.area]
        .projectId,
    ).toBe('A-m');
  });

  test('instância nova com trabalho pendente não ativa nenhuma organização', async () => {
    const store = createCoiabOrganizationsStore();
    // Seleção persistida: A/alertas; o trabalho pendente pertence a B.
    store.instance.setState(organizationDocument(), true);
    const getProject = jest.fn(async () => ({
      $getOwnRole: async () => ({roleId: MEMBER_ROLE_ID}),
    }));
    const hasPendingWork = jest.fn(() => true);
    const activation = createOrganizationActivation({
      store,
      getProject,
      hasPendingWork,
    });
    await activation.initialize();
    expect(getProject).not.toHaveBeenCalled();
    expect(activation.instance.getState().status).toBe('unavailable');
    expect(activation.instance.getState().error).toBe('pending-work');
    expect(activation.instance.getState().projectId).toBeUndefined();
    expect(store.instance.getState().ativa).toEqual({
      organizacaoId: 'A',
      area: 'alertas',
    });
  });
});

describe('trabalho pendente da própria seleção não bloqueia restauração (FIX-B)', () => {
  // `pendingProjectId` é a origem do trabalho pendente reidratado (ex.: um
  // rascunho de A-a). O guard deve comparar essa origem com o alvo da ativação.
  function pendingSetup(pendingProjectId: string | null) {
    const store = createCoiabOrganizationsStore();
    // Seleção persistida A/alertas; projetos A-m, A-a, B-m, B-a.
    store.instance.setState(organizationDocument(), true);
    const getProject = jest.fn(async () => ({
      $getOwnRole: async () => ({roleId: MEMBER_ROLE_ID}),
    }));
    const hasPendingWork = jest.fn(() => true);
    const getPendingWorkProjectId = jest.fn(() => pendingProjectId);
    const activation = createOrganizationActivation({
      store,
      getProject,
      hasPendingWork,
      getPendingWorkProjectId,
    });
    return {store, getProject, hasPendingWork, activation};
  }

  test('trabalho pendente de A + restaurar A → permitido e consulta o core', async () => {
    const {activation, getProject} = pendingSetup('A-a');
    await activation.initialize();
    // Reabrir a própria origem é o que conclui/limpa o trabalho — não bloqueia.
    expect(getProject).toHaveBeenCalled();
    expect(activation.instance.getState()).toMatchObject({
      status: 'ready',
      projectId: 'A-a',
    });
    expect(activation.instance.getState().error).toBeUndefined();
  });

  test('trabalho pendente de A + ativar B → bloqueado pending-work sem consultar o core', async () => {
    const {activation, getProject, store} = pendingSetup('A-a');
    await activation.initialize();
    expect(activation.instance.getState()).toMatchObject({
      status: 'ready',
      projectId: 'A-a',
    });
    getProject.mockClear();
    expect(await activation.activate('B')).toBe(false);
    expect(activation.instance.getState().error).toBe('pending-work');
    // Cobertura discriminante do guard precoce de performActivation: a troca é
    // bloqueada ANTES de consultar o core (sem o guard, getProject seria chamado).
    expect(getProject).not.toHaveBeenCalled();
    // A origem aberta e o cadastro permanecem intactos.
    expect(activation.instance.getState()).toMatchObject({
      status: 'ready',
      projectId: 'A-a',
    });
    expect(store.instance.getState().ativa).toEqual({
      organizacaoId: 'A',
      area: 'alertas',
    });
  });
});

describe('recuperação de journal (CA03)', () => {
  test('preparando reidratado retoma uma vez, falha durável exige retry explícito', async () => {
    const store = createCoiabOrganizationsStore();
    store.instance.setState({
      versao: 1,
      organizacoes: [
        {
          ...readyOrganization(),
          estado: 'preparando',
          areaEmExecucao: 'alertas',
        },
      ],
      ativa: null,
    });
    const resumePreparation = jest.fn(async () => {
      throw new Error('core failed');
    });
    const activation = createOrganizationActivation({
      store,
      getProject: jest.fn(),
      resumePreparation,
    });
    await activation.initialize();
    await activation.initialize();
    expect(resumePreparation).toHaveBeenCalledTimes(1);
    expect(store.instance.getState().organizacoes[0]).toMatchObject({
      estado: 'falha_recuperavel',
      ultimoErro: {codigo: 'preparation-failed', area: 'alertas'},
    });
    await activation.retryPreparation('A');
    expect(resumePreparation).toHaveBeenCalledTimes(2);
    expect(
      store.instance.getState().organizacoes[0]?.materializacao.alertas
        .projectId,
    ).toBe('A-a');
  });
});

describe('A-v4-1: guard global de trabalho pendente na alternância de área (§5.2:172)', () => {
  // §5.2:172 "Alternar área aplica os mesmos bloqueios"; §5.3:180 "um único
  // trabalho em andamento": o predicado é global ("há trabalho pendente?") e
  // NÃO compara a origem do rascunho com a área/organização de destino.
  test('rascunho com origem na própria área ativa bloqueia a alternância para Alertas', async () => {
    const store = createCoiabOrganizationsStore();
    // Organização A/Monitoramento validada e publicada.
    store.instance.setState(
      {
        ...organizationDocument(),
        ativa: {organizacaoId: 'A', area: 'monitoramento'},
      },
      true,
    );
    const getProject = jest.fn(async () => ({
      $getOwnRole: async () => ({roleId: MEMBER_ROLE_ID}),
    }));
    const hasPendingWork = jest.fn(() => false);
    // Rascunho persistido com origem = projeto de Monitoramento de A.
    const getPendingWorkProjectId = jest.fn(() => 'A-m');
    const activation = createOrganizationActivation({
      store,
      getProject,
      hasPendingWork,
      getPendingWorkProjectId,
    });
    await activation.initialize();
    expect(activation.instance.getState()).toMatchObject({
      status: 'ready',
      projectId: 'A-m',
    });
    hasPendingWork.mockReturnValue(true);
    getProject.mockClear();
    const before = store.instance.getState();
    expect(await activation.activate('A', {area: 'alertas'})).toBe(false);
    // Código canônico de §4.4:149 — o MESMO 'pending-work' da troca de
    // organização, sem variante para área (CA15).
    expect(activation.instance.getState().error).toBe('pending-work');
    // Contexto inalterado: `ativa.area` e projeto operacional permanecem.
    expect(activation.instance.getState()).toMatchObject({
      status: 'ready',
      projectId: 'A-m',
    });
    expect(store.instance.getState()).toBe(before);
    expect(store.instance.getState().ativa).toEqual({
      organizacaoId: 'A',
      area: 'monitoramento',
    });
    // O bloqueio acontece antes de qualquer consulta ao core (§5.2:164).
    expect(getProject).not.toHaveBeenCalled();
  });
});

describe('A-v4-2: nenhuma publicação de ready sem revalidação 2/2 desta tentativa', () => {
  test('falha na primeira chamada ao core em cold start → recovery, sem ready publicado, ativa intacta', async () => {
    const store = createCoiabOrganizationsStore();
    // Restauração de seleção persistida; nenhum contexto publicado nesta sessão.
    store.instance.setState(organizationDocument(), true);
    const getProject = jest.fn(async () => {
      throw new Error('core boot failure');
    });
    const activation = createOrganizationActivation({store, getProject});
    const before = store.instance.getState();
    await activation.initialize();
    // A falha injetada é a PRIMEIRA chamada ao core da tentativa.
    expect(getProject).toHaveBeenCalledTimes(1);
    expect(getProject).toHaveBeenCalledWith('A-m');
    // Sem origem validada nesta sessão → recovery (§5.3:189); nunca ready.
    expect(activation.instance.getState().status).toBe('recovery');
    expect(activation.instance.getState().status).not.toBe('ready');
    expect(activation.instance.getState().projectId).toBeUndefined();
    // Regra 8 do §4.2: a falha não apaga `ativa` no documento MMKV.
    expect(store.instance.getState()).toBe(before);
    expect(store.instance.getState().ativa).toEqual({
      organizacaoId: 'A',
      area: 'alertas',
    });
  });
});

describe('A-v4-3: recovery só sai por revalidação bem-sucedida (§5.3:189/CA10)', () => {
  test('a partir de recovery, nova tentativa que rejeita com erro genérico permanece em recovery', async () => {
    const store = createCoiabOrganizationsStore();
    store.instance.setState(organizationDocument(), true);
    const getProject = jest.fn<Promise<ActivationProject>, [id: string]>(
      async () => ({
        $getOwnRole: async () => ({roleId: MEMBER_ROLE_ID}),
        $sync: {stop: async () => {}},
        disconnectServers: async () => {},
      }),
    );
    const activation = createOrganizationActivation({store, getProject});
    await activation.initialize();
    expect(activation.instance.getState()).toMatchObject({
      status: 'ready',
      projectId: 'A-a',
    });
    // Perda de acesso na organização aberta → recovery (FIX-C, já coberto).
    getProject.mockImplementation(async (id: string) => {
      if (id === 'A-m') throw new Error('Project not found');
      return {
        $getOwnRole: async () => ({roleId: MEMBER_ROLE_ID}),
        $sync: {stop: async () => {}},
        disconnectServers: async () => {},
      };
    });
    expect(await activation.activate('A', {area: 'monitoramento'})).toBe(false);
    expect(activation.instance.getState().status).toBe('recovery');
    // Em recovery a origem validada está vazia: TODO catch permanece em
    // recovery. Erro genérico (nunca a string 'access-unavailable' — regra 4
    // do §4.2): não pode restaurar ready com o projectId antigo.
    getProject.mockImplementation(async () => {
      throw new Error('Project not found');
    });
    expect(await activation.activate('A', {area: 'monitoramento'})).toBe(false);
    expect(activation.instance.getState().status).toBe('recovery');
    expect(await activation.activate('B')).toBe(false);
    expect(activation.instance.getState().status).toBe('recovery');
    expect(activation.instance.getState().status).not.toBe('ready');
    // FIX-D: a identidade da origem sobrevive para o cleanup da próxima ativação.
    expect(activation.instance.getState().projectId).toBe('A-a');
    // Regra 8: o documento persistido nunca é tocado pela falha.
    expect(store.instance.getState().ativa).toEqual({
      organizacaoId: 'A',
      area: 'alertas',
    });
  });
});
