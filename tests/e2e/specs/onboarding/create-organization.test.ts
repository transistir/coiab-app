import {expect} from '@wdio/globals';
import {describe, it} from 'mocha';
import {byResourceId, byTextMatches} from '../../utils/selectors';

// SPEC 10.1 / #129: the onboarding fork asks whether the person is a
// coordinator; only the coordinator path reaches Create Organization, where
// the Territory comes from the predefined list and a remote archive URL is
// required.
describe('Onboarding - Create Organization Journey', () => {
  it('should navigate to the Create Organization intro', async () => {
    const coordinatorButton = await $(
      byResourceId('ONBOARDING.role-coordinator-btn'),
    );
    await coordinatorButton.click();

    const title = await $(byTextMatches('Create Territory'));
    await expect(title).toBeDisplayed();

    const introBody = await $(
      byTextMatches('Monitoramento and Alertas, with categories ready to use'),
    );
    await expect(introBody).toBeDisplayed();

    const continueButton = await $(
      byResourceId('ORG.create-intro-continue-btn'),
    );
    await continueButton.click();

    const nameSelect = await $(byResourceId('ORG.create-name-select'));
    await expect(nameSelect).toBeDisplayed();
  });

  it('should keep Create disabled without a valid archive URL', async () => {
    const createButton = await $(byResourceId('ORG.create-btn'));
    await expect(createButton).toBeDisabled();

    const urlInput = await $(byResourceId('ORG.create-archive-url-inp'));
    await urlInput.setValue('not a url');

    const invalidError = await $(
      byResourceId('ORG.create-archive-url-invalid'),
    );
    await expect(invalidError).toBeDisplayed();
    await expect(createButton).toBeDisabled();
  });

  it('should create the Organization and navigate to the map', async () => {
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

    const mapScreen = await $(byResourceId('MAIN.map-screen'));
    await mapScreen.waitForDisplayed({timeout: 30000, interval: 1000});
    await expect(mapScreen).toBeDisplayed();
  });

  it('should still be on Map screen after closing app and reopening', async () => {
    await driver.terminateApp('org.coiab.rc');
    await driver.activateApp('org.coiab.rc');

    // Cold start re-runs the startup gate; wait the restart out on the map.
    const mapScreen = await $(byResourceId('MAIN.map-screen'));
    await mapScreen.waitForDisplayed({timeout: 30000, interval: 1000});
    await expect(mapScreen).toBeDisplayed();
  });
});
