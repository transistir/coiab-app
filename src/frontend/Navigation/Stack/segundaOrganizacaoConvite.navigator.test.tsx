import type {NavigationContainerRef} from '@react-navigation/native';
import type {AppStackParamsList} from '../../sharedTypes/navigation';
import path from 'node:path';

// The engine's async publications (zustand → navigation resets) must run
// under React's act scheduler; RNTL toggles the flag only around its own
// calls, and this suite's transitions arrive in core callbacks outside them.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
import {fireEvent, screen, waitFor} from '@testing-library/react-native';

// The full navigator mounts the real Home tabs (MapScreen included) — the
// map stack is stubbed exactly like index.navigator.test.tsx does.
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
    // Named exports: the real Observation screen renders InsetMapView,
    // which destructures them directly.
    MapView: Stub,
    Camera: Stub,
    MarkerView: Stub,
    UserLocation: Stub,
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
import {
  derivarProjectIdAtivo,
  type EstadoOrganizacoes,
} from '../../lib/organization/coiabOrganizations';
import {markerFor, parseMarker} from '../../lib/organization/marker';
import {clienteDeCriacao} from '../../lib/organization/clienteDeCriacao';
import {criarTemplateSourceInstalado} from '../../lib/organization/pacotesInstalados';
import {COORDINATOR_ROLE_ID} from '../../sharedTypes';
import {
  connectPeers,
  createManager,
} from '../../../../tests/integration/helpers/core';
import {
  setupIntegrationTest,
  semearDocumentoPronta,
} from '../../../../tests/integration/helpers/setupIntegrationTest';
import {sleep} from '../../lib/sleep';

/**
 * The RAW persisted document, exactly as the store writes it: `ativa` and
 * the organization list are asserted from the disk-level truth, not from
 * any subscribed store view.
 */
function documentoPersistido(): EstadoOrganizacoes {
  const cru = MMKVStoreInitializer.getItem(COIAB_ORGANIZATIONS_STORAGE_KEY);
  if (typeof cru !== 'string') throw new Error('documento ausente');
  return JSON.parse(cru).state;
}

/**
 * Convite 4 at navigator level (plano §12.3): the FULL invite journey on the
 * real RootStackNavigator with NO screen mocks — a second REAL device
 * (sender) invites this one into both slots of organization B over local
 * peer discovery; the real PendingInvitesListener routes the bundle to the
 * real sheet; the real accept registers B in the durable document and hands
 * the retoma to the real engine (by id — the Fase 4 post-merge fix), and the
 * provisioning surface lands on B's confirmation while A keeps operating.
 */
