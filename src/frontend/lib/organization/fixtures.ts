import type {EstadoOrganizacoes, OrganizacaoLocal} from './coiabOrganizations';

/** Explicit pairs for organization-layer tests; never inferred from names. */
export function readyOrganization(id = 'A'): OrganizacaoLocal {
  return {
    id,
    nome: `Organização ${id}`,
    estado: 'pronta',
    confirmacaoPendente: false,
    materializacao: {
      monitoramento: {
        etapa: 'verificado',
        projectId: `${id}-m`,
        template: {versao: '1', hash: 'monitoramento'},
        idsAntesDaCriacao: null,
      },
      alertas: {
        etapa: 'verificado',
        projectId: `${id}-a`,
        template: {versao: '1', hash: 'alertas'},
        idsAntesDaCriacao: null,
      },
    },
    areaEmExecucao: null,
    ultimoErro: null,
  };
}

export function organizationDocument(): EstadoOrganizacoes {
  return {
    versao: 1,
    organizacoes: [readyOrganization('A'), readyOrganization('B')],
    ativa: {organizacaoId: 'A', area: 'alertas'},
  };
}
