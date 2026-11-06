import type {
  ArquivoRemoto,
  EstadoArquivoRemoto,
  EstadoOrganizacoes,
  EstadoSlotArquivoRemoto,
  OrganizacaoLocal,
} from './documento';
import {SLOTS, type Slot} from './marker';

/** A promise without a response is failed after this window. */
export const PRAZO_ARQUIVO_REMOTO_MS = 60_000;

/**
 * Space between attempts to re-write a journal checkpoint (a send conclusion
 * or a removal) whose write failed. The local write is retried WITHOUT ever
 * repeating the native effect, so a transient MMKV failure cannot leave the
 * step stuck in `aplicando`/`concluido`.
 */
export const RETENTATIVA_CHECKPOINT_MS = 1_000;

export type ModoArquivoRemoto = 'automatico' | 'retry';

export type ResultadoArquivoRemoto = {
  estado:
    | EstadoArquivoRemoto
    | 'em-andamento'
    | 'sem-arquivo'
    | 'organizacao-ausente';
  slots: Partial<Record<Slot, EstadoSlotArquivoRemoto>>;
};

/**
 * Structural copy of the materializer repository contract. Kept local on
 * purpose: this module is pure/injectable and must not import the engine.
 */
export type ArquivoRemotoRepository = {
  read(): EstadoOrganizacoes;
  write(document: EstadoOrganizacoes): void;
};

/** Network boundary, injected exactly like the engine's other adapters. */
export type ArquivoRemotoRede = {
  addServerPeer(input: {projectId: string; url: string}): Promise<void>;
};

/** The minimal project surface the archive adapter needs. */
export type ArquivoRemotoProjeto = {
  $member: {addServerPeer(url: string): Promise<void>};
};

/**
 * The ONE production adapter for `ArquivoRemotoRede`. Both the journal
 * executor and the manual hook build it from the same `getProject` read, so
 * there is a single place where "apply the archive" reaches Core.
 */
export function criarRedeArquivoRemoto(
  getProject: (projectId: string) => Promise<ArquivoRemotoProjeto>,
): ArquivoRemotoRede {
  return {
    addServerPeer: async ({projectId, url}) => {
      const projeto = await getProject(projectId);
      await projeto.$member.addServerPeer(url);
    },
  };
}

/** One real send (or its late response) settling, after the deadline raced it. */
export type EnvioArquivoRemotoConcluido = {
  organizacaoId: string;
  slot: Slot;
  projectId: string;
  sucesso: boolean;
};

export type ResultadoEnvioSlots = Array<{slot: Slot; erro?: unknown}>;

/**
 * Shared fan-out used by the manual operation: one failing slot never aborts
 * the other, every slot settles through `onSlotSettled` (the caller's cache
 * invalidation), and the array preserves the canonical `SLOTS` order so the
 * first error is deterministic.
 */
export async function aplicarArquivoRemotoEmSlots({
  rede,
  url,
  slots,
  onSlotSettled,
}: {
  rede: ArquivoRemotoRede;
  url: string;
  slots: Record<Slot, string>;
  onSlotSettled?: (slot: Slot) => Promise<unknown> | void;
}): Promise<ResultadoEnvioSlots> {
  return Promise.all(
    SLOTS.map(async slot => {
      try {
        await rede.addServerPeer({projectId: slots[slot], url});
        return {slot};
      } catch (erro) {
        return {slot, erro};
      } finally {
        await onSlotSettled?.(slot);
      }
    }),
  );
}

const AREA_POR_SLOT: Record<Slot, 'monitoramento' | 'alertas'> = {
  m: 'monitoramento',
  a: 'alertas',
};

/**
 * The slot that owns a project. Core removal is per project, so it must reset
 * exactly that slot — never the organization's other (still archived) project.
 */
function localizarSlotDoProjeto(
  documento: EstadoOrganizacoes,
  projectId: string,
): {organizacaoId: string; slot: Slot} | undefined {
  for (const organizacao of documento.organizacoes) {
    for (const slot of SLOTS) {
      if (
        organizacao.materializacao[AREA_POR_SLOT[slot]].projectId === projectId
      ) {
        return {organizacaoId: organizacao.id, slot};
      }
    }
  }
  return undefined;
}

