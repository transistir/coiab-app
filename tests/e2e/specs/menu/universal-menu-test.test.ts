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
    const ekanadybySettings = await $(byText('CoiabApp Settings'));

    await expect(gatherObservations).toBeDisplayed();
    await expect(backgroundMaps).toBeDisplayed();
    await expect(coMapeoSettings).toBeDisplayed();
  });

  it('Should close menu on back button', async () => {
    await driver.back();
    const gatherObservations = await $(byText('Gather Observations'));
    const backgroundMaps = await $(byText('Background Map'));
    const ekanadybySettings = await $(byText('CoiabApp Settings'));

    await expect(gatherObservations).not.toBeDisplayed();
    await expect(backgroundMaps).not.toBeDisplayed();
    await expect(coMapeoSettings).not.toBeDisplayed();
    await expect($(byResourceId('MAIN.map-screen'))).toBeDisplayed();
  });

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
    //should not be visible as the menu pushes it off screen
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
