import * as React from 'react';
import type {Decorator} from '@storybook/react-native';

import {LocaleStoreProvider} from '../../src/frontend/contexts/LocaleStoreContext';
import {IntlProvider} from '../../src/frontend/contexts/IntlContext';

/**
 * Pins the Onboarding stories to Brazilian Portuguese. The in-app Storybook
 * inherits the device locale (en-US on the capture emulator), so without this
 * the captured frames show English copy even though the product copy is
 * pt-BR. Seeding the locale store is the same mechanism tests use; the app's
 * own `IntlProvider` then resolves the `pt` bundle for the story subtree.
 */
export const withPtBrLocale: Decorator = Story => (
  <LocaleStoreProvider initialLanguageTag="pt-BR">
    <IntlProvider>
      <Story />
    </IntlProvider>
  </LocaleStoreProvider>
);