/**
 * A removal is a REAL journal transition, not a Core-only side effect. The
 * removed slot goes back to `falha_recuperavel` (with a distinct reason) so a
 * resend needs an explicit request: the automatic boot pass already skips
 * that state, while a retry sends only this slot and preserves the other.
 */
function marcarSlotRemovido(
  documento: EstadoOrganizacoes,
  organizacaoId: string,
  slot: Slot,
): EstadoOrganizacoes | undefined {
  const organizacao = documento.organizacoes.find(
    item => item.id === organizacaoId,
  );
  if (!organizacao?.arquivoRemoto) return undefined;
  const atual = organizacao.arquivoRemoto.slots[slot];
  // Already reconciled: keep the document reference (no spurious write).
  if (atual.estado === 'falha_recuperavel' && atual.erro === 'removido') {
    return undefined;
  }
  const slots = {
    ...organizacao.arquivoRemoto.slots,
    [slot]: {estado: 'falha_recuperavel' as const, erro: 'removido'},
  };
  const arquivoRemoto: ArquivoRemoto = {
    ...organizacao.arquivoRemoto,
    estado: estadoAgregado(slots),
    slots,
  };
  return {
    ...documento,
    organizacoes: documento.organizacoes.map(item =>
      item.id === organizacaoId ? {...item, arquivoRemoto} : item,
    ),
  };
}

/**
 * Live sends, keyed by the repository OBJECT. A remount creates a new
 * executor but usually shares the repository, so the live-promise guard
 * survives it: a second automatic pass joins, and an explicit retry refuses
 * while the native operation is still in flight.
 */
type Voo = {
  envios: Set<Promise<void>>;
  execucao: Promise<ResultadoArquivoRemoto>;
};
const voos = new WeakMap<object, Map<string, Voo>>();

/**
 * Session-only record of a successful send whose conclusion checkpoint could
 * not be written. The next pass repeats ONLY the write — never the send.
 */
type SucessoPendente = {
  organizacaoId: string;
  slot: Slot;
  tentativaId: string;
};
const sucessosPendentes = new WeakMap<object, Map<string, SucessoPendente>>();

/**
 * Session-only record of a Core removal whose journal checkpoint could not be
 * written. The slot is still `concluido` on disk, so a later request for the
 * SAME URL would skip the send. The next pass repeats ONLY the journal write,
 * BEFORE selecting slots, so reconciliation always precedes a new success.
 */
type RemocaoPendente = {
  organizacaoId: string;
  slot: Slot;
  projectId: string;
};
const remocoesPendentes = new WeakMap<object, Map<string, RemocaoPendente>>();

let sequenciaTentativa = 0;

function proximaTentativa(now: () => number): string {
  sequenciaTentativa += 1;
  return `${now().toString(36)}-${sequenciaTentativa.toString(36)}`;
}

function estadoAgregado(
  slots: Record<Slot, EstadoSlotArquivoRemoto>,
): EstadoArquivoRemoto {
  const estados = SLOTS.map(slot => slots[slot].estado);
  if (estados.some(estado => estado === 'aplicando')) return 'aplicando';
  if (estados.every(estado => estado === 'concluido')) return 'concluido';
  if (estados.some(estado => estado === 'falha_recuperavel'))
    return 'falha_recuperavel';
  return 'pendente';
}

function limparSlot(slot: EstadoSlotArquivoRemoto): EstadoSlotArquivoRemoto {
  return Object.fromEntries(
    Object.entries(slot).filter(([, valor]) => valor !== undefined),
  ) as EstadoSlotArquivoRemoto;
}

export function criarArquivoRemotoPendente(url: string): ArquivoRemoto {
  return {
    url,
    estado: 'pendente',
    slots: {
      m: {estado: 'pendente'},
      a: {estado: 'pendente'},
    },
  };
}

