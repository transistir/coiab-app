import {createContext, ReactNode, useContext} from 'react';

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