describe('segunda organização por convite (navigator real)', () => {
  const orgSetup = setupIntegrationTest();

  const CONVIDADA_ID = 'fedcba9876543210';
  const CONVIDADA_NOME = 'Org Convidada';

  afterEach(() => {
    MMKVStoreInitializer.removeItem(COIAB_ORGANIZATIONS_STORAGE_KEY);
  });

  beforeEach(() => {
    // The teardown of a FAILED test cannot be awaited by the next one; the
    // next device state must hydrate empty (same ledger discipline as
    // index.navigator.test.tsx).
    MMKVStoreInitializer.removeItem(COIAB_ORGANIZATIONS_STORAGE_KEY);
  });

  test('o convite de B com A ativa registra [A,B] e a confirmação descreve B, nunca a primeira entrada', async () => {
    // --- The sender device: organization B with both canonical slots. ---
    const {manager: sender} = await createManager({
      name: 'sender',
      deviceType: 'mobile',
    });
    let disconnect: (() => Promise<void>) | undefined;
    const inviteFailures: Array<{slot: 'm' | 'a'; error: unknown}> = [];
    // The delayed project refresh: the accept's reads (its own preflight,
    // the fresh post-accept read and the invalidated query refetches) park
    // here until the joined slots are proven locally, mirroring the
    // delayed-refresh windows of index.navigator.test.tsx.
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>(resolve => {
      releaseRefresh = resolve;
    });
    let refreshWaiting = false;
    let spy: {mockRestore: () => void} | undefined;
    let slotsAceitos: Record<'m' | 'a', string> | undefined;
    try {
      // connectPeers has no internal deadline: a discovery failure would
      // hang the suite forever, so race it with one of our own.
      await Promise.race([
        connectPeers([orgSetup.manager, sender]).then(stop => {
          disconnect = stop;
        }),
        sleep(60_000).then(() => {
          throw new Error('timed out connecting the invite sender');
        }),
      ]);

      const slotProjectIds: Record<'m' | 'a', string> = {
        m: await sender.createProject({
          name: 'Monitoramento',
          projectDescription: markerFor(CONVIDADA_ID, 'm', CONVIDADA_NOME),
        }),
        a: await sender.createProject({
          name: 'Alertas',
          projectDescription: markerFor(CONVIDADA_ID, 'a', CONVIDADA_NOME),
        }),
      };

      // The INVITER owns the canonical content (SPEC B §5.5): the entry
      // confirmation verifies — never re-imports — the inviter's
      // categories, so the sender imports the real bundled packages into
      // both slots before inviting (same route as the creation flow).
      for (const area of ['m', 'a'] as const) {
        const senderProject = await sender.getProject(slotProjectIds[area]);
        await senderProject.$importCategories({
          filePath: path.resolve(
            __dirname,
            `../../../../assets/categorias/${
              area === 'm' ? 'monitoramento' : 'alertas'
            }.comapeocat`,
          ),
        });
      }

      // A settled A keeps operating before the invite lands: the journey
      // starts from a documento assentado (the Convite 4 premise), not
      // from onboarding.
      semearDocumentoPronta(
        orgSetup.projectId,
        orgSetup.alertasProjectId,
        orgSetup.orgId,
        orgSetup.orgName,
      );

      // Fire-and-forget delivery per slot (spike discipline): the sender
      // promise resolves on the invitee's RESPONSE, i.e. at the Join tap,
      // and may still be mid post-accept sync at teardown — a rejection is
      // RECORDED (never thrown here: a dangling promise must not become an
      // unhandled rejection nor hang the finally) and asserted in the
      // happy path below.
      for (const area of ['m', 'a'] as const) {
        const senderProject = await sender.getProject(slotProjectIds[area]);
        void senderProject.$member
          .invite(orgSetup.manager.deviceId, {
            roleId: COORDINATOR_ROLE_ID,
            roleName: 'coordinator',
            initialSyncTimeoutMs: 120_000,
          })
          .catch((error: unknown) => {
            inviteFailures.push({slot: area, error});
          });
      }

      // Both slot invites must be pending BEFORE the navigator mounts, so
      // the initial invites query already carries the complete bundle.
      for (let inicio = Date.now(); ;) {
        const invites = (await orgSetup.manager.invite.getMany()) as Array<{
          inviteId: string;
          projectDescription?: string;
          state: string;
        }>;
        if (
          invites.filter(
            invite =>
              invite.state === 'pending' &&
              parseMarker(invite.projectDescription ?? '')?.organizationId ===
                CONVIDADA_ID,
          ).length === 2
        ) {
          break;
        }
        if (Date.now() - inicio > 30_000) {
          throw new Error('timed out waiting for both pending invites');
        }
        await sleep(250);
      }

      await orgSetup.renderNavigation();
      // A ativa opens Home/Map. The invite modal that the pending bundle
      // opens over it marks the whole Home screen aria-hidden for native
      // accessibility, so the mount assert must include hidden elements.
      expect(
        await screen.findByTestId(
          'MAIN.map-screen',
          {includeHiddenElements: true},
          {timeout: 15_000},
        ),
      ).toBeOnTheScreen();

      // The real PendingInvitesListener routes the marker bundle: A is
      // settled ('pronta') and B is not local, so the single Organization
      // surface opens on its own — no manual navigation, no deep link.
      expect(
        await screen.findByText(CONVIDADA_NOME, undefined, {
          timeout: 15_000,
        }),
      ).toBeOnTheScreen();
      expect(screen.getByTestId('ORG.invite-join-btn')).toBeOnTheScreen();

      // Arm the delayed refresh BEFORE the tap. The gate passes reads
      // that still see only A's pair (the accept's pre-accept reads —
      // gating those would deadlock the join loop behind its own
      // preflight) and PARKS the first read that sees a joined B slot:
      // the hook's fresh post-accept read and the invalidated query
      // refetches hold there until the joined slots are fully proven
      // below, with the registration waiting behind them.
      const listProjectsRaw = orgSetup.manager.listProjects.bind(
        orgSetup.manager,
      );
      // Reads that still see only A's pair pass straight through — the
      // accept's pre-accept reads cannot park (gating them would deadlock
      // the join loop behind its own preflight), and no joined row of the
      // invited organization exists before the joins. The FIRST read whose
      // result carries such a row — the hook's fresh post-accept read or
      // an invalidated query refetch — sets the flag the verificacao
      // branch waits on and parks on the gate; the flag stays true after
      // the release, so every later read flows one-shot.
      spy = jest
        .spyOn(orgSetup.manager, 'listProjects')
        .mockImplementation(async () => {
          const projects = await listProjectsRaw();
          const joinedB = projects.some(
            row =>
              row.status === 'joined' &&
              parseMarker(row.projectDescription ?? '')?.organizationId ===
                CONVIDADA_ID,
          );
          if (!refreshWaiting && joinedB) {
            refreshWaiting = true;
            await refreshGate;
          }
          return projects;
        });

      // The press's act flush awaits the sheet's accept() — the accept IS
      // the handler's promise, unlike the creation flow whose flight runs
      // detached at the root. The accept's fresh post-accept read parks on
      // the gate below, so releasing the gate from THIS continuation would
      // deadlock the two against each other and burn the core IPC 30 s
      // call timeout (the accept then settles as a raw transport failure
      // and never registers). The joined-slot proof therefore runs as a
      // PARALLEL branch — plain I/O waits, no act — and releases the gate
      // itself; the awaited press then returns only after the accept has
      // settled on the released reads.
      const verificacao = (async () => {
        // The joins complete at core level (each invite.accept waits for
        // its initial sync), and the FRESH read parks on the gate as soon
        // as the first B row exists locally.
        for (let inicio = Date.now(); ;) {
          if (refreshWaiting) break;
          if (Date.now() - inicio > 60_000) {
            throw new Error('timed out waiting for the parked refresh');
          }
          await sleep(250);
        }

        // While the refresh is held, the joins still complete at core
        // level and the device converges locally: rows 'joined', a real
        // role on both slots, and the inviter's categories matching the
        // canonical packages — the exact proof `verificarEntrada` will
        // demand, so the retoma hand-off cannot race its own sync
        // underneath.
        const fonte = criarTemplateSourceInstalado();
        const pacotes = await fonte.prepare();
        const clienteConvite = clienteDeCriacao(orgSetup.client);
        const slotsPorMarcador = async (
          slot: 'm' | 'a',
        ): Promise<string | undefined> => {
          const rows = await listProjectsRaw();
          const linha = rows.find(
            row =>
              row.status === 'joined' &&
              parseMarker(row.projectDescription ?? '')?.organizationId ===
                CONVIDADA_ID &&
              parseMarker(row.projectDescription ?? '')?.slot === slot,
          );
          return linha?.projectId;
        };
        const entradaVerificavel = async (): Promise<
          Record<'m' | 'a', string>
        > => {
          const idM = await slotsPorMarcador('m');
          const idA = await slotsPorMarcador('a');
          if (idM === undefined || idA === undefined) {
            throw new Error('slots not joined yet');
          }
          const projetoM = await clienteConvite.getProject(idM);
          const projetoA = await clienteConvite.getProject(idA);
          const [papelM, papelA] = await Promise.all([
            projetoM.$getOwnRole(),
            projetoA.$getOwnRole(),
          ]);
          if (
            papelM.roleId !== COORDINATOR_ROLE_ID ||
            papelA.roleId !== COORDINATOR_ROLE_ID
          ) {
            throw new Error('roles not synced yet');
          }
          if (
            !(await fonte.verify(projetoM, pacotes.monitoramento, idM)) ||
            !(await fonte.verify(projetoA, pacotes.alertas, idA))
          ) {
            throw new Error('categories not synced yet');
          }
          return {m: idM, a: idA};
        };
        for (let inicio = Date.now(); ;) {
          try {
            slotsAceitos = await entradaVerificavel();
            break;
          } catch {
            if (Date.now() - inicio > 60_000) {
              throw new Error(
                'timed out waiting for the joined slots to become verifiable',
              );
            }
            await sleep(250);
          }
        }

        // The proof is on record: the accept's reads flow again.
        releaseRefresh();
      })();

      await fireEvent.press(screen.getByTestId('ORG.invite-join-btn'));
      await verificacao;

      // The registered accept lands on the provisioning surface by RESET —
      // the stale invite context cannot survive (SPEC B §5.5).
      await waitFor(
        () =>
          expect(
            mockNavigation.getRootState().routes.map(route => route.name),
          ).toEqual(['OrganizationProvisioning']),
        {timeout: 15_000},
      );
      expect(
        await screen.findByText('Organization created', undefined, {
          timeout: 15_000,
        }),
      ).toBeOnTheScreen();
      expect(
        await screen.findByText(
          `${CONVIDADA_NOME} is ready. Monitoring and Alerts are already available.`,
          undefined,
          {timeout: 15_000},
        ),
      ).toBeOnTheScreen();
      expect(screen.getAllByText('Ready')).toHaveLength(2);

      // The durable document took both entries in order, and the accept
      // never touched the operating slot: A stays ativa with its own
      // derived project id (Convite 2's GREEN criterion, navigator-level).
      const cru = documentoPersistido();
      expect(cru.organizacoes.map(org => org.id)).toEqual([
        orgSetup.orgId,
        CONVIDADA_ID,
      ]);
      const entradaB = cru.organizacoes[1]!;
      expect(entradaB.estado).toBe('pronta');
      expect(entradaB.confirmacaoPendente).toBe(true);
      // The invite entry pins the EMBEDDED template refs (the
      // `verificarEntrada` publication), not a creation journal.
      expect(entradaB.materializacao.monitoramento.projectId).toBe(
        slotsAceitos!.m,
      );
      expect(entradaB.materializacao.alertas.projectId).toBe(slotsAceitos!.a);
      expect(entradaB.materializacao.monitoramento.template).not.toBeNull();
      expect(entradaB.materializacao.alertas.template).not.toBeNull();
      expect(cru.ativa).toEqual({
        organizacaoId: orgSetup.orgId,
        area: 'monitoramento',
      });
      expect(derivarProjectIdAtivo(cru)).toBe(orgSetup.projectId);

      // Both sender-side invites were answered by this accept (the
      // response happened at the Join tap, well before the confirmation
      // landed): a recorded delivery failure here is a real journey
      // failure, never teardown noise.
      expect(inviteFailures).toEqual([]);
      // The tap is the only way Home opens (SPEC A §4.2 regra 9): the
      // invited organization opens like any other — the generation gate
      // resets to Home/Map and the header shows B.
      await fireEvent.press(
        screen.getByTestId('ORG.provisioning-open-organization-btn'),
      );
      expect(
        await screen.findByTestId('MAIN.map-screen', {}, {timeout: 15_000}),
      ).toBeOnTheScreen();
      expect(
        mockNavigation.getRootState().routes.map(route => route.name),
      ).toEqual(['Home']);
      expect(
        await screen.findByTestId('HOME.header-title', {}, {timeout: 15_000}),
      ).toHaveTextContent(CONVIDADA_NOME);
      expect(documentoPersistido().ativa).toEqual({
        organizacaoId: CONVIDADA_ID,
        area: 'monitoramento',
      });
    } finally {
      spy?.mockRestore();
      releaseRefresh();
      await disconnect?.();
      await sender.close().catch(() => undefined);
    }
  }, 300_000);
});
