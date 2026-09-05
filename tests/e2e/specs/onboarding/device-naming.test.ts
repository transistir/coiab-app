import {expect} from '@wdio/globals';
import {describe, it} from 'mocha';
import {byResourceId, byTextMatches, byText} from '../../utils/selectors';
import {output} from '../../utils/naming';

describe('Onboarding - Device Naming Test', () => {
  it('should navigate to Device Naming screen after tapping "Next"', async () => {
    const nextButton = await $(byText('Next'));
    await nextButton.click();
  });

  it('should input a device name and verify success message', async () => {
    const deviceNameInput = await $(byResourceId('ONBOARDING.device-name-inp'));
    await expect(deviceNameInput).toBeDisplayed();
    const addNameButton = await $(byResourceId('ONBOARDING.add-name-btn'));

    await addNameButton.click();

    const readyMessage = await $(byTextMatches('is ready'));
    await driver.waitUntil(async () => !(await readyMessage.isExisting()), {
      timeout: 2000,
      timeoutMsg: 'The ready message should not appear when input is empty',
    });

    await deviceNameInput.setValue('    ');
    await addNameButton.click();

    await driver.waitUntil(async () => !(await readyMessage.isExisting()), {
      timeout: 2000,
      timeoutMsg: 'Ready message should not appear when input is only spaces.',
    });

    await deviceNameInput.setValue(output.names.device);
    // On iOS the software keyboard overlays the Save button; dismiss it so the
    // tap lands. Safe no-op when no keyboard is shown (e.g. Android).
    await driver.hideKeyboard().catch(() => {});
    await addNameButton.click();
    const deviceReadyMessage = await $(
      byTextMatches(`${output.names.device} is ready`),
    );
    await expect(deviceReadyMessage).toBeDisplayed();

    // SPEC 10.1: the Success fork is organization-first — Create Organization
    // (primary) and Join an Organization (secondary).
    const createOrgButton = await $(byResourceId('ONBOARDING.create-org-btn'));
    await expect(createOrgButton).toBeDisplayed();

    const joinOrgButton = await $(byResourceId('ONBOARDING.join-org-btn'));
    await expect(joinOrgButton).toBeDisplayed();
  });
});
