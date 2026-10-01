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

/**
 * Runs the teardown steps in order, one at a time, and keeps going after a
 * failure: a failed unmount must not leave the IPC channel, the discovery
 * server or fastify open. The failures still fail the test — a single one is
 * rethrown as is, two or more as an `AggregateError`, in step order.
 */
export async function executarEmOrdem(
  passos: ReadonlyArray<() => unknown>,
): Promise<void> {
  const erros: Array<unknown> = [];
  for (const passo of passos) {
    try {
      await passo();
    } catch (erro) {
      erros.push(erro);
    }
  }
  if (erros.length === 1) throw erros[0];
  if (erros.length > 1) {
    throw new AggregateError(
      erros,
      `integration teardown: ${erros.length} steps failed`,
    );
  }
}

/** A mounted navigator: its tree and the providers wrapping it. */
type RenderMontado = {
  // Absent until `render` resolves.
  unmount?: () => Promise<void>;
  providersTeardown: () => void;
};

/**
 * The per-cycle teardown shared by both setups. Its order is fixed rather
 * than derived from registration order:
 *
 * 1. mounted navigators, newest first — `unmount`, then the providers'
 *    teardown, which clears the QueryClient so nothing refetches;
 * 2. the real `fetch` swap, before the drain: work still settling after the
 *    unmount (e.g. the icon check's `fetch(url).ok`, which never reads the
 *    body) must not open undici sockets to fastify — a response left
 *    unconsumed keeps fastify's `close()` waiting ~70s;
 * 3. `ipc.stop()`, which drains the RPCs still in flight;
 * 4. the local peer discovery server (a no-op when it never started);
 * 5. fastify — after the drain, since drained RPCs may need its HTTP routes.
 *
 * The core steps are filled in by `beforeEach` as each resource comes up, so
 * a `beforeEach` that fails midway still tears down what it created.
 */
function criarEncerramentoDoCiclo() {
  let renders: Array<RenderMontado> = [];
  let core: {
    restaurarFetch?: () => void;
    pararIpc?: () => Promise<void>;
    pararDescoberta?: () => Promise<void>;
    pararFastify?: () => Promise<void>;
  } = {};
  let encerramento: Promise<void> | null = null;

  const passosDoRender = (montado: RenderMontado) => [
    () => montado.unmount?.(),
    () => montado.providersTeardown(),
  ];

  return {
    /** Starts a new cycle; call it first thing in `beforeEach`. */
    reiniciar() {
      renders = [];
      core = {};
      encerramento = null;
    },
    get core() {
      return core;
    },
    /**
     * Registers a navigator and returns its manual teardown, which runs its
     * steps once and takes it off the stack, so `encerrar` does not repeat
     * them.
     */
    registrarRender(montado: RenderMontado): () => Promise<void> {
      renders.push(montado);
      let desmontagem: Promise<void> | null = null;
      return () => {
        renders = renders.filter(outro => outro !== montado);
        return (desmontagem ??= executarEmOrdem(passosDoRender(montado)));
      };
    },
    /** The cycle's `afterEach`; memoized until the next `reiniciar`. */
    encerrar() {
      // Captured now: if this teardown outlives its test, the next cycle's
      // `reiniciar()` must not point these steps at the new core.
      const c = core;
      return (encerramento ??= executarEmOrdem([
        ...[...renders].reverse().flatMap(passosDoRender),
        () => c.restaurarFetch?.(),
        () => c.pararIpc?.(),
        () => c.pararDescoberta?.(),
        () => c.pararFastify?.(),
      ]));
    },
  };
}

export function setupIntegrationTest() {
  let manager: MapeoManager;
  let client: ComapeoCoreClientApi;
  const ciclo = criarEncerramentoDoCiclo();
  let projectId: string;
  let alertasProjectId: string;

  beforeEach(async () => {
    ciclo.reiniciar();
    const {core} = ciclo;

    // jest-expo replaces `fetch` with a non-working stub; the icon
    // verification resolves the real HTTP route (`$icons.getIconUrl` +
    // `fetch().ok`), so the suite needs undici's real fetch.
    core.restaurarFetch = useRealFetch();
    const managerSetup = await createManager({
      name: 'test',
      deviceType: 'mobile',
    });
    ({manager} = managerSetup);
    const {fastifyController} = managerSetup;
    core.pararDescoberta = () =>
      managerSetup.manager.stopLocalPeerDiscoveryServer({force: true});

    const ipcSetup = setUpIPC({manager});
    ({client} = ipcSetup);
    core.pararIpc = ipcSetup.stop;

    await fastifyController.start();
    core.pararFastify = () => fastifyController.stop();
    projectId = await client.createProject({
      name: 'Monitoramento',
      projectDescription: markerFor(ORG_ID, 'm', ORG_NAME),
    });
    alertasProjectId = await client.createProject({
      name: 'Alertas',
      projectDescription: markerFor(ORG_ID, 'a', ORG_NAME),
    });
  });

  afterEach(() => ciclo.encerrar(), 30_000);

  const renderNavigation = async ({
    isOnline = true,
    activeProjectId = projectId,
  }: Readonly<{isOnline?: boolean; activeProjectId?: string}> = {}) => {
    const appProviders = createAppProvidersWrapper({
      mapeoApi: client,
      isOnline,
      activeProjectId,
    });
    // Registered before `render`: if mounting throws, the providers are
    // still torn down.
    const montado: RenderMontado = {providersTeardown: appProviders.teardown};
    const desmontar = ciclo.registrarRender(montado);

    const {unmount} = await render(<MockedAppNavigator />, {
      wrapper: appProviders.wrapper,
    });
    montado.unmount = async () => {
      await unmount();
      await sleep(0);
    };

    return desmontar;
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
  const ciclo = criarEncerramentoDoCiclo();
  let activeProjectIdStore: ActiveProjectIdStore;

  beforeEach(async () => {
    ciclo.reiniciar();
    const {core} = ciclo;

    // Same reason as in `setupIntegrationTest`: real fetch for the icon
    // verification HTTP route.
    core.restaurarFetch = useRealFetch();
    const managerSetup = await createManager({
      name: 'test',
      deviceType: 'mobile',
    });
    ({manager} = managerSetup);
    const {fastifyController} = managerSetup;
    core.pararDescoberta = () =>
      managerSetup.manager.stopLocalPeerDiscoveryServer({force: true});

    const ipcSetup = setUpIPC({manager});
    ({client} = ipcSetup);
    core.pararIpc = ipcSetup.stop;

    await fastifyController.start();
    core.pararFastify = () => fastifyController.stop();
  });

  afterEach(() => ciclo.encerrar(), 30_000);

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
    // Registered before `render`: if mounting throws, the providers are
    // still torn down.
    const montado: RenderMontado = {providersTeardown: appProviders.teardown};
    const desmontar = ciclo.registrarRender(montado);

    const {unmount} = await render(<MockedAppNavigator />, {
      wrapper: appProviders.wrapper,
    });
    montado.unmount = unmount;

    return desmontar;
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
