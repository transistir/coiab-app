import * as v from 'valibot';

import {
  AREAS,
  type Area,
  type EstadoOrganizacoes,
  type EtapaArea,
  type OrganizacaoLocal,
  type TemplateRef,
} from './documento';

/**
 * The durable COIAB organization layer (SPEC A §4.2): one versioned product
 * document under the MMKV key `CoiabOrganizations` — registration, creation
 * state, the #31 materialization journal and the pending confirmation are
 * FIELDS of this document, not separate entities or keys. The type and field
 * names below are the normative contract shared with SPEC B (creation flow).
 *
 * Single source of truth (review round 2 F3): the typed model (Area, EtapaArea,
 * OrganizacaoLocal, EstadoOrganizacoes, TemplateRef, AREAS) is canonically
 * defined in documento.ts — the §4.2 document shared with the
 * materialization layer — and only RE-EXPORTED here. This module keeps the
 * domain functions and the valibot schemas; the type definitions are never
 * duplicated in parallel.
 */
export type {
  Area,
  EstadoOrganizacoes,
  EtapaArea,
  OrganizacaoLocal,
  TemplateRef,
};
export {AREAS};

export type EstadoOrganizacao = 'preparando' | 'falha_recuperavel' | 'pronta';

export const AREA_SCHEMA = v.picklist(['monitoramento', 'alertas']);

const TemplateRefSchema = v.object({
  versao: v.string(),
  hash: v.string(),
});

export const EtapaAreaSchema = v.object({
  etapa: v.picklist([
    'ausente',
    'criando',
    'criado',
    'importando',
    'verificado',
  ]),
  projectId: v.nullable(v.string()),
  template: v.nullable(TemplateRefSchema),
  idsAntesDaCriacao: v.nullable(v.array(v.string())),
});

const OrganizacaoLocalSchema = v.object({
  id: v.string(),
  nome: v.string(),
  estado: v.picklist(['preparando', 'falha_recuperavel', 'pronta']),
  confirmacaoPendente: v.boolean(),
  materializacao: v.object({
    monitoramento: EtapaAreaSchema,
    alertas: EtapaAreaSchema,
  }),
  areaEmExecucao: v.nullable(AREA_SCHEMA),
  ultimoErro: v.nullable(
    v.object({
      codigo: v.string(),
      area: v.nullable(AREA_SCHEMA),
      ocorridoEm: v.string(),
    }),
  ),
});

export const EstadoOrganizacoesSchema = v.object({
  versao: v.literal(1),
  organizacoes: v.array(OrganizacaoLocalSchema),
  ativa: v.nullable(
    v.object({
      organizacaoId: v.string(),
      area: AREA_SCHEMA,
    }),
  ),
});

/** Initial document (SPEC A §4.2): no organization, nothing active. */
export function criarEstadoInicialOrganizacoes(): EstadoOrganizacoes {
  return {
    versao: 1,
    organizacoes: [],
    ativa: null,
  };
}

/** An empty EtapaArea, before any creation attempt for that area. */
export function criarEtapaAreaAusente(): EtapaArea {
  return {
    etapa: 'ausente',
    projectId: null,
    template: null,
    idsAntesDaCriacao: null,
  };
}

/**
 * The operational projectId, DERIVED from the active selection (SPEC A §4.2
 * rule 5): looked up by organization id — never by index — and only when the
 * referenced organization is ready, acknowledged and holds a project in the
 * selected area. Anything else (no selection, missing organization, partial
 * link, pending confirmation) yields null: a fall back to "the first project
 * of the core" is never authorized.
 */
export function derivarProjectIdAtivo(
  estado: EstadoOrganizacoes,
): string | null {
  if (!parseEstadoOrganizacoes(estado)) return null;
  const {ativa} = estado;
  if (!ativa) return null;

  const organizacao = estado.organizacoes.find(
    candidata => candidata.id === ativa.organizacaoId,
  );
  if (!organizacao) return null;
  if (organizacao.estado !== 'pronta') return null;
  if (organizacao.confirmacaoPendente) return null;

  return organizacao.materializacao[ativa.area].projectId;
}

/**
 * Parses a persisted document, rejecting anything that does not satisfy the
 * §4.2 shape — a corrupt or foreign payload must never be rehydrated as the
 * organizational source of truth.
 */
export function parseEstadoOrganizacoes(
  candidate: unknown,
): EstadoOrganizacoes | null {
  const result = v.safeParse(EstadoOrganizacoesSchema, candidate);
  if (!result.success) return null;
  const state = result.output;
  const ids = new Set<string>();
  const projects = new Set<string>();
  for (const org of state.organizacoes) {
    if (
      !org.id ||
      ids.has(org.id) ||
      !org.nome.trim() ||
      org.nome !== org.nome.trim()
    )
      return null;
    ids.add(org.id);
    if (org.estado !== 'pronta' && org.confirmacaoPendente) return null;
    for (const area of AREAS) {
      const step = org.materializacao[area];
      if (step.projectId !== null) {
        if (!step.projectId || projects.has(step.projectId)) return null;
        projects.add(step.projectId);
      }
      if (
        step.etapa === 'verificado' &&
        (!step.projectId || !step.template?.hash || !step.template.versao)
      )
        return null;
      if (org.estado === 'pronta' && step.etapa !== 'verificado') return null;
    }
    if (org.estado === 'pronta' && org.areaEmExecucao !== null) return null;
  }
  if ([...ids].some(id => projects.has(id))) return null;
  // Stale selection is preserved for explicit recovery, never reassigned.
  return state;
}
