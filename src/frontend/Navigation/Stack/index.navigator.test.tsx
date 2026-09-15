import type {NavigationContainerRef} from '@react-navigation/native';
import type {AppStackParamsList} from '../../sharedTypes/navigation';

let mockNavigation: NavigationContainerRef<AppStackParamsList>;
jest.mock('../../../../tests/integration/helpers/navigation', () => {
  const {AppNavigator} = require('../../AppNavigator');
  return {
    MockedAppNavigator: () => {
      return (
        <AppNavigator
          permissionAsked
          navigationIntegration={{
            registerNavigationContainer: (ref: {
              current: NavigationContainerRef<AppStackParamsList>;
            }) => {
              mockNavigation = ref.current;
            },
          }}
        />
      );
    },
  };
});
import {act, fireEvent, screen, waitFor} from '@testing-library/react-native';

// The full navigator mounts the real Home tabs (MapScreen included) — the
// map stack is stubbed exactly like MapScreen.lowStorage.test.tsx does.
jest.mock('@maplibre/maplibre-react-native', () => {
  const React = require('react');
  const {View} = require('react-native');
  const Stub = (
    props: {children?: React.ReactNode} & Record<string, unknown>,
  ) => {
    const {children, ...rest} = props || {};
    return React.createElement(View, rest, children);
  };

  const LineJoin = {Round: 'round', Bevel: 'bevel', Miter: 'miter'};
  const LineCap = {Round: 'round', Butt: 'butt', Square: 'square'};

  return {
    __esModule: true,
    default: {
      MapView: Stub,
      Camera: Stub,
      UserLocation: Stub,
      ShapeSource: Stub,
      LineLayer: Stub,
      setAccessToken: jest.fn(),
      setTelemetryEnabled: jest.fn(),
    },
    LineJoin,
    LineCap,
  };
});

jest.mock('react-native-scale-bar', () => 'ScaleBar');

jest.mock('../../hooks/server/maps', () => ({
  useMapStyleJsonUrl: () => ({data: undefined}),
}));

jest.mock('../../hooks/useCurrentTime', () => ({
  useCurrentTime: () => new Date(),
}));

jest.mock('../../screens/MapScreen/MapLayers/ObservationMapLayer', () => ({
  ObservationMapLayer: () => null,
}));
jest.mock('../../screens/MapScreen/MapLayers/TracksMapLayer', () => ({
  TracksMapLayer: () => null,
}));
jest.mock(
  '../../screens/MapScreen/MapLayers/RemoteDetectionAlertsLayer',
  () => ({
    RemoteDetectionAlertsLayer: () => null,
  }),
);
jest.mock('../../screens/MapScreen/CurrentTrack/CurrentTrackMapLayer', () => ({
  CurrentTrackMapLayer: () => null,
}));
jest.mock('../../screens/MapScreen/CurrentTrack/UserTooltipMarker', () => ({
  UserTooltipMarker: () => null,
}));

jest.mock('../../hooks/useStorageReadingQuery', () => {
  const LOW = 500 * 1024 * 1024;
  return {
    __esModule: true,
    LOW_THRESHOLD_BYTES: LOW,
    useStorageReadingQuery: () => ({
      data: {freeBytes: 64 * 1024 * 1024 * 1024, totalBytes: Infinity},
    }),
    isLowStorage: (free: number | null, threshold: number = LOW) =>
      (free ?? Infinity) <= threshold,
  };
});

jest.mock('../../hooks/server/presets', () => ({
  usePresetsQuery: () => ({data: []}),
}));

