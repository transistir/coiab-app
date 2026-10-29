import {byResourceId} from '../../../utils/selectors';
import {output} from '../../../utils/naming';

// SPEC #128: onboarding collects ethnicity and village after the device name.
// When the saved profile is incomplete, the cold start restarts the app on
// `EthnicGroupSelection`. A later spec in the same session already starts from
// `Success`, so the helper is a no-op there instead of failing.
//
// Ethnicity is free text with local autocomplete: typing a value from the
// dataset is enough and stays valid even if the picker UI changes again.
const ETHNICITY = 'Tunayana';

export async function completeEthnicProfileIfNeeded() {
  const ethnicContinue = await $(
    byResourceId('ONBOARDING.ethnic-group-continue-btn'),
  );
  const joinOrgButton = await $(byResourceId('ONBOARDING.join-org-btn'));

  // Anchor present on both landing screens: the pending profile shows the
  // ethnicity continue button, a completed flow shows the join button. Waiting
  // on either avoids burning the full timeout when there is nothing to do.
  //
  // Standalone this is NOT true: with no device name yet the app lands on
  // IntroToCoMapeo, where neither anchor exists, so the wait runs to its full
  // timeout. Run the calling specs after device-naming (or with a saved
  // profile) — this helper cannot complete onboarding by itself.
  await driver.waitUntil(
    async () =>
      (await ethnicContinue.isDisplayed()) ||
      (await joinOrgButton.isDisplayed()),
    {timeout: 30000, interval: 500},
  );

  // Profile already saved (Success screen): nothing to fill in.
  if (!(await ethnicContinue.isDisplayed())) {
    return;
  }

  const ethnicInput = await $(byResourceId('ONBOARDING.ethnic-group-inp'));
  await ethnicInput.waitForDisplayed({timeout: 15000, interval: 500});
  await ethnicInput.setValue(ETHNICITY);
  // Deliberately keeps the keyboard open: the screen's KeyboardAvoidingView
  // (iOS) / window resize (Android) must leave Continuar reachable. Hiding
  // the keyboard here would mask the exact regression this flow guards.
  await ethnicContinue.click();

  const villageInput = await $(byResourceId('ONBOARDING.village-inp'));
  await villageInput.waitForDisplayed({timeout: 15000, interval: 500});
  await villageInput.setValue(output.names.village);

  const villageContinue = await $(
    byResourceId('ONBOARDING.village-continue-btn'),
  );
  // Same rule as above: Continuar is tapped with the keyboard still open.
  await villageContinue.click();
}
