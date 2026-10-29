import * as React from 'react';
import {Keyboard} from 'react-native';
import {fireEvent, render, screen} from '@testing-library/react-native';

import {AutocompleteField} from './AutocompleteField';

const mockBlur = jest.fn();
const mockFocus = jest.fn();

// O ref de um host component é nulo no react-test-renderer, então um
// TextInput de mentira expõe o ref imperativo que o componente usa
// (`blur`/`focus`) e delega a renderização ao TextInput real — assim
// `fireEvent` continua chegando nos handlers de verdade.
jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  const ReactActual = jest.requireActual('react');
  // React 19 passa `ref` como prop; o mock só precisa expor o ref imperativo.
  function MockTextInput({
    ref,
    ...props
  }: {
    ref?: React.Ref<unknown>;
  } & Record<string, unknown>) {
    ReactActual.useImperativeHandle(ref, () => ({
      blur: mockBlur,
      focus: mockFocus,
      clear: jest.fn(),
      isFocused: () => false,
    }));
    return ReactActual.createElement(actual.TextInput, props);
  }

  return new Proxy(actual, {
    get(target, prop) {
      if (prop === 'TextInput') {
        return MockTextInput;
      }
      return Reflect.get(target, prop);
    },
  });
});

const TEST_ID = 'autocomplete';
const CATALOG = ['Alpha', 'Alpine', 'Beta'];

function filterSuggestions(query: string) {
  const term = query.trim().toLowerCase();
  if (!term) {
    return [];
  }
  return CATALOG.filter(name => name.toLowerCase().includes(term));
}

function Harness({
  initialValue = '',
  onChangeText = jest.fn(),
  onSelect = jest.fn(),
}: {
  initialValue?: string;
  onChangeText?: (text: string) => void;
  onSelect?: (name: string) => void;
}) {
  const [value, setValue] = React.useState(initialValue);

  return (
    <AutocompleteField
      value={value}
      onChangeText={next => {
        setValue(next);
        onChangeText(next);
      }}
      suggestions={filterSuggestions(value)}
      onSelect={name => {
        setValue(name);
        onSelect(name);
      }}
      testID={TEST_ID}
      placeholder="Digite ou escolha"
    />
  );
}

function suggestion(testId: string, name: string) {
  return screen.queryByTestId(`${testId}-suggestion-${name}`);
}

async function focusAndType(
  input: ReturnType<typeof screen.getByTestId>,
  text: string,
) {
  await fireEvent(input, 'focus');
  await fireEvent.changeText(input, text);
}

beforeEach(() => {
  mockBlur.mockClear();
  mockFocus.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('AutocompleteField', () => {
  test('selecting a suggestion fills the field, closes the list and blurs the input', async () => {
    const onSelect = jest.fn();
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    await render(<Harness onSelect={onSelect} />);

    const input = screen.getByTestId(TEST_ID);
    await focusAndType(input, 'Al');
    expect(suggestion(TEST_ID, 'Alpha')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId(`${TEST_ID}-suggestion-Alpha`));

    expect(onSelect).toHaveBeenCalledWith('Alpha');
    expect(screen.getByTestId(TEST_ID).props.value).toBe('Alpha');
    expect(suggestion(TEST_ID, 'Alpha')).toBeNull();
    expect(mockBlur).toHaveBeenCalledTimes(1);
    expect(dismiss).toHaveBeenCalled();
  });

  test('editing after a selection reopens the list with filtered suggestions', async () => {
    await render(<Harness />);

    const input = screen.getByTestId(TEST_ID);
    await focusAndType(input, 'Al');
    await fireEvent.press(screen.getByTestId(`${TEST_ID}-suggestion-Alpha`));
    expect(suggestion(TEST_ID, 'Alpha')).toBeNull();

    await fireEvent.changeText(screen.getByTestId(TEST_ID), 'Al');

    expect(suggestion(TEST_ID, 'Alpha')).toBeOnTheScreen();
    expect(suggestion(TEST_ID, 'Alpine')).toBeOnTheScreen();
    expect(suggestion(TEST_ID, 'Beta')).toBeNull();
  });

  test('reopens the list while editing even without a new focus event', async () => {
    await render(<Harness />);

    const input = screen.getByTestId(TEST_ID);
    await focusAndType(input, 'Al');
    await fireEvent.press(screen.getByTestId(`${TEST_ID}-suggestion-Alpha`));

    // Sem `fireEvent(input, 'focus')`: a edição sozinha já reabre a lista.
    await fireEvent.changeText(screen.getByTestId(TEST_ID), 'Alpi');

    expect(suggestion(TEST_ID, 'Alpha')).toBeNull();
    expect(suggestion(TEST_ID, 'Alpine')).toBeOnTheScreen();
  });

  test('erasing the whole query keeps the list closed', async () => {
    await render(<Harness />);

    const input = screen.getByTestId(TEST_ID);
    await focusAndType(input, 'Al');
    await fireEvent.press(screen.getByTestId(`${TEST_ID}-suggestion-Alpha`));

    await fireEvent.changeText(screen.getByTestId(TEST_ID), 'Bet');
    expect(suggestion(TEST_ID, 'Beta')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByTestId(TEST_ID), '');
    expect(suggestion(TEST_ID, 'Beta')).toBeNull();
    expect(screen.getByTestId(TEST_ID).props.value).toBe('');
  });

  test('keeps accepting and reporting free text', async () => {
    const onChangeText = jest.fn();
    await render(<Harness onChangeText={onChangeText} />);

    const input = screen.getByTestId(TEST_ID);
    await focusAndType(input, 'Etnia escrita à mão');

    expect(onChangeText).toHaveBeenLastCalledWith('Etnia escrita à mão');
    expect(screen.getByTestId(TEST_ID).props.value).toBe('Etnia escrita à mão');
    expect(screen.queryByText('Alpha')).toBeNull();
  });

  test('the chevron toggles the suggestion list', async () => {
    await render(<Harness />);

    const input = screen.getByTestId(TEST_ID);
    await focusAndType(input, 'Al');
    expect(suggestion(TEST_ID, 'Alpha')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId(`${TEST_ID}-toggle`));
    expect(suggestion(TEST_ID, 'Alpha')).toBeNull();

    await fireEvent.press(screen.getByTestId(`${TEST_ID}-toggle`));
    expect(suggestion(TEST_ID, 'Alpha')).toBeOnTheScreen();
  });

  test('blurring closes the list', async () => {
    await render(<Harness />);

    const input = screen.getByTestId(TEST_ID);
    await focusAndType(input, 'Al');
    expect(suggestion(TEST_ID, 'Alpha')).toBeOnTheScreen();

    await fireEvent(input, 'blur');

    expect(suggestion(TEST_ID, 'Alpha')).toBeNull();
  });
});
