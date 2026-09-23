/**
 * Story-scoped app store for the `FlowStateSpec` axis that lives in an app
 * store instead of the backend and must not outlive its story: `earlyAccess`.
 *
 * The running app holds the flag as a persisted singleton (`App.tsx` builds
 * the early-access store with `persist: true`), and every story shares that
 * one running app. The axis is provided as a fresh, non-persisted instance of
 * the same store, around the story that asks for it and nothing else, so what
 * it seeds cannot reach a later story or the next app boot. Without the axis,
 * `FlowStateScope` renders its children untouched.
 *
 * The organization axes are not scoped: `organization` and `organizations`
 * both write the app's persisted COIAB document (`flowState.ts`), because the
 * app's own root activation engine reads that store and no other — the same
 * path production hydrates. What keeps that seed from outliving its story is
 * the cleanup in `flowState.ts` — a story whose spec seeds no persisted
 * organization writes the initial document back before it resolves. That
 * cleanup returns the document but not the root engine; see
 * `flowStateCleanup.test.tsx` for the order contract that follows.
 */
import * as React from 'react';

import {
  EarlyAccessStoreProvider,
  createEarlyAccessStore,
} from '../../src/frontend/contexts/EarlyAccessContext';
import type {ResolvedFlowState} from './flowState';

type FlowStateScopeProps = {
  resolved: ResolvedFlowState;
  children: React.ReactNode;
};

export function FlowStateScope({resolved, children}: FlowStateScopeProps) {
  if (resolved.earlyAccess === undefined) return <>{children}</>;
  return (
    <EarlyAccessScope enabled={resolved.earlyAccess}>
      {children}
    </EarlyAccessScope>
  );
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
