import * as React from 'react';
import {StatusBar, StyleSheet} from 'react-native';
import {render, screen} from '@testing-library/react-native';

import {TelaCarregamento} from './TelaCarregamento';
import {DARK_GREY, WHITE} from '../lib/styles';

// Sonda: o spinner real é o ActivityIndicator nativo do LoadingIndicator; o
// mock registra o color repassado pela TelaCarregamento.
jest.mock('./LoadingIndicator', () => {
  const {createElement} = require('react');
  const {View} = require('react-native');
  return {
    __esModule: true,
    LoadingIndicator: (props: {color?: string}) =>
      createElement(View, {
        testID: 'LoadingIndicatorProbe',
        probeColor: props.color,
      }),
  };
});

// Issue #118 (Fase C, ciclo 4): a tela de carregamento recebe o tema escuro
// do Figma — fundo DARK_GREY, spinner e rótulo em branco. O override do owner
// veta qualquer imagem: só fundo + spinner + rótulo textual.

test('T7a: o fundo de CARREGAMENTO.scrn é DARK_GREY (#1C2A27)', async () => {
  await render(<TelaCarregamento />);
  expect(screen.getByTestId('CARREGAMENTO.scrn')).toHaveStyle({
    backgroundColor: DARK_GREY,
  });
  expect(StyleSheet.flatten(screen.getByTestId('CARREGAMENTO.scrn').props.style)).toEqual(
    expect.objectContaining({backgroundColor: DARK_GREY}),
  );
});

test('T7b: com label, o texto fica branco e o LoadingIndicator recebe color={WHITE}', async () => {
  await render(<TelaCarregamento label="Carregando organização…" />);

  expect(screen.getByText('Carregando organização…')).toHaveStyle({
    color: WHITE,
  });
  expect(screen.getByTestId('LoadingIndicatorProbe').props.probeColor).toBe(
    WHITE,
  );
});

test('T7c: StatusBar estático — light-content ao montar, dark-content no unmount', async () => {
  const spy = jest.spyOn(StatusBar, 'setBarStyle').mockImplementation(() => {});
  try {
    const {unmount} = await render(<TelaCarregamento />);
    expect(spy).toHaveBeenCalledWith('light-content');
    spy.mockClear();
    await unmount();
    expect(spy).toHaveBeenCalledWith('dark-content');
  } finally {
    spy.mockRestore();
  }
});