// The REAL installed template source cannot run under jest: there is no
// `comapeocat` entry in jest-expo's asset registry (the bundled `.comapeocat`
// require cannot even resolve) and the legacy FileSystem mock is a no-op
// stub. This mock keeps everything downstream real — the materializer, the
// core `$importCategories` and the canonical conferência — and simulates
// only the on-device download/copy plumbing with plain node fs over the
// BUNDLED packages, whose bytes the embedded manifests hash (`abrirPacote`
// still verifies them).
jest.mock('../../lib/organization/pacotesInstalados', () => {
  const path = require('node:path');
  const fsPromises = require('node:fs/promises');
  const {
    abrirPacote,
    verificarImportacao,
    manifestosEmbarcados,
  } = require('../../lib/organization/pacotes');

  const ler = async (filePath: string) => {
    try {
      return new Uint8Array(await fsPromises.readFile(filePath));
    } catch {
      return null;
    }
  };

  return {
    criarTemplateSourceInstalado: () => ({
      prepare: async () => ({
        monitoramento: await abrirPacote(
          path.resolve(
            __dirname,
            '../../../../assets/categorias/monitoramento.comapeocat',
          ),
          manifestosEmbarcados.monitoramento.ref,
          manifestosEmbarcados.monitoramento,
          ler,
        ),
        alertas: await abrirPacote(
          path.resolve(
            __dirname,
            '../../../../assets/categorias/alertas.comapeocat',
          ),
          manifestosEmbarcados.alertas.ref,
          manifestosEmbarcados.alertas,
          ler,
        ),
      }),
      verify: (project: unknown, pacote: unknown) =>
        verificarImportacao(
          project as Parameters<typeof verificarImportacao>[0],
          pacote as Parameters<typeof verificarImportacao>[1],
          ler,
        ),
    }),
  };
});

import {MMKVStoreInitializer} from '../../hooks/persistedState/createPersistedState';
import {COIAB_ORGANIZATIONS_STORAGE_KEY} from '../../contexts/CoiabOrganizationsStoreContext';
import {type EstadoOrganizacoes} from '../../lib/organization/coiabOrganizations';

/**
 * The §4.2 document for the pending-confirmation startup (SPEC B §3.3
 * items 2-3): the materialized organization is `pronta` with its pending
 * confirmation, `ativa` stays `null` until the "Abrir organização" tap,
 * and a second record is still `preparando` — so the document, not the
 * reconstruction, decides what the device may open.
 */
