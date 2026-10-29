import * as React from 'react';
import type {Meta, StoryObj} from '@storybook/react-native';

import {EthnicGroupSelection} from './EthnicGroupSelection';
import {
  UserProfileStoreProvider,
  createUserProfileStore,
} from '../../contexts/UserProfileStoreContext';
import {ETHNIC_GROUPS} from '../../lib/ethnicGroups';

/**
 * The screen takes its navigation from the real stack; these stories are for
 * visual review, so the callbacks are inert. Each story provides its own
 * non-persisted store: the AppProviders store would read and write the
 * device's real MMKV. `WithSelection` seeds its store with an ethnic group to
 * expose the pre-selected state.
 */
const NoStoryComponent = () => null;

const meta = {
  title: 'Onboarding/EthnicGroupSelection',
  component: NoStoryComponent,
} satisfies Meta<typeof NoStoryComponent>;

export default meta;
type Story = StoryObj<typeof meta>;

const navigation = {
  navigate: () => {},
  goBack: () => {},
  reset: () => {},
} as never;

const route = {
  key: 'EthnicGroupSelection',
  name: 'EthnicGroupSelection',
} as never;

/** Empty profile: no radio selected and the continue button disabled. */
export const Default: Story = {
  render: () => (
    <UserProfileStoreProvider store={createUserProfileStore()}>
      <EthnicGroupSelection navigation={navigation} route={route} />
    </UserProfileStoreProvider>
  ),
};

/** A profile that already stored an ethnic group. */
export const WithSelection: Story = {
  render: () => {
    const store = createUserProfileStore();
    const stored = ETHNIC_GROUPS[1] ?? ETHNIC_GROUPS[0];
    if (stored) {
      store.instance.setState({ethnicGroupId: stored.id});
    }

    return (
      <UserProfileStoreProvider store={store}>
        <EthnicGroupSelection navigation={navigation} route={route} />
      </UserProfileStoreProvider>
    );
  },
};
