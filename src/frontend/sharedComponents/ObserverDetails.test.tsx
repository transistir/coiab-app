import * as React from 'react';
import {render, screen} from '@testing-library/react-native';
import {IntlProvider} from 'react-intl';

import {ObserverDetails} from './ObserverDetails';

const MESSAGES = {
  '$1screens.Observation.recordedBy': 'Registrado por',
};

function renderObserverDetails(
  props: React.ComponentProps<typeof ObserverDetails>,
) {
  return render(
    <IntlProvider locale="pt-BR" messages={MESSAGES}>
      <ObserverDetails {...props} />
    </IntlProvider>,
  );
}

describe('ObserverDetails', () => {
  test('renderiza o autor de quem registrou', async () => {
    await renderObserverDetails({authorName: 'Aparelho da Maria'});

    expect(screen.getByText('Registrado por')).toBeOnTheScreen();
    expect(screen.getByText('Aparelho da Maria')).toBeOnTheScreen();
  });

  test('sem autor não renderiza nada', async () => {
    await renderObserverDetails({authorName: undefined});

    expect(screen.toJSON()).toBeNull();
  });
});
