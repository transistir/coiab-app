import * as React from 'react';
import {render, waitFor} from '@testing-library/react-native';

import {createAppProvidersWrapper} from '../../tests/integration/helpers/react';
import {
  semearDocumentoPronta,
  setupIntegrationTest,
} from '../../tests/integration/helpers/setupIntegrationTest';
import {
  COIAB_ORGANIZATIONS_STORAGE_KEY,
  useCoiabOrganizationsState,
} from '../../src/frontend/contexts/CoiabOrganizationsStoreContext';
import {useOrganizationActivationContext} from '../../src/frontend/contexts/OrganizationActivationContext';
import {MMKVStoreInitializer} from '../../src/frontend/hooks/persistedState/createPersistedState';
import {
  criarEstadoInicialOrganizacoes,
  type EstadoOrganizacoes,
} from '../../src/frontend/lib/organization/coiabOrganizations';
import {
  FLOW_STATES,
  useFlowState,
  type FlowStateSpec,
  type ResolvedFlowState,
} from './flowState';
import {MISSING_PROJECT_ID, ORPHANED_ORGANIZATION_ID} from './seedData';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The order dependency between capture rows, pinned.
 *
 * A capture run is one app process switching stories, so `useFlowState`'s
 * cleanup is the only thing standing between two rows. That cleanup is
 * deliberately HALF a cleanup: a spec that does not seed a persisted
 * organization writes the initial document back through the production
 * repository (`flowState.ts`), but the root activation engine —
 * `OrganizationActivationProvider`, built once above Storybook and
 * `initialize()`d once (`hooks/organization/useOrganizationActivation.ts`) —
 * keeps the organization it opened, with its `projectId` and `generation`.
 *
 * It stays half a cleanup on purpose, and the harness depends on the residue:
 * `flowState.ts` restores a document a previous row cleared by REVALIDATING
 * through that still-open engine, which publishes no new generation. Closing
 * the engine instead would send that path through a fresh `activate()`, and
 * `activate()` is refused whenever pending work exists
 * (`lib/organization/activation.ts`, the pending-work guard) — every
 * CreateObservation row that seeds a draft would start throwing. There is
 * also no way to close it from here: `revalidate()` is a strict no-op once
 * `ativa` is null, and `initialize()` is deliberately not on
 * `OrganizationActivationHandle`.
 *
 * So the contract is order, not isolation: a row that needs an open
 * organization must be preceded by a row that opened one. This test is what
 * makes that explicit — it fails if the engine ever starts being reset
 * between stories, so whoever changes it has to revisit the draft rows and
 * the manifest order with it.
 *
 * The unopenable rows (`organizations.unopenable`) add the other half of the
 * order: they leave the engine in RECOVERY, and nothing in the harness takes
 * it out of there but the next row that seeds a healthy organization, which
 * opens it through a fresh `activate()`. That activation is refused while
 * pending work exists, so a recovery row is only followed by rows that clear
 * the draft first (`draftObservation: 'none'`) — and the manifest keeps them
 * last.
 */

type Probe = {
  ready: ResolvedFlowState | null;
  status: string;
  projectId?: string;
  generation: number;
  organizationCount: number;
  ativa: unknown;
  document: EstadoOrganizacoes;
};

let probe: Probe | undefined;
/** Every engine status the probe rendered, consecutive repeats collapsed. */
let statuses: string[] = [];

function FlowStateProbe({spec}: {spec: FlowStateSpec}) {
  const ready = useFlowState(spec);
  const {status, projectId, generation} = useOrganizationActivationContext();
  const document = useCoiabOrganizationsState();
  probe = {
    ready,
    status,
    projectId,
    generation,
    organizationCount: document.organizacoes.length,
    ativa: document.ativa,
    document,
  };
  if (statuses.at(-1) !== status) statuses.push(status);
  return null;
}

function currentProbe(): Probe {
  if (!probe) throw new Error('the flow-state probe never rendered');
  return probe;
}

const ORGANIZATION_A_ID = 'aaaaaaaaaaaaaaaa';
const ORGANIZATION_B_ID = 'bbbbbbbbbbbbbbbb';