export function createArquivoRemotoExecutor({
  repository,
  rede,
  now = Date.now,
  timeoutMs = PRAZO_ARQUIVO_REMOTO_MS,
  onEnvioConcluido,
}: {
  repository: ArquivoRemotoRepository;
  rede: ArquivoRemotoRede;
  now?: () => number;
  timeoutMs?: number;
  /**
   * Called when a send REALLY settles — including a response that arrives
   * after `timeoutMs` already released the presentation. The caller uses it
   * to refresh the member cache of the project that received the archive;
   * the deadline itself is not a server effect and must not invalidate.
   */
  onEnvioConcluido?: (evento: EnvioArquivoRemotoConcluido) => unknown;
}) {
  function mapaDeVoos(): Map<string, Voo> {
    let mapa = voos.get(repository);
    if (!mapa) {
      mapa = new Map();
      voos.set(repository, mapa);
    }
    return mapa;
  }

  function mapaDeSucessos(): Map<string, SucessoPendente> {
    let mapa = sucessosPendentes.get(repository);
    if (!mapa) {
      mapa = new Map();
      sucessosPendentes.set(repository, mapa);
    }
    return mapa;
  }

  function mapaDeRemocoes(): Map<string, RemocaoPendente> {
    let mapa = remocoesPendentes.get(repository);
    if (!mapa) {
      mapa = new Map();
      remocoesPendentes.set(repository, mapa);
    }
    return mapa;
  }

  /**
   * One spaced retry timer per organization, owned by this executor. The
   * timer only re-applies a journal checkpoint (a conclusion or a removal); it
   * never selects a slot for sending, so a failed write cannot turn into a
   * duplicate send.
   */
  const retentativas = new Map<string, ReturnType<typeof setTimeout>>();

  function temSucessosPendentes(organizacaoId: string): boolean {
    const mapa = sucessosPendentes.get(repository);
    if (!mapa) return false;
    const prefixo = `${organizacaoId}:`;
    for (const chave of mapa.keys()) {
      if (chave.startsWith(prefixo)) return true;
    }
    return false;
  }

  function temRemocoesPendentes(organizacaoId: string): boolean {
    const mapa = remocoesPendentes.get(repository);
    if (!mapa) return false;
    const prefixo = `${organizacaoId}:`;
    for (const chave of mapa.keys()) {
      if (chave.startsWith(prefixo)) return true;
    }
    return false;
  }

  /**
   * Cache refresh is a consumer concern: it must never affect the durable
   * journal, so a throwing/rejecting callback is swallowed here.
   */
  function notificarEnvioConcluido(
    organizacaoId: string,
    slot: Slot,
    projectId: string,
    sucesso: boolean,
  ): void {
    if (!onEnvioConcluido) return;
    try {
      const resultado = onEnvioConcluido({
        organizacaoId,
        slot,
        projectId,
        sucesso,
      });
      if (
        resultado &&
        typeof (resultado as PromiseLike<unknown>).then === 'function'
      ) {
        (resultado as PromiseLike<unknown>).then(undefined, () => {});
      }
    } catch {
      /* the journal already reflects the send; a cache miss is recoverable */
    }
  }

  function agendarReaplicacao(organizacaoId: string): void {
    if (retentativas.has(organizacaoId)) return;
    const timer = setTimeout(() => {
      retentativas.delete(organizacaoId);
      try {
        // Removals first: reopening a slot supersedes any pending success for
        // it, so a stale conclusion can never win over a Core removal.
        reaplicarRemocoesPendentes(organizacaoId);
        reaplicarSucessosPendentes(organizacaoId);
      } catch {
        // A failed read/write keeps the in-memory guard; retry later.
      }
      if (
        temRemocoesPendentes(organizacaoId) ||
        temSucessosPendentes(organizacaoId)
      )
        agendarReaplicacao(organizacaoId);
    }, RETENTATIVA_CHECKPOINT_MS);
    // Do not keep the Node/Jest process alive for a checkpoint retry.
    (timer as unknown as {unref?: () => void}).unref?.();
    retentativas.set(organizacaoId, timer);
  }

  /** Reads the target organization by id — NEVER the active or first entry. */
  function lerOrganizacao(organizacaoId: string): OrganizacaoLocal | undefined {
    return repository
      .read()
      .organizacoes.find(organizacao => organizacao.id === organizacaoId);
  }

  function resultadoAtual(
    organizacaoId: string,
    estado?: ResultadoArquivoRemoto['estado'],
  ): ResultadoArquivoRemoto {
    const organizacao = lerOrganizacao(organizacaoId);
    if (!organizacao?.arquivoRemoto) {
      return {estado: estado ?? 'sem-arquivo', slots: {}};
    }
    return {
      estado: estado ?? organizacao.arquivoRemoto.estado,
      slots: {...organizacao.arquivoRemoto.slots},
    };
  }

  /**
   * Functional patch by organization id and attempt id. Returns false when
   * the journal no longer belongs to that organization/attempt — a late
   * callback then updates nothing.
   */
  function gravarSlot(
    organizacaoId: string,
    slot: Slot,
    tentativaEsperada: string | null,
    patch: Partial<EstadoSlotArquivoRemoto>,
  ): boolean {
    const documento = repository.read();
    const organizacao = documento.organizacoes.find(
      item => item.id === organizacaoId,
    );
    if (!organizacao?.arquivoRemoto) return false;
    const atual = organizacao.arquivoRemoto.slots[slot];
    if ((atual.tentativaId ?? null) !== tentativaEsperada) return false;
    const slots = {
      ...organizacao.arquivoRemoto.slots,
      [slot]: limparSlot({...atual, ...patch}),
    };
    const arquivoRemoto: ArquivoRemoto = {
      ...organizacao.arquivoRemoto,
      estado: estadoAgregado(slots),
      slots,
    };
    repository.write({
      ...documento,
      organizacoes: documento.organizacoes.map(item =>
        item.id === organizacaoId ? {...item, arquivoRemoto} : item,
      ),
    });
    return true;
  }

  function guardarSucessoPendente(
    organizacaoId: string,
    slot: Slot,
    tentativaId: string,
  ): void {
    mapaDeSucessos().set(`${organizacaoId}:${slot}`, {
      organizacaoId,
      slot,
      tentativaId,
    });
  }

  /**
   * Repeats only the journal write of removals whose checkpoint was lost.
   * Called BEFORE any new selection (and before re-applying success
   * checkpoints), so a stale `concluido` cannot make the executor skip a slot
   * that Core no longer archives.
   */
  function reaplicarRemocoesPendentes(organizacaoId?: string): void {
    const mapa = remocoesPendentes.get(repository);
    if (!mapa) return;
    for (const [chave, remocao] of Array.from(mapa)) {
      if (
        organizacaoId !== undefined &&
        remocao.organizacaoId !== organizacaoId
      )
        continue;
      const documento = repository.read();
      // The slot must still be the one that owns this project; otherwise the
      // journal moved on and this pending removal is obsolete.
      const alvo = localizarSlotDoProjeto(documento, remocao.projectId);
      if (
        !alvo ||
        alvo.organizacaoId !== remocao.organizacaoId ||
        alvo.slot !== remocao.slot
      ) {
        mapa.delete(chave);
        continue;
      }
      const proximo = marcarSlotRemovido(
        documento,
        remocao.organizacaoId,
        remocao.slot,
      );
      if (!proximo) {
        mapa.delete(chave);
        continue;
      }
      try {
        repository.write(proximo);
        mapa.delete(chave);
      } catch {
        // Keep the guard: the next pass writes again, still without sending.
      }
    }
  }

  /**
   * Repeats only the checkpoint of sends that already succeeded. Called
   * BEFORE any new selection, so a failed write can never cause a resend.
   */
  function reaplicarSucessosPendentes(organizacaoId: string): void {
    const mapa = sucessosPendentes.get(repository);
    if (!mapa) return;
    for (const [chave, sucesso] of Array.from(mapa)) {
      if (sucesso.organizacaoId !== organizacaoId) continue;
      // A pending removal of the same slot wins: concluding it here would
      // recreate the false success the removal is reconciling.
      if (remocoesPendentes.get(repository)?.has(chave)) {
        mapa.delete(chave);
        continue;
      }
      const organizacao = lerOrganizacao(organizacaoId);
      if (!organizacao?.arquivoRemoto) {
        mapa.delete(chave);
        continue;
      }
      const atual = organizacao.arquivoRemoto.slots[sucesso.slot];
      if (
        atual.estado === 'concluido' ||
        (atual.tentativaId ?? null) !== sucesso.tentativaId
      ) {
        mapa.delete(chave);
        continue;
      }
      try {
        gravarSlot(organizacaoId, sucesso.slot, sucesso.tentativaId, {
          estado: 'concluido',
        });
        mapa.delete(chave);
      } catch {
        // Keep the guard: the next pass writes again, still without sending.
      }
    }
  }

  function guardaDeSucessoPendente(organizacaoId: string, slot: Slot): boolean {
    return (
      sucessosPendentes.get(repository)?.has(`${organizacaoId}:${slot}`) ===
      true
    );
  }

  async function enviarSlot(
    organizacaoId: string,
    slot: Slot,
    modo: ModoArquivoRemoto,
    voo: Voo,
  ): Promise<void> {
    // Identity and project ids are re-read before EVERY effect: the target is
    // the organization's own journal, never the active/first organization.
    const organizacao = lerOrganizacao(organizacaoId);
    if (!organizacao?.arquivoRemoto) return;
    const projectId = organizacao.materializacao[AREA_POR_SLOT[slot]].projectId;
    const url = organizacao.arquivoRemoto.url;
    const atual = organizacao.arquivoRemoto.slots[slot];
    if (!projectId) {
      try {
        gravarSlot(organizacaoId, slot, atual.tentativaId ?? null, {
          estado: 'falha_recuperavel',
          erro: 'projeto-ausente',
        });
      } catch {
        /* a failed checkpoint never triggers a send */
      }
      return;
    }

    const replay = modo === 'automatico' && atual.estado === 'aplicando';
    const tentativaId = proximaTentativa(now);
    try {
      gravarSlot(organizacaoId, slot, atual.tentativaId ?? null, {
        estado: 'aplicando',
        tentativaId,
        iniciadaEm: now(),
        // The one-replay budget is durable BEFORE the replay is sent: a crash
        // during this replay therefore requires an explicit retry.
        replayConsumido: replay,
        erro: undefined,
      });
    } catch {
      // Cannot record the attempt: do not send. A later pass writes again.
      return;
    }

    const envioBase = Promise.resolve()
      .then(() => rede.addServerPeer({projectId, url}))
      .then(
        () => {
          try {
            gravarSlot(organizacaoId, slot, tentativaId, {estado: 'concluido'});
          } catch {
            // Success must never be re-sent: repeat only this write later.
            guardarSucessoPendente(organizacaoId, slot, tentativaId);
            agendarReaplicacao(organizacaoId);
          }
          notificarEnvioConcluido(organizacaoId, slot, projectId, true);
        },
        () => {
          try {
            gravarSlot(organizacaoId, slot, tentativaId, {
              estado: 'falha_recuperavel',
              erro: 'arquivo-indisponivel',
            });
          } catch {
            /* the next pass re-evaluates this slot from the journal */
          }
          notificarEnvioConcluido(organizacaoId, slot, projectId, false);
        },
      );
    let terminou = false;
    const envio = envioBase.finally(() => {
      terminou = true;
      voo.envios.delete(envio);
    });
    voo.envios.add(envio);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const prazo = new Promise<void>(resolve => {
      timer = setTimeout(resolve, timeoutMs);
    });
    await Promise.race([envio, prazo]);
    if (timer !== undefined) clearTimeout(timer);

    if (!terminou) {
      // Free the presentation, but keep the promise registered: a retry must
      // refuse while the native operation is still alive.
      try {
        gravarSlot(organizacaoId, slot, tentativaId, {
          estado: 'falha_recuperavel',
          erro: 'prazo-excedido',
        });
      } catch {
        /* the late response still patches only its own attempt */
      }
    }
  }

  async function executarInterno(
    organizacaoId: string,
    modo: ModoArquivoRemoto,
    voo: Voo,
  ): Promise<ResultadoArquivoRemoto> {
    // Reconciliation always precedes selection: a removal whose checkpoint was
    // lost must reopen its slot BEFORE a new pass can treat it as concluded.
    reaplicarRemocoesPendentes(organizacaoId);
    reaplicarSucessosPendentes(organizacaoId);
    let organizacao = lerOrganizacao(organizacaoId);
    if (!organizacao) {
      return {estado: 'organizacao-ausente', slots: {}};
    }
    if (!organizacao.arquivoRemoto) {
      return {estado: 'sem-arquivo', slots: {}};
    }

    organizacao = lerOrganizacao(organizacaoId);
    if (!organizacao?.arquivoRemoto) {
      return {estado: 'sem-arquivo', slots: {}};
    }

    const alvos: Slot[] = [];
    for (const slot of SLOTS) {
      const atual = organizacao.arquivoRemoto.slots[slot];
      if (atual.estado === 'concluido') continue;
      if (guardaDeSucessoPendente(organizacaoId, slot)) continue;
      if (modo === 'automatico') {
        // A known rejection waits for an explicit retry — no watchdog resend.
        if (atual.estado === 'falha_recuperavel') continue;
        if (atual.estado === 'aplicando') {
          if (atual.replayConsumido) {
            try {
              gravarSlot(organizacaoId, slot, atual.tentativaId ?? null, {
                estado: 'falha_recuperavel',
                erro: 'replay-esgotado',
              });
            } catch {
              /* nothing is sent either way */
            }
            continue;
          }
        }
      }
      alvos.push(slot);
    }

    await Promise.all(
      alvos.map(slot => enviarSlot(organizacaoId, slot, modo, voo)),
    );
    return resultadoAtual(organizacaoId);
  }

  return {
    /**
     * Reconciles a Core-level archive removal with the durable journal: only
     * the slot whose project lost the server is reopened, so a later request
     * for the SAME URL really sends that slot and leaves the other untouched.
     * An in-flight success checkpoint for that slot is dropped too; a late
     * response cannot patch a journal whose attempt id was cleared.
     */
    removerArquivo(projectId: string): void {
      const documento = repository.read();
      const alvo = localizarSlotDoProjeto(documento, projectId);
      if (!alvo) return;
      const chave = `${alvo.organizacaoId}:${alvo.slot}`;
      sucessosPendentes.get(repository)?.delete(chave);
      const proximo = marcarSlotRemovido(
        documento,
        alvo.organizacaoId,
        alvo.slot,
      );
      if (!proximo) {
        // Already reconciled (or the journal moved on): nothing to retain.
        remocoesPendentes.get(repository)?.delete(chave);
        return;
      }
      try {
        repository.write(proximo);
        remocoesPendentes.get(repository)?.delete(chave);
      } catch {
        // The Core server is gone but the journal still says `concluido`.
        // Retain the removal checkpoint and re-apply it (no send) until it
        // lands, and re-apply it before any new selection.
        mapaDeRemocoes().set(chave, {...alvo, projectId});
        agendarReaplicacao(alvo.organizacaoId);
      }
    },
    /**
     * Whether a pass for this organization is still alive. The caller uses it
     * BEFORE replacing the journal with a new URL: a refusal must leave the
     * live attempt (its URL, tentativaId and slot states) untouched.
     */
    emAndamento(organizacaoId: string): boolean {
      return (mapaDeVoos().get(organizacaoId)?.envios.size ?? 0) > 0;
    },
    executar(
      organizacaoId: string,
      opcoes: {modo?: ModoArquivoRemoto} = {},
    ): Promise<ResultadoArquivoRemoto> {
      const modo = opcoes.modo ?? 'automatico';
      const mapa = mapaDeVoos();
      const existente = mapa.get(organizacaoId);
      if (existente && existente.envios.size > 0) {
        if (modo === 'retry') {
          return Promise.resolve(resultadoAtual(organizacaoId, 'em-andamento'));
        }
        return existente.execucao;
      }

      const voo = {envios: new Set<Promise<void>>()} as Voo;
      voo.execucao = executarInterno(organizacaoId, modo, voo).finally(() => {
        if (voo.envios.size === 0 && mapa.get(organizacaoId) === voo) {
          mapa.delete(organizacaoId);
        }
      });
      mapa.set(organizacaoId, voo);
      return voo.execucao;
    },
  };
}

export type ArquivoRemotoExecutor = ReturnType<
  typeof createArquivoRemotoExecutor
>;
