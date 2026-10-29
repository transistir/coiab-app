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

import {VillageEntry} from './VillageEntry';
import {
  UserProfileStoreProvider,
  createUserProfileStore,
  type UserProfileStore,
} from '../../contexts/UserProfileStoreContext';
import type {AppStackParamsList} from '../../sharedTypes/navigation';

const PT_MESSAGES = {
  '$1screens.Onboarding.VillageEntry.title': 'Qual é a sua aldeia?',
  '$1screens.Onboarding.VillageEntry.continue': 'Continuar',
  '$1screens.Onboarding.VillageEntry.back': 'Voltar',
  '$1screens.Onboarding.VillageEntry.placeholder':
    'Digite ou escolha uma opção',
  '$1screens.Onboarding.VillageEntry.saveError':
    'Não foi possível salvar a aldeia. Tente novamente.',
};

const VILLAGE_INPUT = 'ONBOARDING.village-inp';
const CONTINUE = 'ONBOARDING.village-continue-btn';

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

type ScreenProps = NativeStackScreenProps<AppStackParamsList, 'VillageEntry'>;

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
        <VillageEntry
          navigation={navigation}
          route={{key: 'VillageEntry', name: 'VillageEntry'}}
        />
      </UserProfileStoreProvider>
    </IntlProvider>,
  );

  return {store, navigation};
}

describe('VillageEntry', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('renders the title and a village input with the COIAB styling', async () => {
    await renderScreen();

    expect(screen.getByText('Qual é a sua aldeia?')).toBeOnTheScreen();

    const input = screen.getByTestId(VILLAGE_INPUT);
    expect(input).toHaveStyle({fontSize: 16});
    expect(input.props.maxLength).toBe(100);

    // Figma `2181:11109` (`Fields-Search`): outlined 48px field, 2px beige
    // border, 8px radius, transparent fill and 16px horizontal padding.
    expect(screen.getByTestId(`${VILLAGE_INPUT}-field`)).toHaveStyle({
      height: 48,
      borderRadius: 8,
      borderWidth: 2,
      borderColor: '#DABA8D',
      backgroundColor: 'transparent',
      paddingHorizontal: 16,
    });
  });

  test('the continue button starts disabled while the field is empty', async () => {
    await renderScreen();

    expect(screen.getByTestId(CONTINUE)).toBeDisabled();
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

  test('the continue button stays disabled for whitespace only', async () => {
    const user = userEvent.setup();
    await renderScreen();

    await user.type(screen.getByTestId(VILLAGE_INPUT), '   ');

    expect(screen.getByTestId(CONTINUE)).toBeDisabled();
  });

  test('pre-fills the village already stored in the profile', async () => {
    const store = createUserProfileStore();
    store.instance.setState({village: 'Aldeia Existente'});

    await renderScreen({store});

    expect(screen.getByTestId(VILLAGE_INPUT).props.value).toBe(
      'Aldeia Existente',
    );
  });

  test('typing free text enables Continue and resets navigation to Success', async () => {
    const user = userEvent.setup();
    const {store, navigation} = await renderScreen();

    await fireEvent.changeText(
      screen.getByTestId(VILLAGE_INPUT),
      '  Nova Aldeia  ',
    );
    expect(screen.getByTestId(CONTINUE)).toBeEnabled();

    await user.press(screen.getByTestId(CONTINUE));

    expect(store.instance.getState().village).toBe('Nova Aldeia');
    expect(navigation.reset).toHaveBeenCalledWith({
      index: 0,
      routes: [{name: 'Success'}],
    });
  });

  test('shows an inline error and does not navigate when saving fails', async () => {
    const user = userEvent.setup();
    const store = createUserProfileStore();
    jest.spyOn(store.actions, 'setVillage').mockImplementation(() => {
      throw new Error('persist-failed');
    });

    const {navigation} = await renderScreen({store});

    await fireEvent.changeText(
      screen.getByTestId(VILLAGE_INPUT),
      'Aldeia Teste',
    );
    await user.press(screen.getByTestId(CONTINUE));

    expect(
      screen.getByText('Não foi possível salvar a aldeia. Tente novamente.'),
    ).toBeOnTheScreen();
    expect(navigation.reset).not.toHaveBeenCalled();
    expect(store.instance.getState().village).toBeNull();
  });

  test('the back button returns to the previous screen', async () => {
    const user = userEvent.setup();
    const {navigation} = await renderScreen();

    await user.press(screen.getByTestId('ONBOARDING.village-back-btn'));

    expect(navigation.goBack).toHaveBeenCalled();
  });
});
