import * as React from 'react';
import {
  NavigationContainer,
  ParamListBase,
  RouteProp,
} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {render, screen, within} from '@testing-library/react-native';
import type {BottomTabHeaderProps} from '@react-navigation/bottom-tabs';
import type {MapeoManager} from '@comapeo/core';
import type {ComapeoCoreClientApi} from '@comapeo/ipc';

import {createManager, setUpIPC} from '../../../tests/integration/helpers/core';
import {createAppProvidersWrapper} from '../../../tests/integration/helpers/react';
import {executarEmOrdem} from '../../../tests/integration/helpers/orderedTeardown';
import {ActiveProjectProvider} from '../contexts/ActiveProjectContext';
import {COIAB_ORGANIZATIONS_STORAGE_KEY} from '../contexts/CoiabOrganizationsStoreContext';
import {MMKVStoreInitializer} from '../hooks/persistedState/createPersistedState';
import {organizationDocument} from '../lib/organization/fixtures';

import {HomeHeader} from './HomeHeader';

jest.mock('../hooks/useCurrentTime', () => ({
  useCurrentTime: () => new Date(),
}));

let mockFreeBytes: number | null = null;
let mockTotalBytes: number | null = 64 * 1024 * 1024 * 1024;
jest.mock('../hooks/useStorageReadingQuery', () => {
  return {
    __esModule: true,
    useStorageReadingQuery: () => ({
      data:
        mockFreeBytes == null || mockTotalBytes == null
          ? null
          : {freeBytes: mockFreeBytes, totalBytes: mockTotalBytes},
    }),
  };
});

const Stack = createNativeStackNavigator<{HomeHeaderRoute: undefined}>();

function HomeHeaderScreen() {
  const baseHeader: Pick<
    BottomTabHeaderProps,
    'navigation' | 'route' | 'options' | 'layout'
  > = {
    navigation: {} as BottomTabHeaderProps['navigation'],
    route: {key: 'home', name: 'HomeHeaderRoute'} as RouteProp<
      ParamListBase,
      string
    >,
    options: {} as BottomTabHeaderProps['options'],
    layout: {width: 320, height: 60},
  };

  return (
    <HomeHeader
      {...baseHeader}
      backgroundColor="#fff"
      showBottomBorder
      navigation={{} as BottomTabHeaderProps['navigation']}
    />
  );
}

describe('HomeHeader low storage badge (navigator + AppProviders)', () => {
  let manager: MapeoManager;
  let client: ComapeoCoreClientApi;
  let onTeardown: Array<() => unknown> = [];
  let coreTeardown: Array<() => unknown> = [];
  let projectId: string;

  beforeEach(async () => {
    onTeardown = [];
    coreTeardown = [];

    const setup = await createManager({name: 'test', deviceType: 'mobile'});
    manager = setup.manager;
    await setup.fastifyController.start();

    const ipc = setUpIPC({manager});
    client = ipc.client;
    coreTeardown.push(ipc.stop);
    coreTeardown.push(() => setup.fastifyController.stop());

    mockTotalBytes = 64 * 1024 * 1024 * 1024;
    mockFreeBytes = null;
    projectId = await client.createProject({name: undefined});
  });

  afterEach(async () => {
    // Tree and providers first: their teardown clears the QueryClient, so
    // in-flight queries are cancelled before `ipc.stop` drains the RPCs and
    // closes the channel.
    await executarEmOrdem([
      ...onTeardown,
      ...coreTeardown,
      () => MMKVStoreInitializer.removeItem(COIAB_ORGANIZATIONS_STORAGE_KEY),
    ]);
  }, 15_000);

  const renderHeader = async ({
    isOnline = true,
    activeProjectId = projectId,
  }: Readonly<{isOnline?: boolean; activeProjectId?: string}> = {}) => {
    const appProviders = createAppProvidersWrapper({
      mapeoApi: client,
      isOnline,
      activeProjectId,
    });
    onTeardown.push(appProviders.teardown);

    const utils = await render(
      <React.Suspense fallback={null}>
        <ActiveProjectProvider activeProjectId={activeProjectId}>
          <NavigationContainer>
            <Stack.Navigator screenOptions={{headerShown: false}}>
              <Stack.Screen
                name="HomeHeaderRoute"
                component={HomeHeaderScreen}
              />
            </Stack.Navigator>
          </NavigationContainer>
        </ActiveProjectProvider>
      </React.Suspense>,
      {wrapper: appProviders.wrapper},
    );

    const safeUnmount = async () => {
      await utils.unmount();
      await new Promise(res => setTimeout(res, 0));
    };
    onTeardown.unshift(safeUnmount);

    return utils;
  };

  it('shows badge when isLow is true', async () => {
    mockFreeBytes = 100 * 1024 * 1024;
    await renderHeader();

    await screen.findByTestId('HOME.header-title');

    expect(await screen.findByTestId('low-storage-badge')).toBeTruthy();
  });

  it('hides badge when isLow is false', async () => {
    mockFreeBytes = 600 * 1024 * 1024;
    await renderHeader();

    await screen.findByTestId('HOME.header-title');

    expect(screen.queryByTestId('low-storage-badge')).toBeNull();
  });

  it('keeps the badge outside the block accessibility node when an organization is active', async () => {
    mockFreeBytes = 100 * 1024 * 1024;

    const documento = organizationDocument();
    const organizacaoA = documento.organizacoes[0];
    if (!organizacaoA) throw new Error('fixture: organization A missing');
    organizacaoA.materializacao.monitoramento.projectId = projectId;

    MMKVStoreInitializer.setItem(
      COIAB_ORGANIZATIONS_STORAGE_KEY,
      JSON.stringify({
        state: {
          ...documento,
          ativa: {organizacaoId: 'A', area: 'monitoramento'},
        },
        version: 1,
      }),
    );

    await renderHeader();

    const bloco = await screen.findByTestId('HOME.header-bloco');
    // The block is a single accessibility node; a badge nested inside it would
    // be swallowed by its composed label, so the warning must stay out.
    expect(within(bloco).queryByTestId('low-storage-badge')).toBeNull();
    expect(screen.getByTestId('low-storage-badge')).toBeTruthy();
  });
});
