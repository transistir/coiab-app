import type {Slot} from './marker';

/** Canonical document shared by SPEC A §4.2 and SPEC B §5.3. */
export type Area = 'monitoramento' | 'alertas';
export const AREAS: readonly Area[] = ['monitoramento', 'alertas'];
export type TemplateRef = {versao: string; hash: string};
export type EtapaArea = {
  etapa: 'ausente' | 'criando' | 'criado' | 'importando' | 'verificado';
  projectId: string | null;
  template: TemplateRef | null;
  idsAntesDaCriacao: string[] | null;
};
/**
 * Terminal removal state. It exists so a confirmed removal can never be
 * confused with `pendente`: the archive URL is still in the journal, and a
 * `pendente` slot would make the next automatic pass re-add the file the user
 * removed. `removido` is skipped by automatic passes and becomes a send
 * candidate ONLY on an explicit request.
 */
export type EstadoArquivoRemoto =
  | 'pendente'
  | 'aplicando'
  | 'removendo'
  | 'removido'
  | 'concluido'
  | 'falha_recuperavel';
/**
 * One project slot of the remote archive step (#142). `tentativaId` names the
 * attempt that owns the current state, so a late response can only ever patch
 * the attempt it belongs to. `replayConsumido` is the durable one-replay
 * budget: it is written BEFORE an interrupted attempt is replayed, so a crash
 * during that replay requires an explicit retry.
 */
export type EstadoSlotArquivoRemoto = {
  estado: EstadoArquivoRemoto;
  tentativaId?: string;
  /**
   * Identity of the REMOVAL attempt that owns a `removendo` slot. A late Core
   * read belonging to an older removal must never write its outcome over a
   * newer attempt, so reconciliation applies a result only while this id still
   * matches the slot.
   */
  remocaoId?: string;
  /**
   * Identity of the archive server recorded in this slot (#142 10ª rodada).
   * A removal is only allowed to transition THIS slot when the removed
   * server matches it; otherwise removing A would mark the slot that records
   * B and the next pass would replay B. `deviceId` is filled when the caller
   * knows it (Core's `addServerPeer` returns void); `baseUrl` is the
   * normalized URL and always available as the fallback identity.
   */
  baseUrl?: string;
  deviceId?: string;
  iniciadaEm?: number;
  replayConsumido?: boolean;
  erro?: string;
};
/**
 * The remote archive step lives inside the SAME materialization journal as
 * the local preparation. Its absence means "no archive was requested" (an
 * invite-created organization); the URL is never mirrored anywhere else.
 */
export type ArquivoRemoto = {
  url: string;
  estado: EstadoArquivoRemoto;
  slots: Record<Slot, EstadoSlotArquivoRemoto>;
};
export type OrganizacaoLocal = {
  id: string;
  nome: string;
  estado: 'preparando' | 'falha_recuperavel' | 'pronta';
  confirmacaoPendente: boolean;
  materializacao: Record<Area, EtapaArea>;
  areaEmExecucao: Area | null;
  ultimoErro: null | {codigo: string; area: Area | null; ocorridoEm: string};
  arquivoRemoto?: ArquivoRemoto;
};
export type EstadoOrganizacoes = {
  versao: 1;
  organizacoes: OrganizacaoLocal[];
  ativa: null | {organizacaoId: string; area: Area};
};
export function documentoInicial(): EstadoOrganizacoes {
  return {versao: 1, organizacoes: [], ativa: null};
}
