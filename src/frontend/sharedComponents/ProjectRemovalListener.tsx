import * as React from 'react';
import {CommonActions, useNavigation} from '@react-navigation/native';
import {
  useProjectOwnRoleChangeListener,
  useSingleProject,
} from '@comapeo/core-react';
import type {RoleChangeEvent} from '@comapeo/core';
import {BLOCKED_ROLE_ID} from '../sharedTypes';
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
 * the routing. The one navigation here is the removal explanation (a
 * blocked role, review fronteira P2-3); the active id is never written.
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
  const navigation = useNavigation();
  useProjectOwnRoleChangeListener({projectId});
  const {data: projectApi} = useSingleProject({projectId});
  // A leave emits a BURST of role events; each refused revalidate publishes
  // `operation-in-progress` and re-renders every consumer mid-flight. The
  // engine owns every decision, so one unsettled dispatch is enough: the
  // burst is compacted to a single revalidation (V7 diagnostic).
  const despachandoRef = React.useRef(false);
  React.useEffect(() => {
    if (status !== 'ready') return;
    function handleRoleChange(event: RoleChangeEvent) {
      // Review fronteira P2-3: a removal (blocked role) is explained, not
      // just recovered from. The sheet is presented over the provisioning
      // surface BEFORE the engine publishes the loss — both routes are
      // projectless, so the generation gate's recovery rule keeps them —
      // and names the removed slot itself, which may be the unselected one.
      // Full-state reset with fresh keys (see OrganizationInviteReceived): a
      // partial `{index, routes}` is overwritten by the removed Home route's
      // nested-navigator cleanup. The provisioning surface holds its own
      // Home reset while the sheet sits above it (review fronteira P2-3).
      const estadoAtual = navigation.getState();
      if (
        event.role.roleId === BLOCKED_ROLE_ID &&
        estadoAtual &&
        estadoAtual.routes.at(-1)?.name !== 'RemovedFromProjectBottomSheet'
      ) {
        const sufixo = Date.now().toString(36);
        navigation.dispatch(
          CommonActions.reset({
            ...estadoAtual,
            index: 1,
            routes: [
              {
                key: `OrganizationProvisioning-${sufixo}`,
                name: 'OrganizationProvisioning',
              },
              {
                key: `RemovedFromProjectBottomSheet-${sufixo}`,
                name: 'RemovedFromProjectBottomSheet',
                params: {projectId},
              },
            ],
          }),
        );
      }
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
  }, [projectApi, status, revalidate, navigation, projectId]);
  return null;
};
