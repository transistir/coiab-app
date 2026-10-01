import * as React from 'react';
import {Text} from 'react-native';
import {render, screen} from '@testing-library/react-native';
import type {MapeoManager} from '@comapeo/core';
import type {ComapeoCoreClientApi} from '@comapeo/ipc';

import {createManager, setUpIPC} from '../../../tests/integration/helpers/core';
import {createAppProvidersWrapper} from '../../../tests/integration/helpers/react';
import {executarEmOrdem} from '../../../tests/integration/helpers/setupIntegrationTest';
import {MMKVStoreInitializer} from '../hooks/persistedState/createPersistedState';
import {sleep} from '../lib/sleep';
import {organizationDocument} from '../lib/organization/fixtures';
import {
  COIAB_ORGANIZATIONS_STORAGE_KEY,
  useCoiabOrganizationsState,
} from './CoiabOrganizationsStoreContext';

/**
 * The COIAB organization document must be readable from anywhere under
 * AppProviders: it is the root-mounted store the org-aware UI reads, and it
 * is persisted, so a restart keeps the active organization.
 */
function CoiabOrganizationsProbe() {
  const {versao, ativa} = useCoiabOrganizationsState();

  return (
    <>
      <Text testID="probe-versao">{String(versao)}</Text>
      <Text testID="probe-organizacao-ativa">
        {ativa?.organizacaoId ?? 'sem-organizacao-ativa'}
      </Text>
    </>
  );
}

describe('CoiabOrganizationsStore sob AppProviders', () => {
  let manager: MapeoManager;
  let client: ComapeoCoreClientApi;
  let onTeardown: Array<() => unknown> = [];
  let coreTeardown: Array<() => unknown> = [];

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

  const renderProbe = async () => {
    const appProviders = createAppProvidersWrapper({mapeoApi: client});
    onTeardown.push(appProviders.teardown);

    const utils = await render(<CoiabOrganizationsProbe />, {
      wrapper: appProviders.wrapper,
    });

    // The tree must be unmounted before the IPC is stopped, otherwise every
    // subscription tears down against a closed client.
    onTeardown.unshift(async () => {
      await utils.unmount();
      await sleep(0);
    });

    return utils;
  };

  it('expõe o documento vazio quando não há organização registrada', async () => {
    await renderProbe();

    expect(await screen.findByTestId('probe-versao')).toHaveTextContent('1');
    expect(screen.getByTestId('probe-organizacao-ativa')).toHaveTextContent(
      'sem-organizacao-ativa',
    );
  });

  it('reidrata o documento persistido (persist: true)', async () => {
    MMKVStoreInitializer.setItem(
      COIAB_ORGANIZATIONS_STORAGE_KEY,
      JSON.stringify({state: organizationDocument(), version: 1}),
    );

    await renderProbe();

    expect(
      await screen.findByTestId('probe-organizacao-ativa'),
    ).toHaveTextContent('A');
  });
});
