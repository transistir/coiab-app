import {byResourceId} from '../../../utils/selectors';
import {output} from '../../../utils/naming';

// SPEC #128: onboarding collects ethnicity and village after the device name.
// When the saved profile is incomplete, the cold start restarts the app on
// `EthnicGroupSelection`. A later spec in the same session already starts from
// `Success`, so the helper is a no-op there instead of failing.
//
// It is also idempotent across runs: if an earlier run already stored an
// ethnicity, that row's testID is swapped to `-selected`, so clicking
// `dummy-1Button` unconditionally would miss. Pick any still-unselected row.
const ETHNIC_GROUP_IDS = ['dummy-1', 'dummy-2', 'dummy-3'] as const;

export async function completeEthnicProfileIfNeeded() {
  const ethnicContinue = await $(
    byResourceId('ONBOARDING.ethnic-group-continue-btn'),
  );
  const joinOrgButton = await $(byResourceId('ONBOARDING.join-org-btn'));

  // Anchor present on both landing screens: the pending profile shows the
  // ethnicity continue button, a completed flow shows the join button. Waiting
  // on either avoids burning the full timeout when there is nothing to do.
  await driver.waitUntil(
    async () =>
      (await ethnicContinue.isDisplayed()) ||
      (await joinOrgButton.isDisplayed()),
    {timeout: 15000, interval: 500},
  );

  // Profile already saved (Success screen): nothing to fill in.
  if (!(await ethnicContinue.isDisplayed())) {
    return;
  }

  // First entry that is not selected yet. `SelectOne` exposes the selected row
  // as `<id>Button-selected`, so the plain testID only exists for the others.
  for (const id of ETHNIC_GROUP_IDS) {
    const option = await $(byResourceId(`${id}Button`));
    if (await option.isDisplayed()) {
      await option.click();
      break;
    }
  }
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
