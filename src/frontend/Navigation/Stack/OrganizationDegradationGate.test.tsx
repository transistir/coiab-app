import {render} from '@testing-library/react-native';
import React from 'react';

import {OrganizationDegradationGate, type OrgGateStatus} from './index';

/**
 * The runtime degradation gate unit-tested at its own seam: the component
 * takes plain `state`/`navigation`/`enabled` props, so the transition
 * bookkeeping (F2) and the degraded-active routing trigger (F1) are
 * verifiable without mounting the whole navigator. The navigator-level
 * evidence for F1 lives in index.navigator.test.tsx.
 */

type GateProps = {
  enabled: boolean;
  orgStatus: OrgGateStatus;
  activeProjectDegraded?: boolean;
  /** The route the navigator currently sits on. */
  routeName?: string;
};

function stateOn(routeName: string) {
  return {routes: [{name: routeName, key: `${routeName}-1`}], index: 0};
}

async function renderGate(props: GateProps) {
  const navigation = {reset: jest.fn()};
  const element = (next: GateProps) => {
    const routeName = next.routeName ?? 'Home';
    return (
      <OrganizationDegradationGate
        state={stateOn(routeName) as never}
        navigation={navigation as never}
        orgStatus={next.orgStatus}
        enabled={next.enabled}
        activeProjectDegraded={next.activeProjectDegraded ?? false}
      />
    );
  };
  const view = await render(element(props));
  return {
    navigation,
    rerender: async (next: GateProps) => {
      await view.rerender(element(next));
    },
  };
}

describe('OrganizationDegradationGate: ready→provisioning transition (F2)', () => {
  test('a transition observed while enabled resets to OrganizationProvisioning', async () => {
    const gate = await renderGate({enabled: true, orgStatus: 'ready'});

    await gate.rerender({enabled: true, orgStatus: 'provisioning'});

    expect(gate.navigation.reset).toHaveBeenCalledWith({
      index: 0,
      routes: [{name: 'OrganizationProvisioning'}],
    });
  });

  test('a transition observed while DISABLED is not consumed: it re-fires when enabled returns', async () => {
    // F2 (senior P1-1): the ref used to advance before the `enabled`
    // guard, so a ready→provisioning transition observed while disabled
    // was swallowed and lost. The previous value must be PRESERVED while
    // disabled so the transition re-fires on the next enabled render.
    const gate = await renderGate({enabled: false, orgStatus: 'ready'});

    // The degradation happens entirely inside the disabled window.
    await gate.rerender({enabled: false, orgStatus: 'provisioning'});
    expect(gate.navigation.reset).not.toHaveBeenCalled();

    // Enabled returns with the device still degraded: the pending
    // transition must fire now, not be lost.
    await gate.rerender({enabled: true, orgStatus: 'provisioning'});
    expect(gate.navigation.reset).toHaveBeenCalledWith({
      index: 0,
      routes: [{name: 'OrganizationProvisioning'}],
    });
  });

  test('no transition while enabled never resets', async () => {
    const gate = await renderGate({enabled: true, orgStatus: 'ready'});

    await gate.rerender({enabled: true, orgStatus: 'ready'});
    await gate.rerender({enabled: true, orgStatus: 'none'});

    expect(gate.navigation.reset).not.toHaveBeenCalled();
  });

  test('a transition onto the provisioning screen itself does not reset', async () => {
    const gate = await renderGate({
      enabled: true,
      orgStatus: 'ready',
      routeName: 'OrganizationProvisioning',
    });

    await gate.rerender({
      enabled: true,
      orgStatus: 'provisioning',
      routeName: 'OrganizationProvisioning',
    });

    expect(gate.navigation.reset).not.toHaveBeenCalled();
  });
});

describe('OrganizationDegradationGate: degraded active project routing (F1)', () => {
  test('a degraded active project while another organization is ready resets to OrganizationProvisioning', async () => {
    const gate = await renderGate({enabled: true, orgStatus: 'ready'});

    await gate.rerender({
      enabled: true,
      orgStatus: 'ready',
      activeProjectDegraded: true,
    });

    expect(gate.navigation.reset).toHaveBeenCalledWith({
      index: 0,
      routes: [{name: 'OrganizationProvisioning'}],
    });
  });

  test('mounting already degraded (cold start into the mixed state) routes once', async () => {
    // The device can MOUNT in the degraded state (the degradation
    // happened before the navigator mounted); the routing must fire for
    // it too, not only for transitions observed at runtime.
    const gate = await renderGate({
      enabled: true,
      orgStatus: 'ready',
      activeProjectDegraded: true,
    });

    expect(gate.navigation.reset).toHaveBeenCalledWith({
      index: 0,
      routes: [{name: 'OrganizationProvisioning'}],
    });
  });

  test('a degraded signal observed while DISABLED is not consumed: it re-fires when enabled returns', async () => {
    const gate = await renderGate({enabled: false, orgStatus: 'ready'});

    await gate.rerender({
      enabled: false,
      orgStatus: 'ready',
      activeProjectDegraded: true,
    });
    expect(gate.navigation.reset).not.toHaveBeenCalled();

    await gate.rerender({
      enabled: true,
      orgStatus: 'ready',
      activeProjectDegraded: true,
    });
    expect(gate.navigation.reset).toHaveBeenCalledWith({
      index: 0,
      routes: [{name: 'OrganizationProvisioning'}],
    });
  });

  test('the degraded routing fires once, not on every render while the state persists', async () => {
    const gate = await renderGate({enabled: true, orgStatus: 'ready'});

    await gate.rerender({
      enabled: true,
      orgStatus: 'ready',
      activeProjectDegraded: true,
    });
    await gate.rerender({
      enabled: true,
      orgStatus: 'ready',
      activeProjectDegraded: true,
    });
    await gate.rerender({
      enabled: true,
      orgStatus: 'ready',
      activeProjectDegraded: true,
    });

    expect(gate.navigation.reset).toHaveBeenCalledTimes(1);
  });

  test('a degraded signal does not reset onto the provisioning screen itself', async () => {
    const gate = await renderGate({
      enabled: true,
      orgStatus: 'ready',
      routeName: 'OrganizationProvisioning',
    });

    await gate.rerender({
      enabled: true,
      orgStatus: 'ready',
      activeProjectDegraded: true,
      routeName: 'OrganizationProvisioning',
    });

    expect(gate.navigation.reset).not.toHaveBeenCalled();
  });
});
