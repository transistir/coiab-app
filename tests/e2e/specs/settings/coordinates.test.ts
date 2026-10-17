import {expect} from '@wdio/globals';
import {describe, it} from 'mocha';
import {byResourceId, byTextMatches} from '../../utils/selectors';
import {abrirMenu} from '../../utils/menu';

describe('Settings - Coordinates Settings Flow', () => {
  it('should open the App Settings from the drawer', async () => {
    await abrirMenu();

    const appSettingsOption = await $('~Go to app settings screen.');
    await appSettingsOption.click();
  });

  it('should open Coordinate System screen', async () => {
    const coordinateSystemOption = await $(
      byResourceId('settingsCoodinatesButton'),
    );
    await coordinateSystemOption.click();

    await expect($(byTextMatches('Decimal Degrees'))).toBeDisplayed();
    await expect($(byTextMatches('Degrees/Minutes/Seconds'))).toBeDisplayed();
    await expect(
      $(byTextMatches('Universal Transverse Mercator')),
    ).toBeDisplayed();
  });

  it('should select D/M/S, then back to Settings and back to map', async () => {
    const dmsOption = await $(byTextMatches('Degrees/Minutes/Seconds'));
    await dmsOption.click();

    await $(byResourceId('MAIN.header-back-btn')).click();

    await expect($(byTextMatches('CoiabApp Settings'))).toBeDisplayed();

    await $(byResourceId('MAIN.header-back-btn')).click();
    await $(byResourceId('MAIN.map-screen')).click();
    await expect($(byResourceId('MAIN.mapbox-map-view'))).toBeDisplayed();
  });
});
