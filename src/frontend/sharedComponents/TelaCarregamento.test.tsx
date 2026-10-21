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
  expect(
    StyleSheet.flatten(screen.getByTestId('CARREGAMENTO.scrn').props.style),
  ).toEqual(expect.objectContaining({backgroundColor: DARK_GREY}));
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

test('T7d: com label, o rótulo é HeaderText header4 presente (fontSize 18)', async () => {
  await render(<TelaCarregamento label="Carregando organização…" />);

  // header4 do HeaderText = {fontFamily: rubik-medium, fontSize: 18}
  expect(screen.getByText('Carregando organização…')).toHaveStyle({
    fontFamily: 'Rubik_500Medium',
    fontSize: 18,
  });
});

test('T7e: nenhuma Image no tree (apenas fundo, spinner e rótulo textual)', async () => {
  const json = (
    await render(<TelaCarregamento label="Carregando organização…" />)
  ).toJSON();
  expect(json).not.toBeNull();

  const tipos: string[] = [];
  const walk = (node: {type: string; children?: unknown[]} | string) => {
    if (typeof node === 'string') return;
    tipos.push(node.type);
    (node.children ?? []).forEach(child =>
      walk(child as {type: string; children?: unknown[]} | string),
    );
  };
  walk(json as Exclude<typeof json, null>);

  expect(tipos.filter(t => t === 'Image')).toHaveLength(0);
});

test('T7f: sem label, nenhum texto renderiza — só spinner', async () => {
  await render(<TelaCarregamento />);

  expect(screen.queryByText(/.+/)).toBeNull();
  expect(screen.getByTestId('LoadingIndicatorProbe')).toBeTruthy();
});
