import * as React from 'react';
import type {TestInstance} from 'test-renderer';
import {render, screen} from '@testing-library/react-native';

import {Button} from './Button';
import {PrimaryButton} from './Buttons';
import {BLUE_GREY, COMAPEO_BLUE, DARK_GREY, ORANGE, WHITE} from '../lib/styles';

// O estilo do host chega achatado em alguns componentes (TouchableOpacity) e
// como array cru em outros (View). fundoDe acha o primeiro backgroundColor em
// qualquer forma; o testID do Button legado vai ao View interno, então para
// achar a sua cor de fundo subimos da linha de texto até o primeiro ancestral
// opaco.
function fundoDe(estilo: unknown): string | undefined {
  if (Array.isArray(estilo)) {
    for (const camada of estilo) {
      const valor = fundoDe(camada);
      if (valor !== undefined) return valor;
    }
    return undefined;
  }
  if (
    typeof estilo === 'object' &&
    estilo !== null &&
    'backgroundColor' in estilo &&
    typeof estilo.backgroundColor === 'string'
  ) {
    return estilo.backgroundColor;
  }
  return undefined;
}

function ancestralComFundo(node: TestInstance | null): TestInstance | null {
  for (
    let atual: TestInstance | null = node;
    atual !== null;
    atual = atual.parent
  ) {
    if (fundoDe(atual.props.style) !== undefined) return atual;
  }
  return null;
}

// Issue #19 (PR A, passo 2). O botão principal troca o azul CoMapeo por
// laranja ORANGE; fundo e borda ORANGE, texto e ícone em DARK_GREY (6.77).
// O desabilitado não muda: BLUE_GREY com WHITE, isento pela WCAG (registro).

describe('PrimaryButton (PR A #19, passo 2)', () => {
  test('habilitado: fundo e borda ORANGE, texto e ícone DARK_GREY', async () => {
    const renderIcon = jest.fn(() => null);
    await render(
      <PrimaryButton
        fullSize
        text="COMEÇAR"
        onPress={() => {}}
        renderIcon={renderIcon}
        testID="PRIMARY-OK"
      />,
    );

    const button = screen.getByTestId('PRIMARY-OK');
    expect(button.props.style).toEqual(
      expect.objectContaining({backgroundColor: ORANGE, borderColor: ORANGE}),
    );
    expect(screen.getByText('COMEÇAR').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({color: DARK_GREY})]),
    );
    expect(renderIcon).toHaveBeenCalledWith({color: DARK_GREY, size: 25});
  });

  test('desabilitado continua BLUE_GREY com WHITE (não muda no PR A)', async () => {
    await render(
      <PrimaryButton
        fullSize
        text="SEGURAR"
        disabled
        onPress={() => {}}
        testID="PRIMARY-DIS"
      />,
    );

    const button = screen.getByTestId('PRIMARY-DIS');
    expect(button.props.style).toEqual(
      expect.objectContaining({
        backgroundColor: BLUE_GREY,
        borderColor: BLUE_GREY,
      }),
    );
    expect(screen.getByText('SEGURAR').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({color: WHITE})]),
    );
  });
});

// Exceção à regra de símbolos @deprecated: o Button legado é contrato
// upstream CoMapeo e é migrado no PR B; mantê-lo é requisito de
// compatibilidade externa. Estes testes travam a paleta dele durante a
// transição e serão apagados junto com o componente quando a migração terminar.
describe('Button legado (@deprecated) (PR A #19, passo 2)', () => {
  test('variante contained: fundo ORANGE, texto DARK_GREY', async () => {
    await render(
      <Button testID="LEGADO-CONTAINED" onPress={() => {}}>
        LEGADO
      </Button>,
    );

    const text = screen.getByText('LEGADO');
    const outer = ancestralComFundo(text);
    expect(fundoDe(outer?.props.style)).toBe(ORANGE);
    expect(text.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({color: DARK_GREY})]),
    );
  });

  test('variante outlined ComapeoBlue: texto é a constante (sem azul fixo)', async () => {
    await render(
      <Button
        variant="outlined"
        color="ComapeoBlue"
        testID="LEGADO-OUT"
        onPress={() => {}}>
        OUTLINED
      </Button>,
    );

    expect(screen.getByText('OUTLINED').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({color: COMAPEO_BLUE})]),
    );
  });
});
