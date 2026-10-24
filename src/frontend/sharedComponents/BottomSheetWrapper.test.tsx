import * as React from 'react';
import {act, fireEvent, render, screen} from '@testing-library/react-native';
import {Text} from 'react-native';

import {BottomSheetWrapper} from './BottomSheetWrapper';

const mockGoBack = jest.fn();
const mockDispatch = jest.fn();
const mockAddListener = jest.fn();

type NavigationListener = (event: {
  data: {action: {type: string}};
  preventDefault: () => void;
}) => void;
const beforeRemoveListeners: NavigationListener[] = [];

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  const React = jest.requireActual('react');
  return {
    ...actual,
    useNavigation: () => ({
      goBack: mockGoBack,
      dispatch: mockDispatch,
      addListener: mockAddListener,
    }),
    // The real hook needs a focused screen; drive the effect directly.
    useFocusEffect: (callback: () => void | (() => void)) => {
      React.useEffect(callback, [callback]);
    },
  };
});

/**
 * The deep-import shim is consumed as `.default` by react-native's index, so
 * the mock carries the same shape (as in OrganizationProvisioning.test.tsx).
 */
jest.mock('react-native/Libraries/Utilities/BackHandler', () => {
  const live: Array<() => boolean> = [];
  const addEventListener = jest.fn((_event: string, handler: () => boolean) => {
    live.push(handler);
    return {
      remove: jest.fn(() => {
        const index = live.indexOf(handler);
        if (index >= 0) live.splice(index, 1);
      }),
    };
  });
  return {
    __esModule: true,
    __live: live,
    default: {exitApp: () => {}, addEventListener},
  };
});

const backHandlerMock = jest.requireMock(
  'react-native/Libraries/Utilities/BackHandler',
) as {
  __live: Array<() => boolean>;
  default: {addEventListener: jest.Mock};
};

beforeEach(() => {
  jest.clearAllMocks();
  beforeRemoveListeners.length = 0;
  backHandlerMock.__live.length = 0;
  mockAddListener.mockImplementation(
    (event: string, listener: NavigationListener) => {
      if (event === 'beforeRemove') beforeRemoveListeners.push(listener);
      return jest.fn();
    },
  );
});

/** Simulates the navigator's removal attempt (what goBack would produce). */
async function attemptGoBack() {
  await act(async () => {
    for (const listener of beforeRemoveListeners) {
      listener({data: {action: {type: 'GO_BACK'}}, preventDefault: jest.fn()});
    }
  });
}

describe('BottomSheetWrapper', () => {
  test('por padrão o backdrop NÃO fecha o sheet (opt-in)', async () => {
    await render(
      <BottomSheetWrapper>
        <Text>conteúdo do sheet</Text>
      </BottomSheetWrapper>,
    );

    await fireEvent.press(screen.getByTestId('SHEET.backdrop'));

    expect(mockGoBack).not.toHaveBeenCalled();
    expect(screen.getByText('conteúdo do sheet')).toBeOnTheScreen();
  });

  test('com dismissable, tocar no backdrop fecha via goBack', async () => {
    await render(
      <BottomSheetWrapper dismissable>
        <Text>conteúdo do sheet</Text>
      </BottomSheetWrapper>,
    );

    await fireEvent.press(screen.getByTestId('SHEET.backdrop'));

    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  test('o backdrop é invisível para leitores de tela', async () => {
    await render(
      <BottomSheetWrapper dismissable>
        <Text>conteúdo do sheet</Text>
      </BottomSheetWrapper>,
    );

    const backdrop = screen.getByTestId('SHEET.backdrop');
    expect(backdrop.props.accessible).toBe(false);
    expect(backdrop.props.importantForAccessibility).toBe('no');
  });

  test('segundo toque durante a saída (140ms) é inerte', async () => {
    await render(
      <BottomSheetWrapper dismissable>
        <Text>conteúdo do sheet</Text>
      </BottomSheetWrapper>,
    );

    // The first removal attempt hides the content and starts the exit window.
    await attemptGoBack();
    expect(screen.queryByText('conteúdo do sheet')).not.toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('SHEET.backdrop'));

    expect(mockGoBack).not.toHaveBeenCalled();
  });

  test('hardware back é consumido quando closeOnBackButtonPress não é passado', async () => {
    await render(
      <BottomSheetWrapper>
        <Text>conteúdo do sheet</Text>
      </BottomSheetWrapper>,
    );

    expect(backHandlerMock.default.addEventListener).toHaveBeenCalledTimes(1);
    const [event, handler] =
      backHandlerMock.default.addEventListener.mock.calls[0];
    expect(event).toBe('hardwareBackPress');
    expect(handler()).toBe(true);

    expect(mockGoBack).not.toHaveBeenCalled();
    expect(screen.getByText('conteúdo do sheet')).toBeOnTheScreen();
  });

  test('closeOnBackButtonPress sozinho deixa o navegador tratar o back (semântica upstream)', async () => {
    await render(
      <BottomSheetWrapper closeOnBackButtonPress dismissable={false}>
        <Text>conteúdo do sheet</Text>
      </BottomSheetWrapper>,
    );

    expect(backHandlerMock.default.addEventListener).not.toHaveBeenCalled();
  });

  test('hardware back fica inerte durante a janela de saída', async () => {
    await render(
      <BottomSheetWrapper closeOnBackButtonPress dismissable>
        <Text>conteúdo do sheet</Text>
      </BottomSheetWrapper>,
    );

    // Antes da saída o navegador trata o back (closeOnBackButtonPress).
    expect(backHandlerMock.default.addEventListener).not.toHaveBeenCalled();

    await attemptGoBack();
    expect(screen.queryByText('conteúdo do sheet')).not.toBeOnTheScreen();

    // Durante a animação de saída o back é consumido, como o scrim.
    expect(backHandlerMock.default.addEventListener).toHaveBeenCalledTimes(1);
    const [, handler] = backHandlerMock.default.addEventListener.mock.calls[0];
    expect(handler()).toBe(true);
  });

  test('alternar dismissable não remonta a árvore (assinatura 1 → 0 → 1)', async () => {
    const montagens = jest.fn();
    const Filho = () => {
      React.useEffect(() => {
        montagens();
      }, []);
      return <Text>conteúdo do sheet</Text>;
    };

    // Mesmo par que Organizations alterna: ativando=false → dismissable e
    // closeOnBackButtonPress ativos; ativando=true → ambos desligados.
    const {rerender} = await render(
      <BottomSheetWrapper closeOnBackButtonPress={false} dismissable>
        <Filho />
      </BottomSheetWrapper>,
    );
    expect(backHandlerMock.__live).toHaveLength(1);

    await rerender(
      <BottomSheetWrapper closeOnBackButtonPress dismissable={false}>
        <Filho />
      </BottomSheetWrapper>,
    );
    expect(backHandlerMock.__live).toHaveLength(0);

    await rerender(
      <BottomSheetWrapper closeOnBackButtonPress={false} dismissable>
        <Filho />
      </BottomSheetWrapper>,
    );
    expect(backHandlerMock.__live).toHaveLength(1);

    // A árvore é a mesma: o efeito de montagem do filho rodou uma única vez.
    expect(montagens).toHaveBeenCalledTimes(1);
  });
});
