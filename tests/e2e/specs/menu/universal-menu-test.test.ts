import {expect} from '@wdio/globals';
import {describe, it} from 'mocha';
import {byResourceId, byText, byTextMatches} from '../../utils/selectors';
import {abrirMenu} from '../../utils/menu';

describe('Menu - basic functionality of the menu', () => {
  it('should open on press of menu tab', async () => {
    // #118: the menu is the first tab's page; no more header drawer button.
    await abrirMenu();

    const gatherObservations = await $(byText('Gather Observations'));
    const backgroundMaps = await $(byText('Background Map'));
    const coMapeoSettings = await $(byText('CoiabApp Settings'));

    await expect(gatherObservations).toBeDisplayed();
    await expect(backgroundMaps).toBeDisplayed();
    await expect(coMapeoSettings).toBeDisplayed();
  });

  // #118: hardware back from the initial route sends the app to the
  // background (Android default — no BackHandler remains on the Home '/'
  // tabs/MenuScreen and there is no drawer left to close), so there is
  // nothing meaningful to assert at the e2e level; the it that used to claim
  // the Menu stays displayed after back was removed.

  it('should navigate to background map screen on background map press', async () => {
    await abrirMenu();

    const backgroundMaps = await $(byText('Background Map'));
    await backgroundMaps.click();

    await expect(await $(byText('Background Map'))).toBeDisplayed();
    await driver.pause(2000);

    await expect(await $(byTextMatches('Choose File'))).toBeDisplayed();

    await driver.back();
  });

  it('should navigate to app settings', async () => {
    const ekanadybySettings = await $(byTextMatches('CoiabApp Settings'));
    await ekanadybySettings.click();

    await expect(await $(byText('CoiabApp Settings'))).toBeDisplayed();
    await expect(
      await $(byResourceId('device-name-list-item')),
    ).toBeDisplayed();
    await expect(
      await $(byResourceId('languageSettingsButton')),
    ).toBeDisplayed();

    await driver.back();
  });

  it('should navigate to map when gather observations clicked', async () => {
    const addObservationButton = await $(
      byResourceId('MAIN.add-observation-btn'),
    );
    // should not be visible from the Menu tab page; the map shows it only
    // after navigating to the map tab
    await expect(addObservationButton).not.toBeDisplayed();

    const gatherObservations = await $(byText('Gather Observations'));
    await gatherObservations.click();

    const mapScreen = await $(byResourceId('MAIN.map-screen'));

    await expect(mapScreen).toBeDisplayed();
    await expect(addObservationButton).toBeDisplayed();

    const obsListTab = await $('~Go to observations list.');

    await obsListTab.click();
    const observationView = await $(byResourceId('observationsEmptyView'));

    await expect(observationView).toBeDisplayed();

    await abrirMenu();

    await gatherObservations.click();

    await expect(observationView).not.toBeDisplayed();

    await expect(mapScreen).toBeDisplayed();
    await expect(addObservationButton).toBeDisplayed();
  });
});
