import type {
  EstadoOrganizacoes,
  OrganizacaoLocal,
  ArquivoRemoto,
} from './documento';
import {
  createArquivoRemotoExecutor,
  RETENTATIVA_CHECKPOINT_MS,
} from './arquivoRemoto';

const URL_ARQUIVO = 'https://arquivo.example/';

function area(projectId: string, hash: string) {
  return {
    etapa: 'verificado' as const,
    projectId,
    template: {versao: '1', hash},
    idsAntesDaCriacao: null,
  };
}

function organizacao(
  id = 'org-1',
  arquivoRemoto?: ArquivoRemoto,
): OrganizacaoLocal {
  return {
    id,
    nome: 'Organização',
    estado: 'pronta',
    confirmacaoPendente: false,
    materializacao: {
      monitoramento: area(`${id}-m`, 'm'),
      alertas: area(`${id}-a`, 'a'),
    },
    areaEmExecucao: null,
    ultimoErro: null,
    ...(arquivoRemoto ? {arquivoRemoto} : {}),
  };
}

function documento(...organizacoes: OrganizacaoLocal[]): EstadoOrganizacoes {
  return {versao: 1, organizacoes, ativa: null};
}

function arquivo(overrides: Partial<ArquivoRemoto> = {}): ArquivoRemoto {
  return {
    url: URL_ARQUIVO,
    estado: 'pendente',
    slots: {
      m: {estado: 'pendente'},
      a: {estado: 'pendente'},
    },
    ...overrides,
  };
}

type Rede = (input: {projectId: string; url: string}) => Promise<void>;

function harness({
  documentoInicial: inicial,
  rede,
}: {
  documentoInicial: EstadoOrganizacoes;
  rede?: Rede;
}) {
  let document = inicial;
  const repository = {
    read: () => document,
    write: jest.fn((next: EstadoOrganizacoes) => {
      document = next;
    }),
  };
  const addServerPeer = jest.fn(rede ?? (async () => {}));
  const criar = () =>
    createArquivoRemotoExecutor({
      repository,
      rede: {addServerPeer},
    });
  return {
    repository,
    addServerPeer,
    criar,
    get document() {
      return document;
    },
  };
}

async function microtarefas() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

