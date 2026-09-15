import {expect} from '@wdio/globals';
import {describe, it} from 'mocha';
import {byResourceId, byTextMatches} from '../../utils/selectors';

// SPEC 10.1: the onboarding fork is organization-first — the legacy
// map-on-your-own solo path is gone from the fork. This spec drives the
// Create Organization journey (the fork's primary path), which lands on the
// Map screen the same way the old solo journey did.
describe('Onboarding - Create Organization Journey', () => {
  it('should navigate to the Create Organization intro', async () => {
    const createOrgButton = await $(byResourceId('ONBOARDING.create-org-btn'));
    await createOrgButton.click();

    const title = await $(byTextMatches('Create Organization'));
    await expect(title).toBeDisplayed();

    const introBody = await $(
      byTextMatches('Monitoramento and Alertas, with categories ready to use'),
    );
    await expect(introBody).toBeDisplayed();

    const continueButton = await $(
      byResourceId('ORG.create-intro-continue-btn'),
    );
    await continueButton.click();

    const nameInput = await $(byResourceId('ORG.create-name-inp'));
    await expect(nameInput).toBeDisplayed();
  });

  it('should reject an empty submit with the required-name message', async () => {
    const createButton = await $(byResourceId('ORG.create-btn'));
    await createButton.click();

    const emptyError = await $(byTextMatches('Enter the Organization name'));
    await expect(emptyError).toBeDisplayed();
  });

  it('should create the Organization and navigate to the map', async () => {
    const nameInput = await $(byResourceId('ORG.create-name-inp'));
    await nameInput.setValue('Test Org');

    // On iOS the software keyboard overlays the button; dismiss it so the tap
    // lands. Safe no-op when no keyboard is shown (e.g. Android).
    await driver.hideKeyboard().catch(() => {});
    const createButton = await $(byResourceId('ORG.create-btn'));
    await createButton.click();

    // Provisioning fans out two projects — wait on the map actually showing
    // up instead of a fixed sleep.
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
