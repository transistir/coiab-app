import {userEvent, screen} from '@testing-library/react-native';
import {
  setupIntegrationTest,
  setupIntegrationTestWithoutProject,
} from '../../../../tests/integration/helpers/setupIntegrationTest';
import {randomBytes} from 'node:crypto';
import {MEMBER_ROLE_ID} from '../../sharedTypes';
import {connectPeers} from '../../../../tests/integration/helpers/core';
import {parseMarker} from '../../lib/organization/marker';
import {MMKVStoreInitializer} from '../../hooks/persistedState/createPersistedState';
import {COIAB_ORGANIZATIONS_STORAGE_KEY} from '../../contexts/CoiabOrganizationsStoreContext';
import type {EstadoOrganizacoes} from '../../lib/organization/coiabOrganizations';

/**
 * The RAW persisted document, exactly as the store writes it: the durable
 * COIAB document is asserted from the disk-level truth, not from any
 * subscribed store view (same observation as index.navigator.test.tsx).
 */
function documentoPersistido(): EstadoOrganizacoes {
  const raw = MMKVStoreInitializer.getItem(COIAB_ORGANIZATIONS_STORAGE_KEY);
  if (typeof raw !== 'string') throw new Error('documento ausente');
  return JSON.parse(raw).state;
}

describe('Onboarding Screens', () => {
  const inviteeSetup = setupIntegrationTestWithoutProject();
  const invitorSetup = setupIntegrationTest();

  // Real navigators and real core peers end-to-end: two managers, invite
  // sync, two invite.accept IPC calls, reconstruction, query invalidations
  // and the engine's verification attempt — the whole path legitimately
  // runs past jest's 5000ms default test timeout on this 2-core/3.8GB box
  // (the old destination made the 5000ms cap fire). The 45000ms budget
  // only bounds the wait: if the provisioning surface never appears, the
  // waitFor below fails and this test still fails.
  test('should show the org fork, receive the organization invite bundle, and accept it', async () => {
    const user = userEvent.setup();
    await inviteeSetup.renderNavigationAsync();
    // SPEC E6: the Success fork is organization-first — joining an
    // Organization is a waiting state until an invite bundle arrives.
    const JoinOrgButton = await screen.findByText('Join an Organization');
    expect(JoinOrgButton).toBeVisible();
    await user.press(JoinOrgButton);
    expect(
      await screen.findByText(
        'Ask a coordinator of an existing Organization to invite this device. When the invitation arrives it will appear on this screen.',
      ),
    ).toBeVisible();

    await connectPeers([inviteeSetup.manager, invitorSetup.manager]);

    const invitorProject = await invitorSetup.client.getProject(
      invitorSetup.projectId,
    );
    const invitorAlertas = await invitorSetup.client.getProject(
      invitorSetup.alertasProjectId,
    );

    const inviteId = randomBytes(32);

    // Don't await — resolves only when invitee accepts/rejects, which happens via the UI being tested below.
    void invitorProject.$member.invite(inviteeSetup.manager.deviceId, {
      roleId: MEMBER_ROLE_ID,
      __testOnlyInviteId: inviteId,
    });
    // P5 (SPEC 7.4): the two slots travel as separate invites — while only
    // one has arrived the surface stays on "Preparing invitation…", so BOTH
    // slots are invited before the single organization surface can offer the
    // one "Join Organization" action (SPEC 7.3/8.1).
    void invitorAlertas.$member.invite(inviteeSetup.manager.deviceId, {
      roleId: MEMBER_ROLE_ID,
    });

    // The single Organization surface — never one invite per project.
    expect(await screen.findByText('Test Org')).toBeVisible();
    const joinButton = await screen.findByTestId('ORG.invite-join-btn');
    expect(joinButton).toBeVisible();
    expect(screen.queryByText('Join')).not.toBeOnTheScreen();

    await user.press(joinButton);
    // 6b-ii: a REGISTERED accept no longer renders the joined-confirmation
    // sheet — it resets (not goBack) to OrganizationProvisioning, whose
    // document-driven view owns the flow from here (SPEC B §5.5). The
    // accept runs real core work (two invite.accept IPC calls, project
    // sync, listProjects/reconstruction, query invalidations) and the
    // engine's verification attempt — fired by the registration — then
    // settles that view's title: 'Organization created' when the joined
    // projects carry the imported package categories, the
    // recoverable-failure sentence otherwise (this fixture's invitor
    // projects carry none, so the failure sentence is the settled state).
    // The alternation covers the document-driven view's three titles —
    // each unique to OrganizationProvisioning in production code — so the
    // assertion is the surface, not the verdict; the 30000ms budget only
    // bounds the wait: if the provisioning surface never appears,
    // findByText fails and so does the test.
    expect(
      await screen.findByText(
        /Could not finish creating the organization\.|Organization created|Preparing your organization…/,
        undefined,
        {timeout: 30_000},
      ),
    ).toBeVisible();
    // The joined-confirmation sheet never renders for a registered accept.
    expect(
      screen.queryByText('You have joined Test Org'),
    ).not.toBeOnTheScreen();

    // Accepting invalidates the project/invite queries; let those refetches
    // settle so teardown doesn't close the IPC channel under an in-flight
    // call (RpcChannelClosed).
    await new Promise(resolve => setTimeout(resolve, 500));

    // P5 O6: the accept must leave the device holding EXACTLY the two
    // internal projects of the organization — Monitoramento (slot m) and
    // Alertas (slot a), both carrying the invitor's marker, none unnamed —
    // with the Monitoramento project active.
    const projects = await inviteeSetup.client.listProjects();
    expect(projects).toHaveLength(2);

    const markers = projects.map(project => ({
      project,
      marker: parseMarker(project.projectDescription ?? ''),
    }));
    expect(markers.every(({marker}) => marker !== undefined)).toBe(true);

    const monitoramento = markers.find(({marker}) => marker?.slot === 'm');
    const alertas = markers.find(({marker}) => marker?.slot === 'a');
    expect(monitoramento).toBeDefined();
    expect(alertas).toBeDefined();
    expect(monitoramento!.marker!.organizationId).toBe(invitorSetup.orgId);
    expect(monitoramento!.marker!.organizationName).toBe(invitorSetup.orgName);
    expect(monitoramento!.project.name).toBe('Monitoramento');
    expect(alertas!.marker!.organizationId).toBe(invitorSetup.orgId);
    expect(alertas!.project.name).toBe('Alertas');

    // No unnamed project slipped in alongside the organization's slots.
    expect(
      projects.every(project => (project.name ?? '').trim().length > 0),
    ).toBe(true);

    // Fase 6b-i: a complete accept REGISTERS the joined organization
    // (SPEC B §5.5) and hands activation to the engine — it no longer
    // forces a project active, so the store keeps what it was seeded with
    // (nothing here). Fase 6b-ii: the accept's destination is the
    // OrganizationProvisioning reset asserted above — activation becomes
    // the "Abrir organização" tap on THAT surface once the engine
    // publishes `pronta`, and the org-first landing into Home is covered
    // by the getInitialRoute unit tests (SPEC 10.1/E6).
    expect(inviteeSetup.activeProjectId).toBeUndefined();

    // The durable document holds the invite entry: both accepted
    // projectIds journaled as `criado` with NO creation snapshot and NO
    // local template — the Fase 6a invite origin (this device created
    // nothing; `pronta` belongs to the engine's verification, not to the
    // accept).
    const documento = documentoPersistido();
    expect(documento.organizacoes).toHaveLength(1);
    const entrada = documento.organizacoes[0]!;
    expect(entrada.id).toBe(invitorSetup.orgId);
    expect(entrada.nome).toBe(invitorSetup.orgName);
    expect(entrada.materializacao.monitoramento).toStrictEqual({
      etapa: 'criado',
      projectId: monitoramento!.project.projectId,
      template: null,
      idsAntesDaCriacao: null,
    });
    expect(entrada.materializacao.alertas).toStrictEqual({
      etapa: 'criado',
      projectId: alertas!.project.projectId,
      template: null,
      idsAntesDaCriacao: null,
    });
  }, 45_000);
});
