import {expect} from '@wdio/globals';
import {describe, it} from 'mocha';
import {byTextMatches, byText, byResourceId} from '../../utils/selectors';
import {abrirMenu} from '../../utils/menu';
import {output} from '../../utils/naming';

describe('Main - Menu Page - No Project', () => {
  it('should open the menu page and verify menu options', async () => {
    // #118: the menu content is now a page that the tab bar's Menu button
    // opens; the "click empty list area" below used to dismiss the drawer.
    await abrirMenu();
    await expect($(byTextMatches(output.names.device))).toBeDisplayed();
    await expect($(byText('Just You'))).toBeDisplayed();

    await expect(
      $(byTextMatches("You're mapping on your own")),
    ).toBeDisplayed();

    await expect($('~Go to app settings screen.')).toBeDisplayed();
    await expect($('~Go to background maps screen.')).toBeDisplayed();
    await expect($('~Go to map screen.')).toBeDisplayed();

    await $(byResourceId('observationsEmptyView')).click();
    const mapTab = await $('~Go to map.');
    await mapTab.click();
  });
});
