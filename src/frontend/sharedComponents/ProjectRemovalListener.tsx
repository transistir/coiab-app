import * as React from 'react';
import {
  useProjectOwnRoleChangeListener,
  useSingleProject,
} from '@comapeo/core-react';
import {useCoiabOrganizationsState} from '../contexts/CoiabOrganizationsStoreContext';
import {useOrganizationActivationContext} from '../contexts/OrganizationActivationContext';

/**
 * Fase 11b (SPEC A §5.3 "A verificação deve observar ambos os projetos"): the
 * motor reacts to role changes. The listener registers for BOTH materialized
 * projects of the organization the document selects — the old listener
 * watched only the projected active id, so a revocation in the non-selected
 * area was never observed and the context stayed 'ready' against a broken
 * pair. Any own-role change hands the decision to the engine
 * (`activation.revalidate()`): a healthy re-check publishes nothing, a lost
 * access publishes the recovery, and the navigator's generation gate owns
 * the routing — no navigation and no active-id write from this component.
 */
export const ProjectRemovalListener = () => {
  const estadoOrganizacoes = useCoiabOrganizationsState();
  const {ativa} = estadoOrganizacoes;
  const organizacaoAtiva = ativa
    ? estadoOrganizacoes.organizacoes.find(
        item => item.id === ativa.organizacaoId,
      )
    : undefined;
  return (
    <>
      {organizacaoAtiva?.materializacao.monitoramento.projectId && (
        <SlotRoleListener
          projectId={organizacaoAtiva.materializacao.monitoramento.projectId}
        />
      )}
      {organizacaoAtiva?.materializacao.alertas.projectId && (
        <SlotRoleListener
          projectId={organizacaoAtiva.materializacao.alertas.projectId}
        />
      )}
    </>
  );
};

/**
 * One registered listener per slot. `useProjectOwnRoleChangeListener` is the
 * core-react contract that keeps the project's role-related read hooks
 * updating on background role events; the project API's `own-role-change`
 * event carries the change to the engine. The listener is attached only
 * while the engine has an OPEN context: during `loading`/`opening` an
 * activation owns the engine and no change is dispatched, and with no
 * active organization there is no slot to watch.
 */
const SlotRoleListener = ({projectId}: {projectId: string}) => {
  const {status, revalidate} = useOrganizationActivationContext();
  useProjectOwnRoleChangeListener({projectId});
  const {data: projectApi} = useSingleProject({projectId});
  // A leave emits a BURST of role events; each refused revalidate publishes
  // `operation-in-progress` and re-renders every consumer mid-flight. The
  // engine owns every decision, so one unsettled dispatch is enough: the
  // burst is compacted to a single revalidation (V7 diagnostic).
  const despachandoRef = React.useRef(false);
  React.useEffect(() => {
    if (status !== 'ready') return;
    function handleRoleChange() {
      if (despachandoRef.current) return;
      despachandoRef.current = true;
      void revalidate().finally(() => {
        despachandoRef.current = false;
      });
    }
    projectApi.addListener('own-role-change', handleRoleChange);
    return () => {
      despachandoRef.current = false;
      projectApi.removeListener('own-role-change', handleRoleChange);
    };
  }, [projectApi, status, revalidate]);
  return null;
};
