import * as React from 'react';
import {createContext, ReactNode, useContext} from 'react';

import {useActiveProjectIdActions} from './ActiveProjectIdStoreContext';
import {
  useOrganizationActivation,
  type OrganizationActivationHandle,
} from '../hooks/organization/useOrganizationActivation';

/**
 * The organization activation engine, mounted once at the root (SPEC A §5.2):
 * the provider builds the engine and drives the persisted selection on
 * startup, so any consumer that needs activation state shares this one engine
 * instead of building its own.
 */
const OrganizationActivationContext =
  createContext<OrganizationActivationHandle | null>(null);

export const OrganizationActivationProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const activation = useOrganizationActivation();
  // The legacy `activeProjectId` is a PROJECTION of the engine's published
  // selection (SPEC B §5.3 :207), never an input. The projection is keyed on
  // the engine's `generation`: only a NEW generation (a fresh activation
  // that revalidated both areas) may write it, so the provider never fights
  // the other writers (the startup fallback, the navigation flows) and
  // never re-projects the same publication twice — a blocked switch that
  // republishes the validated snapshot keeps the same generation and is
  // dropped here.
  const {setActiveProjectId} = useActiveProjectIdActions();
  const projectedGeneration = React.useRef(Number.NaN);
  const {status, projectId, generation} = activation;
  React.useEffect(() => {
    if (status !== 'ready' || !projectId) return;
    if (projectedGeneration.current === generation) return;
    projectedGeneration.current = generation;
    setActiveProjectId(projectId);
  }, [status, projectId, generation, setActiveProjectId]);

  return (
    <OrganizationActivationContext value={activation}>
      {children}
    </OrganizationActivationContext>
  );
};

export function useOrganizationActivationContext() {
  const value = useContext(OrganizationActivationContext);

  if (!value) {
    throw new Error('Must set up the OrganizationActivationContext');
  }

  return value;
}
