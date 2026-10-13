import {useActiveProject} from '../contexts/ActiveProjectContext';
import {useCoiabOrganizationsState} from '../contexts/CoiabOrganizationsStoreContext';
import {
  derivarProjectIdAtivo,
  type OrganizacaoLocal,
} from '../lib/organization/coiabOrganizations';

/**
 * SPEC A §4.2 regra 5: the operational projectId is DERIVED from the
 * persisted document, and SPEC B §3.3 item 4 names the organization only in
 * that state. `derivarProjectIdAtivo` embeds the whole gate — parseable
 * document, existing organization, `pronta`, `!confirmacaoPendente` and the
 * slot of `ativa.area` — so comparing its result with the active projectId
 * keeps the organization named only when the app is operating it: any switch
 * of the active project (LeaveProject, a create/accept repoint) makes the
 * derivation diverge and the project name stands. `ativa` is born only in the
 * single write of the "Abrir organização" tap (regra 9), so without a
 * selection nothing names an organization.
 */
export function useOrganizacaoAtiva(): OrganizacaoLocal | undefined {
  const {projectId} = useActiveProject();
  const estado = useCoiabOrganizationsState();

  const derivado = derivarProjectIdAtivo(estado);
  return derivado !== null && derivado === projectId
    ? estado.organizacoes.find(
        organizacao => organizacao.id === estado.ativa?.organizacaoId,
      )
    : undefined;
}
