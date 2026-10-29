import {byResourceId} from '../../../utils/selectors';
import {output} from '../../../utils/naming';

// SPEC #128: onboarding collects ethnicity and village after the device name.
// When the saved profile is incomplete, the cold start restarts the app on
// `EthnicGroupSelection`. A later spec in the same session already starts from
// `Success`, so the helper is a no-op there instead of failing.
export async function completeEthnicProfileIfNeeded() {
  const ethnicContinue = await $(
    byResourceId('ONBOARDING.ethnic-group-continue-btn'),
  );

  try {
    await ethnicContinue.waitForDisplayed({timeout: 15000, interval: 500});
  } catch {
    return;
  }

  // First catalog entry; selecting it swaps the testID to `-selected` and
  // enables the continue button.
  const firstEthnicGroup = await $(byResourceId('dummy-1Button'));
  await firstEthnicGroup.click();
  await ethnicContinue.click();

  const villageInput = await $(byResourceId('ONBOARDING.village-inp'));
  await villageInput.waitForDisplayed({timeout: 15000, interval: 500});
  await villageInput.setValue(output.names.village);
  // On iOS the software keyboard overlays the button.
  await driver.hideKeyboard().catch(() => {});

  const villageContinue = await $(
    byResourceId('ONBOARDING.village-continue-btn'),
  );
  await villageContinue.click();
}
