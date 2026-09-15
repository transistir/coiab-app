import * as React from 'react';
import {fireEvent, render, screen} from '@testing-library/react-native';
import {IntlProvider} from 'react-intl';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {useClientApi} from '@comapeo/core-react';
import type {ComapeoCoreClientApi} from '@comapeo/ipc';
import {createStore} from 'zustand';

import {useProjectRoleAndDetails} from '../hooks/useProjectRoleAndDetails';
import {
  ActiveProjectIdStoreProvider,
  createActiveProjectIdStore,
} from '../contexts/ActiveProjectIdStoreContext';
import {
  createDraftObservationStore,
  type DraftObservationStore,
} from '../contexts/PersistedStores/DraftObservationStore';
import {DraftObservationProvider} from '../contexts/DraftObservationContext';
import {
  createCoiabOrganizationsStore,
  CoiabOrganizationsStoreProvider,
  type CoiabOrganizationsStore,
} from '../contexts/CoiabOrganizationsStoreContext';
import {OrganizationActivationProvider} from '../contexts/OrganizationActivationContext';
import {OrganizationMaterializerProvider} from '../contexts/OrganizationMaterializerContext';
import {
  createEarlyAccessStore,
  EarlyAccessStoreProvider,
} from '../contexts/EarlyAccessContext';
import {
  createTrackStore,
  TrackStoreProvider,
  type TrackStore,
} from '../contexts/TrackStoreContext';
import {
  type LocationState,
  useLocationContext,
} from '../contexts/LocationContext';
import {PermissionStatus} from 'expo-location';
import {organizationDocument} from '../lib/organization/fixtures';

import {DrawerMenu} from './DrawerMenu';

const mockNavigation = {navigate: jest.fn(), popTo: jest.fn()};
jest.mock('../hooks/useNavigationWithTypes', () => ({
  useNavigationFromRoot: () => mockNavigation,
}));

const mockActiveProject = {projectId: 'p-atual'};
jest.mock('../contexts/ActiveProjectContext', () => ({
  useActiveProject: () => mockActiveProject,
}));

jest.mock('../hooks/useStorageReadingQuery', () => ({
  useStorageReadingQuery: () => ({
    data: {freeBytes: 64 * 1024 * 1024 * 1024, totalBytes: Infinity},
  }),
}));

jest.mock('../hooks/useProjectRoleAndDetails', () => ({
  useProjectRoleAndDetails: jest.fn(),
}));

// The real driver runs; only the client it reads through is faked.
jest.mock('@comapeo/core-react', () => ({
  useClientApi: jest.fn(),
}));

// The draft provider requires a location store; a fake keeps the test off
// expo-location while the real draft context wiring runs.
jest.mock('../contexts/LocationContext', () => {
  const actual = jest.requireActual('../contexts/LocationContext');
  return {
    ...actual,
    useLocationContext: jest.fn(),
  };
});

// The driver reports degraded boots to Sentry; the SDK itself stays off jest.
jest.mock('@sentry/react-native', () => ({
  captureException: jest.fn(),
}));

const useClientApiMock = useClientApi as unknown as jest.Mock;
const useProjectRoleAndDetailsMock = useProjectRoleAndDetails as jest.Mock;