/**
 * The persisted document a fresh install hydrates. The MMKV mock outlives
 * each test's providers, so without it the engine would boot on whatever
 * document the previous test left.
 */
function semearDocumentoInicial() {
  MMKVStoreInitializer.setItem(
    COIAB_ORGANIZATIONS_STORAGE_KEY,
    JSON.stringify({state: criarEstadoInicialOrganizacoes(), version: 1}),
  );
}

function alertasProjectId(document: EstadoOrganizacoes, organizacaoId: string) {
  return document.organizacoes.find(({id}) => id === organizacaoId)
    ?.materializacao.alertas.projectId;
}

describe('flow-state cleanup between stories', () => {
  const orgSetup = setupIntegrationTest();

  beforeEach(() => {
    probe = undefined;
    statuses = [];
  });

  test('the cleanup returns the document to its initial state and leaves the root engine holding the organization', async () => {
    semearDocumentoPronta(
      orgSetup.projectId,
      orgSetup.alertasProjectId,
      orgSetup.orgId,
      orgSetup.orgName,
    );
    const appProviders = createAppProvidersWrapper({
      mapeoApi: orgSetup.client,
      activeProjectId: orgSetup.projectId,
    });
    // Row 10's spec: the first manifest row that seeds the persisted
    // organization.
    const view = await render(
      <FlowStateProbe spec={FLOW_STATES.namedWithOrganization} />,
      {wrapper: appProviders.wrapper},
    );

    try {
      await waitFor(() => expect(currentProbe().ready).not.toBeNull(), {
        timeout: 30_000,
      });
      const opened = currentProbe();
      const organizationKey = opened.ready!.key;
      expect(opened.status).toBe('ready');
      expect(opened.projectId).toBe(orgSetup.projectId);
      expect(opened.organizationCount).toBe(1);
      // A real opening, so "the generation never moved" below is a claim
      // about an engine that actually activated something.
      expect(opened.generation).toBeGreaterThan(0);

      // The next story's spec names no organization, so the cleanup runs.
      await view.rerender(<FlowStateProbe spec={FLOW_STATES.namedNoProject} />);
      await waitFor(
        () => {
          const current = currentProbe();
          expect(current.ready).not.toBeNull();
          expect(current.ready!.key).not.toBe(organizationKey);
        },
        {timeout: 30_000},
      );

      const cleaned = currentProbe();
      // The document is back to `criarEstadoInicialOrganizacoes()`...
      expect(cleaned.organizationCount).toBe(0);
      expect(cleaned.ativa).toBeNull();
      // ...and the root engine is not: it still holds the opened
      // organization, at the generation it published when it opened it.
      expect(cleaned.status).toBe('ready');
      expect(cleaned.projectId).toBe(opened.projectId);
      expect(cleaned.generation).toBe(opened.generation);

      // Which is what lets the organization rows recover: the restored
      // document is revalidated through the engine that never closed, and a
      // revalidation publishes no new generation. An engine reset between
      // stories would make this a fresh activation instead, and every
      // generation assertion here would move.
      await view.rerender(
        <FlowStateProbe spec={FLOW_STATES.namedWithOrganization} />,
      );
      await waitFor(
        () => expect(currentProbe().ready?.key).toBe(organizationKey),
        {timeout: 30_000},
      );

      const reopened = currentProbe();
      expect(reopened.status).toBe('ready');
      expect(reopened.projectId).toBe(orgSetup.projectId);
      expect(reopened.organizationCount).toBe(1);
      expect(reopened.generation).toBe(opened.generation);
    } finally {
      await view.unmount();
      await appProviders.teardown();
    }
  }, 120_000);

  test('a story that opens another organization over an open one reaches it', async () => {
    // Rows 04 → 05 of the capture manifest: the root engine is still `ready`
    // on the singular axis's organization when the plural axis selects B. A
    // seed that writes `ativa: B` itself makes the engine's activate(B) read
    // "already open" and return without opening B, and the flow never settles.
    const appProviders = createAppProvidersWrapper({
      mapeoApi: orgSetup.client,
    });
    const view = await render(
      <FlowStateProbe spec={FLOW_STATES.namedWithOrganization} />,
      {wrapper: appProviders.wrapper},
    );

    try {
      await waitFor(() => expect(currentProbe().ready).not.toBeNull(), {
        timeout: 30_000,
      });
      const first = currentProbe();
      expect(first.status).toBe('ready');

      await view.rerender(
        <FlowStateProbe spec={FLOW_STATES.twoOrganizationsEarlyAccess} />,
      );
      await waitFor(
        () => {
          const current = currentProbe();
          expect(current.ready).not.toBeNull();
          expect(current.ready!.key).not.toBe(first.ready!.key);
        },
        {timeout: 30_000},
      );

      const second = currentProbe();
      expect(second.organizationCount).toBe(2);
      expect(second.ativa).toEqual({
        organizacaoId: 'bbbbbbbbbbbbbbbb',
        area: 'monitoramento',
      });
      // B's Monitoramento, published by a real opening of B.
      expect(second.status).toBe('ready');
      expect(second.projectId).toBe(second.ready!.projectId);
      expect(second.projectId).not.toBe(first.projectId);
      expect(second.generation).toBeGreaterThan(first.generation);

      // Rows 06 and 07 follow in the same process: back to A alone, then A
      // open with B in preparation.
      await view.rerender(
        <FlowStateProbe spec={FLOW_STATES.oneOrganizationEarlyAccess} />,
      );
      await waitFor(
        () => {
          const current = currentProbe();
          expect(current.ready).not.toBeNull();
          expect(current.ready!.key).not.toBe(second.ready!.key);
        },
        {timeout: 30_000},
      );
      const third = currentProbe();
      expect(third.ativa).toEqual({
        organizacaoId: 'aaaaaaaaaaaaaaaa',
        area: 'monitoramento',
      });
      expect(third.status).toBe('ready');
      expect(third.projectId).toBe(third.ready!.projectId);
      expect(third.projectId).not.toBe(second.projectId);

      await view.rerender(
        <FlowStateProbe spec={FLOW_STATES.secondOrganizationPreparing} />,
      );
      await waitFor(
        () => {
          const current = currentProbe();
          expect(current.ready).not.toBeNull();
          expect(current.ready!.key).not.toBe(third.ready!.key);
        },
        {timeout: 30_000},
      );
      const fourth = currentProbe();
      expect(fourth.organizationCount).toBe(2);
      expect(fourth.ativa).toEqual({
        organizacaoId: 'aaaaaaaaaaaaaaaa',
        area: 'monitoramento',
      });
      expect(fourth.projectId).toBe(third.projectId);
    } finally {
      await view.unmount();
      await appProviders.teardown();
    }
  }, 120_000);

  test('the plural axis seeds the persisted document, and the next story without one still cleans it', async () => {
    const appProviders = createAppProvidersWrapper({
      mapeoApi: orgSetup.client,
    });
    const view = await render(
      <FlowStateProbe spec={FLOW_STATES.twoOrganizationsEarlyAccess} />,
      {wrapper: appProviders.wrapper},
    );

    try {
      await waitFor(() => expect(currentProbe().ready).not.toBeNull(), {
        timeout: 30_000,
      });
      const opened = currentProbe();
      const organizationsKey = opened.ready!.key;
      // Written to the app's own store and opened by its root engine.
      expect(opened.organizationCount).toBe(2);
      expect(opened.ativa).toEqual({
        organizacaoId: 'bbbbbbbbbbbbbbbb',
        area: 'monitoramento',
      });
      expect(opened.status).toBe('ready');
      expect(opened.projectId).toBe(opened.ready!.projectId);

      await view.rerender(<FlowStateProbe spec={FLOW_STATES.namedNoProject} />);
      await waitFor(
        () => {
          const current = currentProbe();
          expect(current.ready).not.toBeNull();
          expect(current.ready!.key).not.toBe(organizationsKey);
        },
        {timeout: 30_000},
      );

      const cleaned = currentProbe();
      expect(cleaned.organizationCount).toBe(0);
      expect(cleaned.ativa).toBeNull();
    } finally {
      await view.unmount();
      await appProviders.teardown();
    }
  }, 120_000);

  test('an unopenable seed over an open organization lands the root engine in recovery through revalidate()', async () => {
    semearDocumentoInicial();
    const appProviders = createAppProvidersWrapper({
      mapeoApi: orgSetup.client,
    });
    const view = await render(
      <FlowStateProbe spec={FLOW_STATES.namedWithOrganization} />,
      {wrapper: appProviders.wrapper},
    );

    try {
      await waitFor(() => expect(currentProbe().ready).not.toBeNull(), {
        timeout: 30_000,
      });
      const opened = currentProbe();
      expect(opened.status).toBe('ready');
      expect(opened.generation).toBeGreaterThan(0);

      await view.rerender(
        <FlowStateProbe spec={FLOW_STATES.oneOrganizationUnavailable} />,
      );
      await waitFor(
        () => {
          const current = currentProbe();
          expect(current.ready).not.toBeNull();
          expect(current.ready!.key).not.toBe(opened.ready!.key);
        },
        {timeout: 30_000},
      );

      const unavailable = currentProbe();
      // The engine re-checked the selection it held open and lost it: the
      // recovery publication keeps the open context's generation and
      // projectId — no activation ran.
      expect(unavailable.status).toBe('recovery');
      expect(unavailable.generation).toBe(opened.generation);
      expect(unavailable.projectId).toBe(opened.projectId);
      expect(unavailable.document.ativa).toEqual({
        organizacaoId: ORGANIZATION_A_ID,
        area: 'monitoramento',
      });
      expect(alertasProjectId(unavailable.document, ORGANIZATION_A_ID)).toBe(
        MISSING_PROJECT_ID,
      );
      expect(unavailable.ready!.projectId).toBeUndefined();
      expect(unavailable.ready!.earlyAccess).toBe(false);
    } finally {
      await view.unmount();
      await appProviders.teardown();
    }
  }, 120_000);

  test('an unopenable seed on an engine that never opened one lands it in recovery through activate()', async () => {
    // A fresh install's empty document: the engine boots `absent`, so only
    // an activation can take it to recovery.
    semearDocumentoInicial();
    const appProviders = createAppProvidersWrapper({
      mapeoApi: orgSetup.client,
    });
    const view = await render(
      <FlowStateProbe spec={FLOW_STATES.twoOrganizationsUnavailable} />,
      {wrapper: appProviders.wrapper},
    );

    try {
      await waitFor(() => expect(currentProbe().ready).not.toBeNull(), {
        timeout: 30_000,
      });

      const unavailable = currentProbe();
      expect(unavailable.status).toBe('recovery');
      // `opening` is activate()'s own publication: a revalidation never
      // publishes it.
      expect(statuses.slice(-3)).toEqual(['absent', 'opening', 'recovery']);
      expect(unavailable.generation).toBe(0);
      expect(unavailable.projectId).toBeUndefined();
      expect(unavailable.document.ativa).toEqual({
        organizacaoId: ORGANIZATION_B_ID,
        area: 'monitoramento',
      });
      // Only the active organization is broken.
      expect(alertasProjectId(unavailable.document, ORGANIZATION_B_ID)).toBe(
        MISSING_PROJECT_ID,
      );
      expect(
        alertasProjectId(unavailable.document, ORGANIZATION_A_ID),
      ).not.toBe(MISSING_PROJECT_ID);
      expect(unavailable.ready!.projectId).toBeUndefined();
    } finally {
      await view.unmount();
      await appProviders.teardown();
    }
  }, 120_000);

  test('recovery rows follow one another on the engine in recovery, and the next healthy row reopens it', async () => {
    semearDocumentoInicial();
    const appProviders = createAppProvidersWrapper({
      mapeoApi: orgSetup.client,
    });
    const view = await render(
      <FlowStateProbe spec={FLOW_STATES.oneOrganizationUnavailable} />,
      {wrapper: appProviders.wrapper},
    );

    try {
      await waitFor(() => expect(currentProbe().ready).not.toBeNull(), {
        timeout: 30_000,
      });
      const one = currentProbe();
      expect(one.status).toBe('recovery');
      expect(one.document.organizacoes.map(({id}) => id)).toEqual([
        ORGANIZATION_A_ID,
      ]);
      expect(one.document.ativa).toEqual({
        organizacaoId: ORGANIZATION_A_ID,
        area: 'monitoramento',
      });
      expect(alertasProjectId(one.document, ORGANIZATION_A_ID)).toBe(
        MISSING_PROJECT_ID,
      );

      await view.rerender(
        <FlowStateProbe spec={FLOW_STATES.twoOrganizationsUnavailable} />,
      );
      await waitFor(
        () => {
          const current = currentProbe();
          expect(current.ready).not.toBeNull();
          expect(current.ready!.key).not.toBe(one.ready!.key);
        },
        {timeout: 30_000},
      );
      const two = currentProbe();
      expect(two.status).toBe('recovery');
      expect(two.generation).toBe(one.generation);
      expect(two.document.organizacoes.map(({id}) => id)).toEqual([
        ORGANIZATION_A_ID,
        ORGANIZATION_B_ID,
      ]);
      expect(two.document.ativa).toEqual({
        organizacaoId: ORGANIZATION_B_ID,
        area: 'monitoramento',
      });
      // The previous row's fault does not survive into this one.
      expect(alertasProjectId(two.document, ORGANIZATION_A_ID)).not.toBe(
        MISSING_PROJECT_ID,
      );
      expect(alertasProjectId(two.document, ORGANIZATION_B_ID)).toBe(
        MISSING_PROJECT_ID,
      );

      await view.rerender(
        <FlowStateProbe spec={FLOW_STATES.orphanedOrganizationSelection} />,
      );
      await waitFor(
        () => {
          const current = currentProbe();
          expect(current.ready).not.toBeNull();
          expect(current.ready!.key).not.toBe(two.ready!.key);
        },
        {timeout: 30_000},
      );
      const orphan = currentProbe();
      expect(orphan.status).toBe('recovery');
      expect(orphan.generation).toBe(one.generation);
      expect(orphan.document.organizacoes.map(({id}) => id)).toEqual([
        ORGANIZATION_A_ID,
        ORGANIZATION_B_ID,
      ]);
      expect(orphan.document.ativa).toEqual({
        organizacaoId: ORPHANED_ORGANIZATION_ID,
        area: 'monitoramento',
      });
      expect(
        orphan.document.organizacoes.map(({id}) =>
          alertasProjectId(orphan.document, id),
        ),
      ).not.toContain(MISSING_PROJECT_ID);

      // A healthy row after the recovery rows reopens the engine with a
      // fresh activation.
      await view.rerender(
        <FlowStateProbe spec={FLOW_STATES.oneOrganizationEarlyAccess} />,
      );
      await waitFor(
        () => {
          const current = currentProbe();
          expect(current.ready).not.toBeNull();
          expect(current.ready!.key).not.toBe(orphan.ready!.key);
        },
        {timeout: 30_000},
      );
      const reopened = currentProbe();
      expect(reopened.status).toBe('ready');
      expect(reopened.generation).toBeGreaterThan(orphan.generation);
      expect(reopened.projectId).toBe(reopened.ready!.projectId);
      expect(reopened.document.ativa).toEqual({
        organizacaoId: ORGANIZATION_A_ID,
        area: 'monitoramento',
      });

      await view.rerender(<FlowStateProbe spec={FLOW_STATES.namedNoProject} />);
      await waitFor(
        () => {
          const current = currentProbe();
          expect(current.ready).not.toBeNull();
          expect(current.ready!.key).not.toBe(reopened.ready!.key);
        },
        {timeout: 30_000},
      );
      const cleaned = currentProbe();
      expect(cleaned.organizationCount).toBe(0);
      expect(cleaned.ativa).toBeNull();
    } finally {
      await view.unmount();
      await appProviders.teardown();
    }
  }, 180_000);
});
