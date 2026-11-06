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
type Consulta = (projectId: string) => Promise<boolean>;

function harness({
  documentoInicial: inicial,
  rede,
  consulta,
}: {
  documentoInicial: EstadoOrganizacoes;
  rede?: Rede;
  consulta?: Consulta;
}) {
  let document = inicial;
  const novoRepositorio = () => ({
    read: () => document,
    write: jest.fn((next: EstadoOrganizacoes) => {
      document = next;
    }),
  });
  const repository = novoRepositorio();
  const addServerPeer = jest.fn(rede ?? (async () => {}));
  const criarSobre = (
    repo: ReturnType<typeof novoRepositorio>,
    consultarArquivo = consulta,
  ) =>
    createArquivoRemotoExecutor({
      repository: repo,
      rede: {addServerPeer},
      ...(consultarArquivo ? {consultarArquivo} : {}),
    });
  const criar = () => criarSobre(repository);
  return {
    repository,
    addServerPeer,
    criar,
    /** New repository OBJECT over the SAME storage: a process restart. */
    reiniciar: () => {
      const novo = novoRepositorio();
      return {
        repository: novo,
        criar: () => criarSobre(novo),
      };
    },
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

  test('execuções concorrentes adquirem o lock na entrada e não duplicam o Core', async () => {
    const org = organizacao('org-1', arquivo());
    const h = harness({documentoInicial: documento(org)});
    const executor = h.criar();

    // Both calls happen in the same tick, BEFORE the first pass reaches its
    // reconciliation await. The lock must be owned from entry, not from the
    // first send, or the second pass replays the first as an interrupted
    // attempt and doubles the Core calls (2 slots × 2 passes = 4).
    const [primeira, segunda] = await Promise.all([
      executor.executar('org-1'),
      executor.executar('org-1'),
    ]);

    expect(h.addServerPeer).toHaveBeenCalledTimes(2);
    expect(
      h.addServerPeer.mock.calls.map(([entrada]) => entrada.projectId).sort(),
    ).toEqual(['org-1-a', 'org-1-m']);
    expect(primeira.estado).toBe('concluido');
    expect(segunda.estado).toBe('concluido');
  });

  test('retry concorrente à entrada recusa e não reenvia', async () => {
    const org = organizacao('org-1', arquivo());
    const h = harness({documentoInicial: documento(org)});
    const executor = h.criar();

    const primeira = executor.executar('org-1');
    const recusa = await executor.executar('org-1', {modo: 'retry'});

    expect(recusa.estado).toBe('em-andamento');
    await primeira;
    expect(h.addServerPeer).toHaveBeenCalledTimes(2);
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

  test('remoção: falha ao gravar a marca aborta antes de qualquer remoção do Core', () => {
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
    h.repository.write.mockImplementationOnce(() => {
      throw new Error('mmkv-write-failed');
    });

    const executor = h.criar();
    let removeuDoCore = false;
    expect(() => {
      // RemoveRemoteArchive only reaches `useRemoveServerPeer` after this
      // call returns; a throw IS the abort signal.
      executor.marcarRemocao('org-1-m');
      removeuDoCore = true;
    }).toThrow('mmkv-write-failed');

    expect(removeuDoCore).toBe(false);
    expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toEqual({
      estado: 'concluido',
      tentativaId: 'tentativa-m',
    });
  });

  test('remoção: Core OK com checkpoint final perdido reconcilia no restart e readd envia', async () => {
    jest.useFakeTimers();
    try {
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
      // Core no longer has an archive server for m: the removal really landed.
      const consultarArquivo = jest.fn(async () => false);
      const h = harness({
        documentoInicial: documento(org),
        consulta: consultarArquivo,
      });
      const executor = h.criar();

      // 1. Durable intent BEFORE Core removal.
      const anterior = executor.marcarRemocao('org-1-m');
      expect(anterior).toMatchObject({estado: 'concluido'});
      expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toMatchObject({
        estado: 'removendo',
      });

      // 2. Core removal OK, but the final `removido` checkpoint write fails.
      const write = h.repository.write.getMockImplementation()!;
      let falharFinal = true;
      h.repository.write.mockImplementation((next: EstadoOrganizacoes) => {
        const slot = next.organizacoes[0]?.arquivoRemoto?.slots.m;
        if (falharFinal && slot?.estado === 'removido') {
          falharFinal = false;
          throw new Error('mmkv-write-failed');
        }
        write(next);
      });
      // Never a success while the removal is unreconciled.
      expect(executor.removerArquivo('org-1-m')).toBe(false);
      expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toMatchObject({
        estado: 'removendo',
      });

      // 3. Restart: new executor AND new repository object over the same
      // storage. The WeakMaps are gone; only the durable journal survives.
      const reinicio = h.reiniciar();
      const resultado = await reinicio.criar().executar('org-1', {
        modo: 'automatico',
      });

      expect(consultarArquivo).toHaveBeenCalledWith('org-1-m');
      // Reconciliation reopens the slot but the AUTOMATIC boot pass must not
      // re-add an archive the user removed...
      expect(h.addServerPeer).not.toHaveBeenCalled();
      expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toEqual({
        estado: 'removido',
      });
      // `a` still has the archive applied, so the aggregate is NOT `removido`.
      expect(resultado.estado).toBe('concluido');

      // ...an explicit re-add of the SAME URL sends for real, and only for it.
      await reinicio.criar().executar('org-1', {modo: 'retry'});
      expect(h.addServerPeer).toHaveBeenCalledTimes(1);
      expect(h.addServerPeer).toHaveBeenCalledWith({
        projectId: 'org-1-m',
        url: URL_ARQUIVO,
      });
      expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toMatchObject({
        estado: 'concluido',
      });
      expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.a).toMatchObject({
        estado: 'concluido',
        tentativaId: 'tentativa-a',
      });
    } finally {
      jest.useRealTimers();
    }
  });

  test('remoção confirmada é terminal: nenhum passe posterior re-adiciona', async () => {
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
    const h = harness({
      documentoInicial: documento(org),
      consulta: async () => false,
    });
    const executor = h.criar();

    executor.marcarRemocao('org-1-m');
    expect(executor.removerArquivo('org-1-m')).toBe(true);

    expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toEqual({
      estado: 'removido',
    });
    // Partial removal: `a` keeps the archive, so the organization still HAS a
    // remote archive and the aggregate must remain `concluido`.
    expect(h.document.organizacoes[0]?.arquivoRemoto?.estado).toBe('concluido');

    // Boot pass, then a restart (new repository object), then another pass:
    // none of them may re-add the archive the user removed.
    await executor.executar('org-1', {modo: 'automatico'});
    const reinicio = h.reiniciar();
    await reinicio.criar().executar('org-1', {modo: 'automatico'});
    await executor.executar('org-1', {modo: 'automatico'});

    expect(h.addServerPeer).not.toHaveBeenCalled();
    expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toEqual({
      estado: 'removido',
    });
    expect(h.document.organizacoes[0]?.arquivoRemoto?.estado).toBe('concluido');
  });

  test('remoção parcial: slot removido com irmão concluído agrega `concluido`', () => {
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
    const h = harness({
      documentoInicial: documento(org),
      consulta: async () => false,
    });
    const executor = h.criar();

    executor.marcarRemocao('org-1-m');
    expect(executor.removerArquivo('org-1-m')).toBe(true);

    const parcial = h.document.organizacoes[0]!.arquivoRemoto!;
    expect(parcial.slots.m).toEqual({estado: 'removido'});
    expect(parcial.slots.a).toMatchObject({estado: 'concluido'});
    // The archive is still applied in `a`. Every consumer maps `concluido` to
    // "archive present/done", never to the "no archive" copy.
    expect(parcial.estado).toBe('concluido');

    // Absence is only true once BOTH slots are removed.
    executor.marcarRemocao('org-1-a');
    expect(executor.removerArquivo('org-1-a')).toBe(true);
    expect(h.document.organizacoes[0]?.arquivoRemoto?.estado).toBe('removido');
  });

  test('rejeição do Core com falha de escrita converge pelo timer sem novo envio', async () => {
    jest.useFakeTimers();
    try {
      const org = organizacao('org-1', arquivo());
      const h = harness({
        documentoInicial: documento(org),
        rede: async () => {
          throw new Error('core-rejected');
        },
      });
      const write = h.repository.write.getMockImplementation()!;
      let falharFalhaDeM = true;
      h.repository.write.mockImplementation((next: EstadoOrganizacoes) => {
        const slot = next.organizacoes[0]?.arquivoRemoto?.slots.m;
        if (
          falharFalhaDeM &&
          slot?.estado === 'falha_recuperavel' &&
          slot.erro === 'arquivo-indisponivel'
        ) {
          falharFalhaDeM = false;
          throw new Error('mmkv-write-failed');
        }
        write(next);
      });

      await h.criar().executar('org-1');
      expect(h.addServerPeer).toHaveBeenCalledTimes(2);
      // The rejection is real but its checkpoint was lost: the slot must not
      // stay in `aplicando` without a live operation.
      expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m.estado).toBe(
        'aplicando',
      );

      jest.advanceTimersByTime(RETENTATIVA_CHECKPOINT_MS);
      await microtarefas();

      expect(h.addServerPeer).toHaveBeenCalledTimes(2);
      expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toMatchObject({
        estado: 'falha_recuperavel',
        erro: 'arquivo-indisponivel',
      });
      expect(h.document.organizacoes[0]?.arquivoRemoto?.estado).toBe(
        'falha_recuperavel',
      );
    } finally {
      jest.useRealTimers();
    }
  });

  test('concluído + falha recuperável agrega falha_recuperavel (retry visível)', async () => {
    const org = organizacao(
      'org-1',
      arquivo({
        estado: 'concluido',
        slots: {
          m: {estado: 'concluido', tentativaId: 'tentativa-m'},
          a: {
            estado: 'falha_recuperavel',
            tentativaId: 'tentativa-a',
            erro: 'arquivo-indisponivel',
          },
        },
      }),
    );
    const h = harness({
      documentoInicial: documento(org),
      rede: async () => {
        throw new Error('core-rejected');
      },
    });

    const resultado = await h.criar().executar('org-1', {modo: 'retry'});

    // `m` stays applied and `a` failed again: the archive is NOT fully
    // applied, so the aggregate must keep the recoverable failure visible.
    // Before the fix the aggregate was `concluido` and AddRemoteArchive opened
    // SuccessfullyAddedArchive, hiding the retry.
    expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toMatchObject({
      estado: 'concluido',
      tentativaId: 'tentativa-m',
    });
    expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.a).toMatchObject({
      estado: 'falha_recuperavel',
    });
    expect(resultado.estado).toBe('falha_recuperavel');
    expect(h.document.organizacoes[0]?.arquivoRemoto?.estado).toBe(
      'falha_recuperavel',
    );
  });

  test('consulta de remoção antiga não sobrescreve a tentativa nova', async () => {
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

    // Both Core reads are controlled: the first belongs to removal #1 and the
    // second to removal #2. #1's read resolves AFTER #2 started (Core still
    // reports the server as active); #2's read then resolves with the server
    // really gone.
    let resolverAntiga!: (existe: boolean) => void;
    const consultaAntiga = new Promise<boolean>(resolve => {
      resolverAntiga = resolve;
    });
    let resolverNova!: (existe: boolean) => void;
    const consultaNova = new Promise<boolean>(resolve => {
      resolverNova = resolve;
    });
    let chamadas = 0;
    const consultarArquivo = jest.fn(async () => {
      chamadas += 1;
      return chamadas === 1 ? consultaAntiga : consultaNova;
    });
    const h = harness({
      documentoInicial: documento(org),
      consulta: consultarArquivo,
    });
    const executor = h.criar();

    // Removal #1 rejects; its reconciliation read is suspended.
    executor.marcarRemocao('org-1-m');
    const reconciliacaoAntiga = executor.reconciliarRemocao('org-1-m');
    await microtarefas();
    expect(consultarArquivo).toHaveBeenCalledTimes(1);

    // Removal #2 starts and queries Core WHILE #1's read is still pending.
    executor.marcarRemocao('org-1-m');
    const reconciliacaoNova = executor.reconciliarRemocao('org-1-m');
    await microtarefas();
    expect(consultarArquivo).toHaveBeenCalledTimes(2);

    // #1's stale "still active" answer lands first. Without attempt identity
    // it wrote `concluido`, making #2's reconciliation short-circuit.
    resolverAntiga(true);
    await reconciliacaoAntiga;

    // #2's read now says the archive is gone: it must own the outcome.
    resolverNova(false);
    await reconciliacaoNova;

    expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toEqual({
      estado: 'removido',
    });
    // `a` still has the archive applied.
    expect(h.document.organizacoes[0]?.arquivoRemoto?.estado).toBe('concluido');

    // The re-add of the SAME URL must really send: a stale `concluido` used to
    // leave Core blocked while the journal skipped every send.
    await h.criar().executar('org-1', {modo: 'retry'});
    expect(h.addServerPeer).toHaveBeenCalledTimes(1);
    expect(h.addServerPeer).toHaveBeenCalledWith({
      projectId: 'org-1-m',
      url: URL_ARQUIVO,
    });
  });
});
