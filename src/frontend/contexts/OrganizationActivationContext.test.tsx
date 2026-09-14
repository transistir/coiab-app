import * as React from 'react';
import {Asset} from 'expo-asset';
import {Text} from 'react-native';
import {render, screen, waitFor} from '@testing-library/react-native';
import type {MapeoManager} from '@comapeo/core';
import type {ComapeoCoreClientApi} from '@comapeo/ipc';

import {createManager, setUpIPC} from '../../../tests/integration/helpers/core';
import {createAppProvidersWrapper} from '../../../tests/integration/helpers/react';
import {MMKVStoreInitializer} from '../hooks/persistedState/createPersistedState';
import {sleep} from '../lib/sleep';
import {readyOrganization} from '../lib/organization/fixtures';
import type {EstadoOrganizacoes} from '../lib/organization/coiabOrganizations';
import {
  createOrganizationActivation,
  type ActivationOptions,
  type OrganizationActivation,
} from '../lib/organization/activation';
import {useOrganizationMaterializer} from './OrganizationMaterializerContext';
import {COIAB_ORGANIZATIONS_STORAGE_KEY} from './CoiabOrganizationsStoreContext';
import {useOrganizationActivationContext} from './OrganizationActivationContext';

// The real engine runs; only its factory is wrapped so a test can observe how
// many engines the root providers built and how many times each was
// initialized — the internal state alone cannot show a redundant
// initialization, because a second one returns early on the ready context.
jest.mock('../lib/organization/activation', () => {
  const actual = jest.requireActual('../lib/organization/activation') as {
    createOrganizationActivation: (
      options: ActivationOptions,
    ) => OrganizationActivation;
  };
  return {
    ...actual,
    createOrganizationActivation: jest.fn((options: ActivationOptions) => {
      const engine = actual.createOrganizationActivation(options);
      return {...engine, initialize: jest.fn(engine.initialize)};
    }),
  };
});

const createOrganizationActivationMock =
  createOrganizationActivation as unknown as jest.Mock;

/** The materializer is mounted once at the root (Phase 4): the handle must
 * exist under `AppProviders`, and mounting must never touch the asset
 * system — the installed template source does no I/O on construction. */
function MaterializerProbe() {
  const materializador = useOrganizationMaterializer();

  return (
    <Text testID="materializador">
      {materializador ? 'montado' : 'ausente'}
    </Text>
  );
}

/** The engine is mounted once at the root (SPEC A §5.2): everything the
 * activation publishes must be readable from anywhere under `AppProviders`. */
function ActivationProbe() {
  const {status, projectId, generation} = useOrganizationActivationContext();

  return (
    <>
      <Text testID="activation-status">{status}</Text>
      <Text testID="activation-project">{projectId ?? 'sem-projeto'}</Text>
      <Text testID="activation-generation">{String(generation)}</Text>
    </>
  );
}

/**
 * The persisted document for one ready organization whose two areas point at
 * the projects that actually exist in core — the ids cannot be invented, the
 * activation revalidates both against the client.
 */
function persistedDocument(
  monitoramentoId: string,
  alertasId: string,
): EstadoOrganizacoes {
  const org = readyOrganization('A');
  return {
    versao: 1,
    organizacoes: [
      {
        ...org,
        materializacao: {
          monitoramento: {
            ...org.materializacao.monitoramento,
            projectId: monitoramentoId,
          },
          alertas: {...org.materializacao.alertas, projectId: alertasId},
        },
      },
    ],
    ativa: {organizacaoId: 'A', area: 'monitoramento'},
  };
}

