import * as React from 'react';
import {render, screen} from '@testing-library/react-native';
import {IntlProvider} from 'react-intl';

import {ObserverDetails} from './ObserverDetails';

const MESSAGES = {
  '$1screens.Observation.observerEthnicity': 'Etnia do observador',
  '$1screens.Observation.observerVillage': 'Aldeia do observador',
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
  test('renderiza só a etnia quando só ela existe', async () => {
    await renderObserverDetails({ethnicity: 'Mawayana'});

    expect(screen.getByText('Etnia do observador')).toBeOnTheScreen();
    expect(screen.getByText('Mawayana')).toBeOnTheScreen();
    expect(screen.queryByText('Aldeia do observador')).toBeNull();
    expect(screen.queryByText('Registrado por')).toBeNull();
  });

  test('renderiza só a aldeia quando só ela existe', async () => {
    await renderObserverDetails({village: 'Aldeia Nova'});

    expect(screen.getByText('Aldeia do observador')).toBeOnTheScreen();
    expect(screen.getByText('Aldeia Nova')).toBeOnTheScreen();
    expect(screen.queryByText('Etnia do observador')).toBeNull();
  });

  test('renderiza etnia, aldeia e autor quando todos existem', async () => {
    await renderObserverDetails({
      ethnicity: 'Mawayana',
      village: 'Aldeia Nova',
      authorName: 'Aparelho da Maria',
    });

    expect(screen.getByText('Etnia do observador')).toBeOnTheScreen();
    expect(screen.getByText('Mawayana')).toBeOnTheScreen();
    expect(screen.getByText('Aldeia do observador')).toBeOnTheScreen();
    expect(screen.getByText('Aldeia Nova')).toBeOnTheScreen();
    expect(screen.getByText('Registrado por')).toBeOnTheScreen();
    expect(screen.getByText('Aparelho da Maria')).toBeOnTheScreen();
  });

  test('omite o autor quando o nome não existe, mantendo etnia e aldeia', async () => {
    await renderObserverDetails({
      ethnicity: 'Mawayana',
      village: 'Aldeia Nova',
      authorName: undefined,
    });

    expect(screen.queryByText('Registrado por')).toBeNull();
    expect(screen.getByText('Mawayana')).toBeOnTheScreen();
    expect(screen.getByText('Aldeia Nova')).toBeOnTheScreen();
  });

  test('sem nenhum dado não renderiza nada', async () => {
    await renderObserverDetails({});

    expect(screen.toJSON()).toBeNull();
  });
});
