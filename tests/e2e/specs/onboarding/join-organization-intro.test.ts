import {expect} from '@wdio/globals';
import {describe, it} from 'mocha';
import {byResourceId, byTextMatches} from '../../utils/selectors';
import {output} from '../../utils/naming';

// SPEC E6: the onboarding fork is organization-first. The fork's join path
// leads to JoinOrganizationIntro (a waiting state); the legacy JoinProjectIntro
// screen stays registered but is no longer driven from the fork.
describe('Onboarding - Join Organization Intro Screen', () => {
  it('should navigate to the waiting screen', async () => {
    const joinOrgButton = await $(byResourceId('ONBOARDING.join-org-btn'));
    await joinOrgButton.click();

    const title = await $(byTextMatches('Wait for an invitation'));
    await expect(title).toBeDisplayed();
  });

  it('should display waiting content', async () => {
    await expect(
      $(
        byTextMatches(
          'Ask a person responsible for the Organization to invite this device',
        ),
      ),
    ).toBeDisplayed();
  });

  it('should navigate back to Success screen when Back is tapped', async () => {
    const backButton = await $(byResourceId('ORG.join-intro-back-btn'));
    await backButton.click();

    const deviceReadyMessage = await $(
      byTextMatches(`${output.names.device} is ready`),
    );
    await expect(deviceReadyMessage).toBeDisplayed();
  });
});
