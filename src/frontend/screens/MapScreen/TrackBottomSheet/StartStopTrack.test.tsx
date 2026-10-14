import * as React from 'react';
import fs from 'fs';
import path from 'path';
import {render, screen} from '@testing-library/react-native';
import {IntlProvider} from 'react-intl';

import {StartStopTrack} from './StartStopTrack';
import {DARK_GREY} from '../../../lib/styles';

// Issue #19 (PR A, passo 2). O PrimaryButton desta tela agora passa a própria
// cor para o ícone: o StartTracking.svg deixa de ser branco fixo e o
// renderIcon repassa a cor recebida (DARK_GREY sobre ORANGE, 6.77).

jest.mock('../../../hooks/useTracking.ts', () => ({
  useTracking: () => ({
    isTracking: false,
    startTracking: jest.fn(),
    endTracking: jest.fn(),
  }),
}));

jest.mock('../../../hooks/useNavigationWithTypes.ts', () => ({
  useNavigationFromHomeTabs: () => ({
    navigate: jest.fn(),
    setParams: jest.fn(),
  }),
}));

jest.mock('../../../hooks/server/presets', () => ({
  usePresetsQuery: () => ({data: undefined}),
}));

jest.mock('../../../contexts/TrackStoreContext.tsx', () => ({
  useTrackState: () => 0,
}));

jest.mock('../../../images/StartTracking.svg', () => jest.fn(() => null));
jest.mock('../../../images/StopTracking.svg', () => jest.fn(() => null));

const StartTrackingIcon = jest.requireMock(
  '../../../images/StartTracking.svg',
) as jest.Mock;

describe('StartStopTrack (PR A #19, passo 2)', () => {
  test('o mock do ícone recebe a cor DARK_GREY do botão', async () => {
    await render(
      <IntlProvider locale="pt-BR" messages={{}} onError={() => null}>
        <StartStopTrack />
      </IntlProvider>,
    );

    expect(await screen.findByText('Start Tracks')).toBeOnTheScreen();
    expect(StartTrackingIcon).toHaveBeenCalledWith(
      expect.objectContaining({color: DARK_GREY}),
      // O React invoca o componente mock com (props, legacyContext).
      undefined,
    );
  });

  // O jest troca o SVG por mock, então o arquivo não passa por render nesta
  // suíte: o contrato observável aqui é o TEXTO do arquivo (o transformador
  // do Metro resolve fill="currentColor" com a prop recebida).
  test('StartTracking.svg não trava branco fixo; usa currentColor', () => {
    const svgText = fs.readFileSync(
      path.join(__dirname, '../../../images/StartTracking.svg'),
      'utf8',
    );
    expect(svgText).not.toMatch(/fill="white"/);
    expect(svgText).toMatch(/fill="currentColor"/);
  });
});
