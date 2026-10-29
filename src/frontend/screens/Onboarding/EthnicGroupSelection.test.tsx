import * as React from 'react';
import {
  fireEvent,
  render,
  screen,
  userEvent,
} from '@testing-library/react-native';
import {KeyboardAvoidingView, Platform} from 'react-native';
import {IntlProvider} from 'react-intl';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';

import {EthnicGroupSelection} from './EthnicGroupSelection';
import {
  UserProfileStoreProvider,
  createUserProfileStore,
  type UserProfileStore,
} from '../../contexts/UserProfileStoreContext';
import type {AppStackParamsList} from '../../sharedTypes/navigation';

const PT_MESSAGES = {
  '$1screens.Onboarding.EthnicGroupSelection.title': 'Qual é a sua etnia?',
  '$1screens.Onboarding.EthnicGroupSelection.placeholder':
    'Digite ou escolha uma opção',
  '$1screens.Onboarding.EthnicGroupSelection.continue': 'Continuar',
  '$1screens.Onboarding.EthnicGroupSelection.saveError':
    'Não foi possível salvar a etnia. Tente novamente.',
};

const ETHNIC_INPUT = 'ONBOARDING.ethnic-group-inp';
const CONTINUE = 'ONBOARDING.ethnic-group-continue-btn';

/**
 * `KeyboardAvoidingView` keeps the `behavior` prop only on the composite
 * instance (the inner View drops it), so the structural assertion inspects
 * the instance that rendered — not the host tree.
 */
function keyboardAvoidingBehavior(renderSpy: jest.SpyInstance) {
  const instancia = renderSpy.mock.contexts.at(-1) as
    {props?: {behavior?: string}} | undefined;
  return instancia?.props?.behavior;
}

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
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('renders the title and a free-text input with the placeholder', async () => {
    await renderScreen();

    expect(screen.getByText('Qual é a sua etnia?')).toBeOnTheScreen();
    expect(screen.getByTestId(ETHNIC_INPUT)).toBeOnTheScreen();
    expect(
      screen.getByPlaceholderText('Digite ou escolha uma opção'),
    ).toBeOnTheScreen();
  });

  test('wraps the layout in a KeyboardAvoidingView using iOS padding', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const renderSpy = jest.spyOn(KeyboardAvoidingView.prototype, 'render');

    await renderScreen();

    // The footer (Continuar) sits inside the wrapper, so iOS pushes it above
    // the software keyboard while the free-text field is focused.
    expect(keyboardAvoidingBehavior(renderSpy)).toBe('padding');
  });

  test('leaves the Android frame untouched by using no keyboard behavior', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const renderSpy = jest.spyOn(KeyboardAvoidingView.prototype, 'render');

    await renderScreen();

    // Android resizes the window itself; an extra padding behavior would
    // shift the footer and change the captured frame.
    expect(keyboardAvoidingBehavior(renderSpy)).toBeUndefined();
  });

  test('the continue button starts disabled without text', async () => {
    await renderScreen();

    expect(screen.getByTestId(CONTINUE)).toBeDisabled();
  });

  test('the continue button stays disabled for whitespace only', async () => {
    await renderScreen();

    await fireEvent.changeText(screen.getByTestId(ETHNIC_INPUT), '   ');

    expect(screen.getByTestId(CONTINUE)).toBeDisabled();
  });

  test('pre-fills the ethnicity already stored in the profile', async () => {
    const store = createUserProfileStore();
    store.instance.setState({ethnicity: 'Tunayana'});

    await renderScreen({store});

    expect(screen.getByTestId(ETHNIC_INPUT).props.value).toBe('Tunayana');
    expect(screen.getByTestId(CONTINUE)).toBeEnabled();
  });

  test('typing free text outside the dataset enables Continue and persists it', async () => {
    const user = userEvent.setup();
    const {store, navigation} = await renderScreen();

    await fireEvent.changeText(
      screen.getByTestId(ETHNIC_INPUT),
      'Etnia escrita à mão',
    );
    expect(screen.getByTestId(CONTINUE)).toBeEnabled();

    await user.press(screen.getByTestId(CONTINUE));

    expect(store.instance.getState().ethnicity).toBe('Etnia escrita à mão');
    expect(navigation.navigate).toHaveBeenCalledWith('VillageEntry');
  });

  test('selecting a suggestion fills the field', async () => {
    await renderScreen();

    const input = screen.getByTestId(ETHNIC_INPUT);
    await fireEvent(input, 'focus');
    await fireEvent.changeText(input, 'kahyana');

    const suggestion = screen.getByTestId(`${ETHNIC_INPUT}-suggestion-Kahyana`);
    await fireEvent.press(suggestion);

    expect(screen.getByTestId(ETHNIC_INPUT).props.value).toBe('Kahyana');
    expect(screen.getByTestId(CONTINUE)).toBeEnabled();
  });

  test('shows no suggestion list for an empty query', async () => {
    await renderScreen();

    const input = screen.getByTestId(ETHNIC_INPUT);
    await fireEvent(input, 'focus');

    expect(screen.queryByText('Tunayana')).toBeNull();
  });

  test('shows an inline error and does not navigate when saving fails', async () => {
    const user = userEvent.setup();
    const store = createUserProfileStore();
    jest.spyOn(store.actions, 'setEthnicity').mockImplementation(() => {
      throw new Error('persist-failed');
    });

    const {navigation} = await renderScreen({store});

    await fireEvent.changeText(screen.getByTestId(ETHNIC_INPUT), 'Tunayana');
    await user.press(screen.getByTestId(CONTINUE));

    expect(
      screen.getByText('Não foi possível salvar a etnia. Tente novamente.'),
    ).toBeOnTheScreen();
    expect(navigation.navigate).not.toHaveBeenCalled();
    expect(store.instance.getState().ethnicity).toBeNull();
  });
});
