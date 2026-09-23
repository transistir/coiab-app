/**
 * Story-scoped app stores for the `FlowStateSpec` axes that live in app
 * stores instead of the backend: `organizations` (the COIAB document) and
 * `earlyAccess`.
 *
 * The running app holds both as persisted singletons (`AppProviders` builds
 * the document store, `App.tsx` the early-access store, each with
 * `persist: true`), and every story shares that one running app. These two
 * axes are provided as a fresh, non-persisted instance of the same store,
 * around the story that asks for it and nothing else, so what they seed
 * cannot reach a later story or the next app boot — and a document with an
 * open organization even changes which screen set `RootStackNavigator`
 * registers. With neither axis set, `FlowStateScope` renders its children
 * untouched.
 *
 * Scoping is not the harness's only way of seeding a document, and the
 * persisted store is not off limits: the `organization` axis deliberately
 * writes it (`flowState.ts`), because the app's own root activation engine
 * reads that store and no other. What keeps that seed from outliving its
 * story is the cleanup in `flowState.ts` — a story whose spec seeds no
 * persisted organization writes the initial document back before it
 * resolves. That cleanup returns the document but not the root engine; see
 * `flowStateCleanup.test.tsx` for the order contract that follows.
 *
 * The organization scope mirrors the organization half of `AppProviders`
 * (document → materializer → activation engine), so the navigator, the drawer
 * and the selector inside the story all read one engine, bound to the story's
 * document. It restores the seeded selection on mount as a cold start does,
 * checking the device's role in both of the active organization's projects.
 */
import * as React from 'react';

import {
  CoiabOrganizationsStoreProvider,
  createCoiabOrganizationsStore,
} from '../../src/frontend/contexts/CoiabOrganizationsStoreContext';
import {
  EarlyAccessStoreProvider,
  createEarlyAccessStore,
} from '../../src/frontend/contexts/EarlyAccessContext';
import {
  OrganizationActivationProvider,
  useOrganizationActivationContext,
} from '../../src/frontend/contexts/OrganizationActivationContext';
import {OrganizationMaterializerProvider} from '../../src/frontend/contexts/OrganizationMaterializerContext';
import type {EstadoOrganizacoes} from '../../src/frontend/lib/organization/coiabOrganizations';
import type {ResolvedFlowState} from './flowState';

type FlowStateScopeProps = {
  resolved: ResolvedFlowState;
  /** Shown while the scoped engine is still opening the organization. */
  fallback: React.ReactNode;
  children: React.ReactNode;
};

export function FlowStateScope({
  resolved,
  fallback,
  children,
}: FlowStateScopeProps) {
  let scoped = children;
  if (resolved.organizationDocument) {
    scoped = (
      <OrganizationScope
        document={resolved.organizationDocument}
        fallback={fallback}>
        {scoped}
      </OrganizationScope>
    );
  }
  if (resolved.earlyAccess !== undefined) {
    scoped = (
      <EarlyAccessScope enabled={resolved.earlyAccess}>
        {scoped}
      </EarlyAccessScope>
    );
  }
  return <>{scoped}</>;
}

function EarlyAccessScope({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  const [store] = React.useState(() => {
    const earlyAccessStore = createEarlyAccessStore();
    earlyAccessStore.actions.setEarlyAccessEnabled(enabled);
    return earlyAccessStore;
  });

  return (
    <EarlyAccessStoreProvider value={store}>
      {children}
    </EarlyAccessStoreProvider>
  );
}

function OrganizationScope({
  document,
  fallback,
  children,
}: {
  document: EstadoOrganizacoes;
  fallback: React.ReactNode;
  children: React.ReactNode;
}) {
  const [store] = React.useState(() => {
    const organizationsStore = createCoiabOrganizationsStore();
    organizationsStore.instance.setState(document, true);
    return organizationsStore;
  });

  return (
    <CoiabOrganizationsStoreProvider store={store}>
      <OrganizationMaterializerProvider>
        <OrganizationActivationProvider>
          <OpeningGate fallback={fallback}>{children}</OpeningGate>
        </OrganizationActivationProvider>
      </OrganizationMaterializerProvider>
    </CoiabOrganizationsStoreProvider>
  );
}

/**
 * Holds the story on `fallback` through the engine's cold-start opening —
 * the window `RootStackNavigator` would otherwise cover with its own loader,
 * inside an already-mounted `NavigationContainer` — so the story's navigator
 * mounts once, on the opened organization. Generation 0 only: a switch
 * started inside the story (generation ≥ 1) must reach the selector's own
 * "Opening organization…" state, not unmount the navigator.
 */
function OpeningGate({
  fallback,
  children,
}: {
  fallback: React.ReactNode;
  children: React.ReactNode;
}) {
  const {status, generation} = useOrganizationActivationContext();
  const opening =
    generation === 0 && (status === 'loading' || status === 'opening');

  return <>{opening ? fallback : children}</>;
}
