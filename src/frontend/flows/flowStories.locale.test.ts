import {withPtBrLocale} from '../../../.rnstorybook/decorators/withPtBrLocale';

import CreateObservationMeta from './CreateObservation.stories';
import ExchangeMeta from './Exchange.stories';
import MenuMeta from './Menu.stories';
import OnboardingMeta from './Onboarding.stories';
import OrgLayerDrawerMeta from './OrgLayerDrawer.stories';
import SanityMeta from './Sanity.stories';
import SettingsMeta from './Settings.stories';

type StoryMeta = {decorators?: readonly unknown[]};

/**
 * Storybook composes decorators innermost-first: the LAST entry in the array
 * is the OUTERMOST wrapper. `withRealNavigator` never renders `<Story/>` (it
 * mounts the real navigator), so `withPtBrLocale` must be last for its
 * `IntlProvider` to wrap the navigator and localize the flow screens. Pinned
 * for `Flows/OrgLayer` in `OrgLayer.stories.test.tsx`; this covers the rest of
 * the flow stories, whose captures otherwise fall back to the emulator's
 * en-US locale.
 */
const FLOW_STORIES: ReadonlyArray<readonly [string, StoryMeta]> = [
  ['Onboarding.stories.tsx', OnboardingMeta],
  ['CreateObservation.stories.tsx', CreateObservationMeta],
  ['Menu.stories.tsx', MenuMeta],
  ['Settings.stories.tsx', SettingsMeta],
  ['Exchange.stories.tsx', ExchangeMeta],
  ['Sanity.stories.tsx', SanityMeta],
  ['OrgLayerDrawer.stories.tsx', OrgLayerDrawerMeta],
];

describe.each(FLOW_STORIES)('%s', (fileName, meta) => {
  test('pins the pt-BR locale as the outermost decorator', () => {
    const decorators = meta.decorators ?? [];

    if (!decorators.includes(withPtBrLocale)) {
      throw new Error(
        `${fileName}: decorators must include withPtBrLocale so the flow renders pt-BR`,
      );
    }

    const outermost = decorators[decorators.length - 1];
    if (outermost !== withPtBrLocale) {
      throw new Error(
        `${fileName}: withPtBrLocale must be the last decorator so its IntlProvider wraps the navigator`,
      );
    }
  });
});
