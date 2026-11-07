import type {
  EstadoOrganizacoes,
  OrganizacaoLocal,
  ArquivoRemoto,
} from './documento';
import {MEMBER_ROLE_ID} from '../../sharedTypes';
import {
  createArquivoRemotoExecutor,
  criarArquivoRemotoPendente,
  criarRedeArquivoRemoto,
  RETENTATIVA_CHECKPOINT_MS,
} from './arquivoRemoto';
import {parseEstadoOrganizacoes} from './coiabOrganizations';
import type {IdentidadeArquivoRemoto} from './identidadeArquivo';

const URL_ARQUIVO = 'https://arquivo.example/';
const IDENTIDADE_PADRAO = {baseUrl: URL_ARQUIVO};

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

type Rede = (input: {
  projectId: string;
  url: string;
}) => Promise<IdentidadeArquivoRemoto | void>;
type Consulta = (
  projectId: string,
  identidade: IdentidadeArquivoRemoto,
) => Promise<boolean>;
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
  ) => {
    return createArquivoRemotoExecutor({
      repository: repo,
      rede: {addServerPeer},
      ...(consultarArquivo ? {consultarArquivo} : {}),
    });
  };
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

  test('replay com write inicial perdido preserva o orçamento e só reenvia no retry manual', async () => {
    const org = organizacao(
      'org-1',
      arquivo({
        estado: 'aplicando',
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
    const h = harness({documentoInicial: documento(org)});
    const write = h.repository.write.getMockImplementation()!;
    let falharCheckpointInicial = true;
    h.repository.write.mockImplementation((next: EstadoOrganizacoes) => {
      const slot = next.organizacoes[0]?.arquivoRemoto?.slots.m;
      // The `aplicando` write that carries `replayConsumido: true` is the one
      // that is lost; nothing was sent, but the budget was already spent.
      if (
        falharCheckpointInicial &&
        slot?.estado === 'aplicando' &&
        slot.replayConsumido === true
      ) {
        falharCheckpointInicial = false;
        throw new Error('mmkv-write-failed');
      }
      write(next);
    });

    const primeira = await h.criar().executar('org-1');

    expect(h.addServerPeer).not.toHaveBeenCalled();
    expect(primeira.estado).toBe('falha_recuperavel');
    // The failure checkpoint kept the budget even though the `aplicando`
    // checkpoint was never persisted.
    expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toMatchObject({
      estado: 'falha_recuperavel',
      erro: 'checkpoint-inicial',
      replayConsumido: true,
    });

    // The next AUTOMATIC pass now knows the replay was already spent: it must
    // not resend on its own.
    const segunda = await h.criar().executar('org-1');

    expect(h.addServerPeer).not.toHaveBeenCalled();
    expect(segunda.estado).toBe('falha_recuperavel');
    expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toMatchObject({
      estado: 'falha_recuperavel',
      erro: 'replay-esgotado',
      replayConsumido: true,
    });

    // Only the explicit request reopens the budget and really sends.
    const terceira = await h.criar().executar('org-1', {modo: 'retry'});

    expect(h.addServerPeer).toHaveBeenCalledTimes(1);
    expect(h.addServerPeer).toHaveBeenCalledWith({
      projectId: 'org-1-m',
      url: URL_ARQUIVO,
    });
    expect(terceira.estado).toBe('concluido');
    expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toMatchObject({
      estado: 'concluido',
    });
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

  test('remoção: falha ao gravar a marca aborta antes de qualquer remoção do Core', async () => {
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
    // RemoveRemoteArchive only reaches `useRemoveServerPeer` after this call
    // settles; a rejection IS the abort signal.
    await expect(
      executor.marcarRemocao('org-1-m', IDENTIDADE_PADRAO),
    ).rejects.toThrow('mmkv-write-failed');
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
      const anterior = await executor.marcarRemocao(
        'org-1-m',
        IDENTIDADE_PADRAO,
      );
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
      expect(executor.removerArquivo('org-1-m', IDENTIDADE_PADRAO)).toBe(false);
      expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toMatchObject({
        estado: 'removendo',
      });

      // 3. Restart: new executor AND new repository object over the same
      // storage. The WeakMaps are gone; only the durable journal survives.
      const reinicio = h.reiniciar();
      const resultado = await reinicio.criar().executar('org-1', {
        modo: 'automatico',
      });

      expect(consultarArquivo).toHaveBeenCalledWith('org-1-m', {
        baseUrl: 'https://arquivo.example',
      });
      // Reconciliation reopens the slot but the AUTOMATIC boot pass must not
      // re-add an archive the user removed...
      expect(h.addServerPeer).not.toHaveBeenCalled();
      expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toEqual({
        estado: 'removido',
        baseUrl: 'https://arquivo.example',
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

    await executor.marcarRemocao('org-1-m', IDENTIDADE_PADRAO);
    expect(executor.removerArquivo('org-1-m', IDENTIDADE_PADRAO)).toBe(true);

    expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toEqual({
      estado: 'removido',
      baseUrl: 'https://arquivo.example',
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
      baseUrl: 'https://arquivo.example',
    });
    expect(h.document.organizacoes[0]?.arquivoRemoto?.estado).toBe('concluido');
  });

  test('remoção parcial: slot removido com irmão concluído agrega `concluido`', async () => {
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

    await executor.marcarRemocao('org-1-m', IDENTIDADE_PADRAO);
    expect(executor.removerArquivo('org-1-m', IDENTIDADE_PADRAO)).toBe(true);

    const parcial = h.document.organizacoes[0]!.arquivoRemoto!;
    expect(parcial.slots.m).toEqual({
      estado: 'removido',
      baseUrl: 'https://arquivo.example',
    });
    expect(parcial.slots.a).toMatchObject({estado: 'concluido'});
    // The archive is still applied in `a`. Every consumer maps `concluido` to
    // "archive present/done", never to the "no archive" copy.
    expect(parcial.estado).toBe('concluido');

    // Absence is only true once BOTH slots are removed.
    await executor.marcarRemocao('org-1-a', IDENTIDADE_PADRAO);
    expect(executor.removerArquivo('org-1-a', IDENTIDADE_PADRAO)).toBe(true);
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

  test('falha única no checkpoint `aplicando` de a não vira sucesso e o próximo passe envia a', async () => {
    const org = organizacao('org-1', arquivo());
    const h = harness({documentoInicial: documento(org)});
    const write = h.repository.write.getMockImplementation()!;
    let falharAplicandoDeA = true;
    h.repository.write.mockImplementation((next: EstadoOrganizacoes) => {
      const slot = next.organizacoes[0]?.arquivoRemoto?.slots.a;
      if (falharAplicandoDeA && slot?.estado === 'aplicando') {
        falharAplicandoDeA = false;
        throw new Error('mmkv-write-failed');
      }
      write(next);
    });

    const resultado = await h.criar().executar('org-1');

    // `m` was really sent; `a` was NOT (there is no `start` without its
    // durable record). The single sibling success must never be reported as
    // success while `a` was never sent.
    expect(h.addServerPeer).toHaveBeenCalledTimes(1);
    expect(h.addServerPeer).toHaveBeenCalledWith({
      projectId: 'org-1-m',
      url: URL_ARQUIVO,
    });
    expect(resultado.estado).toBe('falha_recuperavel');
    expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.a).toMatchObject({
      estado: 'falha_recuperavel',
      erro: 'checkpoint-inicial',
    });

    // Round-trip: the persisted aggregate still refuses to claim success, so
    // the screen's success branch cannot open.
    const persistido = JSON.parse(
      JSON.stringify(h.document),
    ) as EstadoOrganizacoes;
    expect(persistido.organizacoes[0]?.arquivoRemoto?.estado).toBe(
      'falha_recuperavel',
    );

    // The next pass retakes the slot whose start was never recorded.
    const seguinte = await h.criar().executar('org-1');

    expect(h.addServerPeer).toHaveBeenCalledTimes(2);
    expect(h.addServerPeer).toHaveBeenLastCalledWith({
      projectId: 'org-1-a',
      url: URL_ARQUIVO,
    });
    expect(seguinte.estado).toBe('concluido');
    expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.a).toMatchObject({
      estado: 'concluido',
    });
  });

  test('falha no checkpoint inicial e na falha preserva falha_recuperavel em memória', async () => {
    jest.useFakeTimers();
    try {
      const org = organizacao('org-1', arquivo());
      const h = harness({documentoInicial: documento(org)});
      const write = h.repository.write.getMockImplementation()!;
      let falhas = 0;
      h.repository.write.mockImplementation((next: EstadoOrganizacoes) => {
        const slotA = next.organizacoes[0]?.arquivoRemoto?.slots.a;
        const falhandoAplicando = slotA?.estado === 'aplicando';
        const falhandoCheckpoint =
          slotA?.estado === 'falha_recuperavel' &&
          slotA.erro === 'checkpoint-inicial';
        if (falhas < 2 && (falhandoAplicando || falhandoCheckpoint)) {
          falhas += 1;
          throw new Error('mmkv-write-failed');
        }
        write(next);
      });

      const resultado = await h.criar().executar('org-1');

      expect(h.addServerPeer).toHaveBeenCalledTimes(1);
      // The durable failure checkpoint was lost too, so the slot itself is
      // still `pendente`; only the in-memory latch knows it failed.
      expect(resultado.estado).toBe('falha_recuperavel');
      expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.a.estado).toBe(
        'pendente',
      );

      // The checkpoint retry re-applies the failure WITHOUT resending.
      jest.advanceTimersByTime(RETENTATIVA_CHECKPOINT_MS);
      await microtarefas();

      expect(h.addServerPeer).toHaveBeenCalledTimes(1);
      expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.a).toMatchObject({
        estado: 'falha_recuperavel',
        erro: 'checkpoint-inicial',
      });
      expect(h.document.organizacoes[0]?.arquivoRemoto?.estado).toBe(
        'falha_recuperavel',
      );
    } finally {
      jest.useRealTimers();
    }
  });

  test('concluido + removido continua agregando concluido', async () => {
    const org = organizacao(
      'org-1',
      arquivo({
        estado: 'concluido',
        slots: {
          m: {estado: 'removido'},
          a: {estado: 'concluido', tentativaId: 'tentativa-a'},
        },
      }),
    );
    const h = harness({documentoInicial: documento(org)});

    const resultado = await h.criar().executar('org-1');

    expect(h.addServerPeer).not.toHaveBeenCalled();
    expect(resultado.estado).toBe('concluido');
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
    await executor.marcarRemocao('org-1-m', IDENTIDADE_PADRAO);
    const reconciliacaoAntiga = executor.reconciliarRemocao('org-1-m');
    await microtarefas();
    expect(consultarArquivo).toHaveBeenCalledTimes(1);

    // Removal #2 starts and queries Core WHILE #1's read is still pending.
    await executor.marcarRemocao('org-1-m', IDENTIDADE_PADRAO);
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
      baseUrl: 'https://arquivo.example',
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

describe('identidade do arquivo remoto na remoção (#142 10ª rodada)', () => {
  const URL_B = 'https://b.example/';
  const IDENTIDADE_A = {
    baseUrl: 'https://arquivo.example/',
    deviceId: 'server-a',
  };

  function trocarArquivo(h: ReturnType<typeof harness>, url: string): void {
    h.repository.write({
      ...h.document,
      organizacoes: h.document.organizacoes.map(organizacao => ({
        ...organizacao,
        arquivoRemoto: criarArquivoRemotoPendente(url),
      })),
    });
  }

  test('remover A de `a` depois que B ocupou o slot não marca B', async () => {
    const h = harness({
      documentoInicial: documento(organizacao('org-1')),
      consulta: async () => false,
      // The real adapter persists the device id learned at addition; the
      // A→B comparison below is by ID, exactly as production now does.
      rede: async ({url}) => ({
        baseUrl: url.replace(/\/+$/, ''),
        deviceId: url === URL_B ? 'server-b' : 'server-a',
      }),
    });
    const executor = h.criar();

    // 1. A aplicado nos dois projetos.
    trocarArquivo(h, URL_ARQUIVO);
    await executor.executar('org-1', {modo: 'retry'});
    expect(h.addServerPeer).toHaveBeenCalledTimes(2);
    expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toMatchObject({
      estado: 'concluido',
    });
    expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.a).toMatchObject({
      estado: 'concluido',
    });

    // 2. A é removido de `m`; o journal registra a remoção.
    await executor.marcarRemocao('org-1-m', IDENTIDADE_A);
    expect(executor.removerArquivo('org-1-m', IDENTIDADE_A)).toBe(true);
    expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toEqual({
      estado: 'removido',
      baseUrl: 'https://arquivo.example',
      deviceId: 'server-a',
    });

    // 3. B é adicionado aos dois projetos: em Core `a` fica com A+B, mas o
    // journal passa a referenciar B.
    trocarArquivo(h, URL_B);
    await executor.executar('org-1', {modo: 'retry'});
    expect(h.addServerPeer).toHaveBeenCalledTimes(4);
    expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.a).toMatchObject({
      estado: 'concluido',
    });

    // 4. Remover A de `a` NÃO pode marcar o slot que registra B.
    await expect(
      executor.marcarRemocao('org-1-a', IDENTIDADE_A),
    ).resolves.toBeUndefined();
    expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.a).toMatchObject({
      estado: 'concluido',
    });
    expect(executor.removerArquivo('org-1-a', IDENTIDADE_A)).toBe(true);
    expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.a).toMatchObject({
      estado: 'concluido',
    });
    // O agregado continua indicando que B está aplicado.
    expect(h.document.organizacoes[0]?.arquivoRemoto?.estado).toBe('concluido');

    // 5. Nenhum passe automático reenvia B.
    await executor.executar('org-1', {modo: 'automatico'});
    expect(h.addServerPeer).toHaveBeenCalledTimes(4);
    // A remoção de A de `a` é um no-op no journal; ela não reabre nenhum slot.
    expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.a).toMatchObject({
      estado: 'concluido',
    });

    // 6. O readd de A continua funcionando (pedido explícito).
    trocarArquivo(h, URL_ARQUIVO);
    await executor.executar('org-1', {modo: 'retry'});
    expect(h.addServerPeer).toHaveBeenCalledTimes(6);
    expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toMatchObject({
      estado: 'concluido',
    });
    expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.a).toMatchObject({
      estado: 'concluido',
    });
    expect(h.document.organizacoes[0]?.arquivoRemoto?.estado).toBe('concluido');
  });

  test('reconciliação consulta Core com a identidade do servidor removido', async () => {
    const consulta = jest.fn(async () => false);
    const h = harness({
      documentoInicial: documento(
        organizacao(
          'org-1',
          arquivo({
            estado: 'concluido',
            slots: {
              // The slot already knows the server it holds, so the removal is
              // matched by device id (the 16ª rodada resolution is only for an
              // UNKNOWN identity).
              m: {
                estado: 'concluido',
                tentativaId: 'tentativa-m',
                deviceId: 'server-a',
              },
              a: {estado: 'concluido', tentativaId: 'tentativa-a'},
            },
          }),
        ),
      ),
      consulta,
    });
    const executor = h.criar();

    await executor.marcarRemocao('org-1-m', IDENTIDADE_A);
    const result = await executor.reconciliarRemocao('org-1-m');

    expect(consulta).toHaveBeenCalledWith('org-1-m', {
      baseUrl: 'https://arquivo.example',
      deviceId: 'server-a',
    });
    expect(result).toBe(true);
    expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toEqual({
      estado: 'removido',
      baseUrl: 'https://arquivo.example',
      deviceId: 'server-a',
    });
  });

  test('alias do mesmo servidor é reconhecido pelo deviceId e o readd envia', async () => {
    const URL_ALIAS = 'https://alias.example/';
    // The addition is the only point where Core's device id can be learned:
    // `addServerPeer` returns void, so the adapter resolves the member and the
    // journal must persist that id.
    const rede = jest.fn(async ({url}: {projectId: string; url: string}) => ({
      baseUrl: url.replace(/\/+$/, ''),
      deviceId: 'server-a',
    }));
    const h = harness({
      documentoInicial: documento(organizacao('org-1')),
      rede,
    });
    const executor = h.criar();

    trocarArquivo(h, URL_ARQUIVO);
    await executor.executar('org-1', {modo: 'retry'});
    expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toMatchObject({
      estado: 'concluido',
      baseUrl: 'https://arquivo.example',
      deviceId: 'server-a',
    });

    // Same server, reached through another hostname: the removal identifies
    // it by deviceId, not by the URL that happens to be announced.
    const identidadeAlias = {baseUrl: URL_ALIAS, deviceId: 'server-a'};
    await expect(
      executor.marcarRemocao('org-1-m', identidadeAlias),
    ).resolves.toBeDefined();
    expect(executor.removerArquivo('org-1-m', identidadeAlias)).toBe(true);
    expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toMatchObject({
      estado: 'removido',
      deviceId: 'server-a',
    });

    // Re-adding through the ORIGINAL URL must really send: a stale
    // `concluido` here hid a server that Core had already removed.
    const antes = h.addServerPeer.mock.calls.length;
    await executor.executar('org-1', {modo: 'retry'});
    expect(h.addServerPeer.mock.calls.length).toBeGreaterThan(antes);
    expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toMatchObject({
      estado: 'concluido',
    });
  });

  test.each([
    {caso: 'ativo', existe: true, esperado: 'concluido'},
    {caso: 'ausente', existe: false, esperado: 'removido'},
  ])(
    'reidratação preserva a identidade e reconcilia o servidor ($caso)',
    async ({existe, esperado}) => {
      const bruto = JSON.parse(
        JSON.stringify(
          documento(
            organizacao(
              'org-1',
              arquivo({
                url: 'https://original.example/',
                estado: 'removendo',
                slots: {
                  m: {
                    estado: 'removendo',
                    remocaoId: 'remocao-m',
                    baseUrl: 'https://original.example',
                    deviceId: 'server-a',
                  },
                  a: {estado: 'concluido', tentativaId: 'tentativa-a'},
                },
              }),
            ),
          ),
        ),
      );
      // REAL parser: persist and rehydrate, never an in-memory object.
      const reidratado = parseEstadoOrganizacoes(bruto);
      expect(reidratado).not.toBeNull();

      const consulta = jest.fn(async () => existe);
      const h = harness({
        documentoInicial: reidratado as EstadoOrganizacoes,
        consulta,
      });
      await h.criar().executar('org-1', {modo: 'automatico'});

      // The boot asks Core about THIS server, even though the hostname may
      // have changed since the intent was written.
      expect(consulta).toHaveBeenCalledWith('org-1-m', {
        baseUrl: 'https://original.example',
        deviceId: 'server-a',
      });
      expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toMatchObject({
        estado: esperado,
        baseUrl: 'https://original.example',
        deviceId: 'server-a',
      });
    },
  );
});

describe('adaptador de rede: identidade devolvida pela adição (#142 11ª rodada)', () => {
  function projetoCom(getMany: () => Promise<Array<Record<string, unknown>>>) {
    return {
      $member: {
        addServerPeer: jest.fn(async () => {}),
        getMany: jest.fn(getMany),
      },
    };
  }

  test('resolve o deviceId do servidor recém-adicionado', async () => {
    const membro = {
      deviceId: 'server-a',
      deviceType: 'selfHostedServer',
      role: {roleId: MEMBER_ROLE_ID},
      selfHostedServerDetails: {baseUrl: 'https://arquivo.example/'},
    };
    const projeto = projetoCom(async () => [membro]);
    const rede = criarRedeArquivoRemoto(async () => projeto as never);

    await expect(
      rede.addServerPeer({
        projectId: 'org-1-m',
        url: 'https://arquivo.example/',
      }),
    ).resolves.toEqual({
      baseUrl: 'https://arquivo.example',
      deviceId: 'server-a',
    });
  });

  test('falha na leitura do membro não invalida a adição', async () => {
    const projeto = projetoCom(async () => {
      throw new Error('member-read-failed');
    });
    const rede = criarRedeArquivoRemoto(async () => projeto as never);

    await expect(
      rede.addServerPeer({
        projectId: 'org-1-m',
        url: 'https://arquivo.example/',
      }),
    ).resolves.toBeUndefined();
  });
});

describe('adaptador real: deviceId pelo diff de membros (#142 12ª rodada)', () => {
  const URL_ALIAS = 'https://alias.example/';
  const URL_CANONICA = 'https://canonical.example/';
  const DEVICE_ID = 'srv-1';

  function membroDoServidor() {
    return {
      deviceId: DEVICE_ID,
      deviceType: 'selfHostedServer',
      role: {roleId: MEMBER_ROLE_ID},
      selfHostedServerDetails: {baseUrl: URL_CANONICA},
    };
  }

  /**
   * Fake Core storage with one member list per project. `addServerPeer`
   * behaves like the real server: called through ANY hostname, it registers a
   * member whose device id is `srv-1` and whose announced URL is the canonical
   * one. That is exactly the alias case the adapter must survive.
   */
  function coreReal({
    comGetMany = true,
    getManyFalha = false,
  }: {comGetMany?: boolean; getManyFalha?: boolean} = {}) {
    const membrosPorProjeto = new Map<string, Array<Record<string, unknown>>>();
    const adicionados: string[] = [];
    const getProject = jest.fn(async (projectId: string) => {
      const $member: Record<string, unknown> = {
        addServerPeer: jest.fn(async () => {
          adicionados.push(projectId);
          const atuais = membrosPorProjeto.get(projectId) ?? [];
          if (!atuais.some(item => item.deviceId === DEVICE_ID)) {
            membrosPorProjeto.set(projectId, [...atuais, membroDoServidor()]);
          }
        }),
      };
      if (comGetMany) {
        $member.getMany = jest.fn(async () => {
          if (getManyFalha) throw new Error('member-read-failed');
          return [...(membrosPorProjeto.get(projectId) ?? [])];
        });
      }
      return {$member};
    });
    return {
      rede: criarRedeArquivoRemoto(getProject as never),
      adicionados,
      removerDe: (projectId: string) => membrosPorProjeto.set(projectId, []),
    };
  }

  function trocarArquivo(h: ReturnType<typeof harness>, url: string): void {
    h.repository.write({
      ...h.document,
      organizacoes: h.document.organizacoes.map(organizacao => ({
        ...organizacao,
        arquivoRemoto: criarArquivoRemotoPendente(url),
      })),
    });
  }

  test('alias: o deviceId vem do membro NOVO, não da URL informada', async () => {
    const core = coreReal();

    await expect(
      core.rede.addServerPeer({projectId: 'org-1-m', url: URL_ALIAS}),
    ).resolves.toEqual({
      baseUrl: 'https://alias.example',
      deviceId: DEVICE_ID,
    });
    expect(core.adicionados).toEqual(['org-1-m']);
  });

  test('alias completo: remover pelo canônico + deviceId e o readd envia', async () => {
    const core = coreReal();
    const h = harness({
      documentoInicial: documento(organizacao('org-1')),
      rede: core.rede.addServerPeer,
    });
    const executor = h.criar();

    // 1. Aplicado pelo ALIAS; o servidor anuncia o CANÔNICO.
    trocarArquivo(h, URL_ALIAS);
    await executor.executar('org-1', {modo: 'retry'});
    expect(h.addServerPeer).toHaveBeenCalledTimes(2);
    expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toMatchObject({
      estado: 'concluido',
      baseUrl: 'https://alias.example',
      deviceId: DEVICE_ID,
    });
    expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.a).toMatchObject({
      estado: 'concluido',
      baseUrl: 'https://alias.example',
      deviceId: DEVICE_ID,
    });

    // 2. Remoção chega pelo CANÔNICO + deviceId. Sem o deviceId persistido o
    // slot não era reconhecido e o readd seguinte não enviava nada.
    const identidadeCanonica = {
      baseUrl: URL_CANONICA,
      deviceId: DEVICE_ID,
    };
    await expect(
      executor.marcarRemocao('org-1-m', identidadeCanonica),
    ).resolves.toBeDefined();
    core.removerDe('org-1-m'); // efeito real de Core
    expect(executor.removerArquivo('org-1-m', identidadeCanonica)).toBe(true);
    expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toEqual({
      estado: 'removido',
      baseUrl: 'https://alias.example',
      deviceId: DEVICE_ID,
    });

    // 3. Round-trip REAL por JSON + parser: a identidade sobrevive ao restart.
    const reidratado = parseEstadoOrganizacoes(
      JSON.parse(JSON.stringify(h.document)),
    );
    expect(reidratado).not.toBeNull();
    const h2 = harness({
      documentoInicial: reidratado as EstadoOrganizacoes,
      rede: core.rede.addServerPeer,
    });

    // 4. Readd pela URL ORIGINAL (alias), sem tocar no journal. O slot
    // `removido` só é retomado por um pedido explícito (retry).
    const antes = h2.addServerPeer.mock.calls.length;
    const resultado = await h2.criar().executar('org-1', {modo: 'retry'});

    expect(h2.addServerPeer.mock.calls.length).toBeGreaterThan(antes);
    expect(h2.addServerPeer).toHaveBeenCalledWith({
      projectId: 'org-1-m',
      url: URL_ALIAS,
    });
    expect(resultado.estado).toBe('concluido');
    expect(h2.document.organizacoes[0]?.arquivoRemoto?.slots.m).toMatchObject({
      estado: 'concluido',
      baseUrl: 'https://alias.example',
      deviceId: DEVICE_ID,
    });
    // O slot `a` continua aplicado; o readd não o reenvia.
    expect(h2.addServerPeer).toHaveBeenCalledTimes(1);
    expect(h2.document.organizacoes[0]?.arquivoRemoto?.slots.a).toMatchObject({
      estado: 'concluido',
    });
  });

  test('getMany indisponível: adição ok, identidade só URL', async () => {
    const core = coreReal({comGetMany: false});

    await expect(
      core.rede.addServerPeer({projectId: 'org-1-m', url: URL_ALIAS}),
    ).resolves.toBeUndefined();
    expect(core.adicionados).toEqual(['org-1-m']);
  });

  test('getMany falhando: adição ok, identidade só URL', async () => {
    const core = coreReal({getManyFalha: true});

    await expect(
      core.rede.addServerPeer({projectId: 'org-1-m', url: URL_ALIAS}),
    ).resolves.toBeUndefined();
    expect(core.adicionados).toEqual(['org-1-m']);
  });
});

