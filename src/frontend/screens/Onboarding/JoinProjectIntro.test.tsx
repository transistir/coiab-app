import {userEvent, screen} from '@testing-library/react-native';
import {
  setupIntegrationTest,
  setupIntegrationTestWithoutProject,
} from '../../../../tests/integration/helpers/setupIntegrationTest';
import {randomBytes} from 'node:crypto';
import {MEMBER_ROLE_ID} from '../../sharedTypes';
import {connectPeers} from '../../../../tests/integration/helpers/core';

describe('Onboarding Screens', () => {
  const inviteeSetup = setupIntegrationTestWithoutProject();
  const invitorSetup = setupIntegrationTest();

  test('should show the org fork and receive an invite while waiting', async () => {
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

    await invitorProject.$setProjectSettings({name: 'testProject'});

    const inviteId = randomBytes(32);

    // Don't await — resolves only when invitee accepts/rejects, which happens via the UI being tested below.
    void invitorProject.$member.invite(inviteeSetup.manager.deviceId, {
      roleId: MEMBER_ROLE_ID,
      __testOnlyInviteId: inviteId,
    });

    expect(await screen.findByText("You've been invited to...")).toBeVisible();

    const joinButton = await screen.findByText('Join');
    expect(joinButton).toBeVisible();

    await user.press(joinButton);
    expect(
      await screen.findByText('You have joined testProject'),
    ).toBeVisible();

    // Accepting invalidates the project/invite queries; let those refetches
    // settle so teardown doesn't close the IPC channel under an in-flight
    // call (RpcChannelClosed).
    await new Promise(resolve => setTimeout(resolve, 500));

    // SPEC 10.1 / E6: the invite-accept landing (Done → Home) is reworked by
    // P5 (org invite receive UI); the org-first landing is covered by the
    // getInitialRoute unit tests (no organization + project → Success fork).
  });
});