function documentoComConfirmacaoPendente(
  monitoramentoId: string,
  alertasId: string,
  organizacaoId: string,
  segundaOrganizacaoId: string,
  segundaAreaProjectId: string,
): EstadoOrganizacoes {
  return {
    versao: 1,
    organizacoes: [
      {
        id: organizacaoId,
        nome: 'Test Org',
        estado: 'pronta',
        confirmacaoPendente: true,
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
      {
        id: segundaOrganizacaoId,
        nome: 'Outra Org',
        estado: 'preparando',
        confirmacaoPendente: false,
        materializacao: {
          monitoramento: {
            etapa: 'criado',
            projectId: null,
            template: null,
            idsAntesDaCriacao: null,
          },
          alertas: {
            etapa: 'verificado',
            projectId: segundaAreaProjectId,
            template: {versao: '1', hash: 'alertas'},
            idsAntesDaCriacao: null,
          },
        },
        areaEmExecucao: null,
        ultimoErro: null,
      },
    ],
    ativa: null,
  };
}

/**
 * The RAW persisted document, exactly as the store writes it: `ativa` and
 * the organization list are asserted from the disk-level truth, not from
 * any subscribed store view.
 */
function documentoPersistido(): EstadoOrganizacoes {
  const raw = MMKVStoreInitializer.getItem(COIAB_ORGANIZATIONS_STORAGE_KEY);
  if (typeof raw !== 'string') throw new Error('documento ausente');
  return JSON.parse(raw).state;
}

import {
  setupIntegrationTest,
  setupIntegrationTestWithoutProject,
} from '../../../../tests/integration/helpers/setupIntegrationTest';
import {markerFor} from '../../lib/organization/marker';
import {
  organizationCreationProvenanceStore,
  recordOrganizationCreationProvenance,
} from '../../lib/organization/creationProvenance';

/**
 * The startup gate mounted for real (SPEC 10.1): getInitialRoute picks the
 * first screen from the reconstructed Organization state, so each device
 * state below is seeded through the actual core client before rendering the
 * full navigator.
 */
describe('RootStackNavigator startup gate (SPEC 10.1)', () => {
  // Hook registration lives at the describe level — the helpers install
  // beforeEach/afterEach that boot and tear down a real core manager per test.
  const freshSetup = setupIntegrationTestWithoutProject();
  const orgSetup = setupIntegrationTest();

  beforeEach(() => {
    // The provenance record is durable by design — it must not leak from the
    // test that wrote it into the next device state.
    organizationCreationProvenanceStore.setState({organizationIds: []});
  });

  afterEach(() => {
    // The document is durable by design too: a seeded pending confirmation
    // must not leak from the test that wrote it into the next device state.
    MMKVStoreInitializer.removeItem(COIAB_ORGANIZATIONS_STORAGE_KEY);
  });

  test('a delayed project refresh holds the confirmation up without offering creation again', async () => {
    await freshSetup.renderNavigationAsync();
    await fireEvent.press(
      await screen.findByTestId('ONBOARDING.create-org-btn'),
    );
    await fireEvent.changeText(
      screen.getByTestId('ORG.create-name-inp'),
      'New Org',
    );

    const listProjects = freshSetup.manager.listProjects.bind(
      freshSetup.manager,
    );
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>(resolve => {
      releaseRefresh = resolve;
    });
    let refreshWaiting = false;
    const spy = jest
      .spyOn(freshSetup.manager, 'listProjects')
      .mockImplementation(async () => {
        const projects = await listProjects();
        if (projects.length === 2) {
          refreshWaiting = true;
          await refreshGate;
        }
        return projects;
      });
    try {
      await fireEvent.press(screen.getByTestId('ORG.create-btn'));
      // The form is already gone: as soon as the document registered the
      // organization the screen replaced itself with the provisioning
      // surface (the promise keeps running at the root).
      await waitFor(() =>
        expect(
          mockNavigation.getRootState().routes.map(route => route.name),
        ).toEqual(['Success', 'OrganizationProvisioning']),
      );
      // The gate only trips on the first 2-project read: the materializer
      // has already published `pronta` and invalidated the queries.
      await waitFor(() => expect(refreshWaiting).toBe(true));
      expect(await listProjects()).toHaveLength(2);
      await act(async () => releaseRefresh());
      // While the refresh was gated the document had already published the
      // confirmation; nothing bounced to Home and nothing offers creation.
      expect(await screen.findByText('Organization created')).toBeOnTheScreen();
      // The tap is the ONLY way Home opens (SPEC A §4.2 regra 9).
      await fireEvent.press(
        screen.getByTestId('ORG.provisioning-open-organization-btn'),
      );
      expect(await screen.findByTestId('MAIN.map-screen')).toBeOnTheScreen();
      await act(async () => {
        await listProjects();
      });
      expect(screen.getByTestId('MAIN.map-screen')).toBeOnTheScreen();
      expect(
        screen.queryByTestId('ONBOARDING.create-org-btn'),
      ).not.toBeOnTheScreen();
      expect(screen.queryByTestId('ORG.create-btn')).not.toBeOnTheScreen();
      expect(await listProjects()).toHaveLength(2);
    } finally {
      releaseRefresh();
      spy.mockRestore();
    }
  });

  test('Home creation returns to Home after creating a second organization', async () => {
    await orgSetup.renderNavigation();
    expect(await screen.findByTestId('MAIN.map-screen')).toBeOnTheScreen();
    const navigation = mockNavigation;
    await act(async () => navigation.navigate('CreateOrganization'));
    expect(screen.getByTestId('ORG.create-name-inp')).toBeOnTheScreen();
    expect(navigation.getRootState().routes.map(route => route.name)).toEqual([
      'Home',
      'CreateOrganization',
    ]);
    expect(screen.queryByTestId('MAIN.map-screen')).not.toBeOnTheScreen();
    await fireEvent.changeText(
      screen.getByTestId('ORG.create-name-inp'),
      'Second Org',
    );
    await fireEvent.press(screen.getByTestId('ORG.create-btn'));
    // The document routed the journey: the form replaced itself with the
    // provisioning surface, which completes with the pending confirmation.
    await waitFor(() =>
      expect(
        mockNavigation.getRootState().routes.map(route => route.name),
      ).toEqual(['Home', 'OrganizationProvisioning']),
    );
    await waitFor(async () =>
      expect(await orgSetup.manager.listProjects()).toHaveLength(4),
    );
    expect(await screen.findByText('Organization created')).toBeOnTheScreen();
    // The tap is the ONLY way Home opens (SPEC A §4.2 regra 9).
    await fireEvent.press(
      screen.getByTestId('ORG.provisioning-open-organization-btn'),
    );
    await waitFor(
      () => {
        expect(screen.getByTestId('MAIN.map-screen')).toBeOnTheScreen();
        expect(
          screen.queryByTestId('ORG.create-name-inp'),
        ).not.toBeOnTheScreen();
      },
      {timeout: 5000},
    );
    expect(navigation.getRootState().routes.map(route => route.name)).toEqual([
      'Home',
    ]);
    // Completion is consumed: opening another form must not dismiss it.
    await act(async () => navigation.navigate('CreateOrganization'));
    expect(screen.getByTestId('ORG.create-name-inp')).toBeOnTheScreen();
    expect(screen.queryByTestId('MAIN.map-screen')).not.toBeOnTheScreen();
  }, 15000);

  test('an unmarked project with an active id lands on the Success fork (none-with-projects)', async () => {
    // e.g. a legacy invite accept: a plain project, no Organization.
    const legacyProjectId = await freshSetup.client.createProject({
      name: 'Legacy invite project',
    });
    await freshSetup.renderNavigationAsync({activeProjectId: legacyProjectId});

    expect(await screen.findByText('Join an Organization')).toBeOnTheScreen();
    expect(screen.getByText('test is ready!')).toBeOnTheScreen();
  });

  test('a one-slot organization lands on OrganizationProvisioning', async () => {
    const mProjectId = await freshSetup.client.createProject({
      name: 'Monitoramento',
      projectDescription: markerFor(freshSetup.orgId, 'm', freshSetup.orgName),
    });
    // The create this device started was interrupted before the second slot.
    recordOrganizationCreationProvenance(freshSetup.orgId);
    await freshSetup.renderNavigationAsync({activeProjectId: mProjectId});

    expect(
      await screen.findByText('Setting up your Organization…'),
    ).toBeOnTheScreen();
    // Restart-safe recovery (SPEC 5/E7): the incomplete org carries its name,
    // so the screen offers to finish the interrupted provisioning.
    expect(screen.getByTestId('ORG.provisioning-retry-btn')).toBeOnTheScreen();
  });

  test('a one-slot organization with no creation provenance refuses to finish', async () => {
    // Same local state as the test above WITHOUT the record: this is what a
    // leave or a remote removal leaves behind, and finishing it would create
    // an unrelated project in the missing slot and call the organization
    // ready without the original slot's data or members.
    const mProjectId = await freshSetup.client.createProject({
      name: 'Monitoramento',
      projectDescription: markerFor(freshSetup.orgId, 'm', freshSetup.orgName),
    });
    await freshSetup.renderNavigationAsync({activeProjectId: mProjectId});

    expect(
      await screen.findByText(
        'This Organization was not left half-created on this device, so its setup cannot be finished here.',
      ),
    ).toBeOnTheScreen();
    expect(
      screen.queryByTestId('ORG.provisioning-retry-btn'),
    ).not.toBeOnTheScreen();
    // The escape hatch stays reachable: no permanent creation lockout.
    expect(
      screen.getByTestId('ORG.provisioning-discard-btn'),
    ).toBeOnTheScreen();
  });

  test('leaving a slot of the only organization lands on the provisioning gate', async () => {
    // SPEC 3.8/10.1: the surviving slot reconstructs as `incomplete`, which
    // Home may not operate — the runtime gate must route there even though
    // `initialRouteName` was read when the navigator mounted on Home.
    await orgSetup.renderNavigation();
    expect(await screen.findByTestId('MAIN.map-screen')).toBeOnTheScreen();
    const navigation = mockNavigation;
    await act(async () =>
      navigation.navigate('LeaveProject', {memberType: 'participant'}),
    );
    await fireEvent.press(await screen.findByText('Yes, Leave'));

    await waitFor(async () => {
      const joined = (await orgSetup.manager.listProjects()).filter(
        project => project.status === 'joined',
      );
      expect(joined).toHaveLength(1);
    });
    expect(
      await screen.findByText('Setting up your Organization…'),
    ).toBeOnTheScreen();
    expect(navigation.getRootState().routes.map(route => route.name)).toEqual([
      'OrganizationProvisioning',
    ]);
    expect(screen.queryByTestId('MAIN.map-screen')).not.toBeOnTheScreen();
  }, 15000);

  test('an invalid organization stays reachable from Home while another is ready', async () => {
    // Mixed state: `some(ready)` sends the device to Home, so the invalid
    // organization's diagnosis has to be reachable FROM Home — and must not
    // bounce back to it the moment it renders.
    const duplicateSlotMarker = markerFor('f'.repeat(16), 'm', 'Broken Org');
    await orgSetup.client.createProject({
      name: 'Monitoramento',
      projectDescription: duplicateSlotMarker,
    });
    await orgSetup.client.createProject({
      name: 'Monitoramento (duplicado)',
      projectDescription: duplicateSlotMarker,
    });
    await orgSetup.renderNavigation();

    expect(await screen.findByTestId('MAIN.map-screen')).toBeOnTheScreen();
    const navigation = mockNavigation;
    await fireEvent.press(await screen.findByTestId('HOME.org-repair-btn'));

    expect(
      await screen.findByText(
        'Something is wrong with this Organization. Contact support.',
      ),
    ).toBeOnTheScreen();
    expect(navigation.getRootState().routes.map(route => route.name)).toEqual([
      'Home',
      'OrganizationProvisioning',
    ]);
  }, 15000);

  test('a standalone active id reaches Home on the ready organization even with an invalid one on the device (F7, Greptile P1)', async () => {
    // The reported repro: a valid standalone (unmarked) active project, a
    // READY organization and an INVALID one on the same device. The blanket
    // `some(state !== 'ready')` gate read the invalid organization as
    // evidence about the active id and parked the device on
    // OrganizationProvisioning — with no marker linking the id to the broken
    // organization, Home on the ready organization must stay reachable.
    const readyOrgId = 'fedcba9876543210';
    const readyMProjectId = await freshSetup.client.createProject({
      name: 'Monitoramento',
      projectDescription: markerFor(readyOrgId, 'm', 'Ready Org'),
    });
    await freshSetup.client.createProject({
      name: 'Alertas',
      projectDescription: markerFor(readyOrgId, 'a', 'Ready Org'),
    });
    const duplicateSlotMarker = markerFor('f'.repeat(16), 'm', 'Broken Org');
    await freshSetup.client.createProject({
      name: 'Monitoramento',
      projectDescription: duplicateSlotMarker,
    });
    await freshSetup.client.createProject({
      name: 'Monitoramento (duplicado)',
      projectDescription: duplicateSlotMarker,
    });
    const standaloneProjectId = await freshSetup.client.createProject({
      name: 'Standalone',
    });
    await freshSetup.renderNavigationAsync({
      activeProjectId: standaloneProjectId,
    });

    expect(await screen.findByTestId('MAIN.map-screen')).toBeOnTheScreen();
    // The rootless correction still runs: the id is repointed at the ready
    // organization's Monitoramento slot, not left on the standalone project.
    await waitFor(() =>
      expect(freshSetup.activeProjectId).toBe(readyMProjectId),
    );
    expect(
      mockNavigation.getRootState().routes.map(route => route.name),
    ).toEqual(['Home']);
  }, 15000);

  test('a duplicate-slot organization lands on OrganizationProvisioning and fails closed without crashing', async () => {
    const duplicateSlotMarker = markerFor(
      freshSetup.orgId,
      'm',
      freshSetup.orgName,
    );
    const firstProjectId = await freshSetup.client.createProject({
      name: 'Monitoramento',
      projectDescription: duplicateSlotMarker,
    });
    await freshSetup.client.createProject({
      name: 'Monitoramento (duplicado)',
      projectDescription: duplicateSlotMarker,
    });
    await freshSetup.renderNavigationAsync({activeProjectId: firstProjectId});

    expect(
      await screen.findByText(
        'Something is wrong with this Organization. Contact support.',
      ),
    ).toBeOnTheScreen();
    expect(
      screen.queryByTestId('ORG.provisioning-retry-btn'),
    ).not.toBeOnTheScreen();
  });

  test('a ready organization with the m slot active lands on Home', async () => {
    await orgSetup.renderNavigation();

    expect(await screen.findByTestId('MAIN.map-screen')).toBeOnTheScreen();
  });

  test('a ready organization corrects an unrelated active id to the m slot (SPEC 1.3)', async () => {
    // A standalone/debug switch left a non-organization project active.
    const unrelatedProjectId = await orgSetup.client.createProject({
      name: 'Unrelated',
    });
    await orgSetup.renderNavigation({activeProjectId: unrelatedProjectId});

    expect(await screen.findByTestId('MAIN.map-screen')).toBeOnTheScreen();
    // The active-correction effect repoints the active id at the primary
    // organization's Monitoramento slot before Home uses it — visible in the
    // Home header title (the drawer also lists the active project's marker).
    const headerTitle = await screen.findByTestId('HOME.header-title');
    expect(headerTitle).toHaveTextContent('Monitoramento');
    expect(screen.queryByText('Unrelated')).not.toBeOnTheScreen();
  });

  test('a degraded active organization is not silently switched to the ready one (F1)', async () => {
    // Review round 2 F1: org B is ready while the ACTIVE organization (A)
    // holds only its m slot — a leave or a remote removal degraded it. The
    // buggy effect silently rewrote the active project to B's m slot
    // (data-loss-adjacent: the user would operate another organization
    // with no notice). The fix keeps the active id on A's slot and routes
    // to the recovery surface (OrganizationProvisioning) through the same
    // mechanism OrganizationDegradationGate uses.
    const readyOrgId = 'fedcba9876543210';
    await freshSetup.client.createProject({
      name: 'Monitoramento',
      projectDescription: markerFor(readyOrgId, 'm', 'Ready Org'),
    });
    await freshSetup.client.createProject({
      name: 'Alertas',
      projectDescription: markerFor(readyOrgId, 'a', 'Ready Org'),
    });
    const degradedMProjectId = await freshSetup.client.createProject({
      name: 'Monitoramento',
      projectDescription: markerFor(freshSetup.orgId, 'm', freshSetup.orgName),
    });
    await freshSetup.renderNavigationAsync({
      activeProjectId: degradedMProjectId,
    });

    // The recovery surface renders — NOT Home operating the ready org.
    expect(
      await screen.findByText('Setting up your Organization…'),
    ).toBeOnTheScreen();
    expect(
      mockNavigation.getRootState().routes.map(route => route.name),
    ).toEqual(['OrganizationProvisioning']);
    expect(screen.queryByTestId('MAIN.map-screen')).not.toBeOnTheScreen();
    // NO silent switch: the persisted active id is still the degraded
    // organization's slot, not the ready organization's.
    expect(freshSetup.activeProjectId).toBe(degradedMProjectId);
  }, 15000);

  test('um documento pronta com confirmação pendente não deixa o navigator abrir Home (SPEC B §3.3 2-3)', async () => {
    // Os dois marcadores do par m/a existem no core; o documento persistido
    // descreve a MESMA organização: pronta, confirmação pendente, sem
    // seleção. O refresh da lista de projetos fica preso num gate até o
    // release: quando a reconstrução chega, o documento é a única evidência
    // disponível e NADA pode ser ativado — nem o slot 'm' gravado por baixo
    // da confirmação pendente.
    const mProjectId = await freshSetup.client.createProject({
      name: 'Monitoramento',
      projectDescription: markerFor(freshSetup.orgId, 'm', freshSetup.orgName),
    });
    const aProjectId = await freshSetup.client.createProject({
      name: 'Alertas',
      projectDescription: markerFor(freshSetup.orgId, 'a', freshSetup.orgName),
    });
    // O id legado: um projeto sem marcador desta mesma instância do core —
    // o mesmo resíduo que um interruptor/depuração da era pré-organização
    // deixaria persistido.
    const standaloneProjectId = await freshSetup.client.createProject({
      name: 'Standalone',
    });
    const segundaOrgId = 'fedcba9876543210';
    const segundaAreaProjectId = await freshSetup.client.createProject({
      name: 'Alertas',
      projectDescription: markerFor(segundaOrgId, 'a', 'Outra Org'),
    });
    MMKVStoreInitializer.setItem(
      COIAB_ORGANIZATIONS_STORAGE_KEY,
      JSON.stringify({
        state: documentoComConfirmacaoPendente(
          mProjectId,
          aProjectId,
          freshSetup.orgId,
          segundaOrgId,
          segundaAreaProjectId,
        ),
        version: 1,
      }),
    );

    const listProjects = freshSetup.manager.listProjects.bind(
      freshSetup.manager,
    );
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>(resolve => {
      releaseRefresh = resolve;
    });
    let refreshWaiting = false;
    const spy = jest
      .spyOn(freshSetup.manager, 'listProjects')
      .mockImplementation(async () => {
        const projects = await listProjects();
        if (projects.length >= 2) {
          refreshWaiting = true;
          await refreshGate;
        }
        return projects;
      });
    try {
      await freshSetup.renderNavigationAsync({
        activeProjectId: standaloneProjectId,
      });
      await waitFor(() => expect(refreshWaiting).toBe(true));

      await act(async () => releaseRefresh());

      // O documento roteia o arranque ANTES de qualquer estado
      // reconstruído: a confirmação pendente é a superfície de abertura e,
      // com 5b-1, renderiza a visão guiada pelo documento (a confirmação),
      // não o texto genérico de preparação da era fanout.
      expect(await screen.findByText('Organization created')).toBeOnTheScreen();
      // Nenhum escritor projetou o slot por baixo da confirmação pendente:
      // o id legado segue exatamente o valor semeado.
      expect(freshSetup.activeProjectId).toBe(standaloneProjectId);
    } finally {
      releaseRefresh();
      spy.mockRestore();
    }
  }, 15000);

  test('leaving the active slot while another organization is ready never repoints the active id at it (F6)', async () => {
    // F6: the leave clears the active id, and the slot it left stops being
    // reconstructed at all (only `joined` rows contribute slots) — so the
    // active id is claimed by NO organization and the legacy SPEC 1.3
    // correction used to repoint it at the ready organization's m slot.
    // On the next start that ready slot makes the device look healthy and
    // Home operates the OTHER organization with no notice.
    const readyOrgId = 'fedcba9876543210';
    const readyMProjectId = await freshSetup.client.createProject({
      name: 'Monitoramento',
      projectDescription: markerFor(readyOrgId, 'm', 'Ready Org'),
    });
    const readyAProjectId = await freshSetup.client.createProject({
      name: 'Alertas',
      projectDescription: markerFor(readyOrgId, 'a', 'Ready Org'),
    });
    const activeMProjectId = await freshSetup.client.createProject({
      name: 'Monitoramento',
      projectDescription: markerFor(freshSetup.orgId, 'm', freshSetup.orgName),
    });
    await freshSetup.client.createProject({
      name: 'Alertas',
      projectDescription: markerFor(freshSetup.orgId, 'a', freshSetup.orgName),
    });
    await freshSetup.renderNavigationAsync({
      activeProjectId: activeMProjectId,
    });

    expect(await screen.findByTestId('MAIN.map-screen')).toBeOnTheScreen();
    const navigation = mockNavigation;
    await act(async () =>
      navigation.navigate('LeaveProject', {memberType: 'participant'}),
    );
    await fireEvent.press(await screen.findByText('Yes, Leave'));

    await waitFor(async () => {
      const joined = (await freshSetup.manager.listProjects()).filter(
        project => project.status === 'joined',
      );
      expect(joined).toHaveLength(3);
    });
    // Provenance note (F7/F10): the core KEEPS the project keys row with
    // `hasLeftProject: true` and deletes only the project settings
    // (mapeo-manager.js:1041 / :1044-1047), but `listProjects()` defaults to
    // `includeLeft: false` (:636), so the row is invisible here — the active
    // id names no local project and carries no marker to trace. That
    // absence, asserted below against the real core, is the evidence.
    await waitFor(async () => {
      const rows = await freshSetup.manager.listProjects();
      expect(rows.some(project => project.projectId === activeMProjectId)).toBe(
        false,
      );
    });
    expect(
      await screen.findByText('Setting up your Organization…'),
    ).toBeOnTheScreen();
    // Let the post-leave project refresh settle: the buggy correction fires
    // from an effect on the refreshed organization list.
    await act(async () => {
      await freshSetup.manager.listProjects();
    });

    expect(navigation.getRootState().routes.map(route => route.name)).toEqual([
      'OrganizationProvisioning',
    ]);
    expect(screen.queryByTestId('MAIN.map-screen')).not.toBeOnTheScreen();
    // NO silent switch: the active id is not repointed at EITHER slot of the
    // other organization. It stays on the left slot's id, exactly as the
    // single-organization leave already leaves it (the gate's reset unmounts
    // LeaveProject before its mutation callback clears it) — stale, but
    // fail-closed on the recovery surface instead of operating org B.
    expect(freshSetup.activeProjectId).not.toBe(readyMProjectId);
    expect(freshSetup.activeProjectId).not.toBe(readyAProjectId);
    // Stronger than the two negatives: the only two outcomes the leave may
    // leave behind are the left slot's own id (the gate's reset unmounts
    // LeaveProject before its mutation callback clears it) or `undefined`
    // (the callback ran first). Anything else — including a third project —
    // would be a silent repoint.
    expect([activeMProjectId, undefined]).toContain(freshSetup.activeProjectId);
  }, 20000);
  test('e2e: criar → confirmação → Abrir organização → Home com o nome da organização (SPEC B §3.3)', async () => {
    await freshSetup.renderNavigationAsync();
    await fireEvent.press(
      await screen.findByTestId('ONBOARDING.create-org-btn'),
    );
    await fireEvent.changeText(
      screen.getByTestId('ORG.create-name-inp'),
      '  Minha Org  ',
    );
    await fireEvent.press(screen.getByTestId('ORG.create-btn'));

    // O documento assumiu a viagem: a tela substituiu o formulário pela
    // superfície de provisionamento enquanto a promessa roda na raiz.
    await waitFor(() =>
      expect(
        mockNavigation.getRootState().routes.map(route => route.name),
      ).toEqual(['Success', 'OrganizationProvisioning']),
    );
    // 2/2 verificado → confirmação pendente; o toque é o único caminho
    // para a Home (SPEC A §4.2 regra 9).
    expect(await screen.findByText('Organization created')).toBeOnTheScreen();
    await fireEvent.press(
      screen.getByTestId('ORG.provisioning-open-organization-btn'),
    );

    expect(await screen.findByTestId('MAIN.map-screen')).toBeOnTheScreen();
    // SPEC B §7: a evidência de organização aberta é o nome no cabeçalho —
    // com espaços das bordas removidos no save.
    expect(await screen.findByTestId('HOME.header-title')).toHaveTextContent(
      'Minha Org',
    );
    // A escrita única do toque gravou reconhecimento e seleção juntos.
    const raw = documentoPersistido();
    const organizacaoCriada = raw.organizacoes[0];
    expect(organizacaoCriada).toBeDefined();
    expect(raw.ativa).toEqual({
      organizacaoId: organizacaoCriada!.id,
      area: 'monitoramento',
    });
    // CA4: exatamente dois projetos, sem um terceiro.
    expect(await freshSetup.manager.listProjects()).toHaveLength(2);
  }, 20000);

  test('reinício antes do toque reapresenta a confirmação e mantém ativa nula (CA10)', async () => {
    const desmontar = await freshSetup.renderNavigationAsync();
    await fireEvent.press(
      await screen.findByTestId('ONBOARDING.create-org-btn'),
    );
    await fireEvent.changeText(
      screen.getByTestId('ORG.create-name-inp'),
      'Minha Org',
    );
    await fireEvent.press(screen.getByTestId('ORG.create-btn'));
    // Aguarda a publicação pronta SEM tocar em Abrir organização.
    await screen.findByText('Organization created');

    // Reinício: um NOVO store sobre o MESMO MMKV (o mock MMKV do jest
    // persiste no processo inteiro, como o MMKV real persiste no app).
    await desmontar();
    await freshSetup.renderNavigationAsync();

    // A confirmação é reapresentada — não a preparação, não a Home.
    expect(await screen.findByText('Organization created')).toBeOnTheScreen();
    expect(
      await screen.findByTestId('ORG.provisioning-open-organization-btn'),
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('MAIN.map-screen')).not.toBeOnTheScreen();
    // Nenhuma seleção foi reconstruída ou inferida (regra 9/CA10).
    expect(documentoPersistido().ativa).toBe(null);
    // Nada é recriado: os dois projetos persistidos continuam sendo os mesmos.
    expect(await freshSetup.manager.listProjects()).toHaveLength(2);
  }, 20000);
});
