import {expect} from '@wdio/globals';
import {describe, it} from 'mocha';
import {byResourceId, byTextMatches} from '../../utils/selectors';
import {output} from '../../utils/naming';

describe('Onboarding - Success Screen', () => {
  it('should display device ready message and the coordinator question', async () => {
    const deviceReadyMessage = await $(
      byTextMatches(`${output.names.device} is ready`),
    );
    await expect(deviceReadyMessage).toBeDisplayed();

    const roleQuestion = await $(byTextMatches('Are you a coordinator'));
    await expect(roleQuestion).toBeDisplayed();

    const coordinatorButton = await $(
      byResourceId('ONBOARDING.role-coordinator-btn'),
    );
    await expect(coordinatorButton).toBeDisplayed();

    const participantButton = await $(
      byResourceId('ONBOARDING.role-participant-btn'),
    );
    await expect(participantButton).toBeDisplayed();
  });

  it('should open Create Organization when the coordinator role is chosen', async () => {
    const coordinatorButton = await $(
      byResourceId('ONBOARDING.role-coordinator-btn'),
    );
    await coordinatorButton.click();

    const title = await $(byTextMatches('Create Territory'));
    await expect(title).toBeDisplayed();

    const continueButton = await $(
      byResourceId('ORG.create-intro-continue-btn'),
    );
    await expect(continueButton).toBeDisplayed();
  });
});
