import * as React from 'react';
import type {Meta, StoryObj} from '@storybook/react-native';

import {VillageEntry} from './VillageEntry';
import {
  UserProfileStoreProvider,
  createUserProfileStore,
} from '../../contexts/UserProfileStoreContext';

/**
 * The screen takes its navigation from the real stack; these stories are for
 * visual review, so the callbacks are inert. `Prefilled` seeds the store with
 * a village to expose the editing state.
 */
const NoStoryComponent = () => null;

const meta = {
  title: 'Onboarding/VillageEntry',
  component: NoStoryComponent,
} satisfies Meta<typeof NoStoryComponent>;

export default meta;
type Story = StoryObj<typeof meta>;

const navigation = {
  navigate: () => {},
  goBack: () => {},
  reset: () => {},
} as never;

const route = {key: 'VillageEntry', name: 'VillageEntry'} as never;

/** Empty profile: the continue button is disabled. */
export const Default: Story = {
  render: () => <VillageEntry navigation={navigation} route={route} />,
};

/** A profile that already stored a village. */
export const Prefilled: Story = {
  render: () => {
    const store = createUserProfileStore();
    store.instance.setState({village: 'Aldeia Ekanadyby'});

    return (
      <UserProfileStoreProvider store={store}>
        <VillageEntry navigation={navigation} route={route} />
      </UserProfileStoreProvider>
    );
  },
};
