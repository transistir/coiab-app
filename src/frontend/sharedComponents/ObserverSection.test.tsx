import * as React from 'react';
import {render, screen} from '@testing-library/react-native';
import {IntlProvider} from 'react-intl';
import {useSingleMember} from '@comapeo/core-react';

import {ObserverSection} from './ObserverSection';

jest.mock('@comapeo/core-react', () => ({
  useSingleMember: jest.fn(),
}));

jest.mock('../contexts/ActiveProjectContext', () => ({
  useActiveProject: () => ({projectId: 'project-1', projectApi: {}}),
}));

const useSingleMemberMock = useSingleMember as jest.Mock;

const MESSAGES = {
  '$1screens.Observation.observerEthnicity': 'Etnia do observador',
  '$1screens.Observation.observerVillage': 'Aldeia do observador',
  '$1screens.Observation.recordedBy': 'Registrado por',
};

const TAGS = {
  'coiab:etnia': 'Mawayana',
  'coiab:aldeia': 'Aldeia Nova',
};

function renderSection() {
  return render(
    <IntlProvider locale="pt-BR" messages={MESSAGES}>
      <ObserverSection createdBy="device-1" tags={TAGS} />
    </IntlProvider>,
  );
}

describe('ObserverSection', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  test('consulta de membro pendente não esconde etnia e aldeia', async () => {
    // O hook usa suspense: uma promessa que nunca resolve mantém o nome do
    // aparelho suspenso, mas etnia e aldeia vêm das tags e devem aparecer.
    useSingleMemberMock.mockImplementation(() => {
      throw new Promise(() => {});
    });

    await renderSection();

    expect(screen.getByText('Mawayana')).toBeOnTheScreen();
    expect(screen.getByText('Aldeia Nova')).toBeOnTheScreen();
  });

  test('consulta de membro com erro não derruba nem esconde etnia e aldeia', async () => {
    useSingleMemberMock.mockImplementation(() => {
      throw new Error('member query failed');
    });

    await renderSection();

    expect(screen.getByText('Mawayana')).toBeOnTheScreen();
    expect(screen.getByText('Aldeia Nova')).toBeOnTheScreen();
  });

  test('membro resolvido mostra o nome de quem registrou', async () => {
    useSingleMemberMock.mockReturnValue({data: {name: 'Tablet 1'}});

    await renderSection();

    expect(screen.getByText('Mawayana')).toBeOnTheScreen();
    expect(screen.getByText('Aldeia Nova')).toBeOnTheScreen();
    expect(screen.getByText('Registrado por')).toBeOnTheScreen();
    expect(screen.getByText('Tablet 1')).toBeOnTheScreen();
  });
});
