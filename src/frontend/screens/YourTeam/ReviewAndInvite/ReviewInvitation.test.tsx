import * as React from 'react';
import {StyleSheet} from 'react-native';
import type {TestInstance} from 'test-renderer';
import {render, screen} from '@testing-library/react-native';
import {IntlProvider} from 'react-intl';

import {ReviewInvitation} from './ReviewInvitation';
import {ORANGE, WHITE} from '../../../lib/styles';
import {DeviceType, MEMBER_ROLE_ID} from '../../../sharedTypes';

// The v14 merge restored upstream's "Send Invite" colours: the legacy Button
// keeps the ORANGE background and the custom children are WHITE. The COIAB
// #19 DARK_GREY fix is not part of the merged component, so these assertions
// follow the component as merged. Restoring #19 is a component change, not a
// test change.
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
        deviceId="device-1"
        role={MEMBER_ROLE_ID}
        deviceType={'mobile' as DeviceType}
        sendInvite={() => {}}
      />
    </IntlProvider>,
  );
}

describe('ReviewInvitation (merged v14 — cores do Send Invite)', () => {
  test('ícone e texto são WHITE sobre o fundo ORANGE do botão', async () => {
    await renderTela();

    const texto = screen.getByText('Send Invite');
    expect(fundoDe(ancestralComFundo(texto)?.props.style)).toBe(ORANGE);
    expect(StyleSheet.flatten(texto.props.style)).toEqual(
      expect.objectContaining({color: WHITE}),
    );

    // O texto.parent é o flexRow do botão: [ícone, texto]. O v13 do
    // vector-icons funde o color prop no style de cada Text (styleDefaults).
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
    expect(coresNoFlexRow).toContain(WHITE);
  });
});
