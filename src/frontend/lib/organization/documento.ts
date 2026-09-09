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
export type OrganizacaoLocal = {
  id: string;
  nome: string;
  estado: 'preparando' | 'falha_recuperavel' | 'pronta';
  confirmacaoPendente: boolean;
  materializacao: Record<Area, EtapaArea>;
  areaEmExecucao: Area | null;
  ultimoErro: null | {codigo: string; area: Area | null; ocorridoEm: string};
};
export type EstadoOrganizacoes = {
  versao: 1;
  organizacoes: OrganizacaoLocal[];
  ativa: null | {organizacaoId: string; area: Area};
};
export function documentoInicial(): EstadoOrganizacoes {
  return {versao: 1, organizacoes: [], ativa: null};
}
