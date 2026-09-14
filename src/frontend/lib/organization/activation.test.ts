import {
  COIAB_ORGANIZATIONS_STORAGE_KEY,
  createCoiabOrganizationsStore,
} from '../../contexts/CoiabOrganizationsStoreContext';
import {MMKVStoreInitializer} from '../../hooks/persistedState/createPersistedState';
import {organizationDocument, readyOrganization} from './fixtures';
import {
  createOrganizationActivation,
  type ActivationProject,
} from './activation';
import {parseEstadoOrganizacoes} from './coiabOrganizations';
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

  test('ativação concorrente de outro alvo é rejeitada (false), nunca aliased à intenção em voo (§5.2)', async () => {
    const {activation, getProject, store} = switchSetup();
    store.instance.setState({
      organizacoes: [
        readyOrganization('A'),
        readyOrganization('B'),
        readyOrganization('C'),
      ],
    });
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

    // B fica em voo (suspensa no primeiro await do core); C é pedido em
    // seguida — intenção DIFERENTE, não um duplo toque.
    const toB = activation.activate('B');
    const toC = activation.activate('C');
    release();
    const [bResult, cResult] = await Promise.all([toB, toC]);

    // C não pode herdar o resultado de B: é recusada com false.
    expect(cResult).toBe(false);
    expect(bResult).toBe(true);
    // C nunca é consultada no core nem publicada.
    expect(getProject.mock.calls.some(([id]) => id.startsWith('C'))).toBe(
      false,
    );
    // A troca em voo conclui a sua própria intenção, intacta.
    expect(store.instance.getState().ativa).toEqual({
      organizacaoId: 'B',
      area: 'monitoramento',
    });
  });

  test('duplo toque com MESMO alvo e área diferente é recusado, nunca aliased (§5.2)', async () => {
    const {activation, getProject, store} = switchSetup();
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

    // Monitoramento fica em voo (suspenso no primeiro await do core);
    // Alertas é pedido em seguida para o MESMO alvo — a área pedida difere,
    // então não é um duplo toque, é outra intenção.
    const toMonitoramento = activation.activate('B');
    const toAlertas = activation.activate('B', {area: 'alertas'});
    release();
    const [monitoramentoResult, alertasResult] = await Promise.all([
      toMonitoramento,
      toAlertas,
    ]);

    // A segunda NÃO pode herdar o resultado da primeira: o usuário pediu
    // Alertas e receber `true` com Monitoramento ativo é falso sucesso.
    expect(alertasResult).toBe(false);
    expect(monitoramentoResult).toBe(true);
    // A intenção em voo conclui a área ELA mesma, intacta.
    expect(store.instance.getState().ativa).toEqual({
      organizacaoId: 'B',
      area: 'monitoramento',
    });
  });

  test('duplo toque com MESMO alvo e MESMA área continua compartilhando a intenção (§5.2)', async () => {
    const {activation, getProject} = switchSetup();
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

    // Mesmo alvo, mesma área: é um duplo toque e JOINA a operação em voo —
    // a validação do core roda uma única vez para as duas chamadas.
    const first = activation.activate('B', {area: 'alertas'});
    const second = activation.activate('B', {area: 'alertas'});
    release();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toBe(true);
    expect(secondResult).toBe(true);
    expect(getProject.mock.calls.filter(([id]) => id === 'B-m')).toHaveLength(
      1,
    );
  });

  test('intenção recusada publica o motivo da recusa, não um false silencioso (§6.2:215)', async () => {
    // Review round 2 F5: o caller de intenção diferente recebia `false`
    // sem nenhuma explicação — §6.2:215 exige que a troca bloqueada
    // apresente o motivo. A recusa é publicada na MESMA superfície de
    // erro dos demais bloqueios (o campo `error` da instância).
    const {activation, getProject} = switchSetup();
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

    // Monitoramento fica em voo; Alertas para o MESMO alvo é intenção
    // distinta e é recusada.
    const toMonitoramento = activation.activate('B');
    const toAlertas = activation.activate('B', {area: 'alertas'});

    // O caller recusado observa o motivo publicado E o false.
    expect(await toAlertas).toBe(false);
    expect(activation.instance.getState().error).toBe('operation-in-progress');

    // A intenção em voo conclui a si mesma, intacta.
    release();
    expect(await toMonitoramento).toBe(true);
    expect(activation.instance.getState()).toMatchObject({
      status: 'ready',
      projectId: 'B-m',
      error: undefined,
    });
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

  test('retry de preparação de outra organização é recusado (false), nunca aliased à operação em voo', async () => {
    const store = createCoiabOrganizationsStore();
    // A e B ambas em falha durável: um retry pode retomar qualquer uma.
    store.instance.setState({
      versao: 1,
      organizacoes: [
        {
          ...readyOrganization('A'),
          estado: 'falha_recuperavel',
          areaEmExecucao: null,
          ultimoErro: {
            codigo: 'preparation-failed',
            area: 'alertas',
            ocorridoEm: new Date().toISOString(),
          },
        },
        {
          ...readyOrganization('B'),
          estado: 'falha_recuperavel',
          areaEmExecucao: null,
          ultimoErro: {
            codigo: 'preparation-failed',
            area: 'alertas',
            ocorridoEm: new Date().toISOString(),
          },
        },
      ],
      ativa: null,
    });
    let releaseA!: () => void;
    const aEmVoo = new Promise<void>(resolve => {
      releaseA = resolve;
    });
    const resumePreparation = jest.fn(async (id: string) => {
      // A preparação de A fica suspensa até o teste liberá-la na limpeza.
      await aEmVoo;
      store.instance.setState(state => ({
        organizacoes: state.organizacoes.map(item =>
          item.id === id ? readyOrganization(id) : item,
        ),
      }));
    });
    const activation = createOrganizationActivation({
      store,
      getProject: jest.fn(),
      resumePreparation,
    });

    // A preparação de A está em voo, suspensa dentro de resumePreparation('A').
    const retryA = activation.retryPreparation('A');
    // Duplo toque da MESMA organização: mesma intenção, junta-se à operação.
    const retryAdeNovo = activation.retryPreparation('A');
    // Retry de B é intenção DIFERENTE: deve ser recusado com `false`, nunca
    // aliased ao resultado de A (o que reportaria o sucesso de A como se B
    // tivesse sido recuperada, sem nunca passar B a nada).
    const retryB = activation.retryPreparation('B');

    // Libera A para que o alias defeituoso resolva com o `true` de A em vez de
    // travar — o bug aparece como asserção falha, não como timeout do teste.
    releaseA();
    const [resultadoA, resultadoAdeNovo, resultadoB] = await Promise.all([
      retryA,
      retryAdeNovo,
      retryB,
    ]);

    expect(resultadoB).toBe(false);
    // B nunca é passada à preparação nem tem o estado alterado para 'preparando'
    // ou para o desfecho de A.
    expect(resumePreparation).not.toHaveBeenCalledWith('B');
    expect(
      store.instance.getState().organizacoes.find(item => item.id === 'B')
        ?.estado,
    ).toBe('falha_recuperavel');

    // Duplo toque da MESMA organização continua a juntar-se: um único
    // resumePreparation('A') e o mesmo desfecho (contrato de runExclusive).
    expect(resultadoA).toBe(true);
    expect(resultadoAdeNovo).toBe(true);
    expect(
      resumePreparation.mock.calls.filter(([id]) => id === 'A'),
    ).toHaveLength(1);
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

/**
 * Achados MUST-FIX da co-revisão independente (M-2..M-6): o commit da troca e
 * a hidratação do cadastro são verificados contra o que está DURÁVEL em MMKV,
 * não apenas contra o estado em memória.
 */
describe('co-revisão: recheque de trabalho pendente e endurecimento da hidratação', () => {
  function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => {
      resolve = done;
    });
    return {promise, resolve};
  }

  /** MMKV é síncrono aqui; a assinatura de StateStorage admite Promise. */
  function lerRegistro() {
    return MMKVStoreInitializer.getItem(COIAB_ORGANIZATIONS_STORAGE_KEY) as
      string | null;
  }

  beforeEach(() => {
    MMKVStoreInitializer.removeItem(COIAB_ORGANIZATIONS_STORAGE_KEY);
  });

  function durableSetup() {
    const store = createCoiabOrganizationsStore({persist: true});
    store.instance.setState(organizationDocument(), true);
    const project: ActivationProject = {
      $getOwnRole: async () => ({roleId: MEMBER_ROLE_ID}),
      $sync: {stop: jest.fn(async () => {})},
      disconnectServers: jest.fn(async () => {}),
    };
    const getProject = jest.fn(async (id: string): Promise<typeof project> => {
      void id;
      return project;
    });
    const hasPendingWork = jest.fn(() => false);
    const cancelPresentation = jest.fn(async (ids: string[]) => {
      void ids;
    });
    const activation = createOrganizationActivation({
      store,
      getProject,
      hasPendingWork,
      cancelPresentation,
      getPendingWorkProjectId: () => 'A-a',
    });
    return {
      store,
      project,
      getProject,
      hasPendingWork,
      cancelPresentation,
      activation,
    };
  }

  test('M-2 initialize() concorrente não isenta a troca em voo do seu recheque', async () => {
    const {store, getProject, hasPendingWork, activation, project} =
      durableSetup();
    await activation.initialize();
    const before = lerRegistro();
    const entered = deferred();
    const release = deferred();
    getProject.mockImplementation(async id => {
      if (id === 'B-m') {
        entered.resolve();
        await release.promise;
      }
      return project;
    });
    const switching = activation.activate('B');
    await entered.promise;
    // initialize() de A entra no MESMO lock: não pode instalar a isenção de
    // restauração por cima do recheque final de B.
    const initializing = activation.initialize();
    hasPendingWork.mockReturnValue(true);
    release.resolve();
    expect(await switching).toBe(false);
    await initializing;
    expect(store.instance.getState().ativa).toEqual({
      organizacaoId: 'A',
      area: 'alertas',
    });
    expect(lerRegistro()).toBe(before);
    expect(activation.instance.getState()).toMatchObject({
      status: 'ready',
      projectId: 'A-a',
      error: 'pending-work',
    });
  });

  test.each(['sync', 'disconnect', 'presentation'] as const)(
    'M-3 trabalho surgido na limpeza (%s) aborta antes de persistir o destino',
    async phase => {
      const {store, project, hasPendingWork, cancelPresentation, activation} =
        durableSetup();
      await activation.initialize();
      const before = lerRegistro();
      const entered = deferred();
      const release = deferred();
      const cleanup = async () => {
        entered.resolve();
        await release.promise;
      };
      if (phase === 'sync') project.$sync!.stop = cleanup;
      else if (phase === 'disconnect') project.disconnectServers = cleanup;
      else cancelPresentation.mockImplementation(cleanup);
      const switching = activation.activate('B');
      await entered.promise;
      hasPendingWork.mockReturnValue(true);
      release.resolve();
      expect(await switching).toBe(false);
      expect(store.instance.getState().ativa).toEqual({
        organizacaoId: 'A',
        area: 'alertas',
      });
      expect(lerRegistro()).toBe(before);
      expect(activation.instance.getState()).toMatchObject({
        status: 'ready',
        projectId: 'A-a',
        error: 'pending-work',
      });
    },
  );

  test('M-4 preparação que publica pronta antes de rejeitar preserva registro hidratável', async () => {
    const {store, getProject} = durableSetup();
    store.instance.setState({
      organizacoes: [{...readyOrganization(), estado: 'preparando'}],
      ativa: null,
    });
    const {materializacao} = readyOrganization();
    const activation = createOrganizationActivation({
      store,
      getProject,
      resumePreparation: async id => {
        store.actions.publicarPronta(id, {
          monitoramento: {
            projectId: materializacao.monitoramento.projectId!,
            template: materializacao.monitoramento.template,
          },
          alertas: {
            projectId: materializacao.alertas.projectId!,
            template: materializacao.alertas.template,
          },
        });
        throw new Error('late adapter failure');
      },
    });
    await activation.initialize();
    const durable = JSON.parse(lerRegistro() as string).state;
    // 'falha_recuperavel' + confirmacaoPendente é recusado pelo parser: gravá-lo
    // por cima de uma publicação concluída derrubaria a hidratação inteira.
    expect(parseEstadoOrganizacoes(durable)).not.toBeNull();
    expect(durable.organizacoes[0]).toMatchObject({
      estado: 'pronta',
      confirmacaoPendente: true,
    });
    expect(
      createCoiabOrganizationsStore({persist: true}).instance.getState()
        .hidratacaoFalhou,
    ).toBe(false);
    expect(activation.instance.getState().status).toBe('confirmation');
  });

  test('M-5 cadastro corrompido expõe recuperação de hidratação em vez de ausente', async () => {
    const corrupt = '{unreadable registry';
    MMKVStoreInitializer.setItem(COIAB_ORGANIZATIONS_STORAGE_KEY, corrupt);
    const store = createCoiabOrganizationsStore({persist: true});
    const getProject = jest.fn();
    const activation = createOrganizationActivation({store, getProject});
    await activation.initialize();
    expect(activation.instance.getState()).toMatchObject({
      status: 'recovery',
      error: 'hydration-failed',
    });
    expect(getProject).not.toHaveBeenCalled();
    // O documento ilegível é preservado até a resolução explícita (§5.3).
    expect(lerRegistro()).toBe(corrupt);
    store.actions.resolverFalhaHidratacao();
    await activation.initialize();
    expect(activation.instance.getState()).toMatchObject({
      status: 'absent',
      error: undefined,
    });
  });

  test('M-6 pendência em Monitoramento encaminha a restauração de Alertas à recuperação da origem exata', async () => {
    const {store, getProject} = durableSetup();
    const activation = createOrganizationActivation({
      store,
      getProject,
      hasPendingWork: () => true,
      getPendingWorkProjectId: () => 'A-m',
    });
    // Seleção persistida A/alertas, trabalho pendente em A/monitoramento: a
    // mesma organização NÃO autoriza reabrir o projeto errado.
    await activation.initialize();
    expect(activation.instance.getState()).toMatchObject({
      status: 'unavailable',
      error: 'pending-work',
      pendingWorkOrigin: {
        organizacaoId: 'A',
        area: 'monitoramento',
        projectId: 'A-m',
      },
    });
    expect(getProject).not.toHaveBeenCalled();
    expect(store.instance.getState().ativa).toEqual({
      organizacaoId: 'A',
      area: 'alertas',
    });
    // A rota de saída é explícita: reabrir o projeto de origem do trabalho.
    expect(await activation.recoverPendingWork()).toBe(true);
    expect(activation.instance.getState()).toMatchObject({
      status: 'ready',
      projectId: 'A-m',
    });
    expect(store.instance.getState().ativa).toEqual({
      organizacaoId: 'A',
      area: 'monitoramento',
    });
  });
});
