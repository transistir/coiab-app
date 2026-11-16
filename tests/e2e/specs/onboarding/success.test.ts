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

  it('should complete onboarding as coordinator and land on the map', async () => {
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
    await continueButton.click();

    const nameSelect = await $(byResourceId('ORG.create-name-select'));
    await expect(nameSelect).toBeDisplayed();

    const option = await $(byResourceId('ORG.create-name-option-4999'));
    await option.click();

    const urlInput = await $(byResourceId('ORG.create-archive-url-inp'));
    await urlInput.setValue('https://exemplo.org/');

    // On iOS the software keyboard overlays the button; dismiss it so the tap
    // lands. Safe no-op when no keyboard is shown (e.g. Android).
    await driver.hideKeyboard().catch(() => {});
    const createButton = await $(byResourceId('ORG.create-btn'));
    await createButton.click();

    // Provisioning fans out two projects and shows the confirmation; the tap
    // on "Abrir território" is the only path to Home.
    const openButton = await $(
      byResourceId('ORG.provisioning-open-organization-btn'),
    );
    await openButton.waitForDisplayed({timeout: 30000, interval: 1000});
    await openButton.click();

    // Provisioning leaves routing to the navigator, which opens Home with
    // initialRouteName 'Menu'. Select the map tab to reach the map screen.
    const mapTab = await $('~Go to map.');
    await mapTab.waitForDisplayed({timeout: 30000, interval: 1000});
    await mapTab.click();

    const mapScreen = await $(byResourceId('MAIN.map-screen'));
    await mapScreen.waitForDisplayed({timeout: 30000, interval: 1000});
    await expect(mapScreen).toBeDisplayed();
  });
});
