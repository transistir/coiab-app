import * as React from 'react';
import {render, screen, userEvent} from '@testing-library/react-native';
import {IntlProvider} from 'react-intl';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';

import {EthnicGroupSelection} from './EthnicGroupSelection';
import {ETHNIC_GROUPS} from '../../lib/ethnicGroups';
import {
  UserProfileStoreProvider,
  createUserProfileStore,
  type UserProfileStore,
} from '../../contexts/UserProfileStoreContext';
import type {AppStackParamsList} from '../../sharedTypes/navigation';

const PT_MESSAGES = {
  '$1screens.Onboarding.EthnicGroupSelection.title': 'Qual é a sua etnia?',
  '$1screens.Onboarding.EthnicGroupSelection.continue': 'Continuar',
  '$1screens.Onboarding.EthnicGroupSelection.saveError':
    'Não foi possível salvar a etnia. Tente novamente.',
};

type ScreenProps = NativeStackScreenProps<
  AppStackParamsList,
  'EthnicGroupSelection'
>;

function createNavigation() {
  return {
    navigate: jest.fn(),
    goBack: jest.fn(),
    reset: jest.fn(),
  } as unknown as ScreenProps['navigation'];
}

async function renderScreen({
  store = createUserProfileStore(),
  navigation = createNavigation(),
}: {
  store?: UserProfileStore;
  navigation?: ScreenProps['navigation'];
} = {}) {
  await render(
    <IntlProvider locale="pt-BR" messages={PT_MESSAGES}>
      <UserProfileStoreProvider store={store}>
        <EthnicGroupSelection
          navigation={navigation}
          route={{key: 'EthnicGroupSelection', name: 'EthnicGroupSelection'}}
        />
      </UserProfileStoreProvider>
    </IntlProvider>,
  );

  return {store, navigation};
}

describe('EthnicGroupSelection', () => {
  test('renders the title and every ethnic group from the catalog', async () => {
    await renderScreen();

    expect(screen.getByText('Qual é a sua etnia?')).toBeOnTheScreen();

    for (const group of ETHNIC_GROUPS) {
      expect(screen.getByText(group.name)).toBeOnTheScreen();
    }
  });

  test('the continue button starts disabled without a selection', async () => {
    await renderScreen();

    expect(
      screen.getByTestId('ONBOARDING.ethnic-group-continue-btn'),
    ).toBeDisabled();
  });

  test('pre-selects the ethnic group already stored in the profile', async () => {
    const store = createUserProfileStore();
    const stored = ETHNIC_GROUPS[1]!;
    store.instance.setState({ethnicGroupId: stored.id});

    await renderScreen({store});

    expect(
      screen.getByTestId(`${stored.id}Button-selected`),
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('ONBOARDING.ethnic-group-continue-btn'),
    ).toBeEnabled();
  });

  test('saves the selected group and navigates to VillageEntry', async () => {
    const user = userEvent.setup();
    const {store, navigation} = await renderScreen();
    const chosen = ETHNIC_GROUPS[0]!;

    await user.press(screen.getByTestId(`${chosen.id}Button`));
    expect(
      screen.getByTestId('ONBOARDING.ethnic-group-continue-btn'),
    ).toBeEnabled();

    await user.press(
      screen.getByTestId('ONBOARDING.ethnic-group-continue-btn'),
    );

    expect(store.instance.getState().ethnicGroupId).toBe(chosen.id);
    expect(navigation.navigate).toHaveBeenCalledWith('VillageEntry');
  });

  test('shows an inline error and does not navigate when saving fails', async () => {
    const user = userEvent.setup();
    const store = createUserProfileStore();
    const chosen = ETHNIC_GROUPS[0]!;
    jest.spyOn(store.actions, 'setEthnicGroup').mockImplementation(() => {
      throw new Error('persist-failed');
    });

    const {navigation} = await renderScreen({store});

    await user.press(screen.getByTestId(`${chosen.id}Button`));
    await user.press(
      screen.getByTestId('ONBOARDING.ethnic-group-continue-btn'),
    );

    expect(
      screen.getByText('Não foi possível salvar a etnia. Tente novamente.'),
    ).toBeOnTheScreen();
    expect(navigation.navigate).not.toHaveBeenCalled();
    expect(store.instance.getState().ethnicGroupId).toBeNull();
  });
});
