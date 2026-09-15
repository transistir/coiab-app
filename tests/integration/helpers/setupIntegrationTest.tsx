import {render} from '@testing-library/react-native';
import type {MapeoManager} from '@comapeo/core';
import type {ComapeoCoreClientApi} from '@comapeo/ipc';
import {createManager, setUpIPC, useRealFetch} from './core';
import {createAppProvidersWrapper} from './react';
import type {ActiveProjectIdStore} from '../../../src/frontend/contexts/ActiveProjectIdStoreContext';
import {MockedAppNavigator} from './navigation';
import {sleep} from '../../../src/frontend/lib/sleep';
import {markerFor} from '../../../src/frontend/lib/organization/marker';
import {MMKVStoreInitializer} from '../../../src/frontend/hooks/persistedState/createPersistedState';
import {COIAB_ORGANIZATIONS_STORAGE_KEY} from '../../../src/frontend/contexts/CoiabOrganizationsStoreContext';
import type {EstadoOrganizacoes} from '../../../src/frontend/lib/organization/coiabOrganizations';
import React from 'react';

// The P3 onboarding gate (SPEC 10.1) requires an Organization before Home, so
// the shared helper seeds the two internal projects of a fixed test org. The
// default active project is the Monitoramento (slot m) project.
const ORG_ID = '0123456789abcdef';
const ORG_NAME = 'Test Org';

export function setupIntegrationTest() {
  let manager: MapeoManager;
  let client: ComapeoCoreClientApi;
  let onTeardown: Array<() => unknown> = [];
  let projectId: string;
  let alertasProjectId: string;

  beforeEach(async () => {
    onTeardown = [];

    // jest-expo replaces `fetch` with a non-working stub; the icon
    // verification resolves the real HTTP route (`$icons.getIconUrl` +
    // `fetch().ok`), so the suite needs undici's real fetch.
    onTeardown.push(useRealFetch());
    const managerSetup = await createManager({
      name: 'test',
      deviceType: 'mobile',
    });
    ({manager} = managerSetup);
    const {fastifyController} = managerSetup;

    const ipcSetup = setUpIPC({manager});
    ({client} = ipcSetup);
    const {stop} = ipcSetup;
    onTeardown.push(stop);

    await fastifyController.start();
    onTeardown.push(() => fastifyController.stop());
    projectId = await client.createProject({
      name: 'Monitoramento',
      projectDescription: markerFor(ORG_ID, 'm', ORG_NAME),
    });
    alertasProjectId = await client.createProject({
      name: 'Alertas',
      projectDescription: markerFor(ORG_ID, 'a', ORG_NAME),
    });
  });

  afterEach(async () => {
    for (const fn of onTeardown) await fn();
  });

  const renderNavigation = async ({
    isOnline = true,
    activeProjectId = projectId,
  }: Readonly<{isOnline?: boolean; activeProjectId?: string}> = {}) => {
    const appProviders = createAppProvidersWrapper({
      mapeoApi: client,
      isOnline,
      activeProjectId,
    });
    onTeardown.push(appProviders.teardown);

    const {unmount} = await render(<MockedAppNavigator />, {
      wrapper: appProviders.wrapper,
    });
    const actualTeardown = async () => {
      await unmount();
      await sleep(0);
    };

    onTeardown.unshift(actualTeardown);

    return () => {
      const result = actualTeardown();
      onTeardown = onTeardown.filter(fn => fn !== actualTeardown);
      return result;
    };
  };

  return {
    renderNavigation,
    get projectId() {
      return projectId;
    },
    get alertasProjectId() {
      return alertasProjectId;
    },
    get orgId() {
      return ORG_ID;
    },
    get orgName() {
      return ORG_NAME;
    },
    get client() {
      return client;
    },
    get manager() {
      return manager;
    },
  };
}

export function setupIntegrationTestWithoutProject() {
  let manager: MapeoManager;
  let client: ComapeoCoreClientApi;
  let onTeardown: Array<() => unknown> = [];
  let activeProjectIdStore: ActiveProjectIdStore;

  beforeEach(async () => {
    onTeardown = [];

    // Same reason as in `setupIntegrationTest`: real fetch for the icon
    // verification HTTP route.
    onTeardown.push(useRealFetch());
    const managerSetup = await createManager({
      name: 'test',
      deviceType: 'mobile',
    });
    ({manager} = managerSetup);
    const {fastifyController} = managerSetup;

    const ipcSetup = setUpIPC({manager});
    ({client} = ipcSetup);
    const {stop} = ipcSetup;
    onTeardown.push(stop);

    await fastifyController.start();
    onTeardown.push(() => fastifyController.stop());
  });

  afterEach(async () => {
    for (const fn of onTeardown) await fn();
  });

  const renderNavigationAsync = async ({
    isOnline = true,
    activeProjectId,
  }: Readonly<{isOnline?: boolean; activeProjectId?: string}> = {}) => {
    const appProviders = createAppProvidersWrapper({
      mapeoApi: client,
      isOnline,
      activeProjectId,
    });
    activeProjectIdStore = appProviders.activeProjectIdStore;
    onTeardown.push(appProviders.teardown);

    const {unmount} = await render(<MockedAppNavigator />, {
      wrapper: appProviders.wrapper,
    });
    const actualTeardown = async () => {
      await unmount();
    };

    onTeardown.unshift(actualTeardown);

    return async () => {
      const result = await actualTeardown();
      onTeardown = onTeardown.filter(fn => fn !== actualTeardown);
      return result;
    };
  };

  return {
    renderNavigationAsync,
    get client() {
      return client;
    },
    get manager() {
      return manager;
    },
    get orgId() {
      return ORG_ID;
    },
    get orgName() {
      return ORG_NAME;
    },
    get activeProjectId() {
      return activeProjectIdStore?.instance.getState().projectId;
    },
  };
}

/**
 * Seeds the RAW persisted COIAB document (SPEC A §4.2) for a fully open
 * organization: both areas verified, the confirmation acknowledged and
 * Monitoramento selected. The ids must be the REAL core project ids of the
 * test's CURRENT manager, so the engine's cold-start restoration validates
 * against the same rows — call it after the setup's beforeEach boot and
 * before rendering the navigator.
 *
 * Shared by the suites that mount the real navigator and expect Home:
 * under the organization-first startup (SPEC 10.1) the persisted document,
 * not the core's project list, decides the initial route — without this
 * seed such a device lands on the Success fork ("test is ready!").
 */
export function semearDocumentoPronta(
  monitoramentoId: string,
  alertasId: string,
  organizacaoId: string,
  nome: string,
): void {
  const documento: EstadoOrganizacoes = {
    versao: 1,
    organizacoes: [
      {
        id: organizacaoId,
        nome,
        estado: 'pronta',
        confirmacaoPendente: false,
        materializacao: {
          monitoramento: {
            etapa: 'verificado',
            projectId: monitoramentoId,
            template: {versao: '1', hash: 'monitoramento'},
            idsAntesDaCriacao: null,
          },
          alertas: {
            etapa: 'verificado',
            projectId: alertasId,
            template: {versao: '1', hash: 'alertas'},
            idsAntesDaCriacao: null,
          },
        },
        areaEmExecucao: null,
        ultimoErro: null,
      },
    ],
    ativa: {organizacaoId, area: 'monitoramento'},
  };
  MMKVStoreInitializer.setItem(
    COIAB_ORGANIZATIONS_STORAGE_KEY,
    JSON.stringify({state: documento, version: 1}),
  );
}
