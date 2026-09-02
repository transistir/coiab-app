import type {Meta, StoryObj} from '@storybook/react-native';
import {View} from 'react-native';

import {NoWifiDisplay} from './NoWifiDisplay';
import {withFlowState} from '../../../../.rnstorybook/decorators/withFlowState';
import {withNavigation} from '../../../../.rnstorybook/decorators/withNavigation';
import {NavigatorScreenOptions} from '../../Navigation/Stack';

/**
 * Leaf story. `NoWifiDisplay` is purely presentational (an `onGoBack`
 * callback, no hooks), so this covers the screen `SyncScreen` renders when
 * `shouldShowNoWifiDisplay()` is true — a branch that cannot be forced
 * deterministically as a flow story because it depends on the CI
 * emulator's live WiFi radio status (see `Flows/Exchange`'s `MainScreen`
 * doc comment). A wrapping `testID` view (rather than editing app source)
 * gives the capture pipeline a stable readiness marker for this story's own
 * state, nested inside `withFlowState`'s own `flex: 1` marker view (which
 * also supplies the required `STORYBOOK.flow-ready.<story_id>` marker) —
 * nested `flex: 1` views compose fine here since `NoWifiDisplay` itself
 * already expects to fill the screen (it renders a `ScreenContentWithDock`
 * with `flex: 1`).
 *
 * `withNavigation` supplies the app's real `Exchange` header. In production
 * this component is returned by `SyncScreen` from the registered `Sync`
 * route (`src/frontend/screens/Exchange/index.tsx`), which sets
 * `headerTitle: intl(SyncScreen.navTitle)` in
 * `Navigation/Stack/AppScreens.tsx` — so a headerless capture would have
 * extra vertical space and could not expose header-related clipping. The
 * screen options are the same ones `Exchange/Screen` uses, reusing the
 * exported `NavigatorScreenOptions` rather than restating them.
 */
const meta = {
  title: 'Exchange/NoWifiDisplay',
  component: NoWifiDisplay,
  decorators: [withFlowState, withNavigation],
  parameters: {
    navigation: {
      options: {...NavigatorScreenOptions, headerTitle: 'Exchange'},
    },
  },
} satisfies Meta<typeof NoWifiDisplay>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 01 No WiFi / no internet access state. */
export const NoWifi: Story = {
  name: '01 No Wifi',
  args: {
    onGoBack: () => {},
  },
  render: args => (
    <View testID="EXCHANGE.no-wifi-display" style={{flex: 1}}>
      <NoWifiDisplay {...args} />
    </View>
  ),
};
