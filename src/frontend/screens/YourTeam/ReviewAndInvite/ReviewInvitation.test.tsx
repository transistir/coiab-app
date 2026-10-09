import * as React from 'react';
import type {TestInstance} from 'test-renderer';
import {render, screen} from '@testing-library/react-native';
import {IntlProvider} from 'react-intl';

import {ReviewInvitation} from './ReviewInvitation';
import {DARK_GREY, ORANGE, WHITE} from '../../../lib/styles';
import type {DeviceType} from '../../../sharedTypes';

// Issue #19 (PR A, correção pós-review). O botão "Send Invite" é o último
// consumidor do Button legado com children custom por cima do fundo
// ORANGE — ícone e texto ficam em DARK_GREY (contraste 6.77); WHITE
// sobre ORANGE daria 2.20, abaixo do piso WCAG para texto pequeno.
function fundoDe(estilo: unknown): string | undefined {
  if (Array.isArray(estilo)) {
    for (const item of estilo) {
      const achado = fundoDe(item);
      if (achado !== undefined) return achado;
    }
    return undefined;
  }
  if (
    typeof estilo === 'object' &&
    estilo !== null &&
    'backgroundColor' in estilo &&
    typeof estilo.backgroundColor === 'string' &&
    estilo.backgroundColor !== 'transparent'
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

function renderTela() {
  return render(
    <IntlProvider locale="en" messages={{}}>
      <ReviewInvitation
        name="Celino"
        role="coordinator"
        deviceId="device-1"
        deviceType={'mobile' as DeviceType}
        sendInvite={() => {}}
      />
    </IntlProvider>,
  );
}

describe('ReviewInvitation (PR A #19 — contraste do Send Invite)', () => {
  test('ícone e texto nunca WHITE sobre o fundo ORANGE do botão', async () => {
    await renderTela();

    const texto = screen.getByText('Send Invite');
    expect(fundoDe(ancestralComFundo(texto)?.props.style)).toBe(ORANGE);
    expect(texto.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({color: DARK_GREY})]),
    );
    expect(texto.props.style).not.toEqual(
      expect.arrayContaining([expect.objectContaining({color: WHITE})]),
    );

    // O texto.parent é o flexRow do botão: [ícone, texto]. O v13 do
    // vector-icons funde o color prop no style de cada Text (styleDefaults);
    // nenhuma cor WHITE pode aparecer em nenhum nó do botão.
    const coresDoEstilo = (estilo: unknown): string[] => {
      if (Array.isArray(estilo)) {
        return estilo.flatMap(item => coresDoEstilo(item));
      }
      if (
        typeof estilo === 'object' &&
        estilo !== null &&
        'color' in estilo &&
        typeof estilo.color === 'string'
      ) {
        return [estilo.color];
      }
      return [];
    };

    const coresNoFlexRow =
      texto.parent
        ?.queryAll(node => coresDoEstilo(node.props.style).length > 0)
        .flatMap(node => coresDoEstilo(node.props.style)) ?? [];
    expect(coresNoFlexRow.length).toBeGreaterThan(0);
    expect(coresNoFlexRow).not.toContain(WHITE);
    expect(coresNoFlexRow).toContain(DARK_GREY);
  });
});
