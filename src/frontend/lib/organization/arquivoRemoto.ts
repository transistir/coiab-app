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
 * Space between attempts to re-write a TERMINAL journal checkpoint (a send
 * conclusion, a rejection, a deadline or a removal) whose write failed. The
 * local write is retried WITHOUT ever repeating the native effect, so a
 * transient MMKV failure cannot leave the step without a live operation.
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

/**
 * Core read used to reconcile a durable `removendo` intent lost to a failed
 * journal write. `true` means Core still has the archive server for that
 * project; `false` means the removal really happened.
 */
export type ArquivoRemotoConsulta = (projectId: string) => Promise<boolean>;

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
 * One pass, keyed by the repository OBJECT. A remount creates a new executor
 * but usually shares the repository, so the guard survives it: a second
 * automatic pass joins, and an explicit retry refuses while the pass is
 * alive. `executando` is registered SYNCHRONOUSLY at `executar` entry — before
 * the first `await` and therefore before reconciliation — so two consecutive
 * calls can never both select a slot and double the Core calls. `envios`
 * outlives `executando` on purpose: after the 60 s deadline the presentation
 * is released, but the native promise is still live and a retry must refuse
 * until it really settles.
 */
type Voo = {
  envios: Set<Promise<void>>;
  executando: boolean;
  execucao: Promise<ResultadoArquivoRemoto>;
};
const voos = new WeakMap<object, Map<string, Voo>>();

/**
 * Session-only record of a TERMINAL journal checkpoint (success, rejection or
 * deadline) whose write could not be persisted. The next pass repeats ONLY the
 * write — never the network effect — so a failed write can never turn into a
 * duplicate send or leave the journal in `aplicando` with no live operation.
 */
type CheckpointPendente = {
  organizacaoId: string;
  slot: Slot;
  tentativaId: string | null;
  patch: Partial<EstadoSlotArquivoRemoto>;
};
const checkpointsPendentes = new WeakMap<
  object,
  Map<string, CheckpointPendente>
>();

/**
 * Session-only guard for a removal between `marcarRemocao` and the Core
 * callback. It is NOT the durable state (the journal's `removendo` is); it
 * just stops a concurrent boot/executor pass from reconciling a removal whose
 * Core call is still in flight. On a crash the set disappears and the next
 * boot queries Core, which is exactly why the intent is durable.
 */