describe('DrawerMenu com as áreas da organização (SPEC A §6.1/D12)', () => {
  let clientApi: {
    getProject: jest.Mock;
    getDeviceInfo: jest.Mock;
    setDeviceInfo: jest.Mock;
    listProjects: jest.Mock;
  };
  let queryClient: QueryClient;
  let trackStore: TrackStore;
  let draftStore: DraftObservationStore;
  const closeMenu = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    useProjectRoleAndDetailsMock.mockReturnValue({
      role: 'coordinator',
      projectHeader: 'Monitoramento',
      projectName: 'Monitoramento',
      projectColor: '#232323',
      projectDescription: undefined,
    });
    clientApi = {
      getProject: jest.fn(async (id: string) => {
        throw new Error(`getProject inesperado: ${id}`);
      }),
      getDeviceInfo: jest.fn(async () => ({
        deviceId: 'device-1',
        name: 'Teste',
        deviceType: 'mobile',
      })),
      setDeviceInfo: jest.fn(async () => {}),
      // The ActiveProjectIdStoreProvider init reads this on mount.
      listProjects: jest.fn(async () => []),
    };
    useClientApiMock.mockReturnValue(
      clientApi as unknown as ComapeoCoreClientApi,
    );
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {gcTime: Infinity},
        mutations: {gcTime: Infinity},
      },
    });
    trackStore = createTrackStore();
    draftStore = createDraftObservationStore({persist: false});
    (useLocationContext as jest.Mock).mockReturnValue(
      createStore<LocationState>()(() => ({
        location: undefined,
        throttledMapLocation: undefined,
        locationPermission: PermissionStatus.DENIED,
        providerStatus: {
          locationServicesEnabled: false,
          backgroundModeEnabled: false,
          gpsAvailable: false,
          networkAvailable: false,
          passiveAvailable: false,
        },
      })),
    );
  });

  /** The real driver, mirroring AppProviders' nesting; the drawers's
   * OrganizationAreaAccesses consumes the shared activation context. */
  function Providers({store}: {store: CoiabOrganizationsStore}) {
    return (
      <QueryClientProvider client={queryClient}>
        <TrackStoreProvider value={trackStore}>
          <DraftObservationProvider draftObservationStore={draftStore}>
            <ActiveProjectIdStoreProvider store={createActiveProjectIdStore()}>
              <EarlyAccessStoreProvider
                value={createEarlyAccessStore({persist: false})}>
                <CoiabOrganizationsStoreProvider store={store}>
                  <OrganizationMaterializerProvider>
                    <OrganizationActivationProvider>
                      <IntlProvider locale="en" messages={{}}>
                        <DrawerMenu closeMenu={closeMenu} />
                      </IntlProvider>
                    </OrganizationActivationProvider>
                  </OrganizationMaterializerProvider>
                </CoiabOrganizationsStoreProvider>
              </EarlyAccessStoreProvider>
            </ActiveProjectIdStoreProvider>
          </DraftObservationProvider>
        </TrackStoreProvider>
      </QueryClientProvider>
    );
  }

  async function renderDrawer(operatingOrganization: boolean) {
    const store = createCoiabOrganizationsStore();
    if (operatingOrganization) {
      store.instance.setState(organizationDocument(), true);
    }
    await render(<Providers store={store} />);
    return {store};
  }

  test('com organização operável: as duas áreas substituem a troca crua de projeto', async () => {
    await renderDrawer(true);

    // CA16 no drawer: o nome da organização e os dois acessos fixos, com a
    // área corrente (Alertas na fixture) marcada.
    expect(await screen.findByText('Organização A')).toBeOnTheScreen();
    expect(screen.getByTestId('MENU.area-monitoramento')).toBeOnTheScreen();
    expect(screen.getByTestId('MENU.area-alertas')).toBeOnTheScreen();
    expect(
      screen.getByTestId('MENU.area-monitoramento').props.accessibilityState,
    ).toEqual({selected: false});
    expect(
      screen.getByTestId('MENU.area-alertas').props.accessibilityState,
    ).toEqual({selected: true});
    expect(screen.getByText('Current')).toBeOnTheScreen();

    // A troca crua de projeto do CoMapeo (SPEC A §6.1:197) saiu do menu.
    expect(screen.queryByText('Switch Project')).not.toBeOnTheScreen();
  });

  test('toque na área corrente não ativa: só fecha o menu', async () => {
    await renderDrawer(true);

    await screen.findByTestId('MENU.area-alertas');
    await fireEvent.press(screen.getByTestId('MENU.area-alertas'));

    expect(closeMenu).toHaveBeenCalledTimes(1);
    expect(mockNavigation.navigate).not.toHaveBeenCalled();
    expect(mockNavigation.popTo).not.toHaveBeenCalled();
  });

  test('sem organização operável: nenhuma área e o resto do menu intacto', async () => {
    await renderDrawer(false);

    await screen.findByTestId('MENU.main-action-button');
    expect(
      screen.queryByTestId('MENU.area-monitoramento'),
    ).not.toBeOnTheScreen();
    expect(screen.queryByTestId('MENU.area-alertas')).not.toBeOnTheScreen();
    expect(screen.queryByText('Switch Project')).not.toBeOnTheScreen();
  });

  test('projeto solo (sem documento de organização): cabeçalho e descrição permanecem', async () => {
    useProjectRoleAndDetailsMock.mockReturnValue({
      role: 'solo',
      projectHeader: 'Meu projeto',
      projectName: 'Meu projeto',
      projectColor: '#232323',
      projectDescription: undefined,
    });
    await renderDrawer(false);

    // O cartão não fica vazio: o cabeçalho e a linha legada do solo
    // permanecem quando a derivação é nula (aposentadoria é a Fase 9).
    expect(await screen.findByText('Meu projeto')).toBeOnTheScreen();
    expect(screen.getByText("You're mapping on your own.")).toBeOnTheScreen();
    expect(screen.getByTestId('MENU.main-action-button')).toBeOnTheScreen();
    expect(
      screen.queryByTestId('MENU.area-monitoramento'),
    ).not.toBeOnTheScreen();
    expect(screen.queryByTestId('MENU.area-alertas')).not.toBeOnTheScreen();
  });

  test('projeto sem organização: a descrição do projeto permanece no lugar das áreas', async () => {
    useProjectRoleAndDetailsMock.mockReturnValue({
      role: 'coordinator',
      projectHeader: 'Projeto X',
      projectName: 'Projeto X',
      projectColor: '#232323',
      projectDescription: 'Descrição do projeto',
    });
    await renderDrawer(false);

    expect(await screen.findByText('Projeto X')).toBeOnTheScreen();
    expect(screen.getByText('Descrição do projeto')).toBeOnTheScreen();
    expect(
      screen.queryByTestId('MENU.area-monitoramento'),
    ).not.toBeOnTheScreen();
    expect(screen.queryByTestId('MENU.area-alertas')).not.toBeOnTheScreen();
  });
});
