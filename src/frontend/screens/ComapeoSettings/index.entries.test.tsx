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
jest.mock('../../contexts/UserProfileStoreContext', () => ({
  useUserProfileState: jest.fn(),
}));
jest.mock('../../contexts/CoiabOrganizationsStoreContext', () => ({
  useCoiabOrganizationsState: jest.fn(),
}));

import {useProjectRoleAndDetails} from '../../hooks/useProjectRoleAndDetails';
import {useUserProfileState} from '../../contexts/UserProfileStoreContext';
import type {CoordinationRole} from '../../contexts/UserProfileStoreContext';
import {useCoiabOrganizationsState} from '../../contexts/CoiabOrganizationsStoreContext';

const roleMock = useProjectRoleAndDetails as jest.Mock;
const profileMock = useUserProfileState as jest.Mock;
const organizationsMock = useCoiabOrganizationsState as jest.Mock;

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

function mockCoordinationRole(role: CoordinationRole) {
  profileMock.mockReturnValue({
    ethnicity: null,
    village: null,
    coordinationRole: role,
  });
}

function mockOrganizations(count: number) {
  organizationsMock.mockReturnValue({
    organizacoes: Array.from({length: count}, (_, index) => ({
      id: `org-${index}`,
    })),
  });
}

describe('AppSettings — migração dos acessos removidos do Menu (Entroncamento)', () => {
  beforeEach(() => {
    mockRole('coordinator');
    mockCoordinationRole('coordinator');
    mockOrganizations(1);
    navigate.mockClear();
  });

  test.each(['coordinator', 'participant', 'solo'] as const)(
    '%s: Mapa de fundo saiu de Configurações (#157)',
    async role => {
      mockRole(role);
      mockCoordinationRole(
        role === 'participant' ? 'participant' : 'coordinator',
      );
      await render(
        <IntlProvider locale="en" messages={{}}>
          <AppSettings
            navigation={mockNavigation as never}
            route={mockRoute as never}
          />
        </IntlProvider>,
      );

      // Âncora positiva: a tela montou e a lista de Configurações renderizou.
      expect(screen.getByTestId('device-name-list-item')).toBeOnTheScreen();
      expect(
        screen.queryByTestId('settingsBackgroundMapsButton'),
      ).not.toBeOnTheScreen();
      expect(screen.queryByText('Background Map')).not.toBeOnTheScreen();
    },
  );

  test('participant: ProjectSettings e Criar território ausentes; YourTeam presente', async () => {
    mockRole('participant');
    mockCoordinationRole('participant');
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
    expect(
      screen.queryByTestId('settingsCreateOrganizationButton'),
    ).not.toBeOnTheScreen();
    expect(screen.getByTestId('settingsYourTeamButton')).toBeOnTheScreen();
  });

  // #131: perfis v2–v5 hidratam `coordinationRole: null` ("não respondido").
  // Esconder a entrada nesse caso tiraria o único caminho de criação de
  // território de um coordenador legado — o menu não tem mais a ação.
  test('papel de coordenação não respondido (perfil legado): Criar território presente', async () => {
    mockCoordinationRole(null);
    await render(
      <IntlProvider locale="en" messages={{}}>
        <AppSettings
          navigation={mockNavigation as never}
          route={mockRoute as never}
        />
      </IntlProvider>,
    );

    expect(
      screen.getByTestId('settingsCreateOrganizationButton'),
    ).toBeOnTheScreen();
  });

  test('coordenador: Criar território presente', async () => {
    mockCoordinationRole('coordinator');
    await render(
      <IntlProvider locale="en" messages={{}}>
        <AppSettings
          navigation={mockNavigation as never}
          route={mockRoute as never}
        />
      </IntlProvider>,
    );

    expect(
      screen.getByTestId('settingsCreateOrganizationButton'),
    ).toBeOnTheScreen();
  });

  test('solo: YourTeam ausente (sem equipe)', async () => {
    mockRole('solo');
    mockCoordinationRole('coordinator');
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
      screen.getByTestId('settingsProjectSettingsButton'),
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('settingsCreateOrganizationButton'),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('settingsYourTeamButton')).toBeOnTheScreen();

    // Navegação simulada: cada entrada despacha a rota certa.
    await fireEvent.press(screen.getByTestId('settingsProjectSettingsButton'));
    expect(navigate).toHaveBeenCalledWith('ProjectSettings');
    await fireEvent.press(
      screen.getByTestId('settingsCreateOrganizationButton'),
    );
    expect(navigate).toHaveBeenCalledWith('CreateOrganization');
    await fireEvent.press(screen.getByTestId('settingsYourTeamButton'));
    expect(navigate).toHaveBeenCalledWith('YourTeam');
  });

  test('duas organizações: Trocar de território presente e abre o seletor', async () => {
    mockOrganizations(2);
    await render(
      <IntlProvider locale="en" messages={{}}>
        <AppSettings
          navigation={mockNavigation as never}
          route={mockRoute as never}
        />
      </IntlProvider>,
    );

    expect(
      screen.getByTestId('settingsSwitchTerritoryButton'),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('settingsSwitchTerritoryButton'));
    expect(navigate).toHaveBeenCalledWith('Organizations');
  });

  test('uma organização: Trocar de território ausente', async () => {
    mockOrganizations(1);
    await render(
      <IntlProvider locale="en" messages={{}}>
        <AppSettings
          navigation={mockNavigation as never}
          route={mockRoute as never}
        />
      </IntlProvider>,
    );

    expect(
      screen.queryByTestId('settingsSwitchTerritoryButton'),
    ).not.toBeOnTheScreen();
  });

  test('solo + participant: cabeçalho Territory ausente quando a seção fica vazia (#157)', async () => {
    mockRole('solo');
    mockCoordinationRole('participant');
    mockOrganizations(1);
    await render(
      <IntlProvider locale="en" messages={{}}>
        <AppSettings
          navigation={mockNavigation as never}
          route={mockRoute as never}
        />
      </IntlProvider>,
    );

    // Âncora positiva: a tela montou e outras seções continuam renderizando.
    expect(screen.getByText('Device Name')).toBeOnTheScreen();
    expect(screen.getByTestId('device-name-list-item')).toBeOnTheScreen();
    // Sem nenhuma linha na seção, o cabeçalho não deve aparecer.
    expect(screen.queryByText('Territory')).not.toBeOnTheScreen();
  });
});
