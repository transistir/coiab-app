import * as React from 'react';
import {render, screen} from '@testing-library/react-native';
import type {ComapeoCoreClientApi} from '@comapeo/ipc';
import type {MapeoManager} from '@comapeo/core';

import {
  createManager,
  setUpIPC,
} from '../../../../tests/integration/helpers/core';
import {createAppProvidersWrapper} from '../../../../tests/integration/helpers/react';
import {ActiveProjectProvider} from '../../contexts/ActiveProjectContext';
import {COIAB_ORGANIZATIONS_STORAGE_KEY} from '../../contexts/CoiabOrganizationsStoreContext';
import {MMKVStoreInitializer} from '../../hooks/persistedState/createPersistedState';
import {sleep} from '../../lib/sleep';
import {organizationDocument} from '../../lib/organization/fixtures';

import {ObservationEmptyView} from './ObservationsEmptyView';

/**
 * The per-area empty copy (SPEC A §4.4:147) resolves the area from the
 * persisted document, gated the same way HomeHeader gates the organization
 * name: the derivation must equal the project being rendered. The provider
 * stack is the real one (AppProviders) and the document is seeded through
 * the durable MMKV key, exactly like the startup hydrates it.
 */
describe('ObservationsEmptyView por área (SPEC A §4.4:147)', () => {
  let manager: MapeoManager;
  let client: ComapeoCoreClientApi;
  let onTeardown: Array<() => unknown> = [];
  let projectId: string;

  beforeEach(async () => {
    onTeardown = [];
    const setup = await createManager({name: 'test', deviceType: 'mobile'});
    manager = setup.manager;
    await setup.fastifyController.start();
    onTeardown.push(() => setup.fastifyController.stop());
    const ipc = setUpIPC({manager});
    client = ipc.client;
    onTeardown.push(ipc.stop);
    projectId = await client.createProject({name: 'Projeto da área'});
  });

  afterEach(async () => {
    for (const fn of onTeardown) await fn();
    MMKVStoreInitializer.removeItem(COIAB_ORGANIZATIONS_STORAGE_KEY);
  });

  /** Seeds the MMKV document with `ativa` on the named area, whose slot is
   * the real project this device operates. */
  const seedDocumento = (area: 'monitoramento' | 'alertas' | null) => {
    if (area === null) {
      MMKVStoreInitializer.removeItem(COIAB_ORGANIZATIONS_STORAGE_KEY);
      return;
    }
    const documento = organizationDocument();
    const organizacaoA = documento.organizacoes[0];
    if (!organizacaoA) throw new Error('fixture: organization A missing');
    organizacaoA.materializacao[area].projectId = projectId;
    const ativa = area === null ? null : {organizacaoId: 'A', area};
    MMKVStoreInitializer.setItem(
      COIAB_ORGANIZATIONS_STORAGE_KEY,
      JSON.stringify({
        state: ativa ? {...documento, ativa} : documento,
        version: 1,
      }),
    );
  };

  const renderEmptyView = async () => {
    const appProviders = createAppProvidersWrapper({
      mapeoApi: client,
      activeProjectId: projectId,
    });
    onTeardown.push(appProviders.teardown);

    const utils = await render(
      <ActiveProjectProvider activeProjectId={projectId}>
        <ObservationEmptyView onPressBack={() => {}} />
      </ActiveProjectProvider>,
      {wrapper: appProviders.wrapper},
    );
    onTeardown.unshift(async () => {
      await utils.unmount();
      await sleep(0);
    });
    return utils;
  };

  test('área Alertas operante: cópia de Alertas e ação Ir para o mapa', async () => {
    seedDocumento('alertas');
    await renderEmptyView();

    expect(
      await screen.findByText('No records yet in Alerts'),
    ).toBeOnTheScreen();
    expect(screen.getByText('Go to the map')).toBeOnTheScreen();
    // A cópia legada não aparece quando a organização guia a tela.
    expect(screen.queryByText('Add Observations')).not.toBeOnTheScreen();
    expect(
      screen.queryByText('No records yet in Monitoring'),
    ).not.toBeOnTheScreen();
  });

  test('área Monitoramento operante: cópia de Monitoramento', async () => {
    seedDocumento('monitoramento');
    await renderEmptyView();

    expect(
      await screen.findByText('No records yet in Monitoring'),
    ).toBeOnTheScreen();
    expect(screen.getByText('Go to the map')).toBeOnTheScreen();
    expect(
      screen.queryByText('No records yet in Alerts'),
    ).not.toBeOnTheScreen();
  });

  test('sem organização operante: a cópia legada permanece', async () => {
    seedDocumento(null);
    await renderEmptyView();

    expect(await screen.findByText('Add Observations')).toBeOnTheScreen();
    expect(screen.getByText('Go To Map')).toBeOnTheScreen();
    expect(
      screen.queryByText('No records yet in Alerts'),
    ).not.toBeOnTheScreen();
    expect(
      screen.queryByText('No records yet in Monitoring'),
    ).not.toBeOnTheScreen();
  });
});