const remocoesEmVoo = new WeakMap<object, Set<string>>();

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
  // A removal in flight is not "no archive": keeping it non-terminal lets the
  // next boot reconcile a durable `removendo` left by a crash (a `concluido`
  // sibling would otherwise make the aggregate terminal and hide the intent).
  if (estados.some(estado => estado === 'removendo')) return 'removendo';
  // All slots removed means there is no archive anywhere.
  if (estados.every(estado => estado === 'removido')) return 'removido';
  // Success requires the WHOLE archive applied (or deliberately removed): a
  // single `concluido` sibling must never mask a slot that was never sent.
  // `pendente`/`aplicando` are not terminal, so they can never be success.
  const todosTerminaisDeSucesso = estados.every(
    estado => estado === 'concluido' || estado === 'removido',
  );
  if (todosTerminaisDeSucesso && estados.some(estado => estado === 'concluido'))
    return 'concluido';
  // A recoverable failure must outrank a partial success: with one slot
  // `concluido` and another `falha_recuperavel` the archive is NOT fully
  // applied, so the aggregate must keep the retry visible instead of letting
  // the screen announce a false success.
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
  consultarArquivo,
}: {
  repository: ArquivoRemotoRepository;
  rede: ArquivoRemotoRede;
  now?: () => number;
  timeoutMs?: number;
  /**
   * Core read used ONLY to reconcile a durable `removendo` slot: absent means
   * the removal landed (`pendente`), present means it did not (`concluido`).
   * Omitted in unit harnesses that never seed a pending removal.
   */
  consultarArquivo?: ArquivoRemotoConsulta;
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

  function mapaDeCheckpoints(): Map<string, CheckpointPendente> {
    let mapa = checkpointsPendentes.get(repository);
    if (!mapa) {
      mapa = new Map();
      checkpointsPendentes.set(repository, mapa);
    }
    return mapa;
  }

  function marcarRemocaoEmVoo(projectId: string): void {
    let conjunto = remocoesEmVoo.get(repository);
    if (!conjunto) {
      conjunto = new Set();
      remocoesEmVoo.set(repository, conjunto);
    }
    conjunto.add(projectId);
  }

  function limparRemocaoEmVoo(projectId: string): void {
    remocoesEmVoo.get(repository)?.delete(projectId);
  }

  function remocaoEmVoo(projectId: string): boolean {
    return remocoesEmVoo.get(repository)?.has(projectId) === true;
  }

  /**
   * One spaced retry timer per organization, owned by this executor. The
   * timer only re-applies a durable journal checkpoint (a conclusion, a
   * rejection, a deadline or a removal); it never selects a slot for sending,
   * so a failed write cannot turn into a duplicate send.
   */
  const retentativas = new Map<string, ReturnType<typeof setTimeout>>();

  function temCheckpointsPendentes(organizacaoId: string): boolean {
    const mapa = checkpointsPendentes.get(repository);
    if (!mapa) return false;
    const prefixo = `${organizacaoId}:`;
    for (const chave of mapa.keys()) {
      if (chave.startsWith(prefixo)) return true;
    }
    return false;
  }

  /**
   * A durable `removendo` slot is itself the live operation: even after a
   * process restart (where every WeakMap is gone) the next pass must reconcile
   * it before selecting anything.
   */
  function temRemocoesPendentes(organizacaoId: string): boolean {
    try {
      const arquivo = lerOrganizacao(organizacaoId)?.arquivoRemoto;
      if (!arquivo) return false;
      return SLOTS.some(slot => arquivo.slots[slot].estado === 'removendo');
    } catch {
      // A repository read failure keeps the retry alive.
      return true;
    }
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
      void (async () => {
        try {
          // Removals first: resolving a durable `removendo` supersedes any
          // stale conclusion for that slot.
          await reconciliarRemocoes(organizacaoId);
        } catch {
          // A failed Core read/write keeps the durable intent; retry later.
        }
        try {
          reaplicarCheckpointsPendentes(organizacaoId);
        } catch {
          // A failed read/write keeps the in-memory guard; retry later.
        }
        if (
          // Without a Core adapter a durable `removendo` cannot be resolved;
          // keep the intent (and the screen's false-success guard) rather than
          // spinning a timer that can never make progress.
          (consultarArquivo !== undefined &&
            temRemocoesPendentes(organizacaoId)) ||
          temCheckpointsPendentes(organizacaoId)
        )
          agendarReaplicacao(organizacaoId);
      })();
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

  /**
   * A failed `aplicando` checkpoint whose terminal failure ALSO failed to
   * persist lives only in memory. The pass result must still report
   * `falha_recuperavel`: the durable aggregate (`pendente` after a sibling
   * success) would otherwise hide a slot that was never sent.
   */
  function estadoComFalhaDeCheckpointInicial(
    organizacaoId: string,
    estado: ResultadoArquivoRemoto['estado'],
  ): ResultadoArquivoRemoto['estado'] {
    // Only a would-be success (or its silent `pendente` fallback) is unsafe;
    // explicit in-progress/absent results keep their meaning.
    if (estado !== 'pendente' && estado !== 'concluido') return estado;
    const mapa = checkpointsPendentes.get(repository);
    if (!mapa) return estado;
    const prefixo = `${organizacaoId}:`;
    for (const [chave, checkpoint] of mapa) {
      if (
        chave.startsWith(prefixo) &&
        checkpoint.patch.erro === 'checkpoint-inicial'
      )
        return 'falha_recuperavel';
    }
    return estado;
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
      estado: estadoComFalhaDeCheckpointInicial(
        organizacaoId,
        estado ?? organizacao.arquivoRemoto.estado,
      ),
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

  /**
   * Unconditional slot write by organization/slot. Used only by the removal
   * intent transitions, which are keyed by projectId and must not be
   * overwritten by a late response from an older send attempt.
   */
  function gravarSlotDireto(
    organizacaoId: string,
    slot: Slot,
    estadoSlot: EstadoSlotArquivoRemoto,
  ): void {
    const documento = repository.read();
    const organizacao = documento.organizacoes.find(
      item => item.id === organizacaoId,
    );
    if (!organizacao?.arquivoRemoto) {
      throw new Error('archive-journal-missing');
    }
    const slots = {
      ...organizacao.arquivoRemoto.slots,
      [slot]: limparSlot(estadoSlot),
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
  }

  function chaveDoSlot(organizacaoId: string, slot: Slot): string {
    return `${organizacaoId}:${slot}`;
  }

  function guardarCheckpointPendente(
    organizacaoId: string,
    slot: Slot,
    tentativaId: string | null,
    patch: Partial<EstadoSlotArquivoRemoto>,
  ): void {
    mapaDeCheckpoints().set(chaveDoSlot(organizacaoId, slot), {
      organizacaoId,
      slot,
      tentativaId,
      patch,
    });
    agendarReaplicacao(organizacaoId);
  }

  function limparCheckpointPendente(organizacaoId: string, slot: Slot): void {
    checkpointsPendentes
      .get(repository)
      ?.delete(chaveDoSlot(organizacaoId, slot));
  }

  function guardaDeCheckpointPendente(
    organizacaoId: string,
    slot: Slot,
  ): boolean {
    return (
      checkpointsPendentes
        .get(repository)
        ?.has(chaveDoSlot(organizacaoId, slot)) === true
    );
  }

  /**
   * Repeats only the journal write of a TERMINAL checkpoint whose write was
   * lost. Called BEFORE any new selection, so a failed write can never cause a
   * resend or leave an `aplicando` slot with no live operation.
   */
  function reaplicarCheckpointsPendentes(organizacaoId: string): void {
    const mapa = checkpointsPendentes.get(repository);
    if (!mapa) return;
    for (const [chave, checkpoint] of Array.from(mapa)) {
      if (checkpoint.organizacaoId !== organizacaoId) continue;
      const organizacao = lerOrganizacao(organizacaoId);
      if (!organizacao?.arquivoRemoto) {
        mapa.delete(chave);
        continue;
      }
      const atual = organizacao.arquivoRemoto.slots[checkpoint.slot];
      if ((atual.tentativaId ?? null) !== checkpoint.tentativaId) {
        // The journal moved on to another attempt; this latch is obsolete.
        mapa.delete(chave);
        continue;
      }
      if (checkpoint.patch.estado === 'concluido') {
        if (atual.estado === 'concluido') {
          mapa.delete(chave);
          continue;
        }
      } else if (atual.estado === 'concluido') {
        // A real late success already won; never downgrade it.
        mapa.delete(chave);
        continue;
      } else if (
        atual.estado === checkpoint.patch.estado &&
        atual.erro === checkpoint.patch.erro
      ) {
        // Already applied by a previous retry.
        mapa.delete(chave);
        continue;
      }
      try {
        gravarSlot(
          organizacaoId,
          checkpoint.slot,
          checkpoint.tentativaId,
          checkpoint.patch,
        );
        mapa.delete(chave);
      } catch {
        // Keep the latch: the next pass writes again, still without sending.
      }
    }
  }

  /**
   * Resolves every durable `removendo` slot against Core. This is the restart
   * path: the intent survived the failed checkpoint write even though every
   * in-memory guard is gone. An unreachable Core keeps the slot `removendo`
   * (and a timer alive) so a removal can never claim a false success.
   */
  async function reconciliarRemocoes(organizacaoId?: string): Promise<void> {
    if (!consultarArquivo) return;
    const documento = repository.read();
    for (const organizacao of documento.organizacoes) {
      if (organizacaoId !== undefined && organizacao.id !== organizacaoId)
        continue;
      const arquivo = organizacao.arquivoRemoto;
      if (!arquivo) continue;
      for (const slot of SLOTS) {
        if (arquivo.slots[slot].estado !== 'removendo') continue;
        // Identity of the removal attempt that is being reconciled. A newer
        // removal replaces it; the old read must then be discarded.
        const remocaoId = arquivo.slots[slot].remocaoId;
        const projectId =
          organizacao.materializacao[AREA_POR_SLOT[slot]].projectId;
        if (!projectId) {
          agendarReaplicacao(organizacao.id);
          continue;
        }
        // The Core callback owns this window; reconciling here could read the
        // pre-removal state and write a false `concluido`.
        if (remocaoEmVoo(projectId)) continue;
        let existe: boolean;
        try {
          existe = await consultarArquivo(projectId);
        } catch {
          // Unknown Core state: keep the intent and retry, never guess.
          agendarReaplicacao(organizacao.id);
          continue;
        }
        // Re-read after the await: the journal may have moved on.
        const atualDoc = repository.read();
        const alvo = localizarSlotDoProjeto(atualDoc, projectId);
        if (
          !alvo ||
          alvo.organizacaoId !== organizacao.id ||
          alvo.slot !== slot
        )
          continue;
        const organizacaoAtual = atualDoc.organizacoes.find(
          item => item.id === organizacao.id,
        );
        const slotAtual = organizacaoAtual?.arquivoRemoto?.slots[slot];
        if (slotAtual?.estado !== 'removendo') continue;
        // A newer removal now owns this slot. Its own callback/reconciliation
        // decides the outcome; this read is stale and must be dropped silently.
        if (slotAtual.remocaoId !== remocaoId) continue;
        // A removal may have started while Core was being queried. Its
        // callback owns the decision now; never write a stale `concluido`.
        if (remocaoEmVoo(projectId)) continue;
        try {
          gravarSlotDireto(
            organizacao.id,
            slot,
            existe
              ? {estado: 'concluido'}
              : // Removed, but explicit: a terminal state distinct from
                // `pendente`, so the automatic boot pass never re-adds the
                // archive the user removed while an explicit request still can.
                {estado: 'removido'},
          );
        } catch {
          agendarReaplicacao(organizacao.id);
        }
      }
    }
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
      const tentativaEsperada = atual.tentativaId ?? null;
      try {
        gravarSlot(organizacaoId, slot, tentativaEsperada, {
          estado: 'falha_recuperavel',
          erro: 'projeto-ausente',
        });
        limparCheckpointPendente(organizacaoId, slot);
      } catch {
        guardarCheckpointPendente(organizacaoId, slot, tentativaEsperada, {
          estado: 'falha_recuperavel',
          erro: 'projeto-ausente',
        });
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
      // Cannot record the attempt (no `start` without its durable record), so
      // the slot must NOT be sent. Leaving it silently `pendente` is exactly
      // what let a `concluido` sibling produce a false success. Record the
      // attempt as a recoverable failure instead; the executor result then
      // reports it and a later pass can retake the slot.
      const tentativaEsperada = atual.tentativaId ?? null;
      try {
        gravarSlot(organizacaoId, slot, tentativaEsperada, {
          estado: 'falha_recuperavel',
          erro: 'checkpoint-inicial',
        });
        limparCheckpointPendente(organizacaoId, slot);
      } catch {
        // Even the failure checkpoint was lost: keep it in memory, re-apply it
        // by timer (never resending anything) and keep the pass non-success.
        guardarCheckpointPendente(organizacaoId, slot, tentativaEsperada, {
          estado: 'falha_recuperavel',
          erro: 'checkpoint-inicial',
        });
      }
      return;
    }

    const envioBase = Promise.resolve()
      .then(() => rede.addServerPeer({projectId, url}))
      .then(
        () => {
          try {
            gravarSlot(organizacaoId, slot, tentativaId, {estado: 'concluido'});
            limparCheckpointPendente(organizacaoId, slot);
          } catch {
            // Success must never be re-sent: repeat only this write later.
            guardarCheckpointPendente(organizacaoId, slot, tentativaId, {
              estado: 'concluido',
            });
          }
          notificarEnvioConcluido(organizacaoId, slot, projectId, true);
        },
        () => {
          try {
            gravarSlot(organizacaoId, slot, tentativaId, {
              estado: 'falha_recuperavel',
              erro: 'arquivo-indisponivel',
            });
            limparCheckpointPendente(organizacaoId, slot);
          } catch {
            // A rejected send must still become an explicit recoverable
            // failure: retain the terminal checkpoint and re-apply it by
            // timer, without ever repeating the send. This is what keeps the
            // slot from being stuck in `aplicando` with no live operation.
            guardarCheckpointPendente(organizacaoId, slot, tentativaId, {
              estado: 'falha_recuperavel',
              erro: 'arquivo-indisponivel',
            });
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
        limparCheckpointPendente(organizacaoId, slot);
      } catch {
        // The late response still owns this attempt when it arrives, but a
        // failed write must not leave the presentation in `aplicando`.
        guardarCheckpointPendente(organizacaoId, slot, tentativaId, {
          estado: 'falha_recuperavel',
          erro: 'prazo-excedido',
        });
      }
    }
  }

  async function executarInterno(
    organizacaoId: string,
    modo: ModoArquivoRemoto,
    voo: Voo,
  ): Promise<ResultadoArquivoRemoto> {
    // Reconciliation always precedes selection: a durable `removendo` must be
    // resolved against Core BEFORE a new pass can treat it as concluded.
    await reconciliarRemocoes(organizacaoId);
    reaplicarCheckpointsPendentes(organizacaoId);
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
      // A removal with an unknown Core outcome is never a send candidate. The
      // reconciliation above resolves it; an unreachable Core keeps it out.
      if (atual.estado === 'removendo') continue;
      if (guardaDeCheckpointPendente(organizacaoId, slot)) continue;
      if (modo === 'automatico') {
        // A known rejection waits for an explicit retry — no watchdog resend.
        // The ONE exception is a locally lost `aplicando` checkpoint: no
        // native effect ever started, so the next pass must retake the slot
        // instead of leaving it stranded with no live operation.
        if (
          atual.estado === 'falha_recuperavel' &&
          atual.erro !== 'checkpoint-inicial'
        )
          continue;
        // A confirmed removal is TERMINAL for automatic passes: the boot
        // must not re-add an archive the user removed. Only an explicit
        // request reopens it.
        if (atual.estado === 'removido') continue;
        if (atual.estado === 'aplicando') {
          if (atual.replayConsumido) {
            const tentativaEsperada = atual.tentativaId ?? null;
            try {
              gravarSlot(organizacaoId, slot, tentativaEsperada, {
                estado: 'falha_recuperavel',
                erro: 'replay-esgotado',
              });
              limparCheckpointPendente(organizacaoId, slot);
            } catch {
              // A terminal failure checkpoint must never be lost: re-apply it
              // by timer, still without sending.
              guardarCheckpointPendente(
                organizacaoId,
                slot,
                tentativaEsperada,
                {estado: 'falha_recuperavel', erro: 'replay-esgotado'},
              );
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
     * Durable intent BEFORE the Core effect. The slot is persisted as
     * `removendo` and any late send response loses its attempt id, so it can
     * never recreate a false `concluido`. A failed write throws, which the
     * caller uses to ABORT the Core removal: there is no removal without a
     * registered intent. Returns the previous slot state so a Core failure can
     * restore it exactly.
     */
    marcarRemocao(projectId: string): EstadoSlotArquivoRemoto | undefined {
      const documento = repository.read();
      const alvo = localizarSlotDoProjeto(documento, projectId);
      // The journal only owns COIAB organizations. A standalone project has
      // no slot to mark, and its Core removal is allowed exactly as before.
      if (!alvo) return undefined;
      const organizacao = documento.organizacoes.find(
        item => item.id === alvo.organizacaoId,
      );
      if (!organizacao?.arquivoRemoto) return undefined;
      const anterior = {...organizacao.arquivoRemoto.slots[alvo.slot]};
      gravarSlotDireto(alvo.organizacaoId, alvo.slot, {
        estado: 'removendo',
        // The attempt identity is durable BEFORE the Core effect. A Core read
        // started by an older removal carries the old id and is discarded once
        // this new attempt owns the slot.
        remocaoId: proximaTentativa(now),
      });
      // The removal supersedes any pending send conclusion for this slot.
      limparCheckpointPendente(alvo.organizacaoId, alvo.slot);
      marcarRemocaoEmVoo(projectId);
      return anterior;
    },
    /**
     * Finalizes a Core removal that already succeeded. The slot becomes the
     * terminal `removido`, so a later explicit request for the same URL really
     * sends while the automatic boot pass does not. Returns true ONLY when the
     * journal no longer claims the archive; when the final write fails the
     * durable `removendo` stays and a timer keeps reconciling it.
     */
    removerArquivo(projectId: string): boolean {
      try {
        const documento = repository.read();
        const alvo = localizarSlotDoProjeto(documento, projectId);
        if (!alvo) return true;
        const organizacao = documento.organizacoes.find(
          item => item.id === alvo.organizacaoId,
        );
        if (!organizacao?.arquivoRemoto) return true;
        const atual = organizacao.arquivoRemoto.slots[alvo.slot];
        if (
          atual.estado !== 'removendo' &&
          atual.estado !== 'concluido' &&
          atual.estado !== 'removido'
        ) {
          // Already reopened (or failed): nothing still claims `concluido`.
          return true;
        }
        if (atual.estado === 'removido') return true;
        try {
          // Called only after Core confirmed the removal, so `concluido` is
          // stale even if a concurrent reconciliation wrote it while the
          // Core call was in flight.
          gravarSlotDireto(alvo.organizacaoId, alvo.slot, {
            estado: 'removido',
          });
          limparCheckpointPendente(alvo.organizacaoId, alvo.slot);
          return true;
        } catch {
          // The Core server is gone but the journal still says `removendo`.
          // The durable intent is the checkpoint: retry it by timer.
          agendarReaplicacao(alvo.organizacaoId);
          return false;
        }
      } finally {
        limparRemocaoEmVoo(projectId);
      }
    },
    /**
     * Reconciles a REMOVAL whose Core call just rejected. Core assigns the
     * blocked role BEFORE syncing (`member-api.js`), so a rejection does not
     * prove the server is still active: the error may arrive after the block
     * landed. Guessing (`concluido`) would leave the journal durably wrong and
     * block re-adding the same URL, so the slot stays `removendo` until a real
     * Core read decides:
     *   - no active server → `removido`;
     *   - still active → `concluido` (the removal did not stick);
     *   - Core unreachable → `removendo`, retried by timer/boot.
     *
     * Returns true only when the slot reached a terminal state.
     */
    async reconciliarRemocao(projectId: string): Promise<boolean> {
      // The Core call already settled: its live guard must not block the read
      // that decides the real outcome.
      limparRemocaoEmVoo(projectId);
      if (!consultarArquivo) return false;
      const documento = repository.read();
      const alvo = localizarSlotDoProjeto(documento, projectId);
      if (!alvo) return true;
      const organizacao = documento.organizacoes.find(
        item => item.id === alvo.organizacaoId,
      );
      const slotInicial = organizacao?.arquivoRemoto?.slots[alvo.slot];
      if (slotInicial?.estado !== 'removendo') return true;
      // Identity of THIS removal attempt. If a newer removal starts while the
      // Core read is in flight, its id replaces this one and the result below
      // is discarded instead of overwriting the new attempt.
      const remocaoId = slotInicial.remocaoId;
      let existe: boolean;
      try {
        existe = await consultarArquivo(projectId);
      } catch {
        // Unknown Core state: keep the durable intent and retry later.
        agendarReaplicacao(alvo.organizacaoId);
        return false;
      }
      // Re-read after the await: the journal may have moved on.
      const atualDoc = repository.read();
      const alvoAtual = localizarSlotDoProjeto(atualDoc, projectId);
      if (
        !alvoAtual ||
        alvoAtual.organizacaoId !== alvo.organizacaoId ||
        alvoAtual.slot !== alvo.slot
      )
        return true;
      const slotAtual = atualDoc.organizacoes.find(
        item => item.id === alvo.organizacaoId,
      )?.arquivoRemoto?.slots[alvo.slot];
      if (slotAtual?.estado !== 'removendo') return true;
      // Another removal owns the slot now: drop this stale read silently and
      // let that attempt (or its own reconciliation) decide.
      if (slotAtual.remocaoId !== remocaoId) return false;
      try {
        gravarSlotDireto(
          alvo.organizacaoId,
          alvo.slot,
          existe ? {estado: 'concluido'} : {estado: 'removido'},
        );
        return true;
      } catch {
        agendarReaplicacao(alvo.organizacaoId);
        return false;
      }
    },
    /**
     * Reverts the durable mark when the REMOVAL effect was never started (a
     * pre-flight failure). A rejection from Core is NEVER handled here: Core
     * may have blocked before failing, so only `reconciliarRemocao` may decide
     * its outcome.
     */
    cancelarRemocao(
      projectId: string,
      anterior: EstadoSlotArquivoRemoto | undefined,
    ): boolean {
      try {
        // Untracked project: there was no durable mark to revert.
        if (!anterior) return true;
        const documento = repository.read();
        const alvo = localizarSlotDoProjeto(documento, projectId);
        if (!alvo) return true;
        try {
          gravarSlotDireto(alvo.organizacaoId, alvo.slot, anterior);
          limparCheckpointPendente(alvo.organizacaoId, alvo.slot);
          return true;
        } catch {
          agendarReaplicacao(alvo.organizacaoId);
          return false;
        }
      } finally {
        limparRemocaoEmVoo(projectId);
      }
    },
    /**
     * Resolves every durable `removendo` slot against Core WITHOUT selecting a
     * send. The manual path calls it BEFORE replacing the journal URL: a
     * removal whose Core outcome is still unknown must never be erased by a
     * new URL. It is also the restart path — the journal state, not a live
     * promise, drives the guard.
     */
    async reconciliar(organizacaoId: string): Promise<void> {
      await reconciliarRemocoes(organizacaoId);
    },
    /**
     * Whether the organization still owns an unresolved archive operation.
     * A live pass counts, AND so does any durable slot in a non-terminal state
     * that a restart would otherwise forget: `removendo` (Core outcome
     * unknown) and `aplicando` (send outcome unknown). The caller uses it
     * BEFORE replacing the journal with a new URL: a refusal must leave the
     * live attempt (its URL, tentativaId and slot states) untouched.
     */
    emAndamento(organizacaoId: string): boolean {
      const voo = mapaDeVoos().get(organizacaoId);
      if (voo && (voo.executando || voo.envios.size > 0)) return true;
      try {
        const arquivo = lerOrganizacao(organizacaoId)?.arquivoRemoto;
        if (!arquivo) return false;
        return SLOTS.some(slot => {
          const estado = arquivo.slots[slot].estado;
          return estado === 'aplicando' || estado === 'removendo';
        });
      } catch {
        // An unreadable journal keeps the conservative refusal.
        return true;
      }
    },
    executar(
      organizacaoId: string,
      opcoes: {modo?: ModoArquivoRemoto} = {},
    ): Promise<ResultadoArquivoRemoto> {
      const modo = opcoes.modo ?? 'automatico';
      const mapa = mapaDeVoos();
      const existente = mapa.get(organizacaoId);
      if (existente && (existente.executando || existente.envios.size > 0)) {
        if (modo === 'retry') {
          return Promise.resolve(resultadoAtual(organizacaoId, 'em-andamento'));
        }
        return existente.execucao;
      }

      const voo = {
        envios: new Set<Promise<void>>(),
        executando: true,
      } as Voo;
      // Register BEFORE `executarInterno` reaches its first `await` (the
      // reconciliation): the lock is owned from entry, not from the first
      // send. A second call in the same tick therefore joins this pass.
      mapa.set(organizacaoId, voo);
      voo.execucao = executarInterno(organizacaoId, modo, voo).finally(() => {
        voo.executando = false;
        if (voo.envios.size === 0 && mapa.get(organizacaoId) === voo) {
          mapa.delete(organizacaoId);
        }
      });
      return voo.execucao;
    },
  };
}

export type ArquivoRemotoExecutor = ReturnType<
  typeof createArquivoRemotoExecutor
>;