describe('arquivo remoto no journal da organização (#142)', () => {
  test('m concluído/a falhou: retry envia somente a', async () => {
    const org = organizacao(
      'org-1',
      arquivo({
        estado: 'falha_recuperavel',
        slots: {
          m: {estado: 'concluido', tentativaId: 'tentativa-m'},
          a: {estado: 'falha_recuperavel', tentativaId: 'tentativa-a'},
        },
      }),
    );
    const h = harness({documentoInicial: documento(org)});

    const resultado = await h.criar().executar('org-1', {modo: 'retry'});

    expect(h.addServerPeer).toHaveBeenCalledTimes(1);
    expect(h.addServerPeer).toHaveBeenCalledWith({
      projectId: 'org-1-a',
      url: URL_ARQUIVO,
    });
    expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toMatchObject({
      estado: 'concluido',
      tentativaId: 'tentativa-m',
    });
    expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.a).toMatchObject({
      estado: 'concluido',
    });
    expect(resultado.estado).toBe('concluido');
  });

  test('concluído reidratado não chama start', async () => {
    const org = organizacao(
      'org-1',
      arquivo({
        estado: 'concluido',
        slots: {
          m: {estado: 'concluido', tentativaId: 'tentativa-m'},
          a: {estado: 'concluido', tentativaId: 'tentativa-a'},
        },
      }),
    );
    const h = harness({documentoInicial: documento(org)});

    const resultado = await h.criar().executar('org-1');

    expect(h.addServerPeer).not.toHaveBeenCalled();
    expect(resultado.estado).toBe('concluido');
  });

  test('prazo, remount e passagem de vários minutos não duplicam start', async () => {
    jest.useFakeTimers();
    try {
      let resolver!: () => void;
      const pendente = new Promise<void>(resolve => {
        resolver = resolve;
      });
      const org = organizacao('org-1', arquivo());
      const h = harness({
        documentoInicial: documento(org),
        rede: () => pendente,
      });

      const primeira = h.criar().executar('org-1');
      await microtarefas();
      expect(h.addServerPeer).toHaveBeenCalledTimes(2);
      expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m.estado).toBe(
        'aplicando',
      );

      jest.advanceTimersByTime(60_000);
      await primeira;

      expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m.estado).toBe(
        'falha_recuperavel',
      );

      // Remount: same repository object and the native promise is still alive.
      await h.criar().executar('org-1');
      expect(h.addServerPeer).toHaveBeenCalledTimes(2);

      jest.advanceTimersByTime(10 * 60_000);
      await h.criar().executar('org-1');
      expect(h.addServerPeer).toHaveBeenCalledTimes(2);

      resolver();
      await microtarefas();
    } finally {
      jest.useRealTimers();
    }
  });

  test('retry recusa promessa ainda viva', async () => {
    jest.useFakeTimers();
    try {
      let resolver!: () => void;
      const pendente = new Promise<void>(resolve => {
        resolver = resolve;
      });
      const org = organizacao('org-1', arquivo());
      const h = harness({
        documentoInicial: documento(org),
        rede: () => pendente,
      });
      const executor = h.criar();

      const primeira = executor.executar('org-1');
      await microtarefas();
      expect(h.addServerPeer).toHaveBeenCalledTimes(2);

      const retry = await executor.executar('org-1', {modo: 'retry'});
      expect(retry.estado).toBe('em-andamento');
      expect(h.addServerPeer).toHaveBeenCalledTimes(2);

      jest.advanceTimersByTime(60_000);
      await primeira;
      resolver();
      await microtarefas();
    } finally {
      jest.useRealTimers();
    }
  });

  test('aplicando interrompido reidrata com um único replay durável', async () => {
    let replayConsumidoAntesDoEnvio: boolean | undefined;
    const org = organizacao(
      'org-1',
      arquivo({
        slots: {
          m: {
            estado: 'aplicando',
            tentativaId: 'tentativa-interrompida',
            iniciadaEm: 1,
            replayConsumido: false,
          },
          a: {estado: 'concluido', tentativaId: 'tentativa-a'},
        },
      }),
    );
    const h = harness({
      documentoInicial: documento(org),
      rede: async () => {
        replayConsumidoAntesDoEnvio =
          h.document.organizacoes[0]?.arquivoRemoto?.slots.m.replayConsumido;
      },
    });

    await h.criar().executar('org-1');

    expect(h.addServerPeer).toHaveBeenCalledTimes(1);
    expect(replayConsumidoAntesDoEnvio).toBe(true);
    expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toMatchObject({
      estado: 'concluido',
      replayConsumido: true,
    });

    // A second crash DURING the replay: the durable mark was already written,
    // so automatic rehydration must not send again.
    const documentoAposSegundoCrash = documento(
      organizacao(
        'org-1',
        arquivo({
          estado: 'aplicando',
          slots: {
            m: {
              estado: 'aplicando',
              tentativaId: 'tentativa-replay',
              iniciadaEm: 2,
              replayConsumido: true,
            },
            a: {estado: 'concluido', tentativaId: 'tentativa-a'},
          },
        }),
      ),
    );
    const h2 = harness({documentoInicial: documentoAposSegundoCrash});

    await h2.criar().executar('org-1');

    expect(h2.addServerPeer).not.toHaveBeenCalled();
    expect(h2.document.organizacoes[0]?.arquivoRemoto?.slots.m.estado).toBe(
      'falha_recuperavel',
    );
  });

  test('sucesso seguido de falha de persistência converge sem novo envio', async () => {
    jest.useFakeTimers();
    try {
      const org = organizacao('org-1', arquivo());
      const h = harness({documentoInicial: documento(org)});
      const write = h.repository.write.getMockImplementation()!;
      let falharConclusaoDeM = true;
      h.repository.write.mockImplementation((next: EstadoOrganizacoes) => {
        const slot = next.organizacoes[0]?.arquivoRemoto?.slots.m;
        if (falharConclusaoDeM && slot?.estado === 'concluido') {
          falharConclusaoDeM = false;
          throw new Error('mmkv-write-failed');
        }
        write(next);
      });

      await h.criar().executar('org-1');

      // The send succeeded; only the conclusion checkpoint was lost.
      expect(h.addServerPeer).toHaveBeenCalledTimes(2);
      expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m.estado).toBe(
        'aplicando',
      );

      // No external call and no extra send: the executor itself retries the
      // CHECKPOINT after the spacing, converging to `concluido`.
      jest.advanceTimersByTime(RETENTATIVA_CHECKPOINT_MS);
      await microtarefas();

      expect(h.addServerPeer).toHaveBeenCalledTimes(2);
      expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toMatchObject({
        estado: 'concluido',
      });
      expect(h.document.organizacoes[0]?.arquivoRemoto?.estado).toBe(
        'concluido',
      );
    } finally {
      jest.useRealTimers();
    }
  });
});