describe('checkpoint de sucesso pendente antes da remoção (#142 13ª rodada)', () => {
  const URL_ALIAS = 'https://alias.example/';
  const URL_CANONICA = 'https://canonical.example/';
  const DEVICE_ID = 'srv-1';

  function membroDoServidor() {
    return {
      deviceId: DEVICE_ID,
      deviceType: 'selfHostedServer',
      role: {roleId: MEMBER_ROLE_ID},
      selfHostedServerDetails: {baseUrl: URL_CANONICA},
    };
  }

  /**
   * Real adapter over fake Core storage: `addServerPeer` registers `srv-1`
   * regardless of the hostname used, so alias/canonical are the real pair the
   * production adapter must resolve.
   */
  function coreReal() {
    const membrosPorProjeto = new Map<string, Array<Record<string, unknown>>>();
    const getProject = jest.fn(async (projectId: string) => ({
      $member: {
        addServerPeer: jest.fn(async () => {
          const atuais = membrosPorProjeto.get(projectId) ?? [];
          if (!atuais.some(item => item.deviceId === DEVICE_ID)) {
            membrosPorProjeto.set(projectId, [...atuais, membroDoServidor()]);
          }
        }),
        getMany: jest.fn(async () => [
          ...(membrosPorProjeto.get(projectId) ?? []),
        ]),
      },
    }));
    return {
      rede: criarRedeArquivoRemoto(getProject as never),
      removerDe: (projectId: string) => membrosPorProjeto.set(projectId, []),
    };
  }

  function trocarArquivo(h: ReturnType<typeof harness>, url: string): void {
    h.repository.write({
      ...h.document,
      organizacoes: h.document.organizacoes.map(organizacao => ({
        ...organizacao,
        arquivoRemoto: criarArquivoRemotoPendente(url),
      })),
    });
  }

  /**
   * Makes the persistence of `m: concluido` fail while the send itself
   * succeeded, leaving only the in-memory checkpoint. `persistente` also fails
   * every retry of that checkpoint (the "still cannot be written" case).
   */
  function falharConclusaoDeM(
    h: ReturnType<typeof harness>,
    {persistente = false}: {persistente?: boolean} = {},
  ): () => boolean {
    const write = h.repository.write.getMockImplementation()!;
    let falhou = false;
    h.repository.write.mockImplementation((next: EstadoOrganizacoes) => {
      const slotM = next.organizacoes[0]?.arquivoRemoto?.slots.m;
      if (slotM?.estado === 'concluido' && (persistente || !falhou)) {
        falhou = true;
        throw new Error('mmkv-write-failed');
      }
      write(next);
    });
    return () => falhou;
  }

  test('remoção pelo canônico reaplica o checkpoint pendente e o readd envia', async () => {
    jest.useFakeTimers();
    try {
      const core = coreReal();
      const h = harness({
        documentoInicial: documento(organizacao('org-1')),
        rede: core.rede.addServerPeer,
      });
      const executor = h.criar();

      // 1. Applied through the ALIAS; Core resolves `srv-1`.
      trocarArquivo(h, URL_ALIAS);
      const falhou = falharConclusaoDeM(h);
      await executor.executar('org-1', {modo: 'retry'});

      expect(h.addServerPeer).toHaveBeenCalledTimes(2);
      expect(falhou()).toBe(true);
      // Only the in-memory checkpoint knows `srv-1`; the persisted slot still
      // carries the OLD identity.
      expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toMatchObject({
        estado: 'aplicando',
      });
      expect(
        h.document.organizacoes[0]?.arquivoRemoto?.slots.m.deviceId,
      ).toBeUndefined();

      // 2. BEFORE the retry timer: removal arrives through the CANONICAL url
      // plus `srv-1`. Without re-applying the checkpoint the identity would
      // not match and the removal would be silently ignored.
      const identidadeCanonica = {baseUrl: URL_CANONICA, deviceId: DEVICE_ID};
      const anterior = await executor.marcarRemocao(
        'org-1-m',
        identidadeCanonica,
      );
      expect(anterior).toBeDefined();
      expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toMatchObject({
        estado: 'removendo',
        deviceId: DEVICE_ID,
      });

      // 3. Core removes and the journal finalizes inside the same call.
      core.removerDe('org-1-m');
      expect(executor.removerArquivo('org-1-m', identidadeCanonica)).toBe(true);

      // 4. REAL JSON + parser round-trip: restart.
      const reidratado = parseEstadoOrganizacoes(
        JSON.parse(JSON.stringify(h.document)),
      );
      expect(reidratado).not.toBeNull();
      const h2 = harness({
        documentoInicial: reidratado as EstadoOrganizacoes,
        rede: core.rede.addServerPeer,
      });

      // 5. Re-add through the ALIAS must really send, never a stale success.
      const antes = h2.addServerPeer.mock.calls.length;
      await h2.criar().executar('org-1', {modo: 'retry'});

      expect(h2.addServerPeer.mock.calls.length).toBeGreaterThan(antes);
      expect(h2.addServerPeer).toHaveBeenCalledWith({
        projectId: 'org-1-m',
        url: URL_ALIAS,
      });
      expect(h2.document.organizacoes[0]?.arquivoRemoto?.slots.m).toMatchObject(
        {
          estado: 'concluido',
          deviceId: DEVICE_ID,
        },
      );
    } finally {
      jest.useRealTimers();
    }
  });

  test('checkpoint pendente não gravável recusa a remoção antes do Core', async () => {
    jest.useFakeTimers();
    try {
      const core = coreReal();
      const h = harness({
        documentoInicial: documento(organizacao('org-1')),
        rede: core.rede.addServerPeer,
      });
      const executor = h.criar();

      trocarArquivo(h, URL_ALIAS);
      const falhou = falharConclusaoDeM(h, {persistente: true});
      await executor.executar('org-1', {modo: 'retry'});

      expect(h.addServerPeer).toHaveBeenCalledTimes(2);
      expect(falhou()).toBe(true);
      expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toMatchObject({
        estado: 'aplicando',
      });

      // The screen only reaches `useRemoveServerPeer` after this call settles;
      // a rejection IS the abort signal, so Core is never asked to remove.
      await expect(
        executor.marcarRemocao('org-1-m', {
          baseUrl: URL_CANONICA,
          deviceId: DEVICE_ID,
        }),
      ).rejects.toThrow('archive-removal-checkpoint-pending');
      expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toMatchObject({
        estado: 'aplicando',
      });
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('identidade em resolução na remoção (#142 14ª rodada)', () => {
  const URL_ALIAS = 'https://alias.example/';
  const URL_CANONICA = 'https://canonical.example/';
  const DEVICE_ID = 'srv-1';

  function trocarArquivo(h: ReturnType<typeof harness>, url: string): void {
    h.repository.write({
      ...h.document,
      organizacoes: h.document.organizacoes.map(organizacao => ({
        ...organizacao,
        arquivoRemoto: criarArquivoRemotoPendente(url),
      })),
    });
  }

  test('A→B→remover A continua removendo A e deixa B concluído', async () => {
    const h = harness({
      documentoInicial: documento(organizacao('org-1')),
      rede: async ({url}: {projectId: string; url: string}) => ({
        baseUrl: url.replace(/\/+$/, ''),
        deviceId: url === URL_ALIAS ? 'server-a' : DEVICE_ID,
      }),
    });
    const executor = h.criar();

    // A applied to both projects.
    trocarArquivo(h, URL_ALIAS);
    await executor.executar('org-1', {modo: 'retry'});
    expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toMatchObject({
      estado: 'concluido',
      deviceId: 'server-a',
    });

    // B replaces the archive and is fully applied.
    trocarArquivo(h, URL_CANONICA);
    await executor.executar('org-1', {modo: 'retry'});
    expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toMatchObject({
      estado: 'concluido',
      deviceId: DEVICE_ID,
    });

    // Removing A is provably a DIFFERENT server: never refused, never marks
    // the slot that records B.
    const identidadeA = {baseUrl: URL_ALIAS, deviceId: 'server-a'};
    await expect(
      executor.marcarRemocao('org-1-m', identidadeA),
    ).resolves.toBeUndefined();
    expect(executor.removerArquivo('org-1-m', identidadeA)).toBe(true);
    expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toMatchObject({
      estado: 'concluido',
      deviceId: DEVICE_ID,
    });
    expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.a).toMatchObject({
      estado: 'concluido',
      deviceId: DEVICE_ID,
    });
    expect(h.document.organizacoes[0]?.arquivoRemoto?.estado).toBe('concluido');
  });

  test('slot `aplicando` com deviceId já resolvido não é recusado', async () => {
    const org = organizacao(
      'org-1',
      arquivo({
        url: URL_ALIAS,
        estado: 'aplicando',
        slots: {
          m: {
            estado: 'aplicando',
            tentativaId: 'tentativa-m',
            baseUrl: 'https://alias.example',
            deviceId: DEVICE_ID,
          },
          a: {
            estado: 'aplicando',
            tentativaId: 'tentativa-a',
            baseUrl: 'https://alias.example',
            deviceId: DEVICE_ID,
          },
        },
      }),
    );
    const h = harness({documentoInicial: documento(org)});
    const executor = h.criar();

    const anterior = await executor.marcarRemocao('org-1-m', {
      baseUrl: URL_CANONICA,
      deviceId: DEVICE_ID,
    });

    expect(anterior).toMatchObject({estado: 'aplicando'});
    expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toMatchObject({
      estado: 'removendo',
      deviceId: DEVICE_ID,
    });
  });
});

/**
 * #142 16ª rodada: an UNKNOWN identity (a slot without a persisted `deviceId`)
 * is indeterminate for EVERY slot state, not only `aplicando`. The removal
 * must either resolve the identity against the same member source the adapter
 * uses, or refuse before Core. The previous narrow guard let a timed-out or
 * late-failed addition be removed while Core still had the server, leaving a
 * false `concluido` that made the next readd send nothing.
 */
describe('identidade desconhecida é indeterminada na remoção (#142 16ª/17ª rodada)', () => {
  const URL_ALIAS = 'https://alias.example/';
  const URL_CANONICA = 'https://canonical.example/';
  const DEVICE_ID = 'srv-1';
  const IDENTIDADE_CANONICA = {baseUrl: URL_CANONICA, deviceId: DEVICE_ID};

  function membroDoServidor() {
    return {
      deviceId: DEVICE_ID,
      deviceType: 'selfHostedServer',
      role: {roleId: MEMBER_ROLE_ID},
      selfHostedServerDetails: {baseUrl: URL_CANONICA},
    };
  }

  /**
   * Fake Core with one member list per project and the real adapter.
   * `leituraPosAdicao` controls the read that follows `addServerPeer`:
   *   - `ok`: resolves normally;
   *   - `falha`: fails once, leaving `concluido` without `deviceId`;
   *   - `retida`: hangs until `liberar()` (the timeout scenario);
   *   - `sempre-falha`: every post-add read fails (identity never persisted).
   */
  function coreControlado({
    leituraPosAdicao = 'ok',
  }: {
    leituraPosAdicao?: 'ok' | 'falha' | 'retida' | 'sempre-falha';
  } = {}) {
    const membrosPorProjeto = new Map<string, Array<Record<string, unknown>>>();
    const liberacoes: Array<() => void> = [];
    let atrasar = leituraPosAdicao === 'retida';
    let falhasRestantes = leituraPosAdicao === 'falha' ? 1 : 0;
    const sempreFalha = leituraPosAdicao === 'sempre-falha';
    const adicionados: string[] = [];

    const getProject = jest.fn(async (projectId: string) => ({
      $member: {
        addServerPeer: jest.fn(async () => {
          adicionados.push(projectId);
          const atuais = membrosPorProjeto.get(projectId) ?? [];
          if (!atuais.some(item => item.deviceId === DEVICE_ID)) {
            membrosPorProjeto.set(projectId, [...atuais, membroDoServidor()]);
          }
        }),
        getMany: jest.fn(async (options: {includeLeft: boolean}) => {
          // Same call shape as the production adapter.
          expect(options).toEqual({includeLeft: false});
          const atuais = [...(membrosPorProjeto.get(projectId) ?? [])];
          if (atuais.length > 0 && sempreFalha) {
            throw new Error('member-read-failed');
          }
          if (atuais.length > 0 && falhasRestantes > 0) {
            falhasRestantes -= 1;
            throw new Error('member-read-failed');
          }
          if (atrasar && atuais.length > 0) {
            await new Promise<void>(resolve => liberacoes.push(resolve));
          }
          return atuais;
        }),
      },
    }));

    return {
      getProject,
      rede: criarRedeArquivoRemoto(getProject as never),
      adicionados,
      removerDe: (projectId: string) => membrosPorProjeto.set(projectId, []),
      liberar: () => {
        atrasar = false;
        while (liberacoes.length > 0) liberacoes.shift()!();
      },
    };
  }

  function trocarArquivo(h: ReturnType<typeof harness>, url: string): void {
    h.repository.write({
      ...h.document,
      organizacoes: h.document.organizacoes.map(organizacao => ({
        ...organizacao,
        arquivoRemoto: criarArquivoRemotoPendente(url),
      })),
    });
  }

  async function ate(condicao: () => boolean): Promise<void> {
    for (let i = 0; i < 300 && !condicao(); i += 1) await Promise.resolve();
    expect(condicao()).toBe(true);
  }

  /** A send that stays alive until `liberar()`, returning a known device id. */
  function redeRetida() {
    const liberacoes: Array<() => void> = [];
    const rede = jest.fn(
      ({url}: {projectId: string; url: string}) =>
        new Promise<IdentidadeArquivoRemoto | void>(resolve => {
          liberacoes.push(() =>
            resolve({baseUrl: url.replace(/\/+$/, ''), deviceId: DEVICE_ID}),
          );
        }),
    );
    return {
      rede,
      liberar: () => {
        while (liberacoes.length > 0) liberacoes.shift()!();
      },
    };
  }

  test('P2#2 timeout com getMany retido: recusa sem escrever no journal', async () => {
    jest.useFakeTimers();
    try {
      const core = coreControlado({leituraPosAdicao: 'retida'});
      const h = harness({
        documentoInicial: documento(organizacao('org-1')),
        rede: core.rede.addServerPeer,
      });
      const executor = h.criar();

      // 1. Add through the ALIAS. Core registers `srv-1`, but the post-add
      // member read is held, so the slot has no persisted `deviceId`.
      trocarArquivo(h, URL_ALIAS);
      const execucao = executor.executar('org-1', {modo: 'retry'});
      await ate(
        () =>
          h.document.organizacoes[0]?.arquivoRemoto?.slots.m.estado ===
            'aplicando' &&
          h.document.organizacoes[0]?.arquivoRemoto?.slots.a.estado ===
            'aplicando',
      );

      // 2. The 60 s deadline expires while the read is still held. The slot
      // becomes `falha_recuperavel/prazo-excedido` WITHOUT a `deviceId`, but
      // the real send (and its member read) is still alive.
      jest.advanceTimersByTime(60_000);
      await execucao;
      expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toMatchObject({
        estado: 'falha_recuperavel',
        erro: 'prazo-excedido',
      });
      expect(
        h.document.organizacoes[0]?.arquivoRemoto?.slots.m.deviceId,
      ).toBeUndefined();

      // 3. A removal through the CANONICAL hostname + `srv-1` would have to
      // guess the identity. With a live send still owning the delayed member
      // read, the executor refuses BEFORE Core. P2#2: the journal is byte
      // identical — no resolution write, no `removendo` — so the late read
      // cannot overwrite a newer state.
      const antes = JSON.stringify(h.document);
      await expect(
        executor.marcarRemocao('org-1-m', IDENTIDADE_CANONICA),
      ).rejects.toThrow('archive-apply-in-flight');
      expect(JSON.stringify(h.document)).toBe(antes);

      // 4. The delayed read resolves and the executor persists the identity.
      core.liberar();
      await ate(
        () =>
          h.document.organizacoes[0]?.arquivoRemoto?.slots.m.estado ===
            'concluido' &&
          h.document.organizacoes[0]?.arquivoRemoto?.slots.m.deviceId ===
            DEVICE_ID &&
          !executor.emAndamento('org-1'),
      );

      // 5. A new removal attempt now works and really finalizes.
      await expect(
        executor.marcarRemocao('org-1-m', IDENTIDADE_CANONICA),
      ).resolves.toBeDefined();
      core.removerDe('org-1-m');
      expect(executor.removerArquivo('org-1-m', IDENTIDADE_CANONICA)).toBe(
        true,
      );
      expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toEqual({
        estado: 'removido',
        baseUrl: 'https://alias.example',
        deviceId: DEVICE_ID,
      });

      // 6. REAL JSON + parser round-trip: restart. The explicit readd must
      // really send, never inherit a stale `concluido`.
      const reidratado = parseEstadoOrganizacoes(
        JSON.parse(JSON.stringify(h.document)),
      );
      expect(reidratado).not.toBeNull();
      const h2 = harness({
        documentoInicial: reidratado as EstadoOrganizacoes,
        rede: core.rede.addServerPeer,
      });
      const antesDoReadd = h2.addServerPeer.mock.calls.length;
      await h2.criar().executar('org-1', {modo: 'retry'});

      expect(h2.addServerPeer.mock.calls.length).toBeGreaterThan(antesDoReadd);
      expect(h2.addServerPeer).toHaveBeenCalledWith({
        projectId: 'org-1-m',
        url: URL_ALIAS,
      });
    } finally {
      jest.useRealTimers();
    }
  });

  test('concluido sem deviceId recusa sem estado terminal e sem escrita', async () => {
    const core = coreControlado({leituraPosAdicao: 'sempre-falha'});
    const h = harness({
      documentoInicial: documento(organizacao('org-1')),
      rede: core.rede.addServerPeer,
    });
    const executor = h.criar();

    // Seed the exact post-failure state: `concluido` without `deviceId`.
    trocarArquivo(h, URL_ALIAS);
    await executor.executar('org-1', {modo: 'retry'});
    expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toMatchObject({
      estado: 'concluido',
    });
    expect(
      h.document.organizacoes[0]?.arquivoRemoto?.slots.m.deviceId,
    ).toBeUndefined();

    // The identity cannot be proven, so the removal refuses before Core and
    // leaves the journal byte-identical (no `removendo`, no `removido`).
    const antes = JSON.stringify(h.document);
    await expect(
      executor.marcarRemocao('org-1-m', IDENTIDADE_CANONICA),
    ).rejects.toThrow('archive-identity-pending');
    expect(JSON.stringify(h.document)).toBe(antes);
  });

  test('P2#3 envio vivo com deviceId conhecido recusa sem escrever no journal', async () => {
    const core = redeRetida();
    const org = organizacao(
      'org-1',
      arquivo({
        url: URL_ALIAS,
        estado: 'pendente',
        slots: {
          m: {
            estado: 'pendente',
            baseUrl: 'https://alias.example',
            deviceId: DEVICE_ID,
          },
          a: {
            estado: 'pendente',
            baseUrl: 'https://alias.example',
            deviceId: DEVICE_ID,
          },
        },
      }),
    );
    const h = harness({
      documentoInicial: documento(org),
      rede: core.rede,
    });
    const executor = h.criar();

    const execucao = executor.executar('org-1', {modo: 'retry'});
    await ate(
      () =>
        h.document.organizacoes[0]?.arquivoRemoto?.slots.m.estado ===
          'aplicando' &&
        h.document.organizacoes[0]?.arquivoRemoto?.slots.a.estado ===
          'aplicando' &&
        h.addServerPeer.mock.calls.length === 2,
    );

    // The identity IS known, but the live send can still write `concluido`
    // AFTER the removal. Refuse before Core; nothing is written.
    const antes = JSON.stringify(h.document);
    await expect(
      executor.marcarRemocao('org-1-m', IDENTIDADE_CANONICA),
    ).rejects.toThrow('archive-apply-in-flight');
    expect(JSON.stringify(h.document)).toBe(antes);

    core.liberar();
    await execucao;
    expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toMatchObject({
      estado: 'concluido',
      deviceId: DEVICE_ID,
    });
  });

  test('P2#1 remoção de outro servidor não escreve no journal', async () => {
    const org = organizacao(
      'org-1',
      arquivo({
        url: URL_ALIAS,
        estado: 'concluido',
        slots: {
          m: {
            estado: 'concluido',
            baseUrl: 'https://alias.example',
            deviceId: 'server-b',
          },
          a: {
            estado: 'concluido',
            baseUrl: 'https://alias.example',
            deviceId: 'server-b',
          },
        },
      }),
    );
    const h = harness({documentoInicial: documento(org)});
    const executor = h.criar();

    // Removing A while the slot records B must never substitute B's identity:
    // the comparison by id is a no-op and writes nothing.
    const antes = JSON.stringify(h.document);
    await expect(
      executor.marcarRemocao('org-1-m', {
        baseUrl: URL_ALIAS,
        deviceId: 'server-a',
      }),
    ).resolves.toBeUndefined();
    expect(JSON.stringify(h.document)).toBe(antes);
  });

  test('slot com deviceId igual prossegue', async () => {
    const org = organizacao(
      'org-1',
      arquivo({
        url: URL_ALIAS,
        estado: 'concluido',
        slots: {
          m: {
            estado: 'concluido',
            baseUrl: 'https://alias.example',
            deviceId: DEVICE_ID,
          },
          a: {
            estado: 'concluido',
            baseUrl: 'https://alias.example',
            deviceId: DEVICE_ID,
          },
        },
      }),
    );
    const h = harness({documentoInicial: documento(org)});
    const executor = h.criar();

    await expect(
      executor.marcarRemocao('org-1-m', IDENTIDADE_CANONICA),
    ).resolves.toBeDefined();
    expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toMatchObject({
      estado: 'removendo',
      deviceId: DEVICE_ID,
    });
  });

  test('concluido sem deviceId: a URL do próprio journal libera a remoção', async () => {
    // The member read failed at addition, so the slot is `concluido` without a
    // `deviceId`. No later send will ever resolve it, and boot/retry skip
    // concluded slots — without the URL proof the removal would be locked
    // forever.
    const org = organizacao(
      'org-1',
      arquivo({
        url: URL_ALIAS,
        estado: 'concluido',
        slots: {
          m: {
            estado: 'concluido',
            tentativaId: 'tentativa-m',
            baseUrl: 'https://alias.example',
          },
          a: {
            estado: 'concluido',
            tentativaId: 'tentativa-a',
            baseUrl: 'https://alias.example',
          },
        },
      }),
    );
    const consulta = jest.fn(async () => false);
    const h = harness({documentoInicial: documento(org), consulta});
    const executor = h.criar();
    const identidade = {baseUrl: URL_ALIAS, deviceId: DEVICE_ID};

    const anterior = await executor.marcarRemocao('org-1-m', identidade);

    expect(anterior).toBeDefined();
    expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toMatchObject({
      estado: 'removendo',
      baseUrl: 'https://alias.example',
      deviceId: DEVICE_ID,
    });

    // The screen reaches Core and finalizes the same slot.
    expect(executor.removerArquivo('org-1-m', identidade)).toBe(true);
    expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toEqual({
      estado: 'removido',
      baseUrl: 'https://alias.example',
      deviceId: DEVICE_ID,
    });
  });

  test('concluido sem deviceId: URL divergente mantém a recusa sem escrita', async () => {
    const org = organizacao(
      'org-1',
      arquivo({
        url: URL_ALIAS,
        estado: 'concluido',
        slots: {
          m: {
            estado: 'concluido',
            tentativaId: 'tentativa-m',
            baseUrl: 'https://alias.example',
          },
          a: {
            estado: 'concluido',
            tentativaId: 'tentativa-a',
            baseUrl: 'https://alias.example',
          },
        },
      }),
    );
    const h = harness({documentoInicial: documento(org)});
    const executor = h.criar();

    const antes = JSON.stringify(h.document);
    // The alias/canonical pair means a different URL proves nothing: refuse
    // before Core and write nothing.
    await expect(
      executor.marcarRemocao('org-1-m', IDENTIDADE_CANONICA),
    ).rejects.toThrow('archive-identity-pending');
    expect(JSON.stringify(h.document)).toBe(antes);
  });

  test('envio vivo de OUTRO projeto não bloqueia a remoção', async () => {
    const core = redeRetida();
    const org = organizacao(
      'org-1',
      arquivo({
        url: URL_ALIAS,
        estado: 'concluido',
        slots: {
          m: {
            estado: 'concluido',
            tentativaId: 'tentativa-m',
            baseUrl: 'https://alias.example',
            deviceId: DEVICE_ID,
          },
          a: {
            estado: 'pendente',
            baseUrl: 'https://alias.example',
            deviceId: DEVICE_ID,
          },
        },
      }),
    );
    const h = harness({documentoInicial: documento(org), rede: core.rede});
    const executor = h.criar();

    // A real send to `a` is alive; it owns only `org-1-a`.
    const execucao = executor.executar('org-1', {modo: 'retry'});
    await ate(
      () =>
        h.document.organizacoes[0]?.arquivoRemoto?.slots.a.estado ===
          'aplicando' && h.addServerPeer.mock.calls.length === 1,
    );

    // Removing `m` is about a different project: the unrelated live send must
    // not block it.
    const anterior = await executor.marcarRemocao('org-1-m', {
      baseUrl: URL_ALIAS,
      deviceId: DEVICE_ID,
    });
    expect(anterior).toBeDefined();
    expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toMatchObject({
      estado: 'removendo',
      deviceId: DEVICE_ID,
    });

    expect(
      executor.removerArquivo('org-1-m', {
        baseUrl: URL_ALIAS,
        deviceId: DEVICE_ID,
      }),
    ).toBe(true);
    expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.m).toMatchObject({
      estado: 'removido',
    });

    core.liberar();
    await execucao;
    expect(h.document.organizacoes[0]?.arquivoRemoto?.slots.a).toMatchObject({
      estado: 'concluido',
    });
  });

  test('envio vivo do MESMO projeto bloqueia a remoção', async () => {
    const core = redeRetida();
    const org = organizacao(
      'org-1',
      arquivo({
        url: URL_ALIAS,
        estado: 'pendente',
        slots: {
          m: {
            estado: 'pendente',
            baseUrl: 'https://alias.example',
            deviceId: DEVICE_ID,
          },
          a: {estado: 'concluido', tentativaId: 'tentativa-a'},
        },
      }),
    );
    const h = harness({documentoInicial: documento(org), rede: core.rede});
    const executor = h.criar();

    const execucao = executor.executar('org-1', {modo: 'retry'});
    await ate(
      () =>
        h.document.organizacoes[0]?.arquivoRemoto?.slots.m.estado ===
          'aplicando' && h.addServerPeer.mock.calls.length === 1,
    );

    const antes = JSON.stringify(h.document);
    await expect(
      executor.marcarRemocao('org-1-m', {
        baseUrl: URL_ALIAS,
        deviceId: DEVICE_ID,
      }),
    ).rejects.toThrow('archive-apply-in-flight');
    // The refusal writes nothing.
    expect(JSON.stringify(h.document)).toBe(antes);

    core.liberar();
    await execucao;
  });
});
