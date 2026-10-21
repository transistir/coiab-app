import * as React from 'react';
import {IntlProvider} from 'react-intl';
import {fireEvent, render, screen} from '@testing-library/react-native';

import {AppSettings} from './index';

jest.mock('../../contexts/AuthContext', () => ({
  useAuthContext: () => ({authState: 'obscured'}),
}));
jest.mock('../../contexts/EarlyAccessContext', () => ({
  useEarlyAccessState: (
    selector: (s: {isEarlyAccessEnabled: boolean}) => unknown,
  ) => selector({isEarlyAccessEnabled: false}),
}));
jest.mock('../../contexts/CoordinateFormatStoreContext', () => ({
  useCoordinateFormat: () => 'utm' as const,
}));
jest.mock('../../contexts/LocaleStoreContext', () => ({
  useLocaleState: (selector: (s: {languageTag: string}) => unknown) =>
    selector({languageTag: 'en'}),
}));
jest.mock('../../contexts/SecurityStoreContext', () => ({
  useSecurityState: (selector: (s: {passcode: string | null}) => unknown) =>
    selector({passcode: null}),
}));
jest.mock('../../contexts/UnitSystemStoreContext', () => ({
  useUnitSystem: () => 'metric' as const,
}));
jest.mock('../../contexts/QADeviceNameStoreContext', () => ({
  useQADeviceName: () => null,
}));
jest.mock('../../lib/appVariant', () => ({isQABuild: false}));
jest.mock('@comapeo/core-react', () => ({
  useOwnDeviceInfo: () => ({data: undefined}),
}));
jest.mock('../../contexts/ActiveProjectContext', () => ({
  useActiveProject: () => ({projectId: 'p-teste'}),
}));
jest.mock('../../hooks/useProjectRoleAndDetails', () => ({
  useProjectRoleAndDetails: jest.fn(),
}));

import {useProjectRoleAndDetails} from '../../hooks/useProjectRoleAndDetails';

const roleMock = useProjectRoleAndDetails as jest.Mock;

// O componente consome as props tipadas `navigation`/`route` do
// react-navigation; nos testes um dublê com o `navigate` espiado basta
// (padrão `as never` do AddRemoteArchive.test.tsx — sem `any`).
const navigate = jest.fn();
const mockNavigation = {
  navigate,
  setOptions: jest.fn(),
  addListener: jest.fn(),
};
const mockRoute = {key: 'AppSettings-duble', name: 'AppSettings'} as const;

function mockRole(role: 'coordinator' | 'participant' | 'solo') {
  roleMock.mockReturnValue({
    role,
    projectHeader: 'Organização',
    projectName: 'Organização',
    projectColor: '#232323',
    projectDescription: undefined,
  });
}

describe('AppSettings — migração dos acessos removidos do Menu (Entroncamento)', () => {
  beforeEach(() => {
    mockRole('coordinator');
  });

  test('participant: ProjectSettings ausente; YourTeam e BackgroundMaps presentes', async () => {
    mockRole('participant');
    await render(
      <IntlProvider locale="en" messages={{}}>
        <AppSettings
          navigation={mockNavigation as never}
          route={mockRoute as never}
        />
      </IntlProvider>,
    );

    expect(
      screen.queryByTestId('settingsProjectSettingsButton'),
    ).not.toBeOnTheScreen();
    expect(screen.getByTestId('settingsYourTeamButton')).toBeOnTheScreen();
    expect(
      screen.getByTestId('settingsBackgroundMapsButton'),
    ).toBeOnTheScreen();
  });

  test('solo: YourTeam ausente (sem equipe); BackgroundMaps sem restrição', async () => {
    mockRole('solo');
    await render(
      <IntlProvider locale="en" messages={{}}>
        <AppSettings
          navigation={mockNavigation as never}
          route={mockRoute as never}
        />
      </IntlProvider>,
    );

    expect(
      screen.queryByTestId('settingsYourTeamButton'),
    ).not.toBeOnTheScreen();
    expect(
      screen.getByTestId('settingsBackgroundMapsButton'),
    ).toBeOnTheScreen();
  });

  test('coordinator: entradas novas presentes e navegam para as rotas certas', async () => {
    await render(
      <IntlProvider locale="en" messages={{}}>
        <AppSettings
          navigation={mockNavigation as never}
          route={mockRoute as never}
        />
      </IntlProvider>,
    );

    expect(
      screen.getByTestId('settingsBackgroundMapsButton'),
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('settingsProjectSettingsButton'),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('settingsYourTeamButton')).toBeOnTheScreen();

    // Navegação simulada: cada entrada despacha a rota certa.
    await fireEvent.press(screen.getByTestId('settingsBackgroundMapsButton'));
    expect(navigate).toHaveBeenCalledWith('BackgroundMaps');
    await fireEvent.press(screen.getByTestId('settingsProjectSettingsButton'));
    expect(navigate).toHaveBeenCalledWith('ProjectSettings');
    await fireEvent.press(screen.getByTestId('settingsYourTeamButton'));
    expect(navigate).toHaveBeenCalledWith('YourTeam');
  });
});