describe('OrganizationActivationContext sob AppProviders', () => {
  let manager: MapeoManager;
  let client: ComapeoCoreClientApi;
  let onTeardown: Array<() => unknown> = [];

  beforeEach(async () => {
    jest.clearAllMocks();
    onTeardown = [];

    const setup = await createManager({name: 'test', deviceType: 'mobile'});
    manager = setup.manager;
    await setup.fastifyController.start();
    onTeardown.push(() => setup.fastifyController.stop());

    const ipc = setUpIPC({manager});
    client = ipc.client;
    onTeardown.push(ipc.stop);
  });

  afterEach(async () => {
    for (const fn of onTeardown) await fn();
    MMKVStoreInitializer.removeItem(COIAB_ORGANIZATIONS_STORAGE_KEY);
  });

  const renderProbe = async () => {
    const appProviders = createAppProvidersWrapper({mapeoApi: client});
    onTeardown.push(appProviders.teardown);

    const utils = await render(
      <>
        <ActivationProbe />
        <MaterializerProbe />
      </>,
      {
        wrapper: appProviders.wrapper,
      },
    );

    // The tree must be unmounted before the IPC is stopped, otherwise every
    // subscription tears down against a closed client.
    onTeardown.unshift(async () => {
      await utils.unmount();
      await sleep(0);
    });

    return utils;
  };

  test('expõe o motor de ativação montado na raiz', async () => {
    await renderProbe();

    // `loading` is the engine's initial state; `absent` can only come from the
    // startup initialization, so reaching it proves the engine ran.
    await waitFor(() =>
      expect(screen.getByTestId('activation-status')).toHaveTextContent(
        'absent',
      ),
    );
    expect(screen.getByTestId('activation-project')).toHaveTextContent(
      'sem-projeto',
    );
    expect(screen.getByTestId('activation-generation')).toHaveTextContent('0');

    const engine = createOrganizationActivationMock.mock.results[0]!.value;
    expect(engine.initialize).toHaveBeenCalledTimes(1);
  });

  test('ativa a organização persistida no start', async () => {
    const monitoramentoId = await client.createProject({
      name: 'Monitoramento',
    });
    const alertasId = await client.createProject({name: 'Alertas'});
    MMKVStoreInitializer.setItem(
      COIAB_ORGANIZATIONS_STORAGE_KEY,
      JSON.stringify({
        state: persistedDocument(monitoramentoId, alertasId),
        version: 1,
      }),
    );

    await renderProbe();

    await waitFor(() =>
      expect(screen.getByTestId('activation-status')).toHaveTextContent(
        'ready',
      ),
    );
    expect(screen.getByTestId('activation-project')).toHaveTextContent(
      monitoramentoId,
    );
    expect(screen.getByTestId('activation-generation')).toHaveTextContent('1');
  });

  test('re-render da raiz não recria o motor nem inicializa de novo', async () => {
    const utils = await renderProbe();

    await waitFor(() =>
      expect(screen.getByTestId('activation-status')).toHaveTextContent(
        'absent',
      ),
    );

    // Re-rendering the providers with different children is what an unrelated
    // root re-render does: the engine is memoized on the store and the client
    // API, so neither the factory nor the startup initialization may re-run.
    await utils.rerender(
      <>
        <ActivationProbe />
        <Text testID="unrelated">re-render não relacionado</Text>
      </>,
    );

    expect(createOrganizationActivationMock).toHaveBeenCalledTimes(1);
    const engine = createOrganizationActivationMock.mock.results[0]!.value;
    expect(engine.initialize).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('activation-status')).toHaveTextContent('absent');
  });

  test('monta o materializador na raiz sem nenhuma chamada de asset (documento vazio)', async () => {
    const fromModuleSpy = jest.spyOn(Asset, 'fromModule');
    const downloadAsyncSpy = jest.spyOn(Asset.prototype, 'downloadAsync');

    await renderProbe();

    await waitFor(() =>
      expect(screen.getByTestId('activation-status')).toHaveTextContent(
        'absent',
      ),
    );
    expect(screen.getByTestId('materializador')).toHaveTextContent('montado');
    // Constructing the installed template source at the root does no I/O:
    // the asset download happens only inside `prepare` (Phase 3).
    expect(fromModuleSpy).not.toHaveBeenCalled();
    expect(downloadAsyncSpy).not.toHaveBeenCalled();
  });
});
