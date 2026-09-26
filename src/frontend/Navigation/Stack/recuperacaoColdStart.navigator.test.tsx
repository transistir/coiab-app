import type {NavigationContainerRef} from '@react-navigation/native';
import type {AppStackParamsList} from '../../sharedTypes/navigation';

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

// #89 fase 2 (T8): the recovery surface reads the early-access gate (D1) —
// but the `EarlyAccess` screen used by the other suites is pruned while the
// engine is in recovery, so the flag is seeded by wrapping the store factory
// the providers wrapper calls (tests/integration/helpers/react.tsx:159).
// Provider and hook stay real.
let mockEarlyAccess = true;
jest.mock('../../contexts/EarlyAccessContext', () => {
  const actual = jest.requireActual<
    typeof import('../../contexts/EarlyAccessContext')
  >('../../contexts/EarlyAccessContext');
  return {
    ...actual,
    createEarlyAccessStore: (
      ...a: Parameters<typeof actual.createEarlyAccessStore>
    ) => {
      const s = actual.createEarlyAccessStore(...a);
      s.actions.setEarlyAccessEnabled(mockEarlyAccess);
      return s;
    },
  };
});

// The engine stays REAL — the wrapper only keeps a handle on each instance
// and logs every publication, so a test can pin the exact publications a
// gesture produced ("sem nova publicação" = same length as before it).
type MockPublicacao = {
  status: string;
  error?: string;
  generation: number;
  projectId?: string;
};
const mockPublicacoes: MockPublicacao[] = [];
const mockMotores: Array<{instance: {getState(): MockPublicacao}}> = [];
jest.mock('../../lib/organization/activation', () => {
  const actual = jest.requireActual<
    typeof import('../../lib/organization/activation')
  >('../../lib/organization/activation');
  return {
    ...actual,
    createOrganizationActivation: (
      ...args: Parameters<typeof actual.createOrganizationActivation>
    ) => {
      const motor = actual.createOrganizationActivation(...args);
      mockMotores.push(motor);
      motor.instance.subscribe(state =>
        mockPublicacoes.push({
          status: state.status,
          error: state.error,
          generation: state.generation,
        }),
      );
      return motor;
    },
  };
});

// (T7) The REAL installed template source cannot run under jest (no
// `comapeocat` entry in jest-expo's asset registry — see
// segundaOrganizacao.navigator.test.tsx). This mock keeps everything
// downstream real — the materializer, the core `$importCategories` and the
// canonical conferência — and simulates only the on-device download/copy
// plumbing, plus two levers this suite needs:
// - (T6) `mockBarreiraPrepare` holds `prepare` while it is in flight, so a
//   test can observe the REAL intermediate state of a resume that is stuck
//   at materializar.ts's resume barrier (N7);
// - (T8) `mockFalharVerify` fails the post-persistence `verify`, landing in
//   the materializer's `fail()` — the R1 limit (H1).
let mockBarreiraPrepare:
  {entrou: () => void; liberada: Promise<void>} | undefined;
let mockFalharVerify = false;
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
      prepare: async () => {
        if (mockBarreiraPrepare) {
          mockBarreiraPrepare.entrou();
          await mockBarreiraPrepare.liberada;
        }
        return {
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
        };
      },
      verify: (project: unknown, pacote: unknown) =>
        mockFalharVerify
          ? Promise.reject(new Error('verify-falhou'))
          : verificarImportacao(
              project as Parameters<typeof verificarImportacao>[0],
              pacote as Parameters<typeof verificarImportacao>[1],
              ler,
            ),
    }),
  };
});

import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

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

import {MMKVStoreInitializer} from '../../hooks/persistedState/createPersistedState';
import {COIAB_ORGANIZATIONS_STORAGE_KEY} from '../../contexts/CoiabOrganizationsStoreContext';
import {
  type EstadoOrganizacoes,
  type OrganizacaoLocal,
} from '../../lib/organization/coiabOrganizations';
import {manifestosEmbarcados} from '../../lib/organization/pacotes';
import {BLOCKED_ROLE_ID} from '../../sharedTypes';
import {markerFor} from '../../lib/organization/marker';
import {
  setupIntegrationTest,
  semearDocumentoPronta,
} from '../../../../tests/integration/helpers/setupIntegrationTest';

const rotas = () =>
  mockNavigation.getRootState().routes.map(route => route.name);

/** The live engine: the one whose boot left `loading`. */
const motor = () =>
  mockMotores.find(item => item.instance.getState().status !== 'loading') ??
  mockMotores.at(-1)!;

function organizacaoPronta(
  id: string,
  nome: string,
  monitoramentoId: string,
  alertasId: string,
): OrganizacaoLocal {
  return {
    id,
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
  };
}

/** An area journal before any creation attempt (the resume re-registers). */
function etapaAusente(
  area: 'monitoramento' | 'alertas',
): OrganizacaoLocal['materializacao']['monitoramento'] {
  return {
    etapa: 'ausente',
    projectId: null,
    template: manifestosEmbarcados[area].ref,
    idsAntesDaCriacao: null,
  };
}

/** The RAW persisted document: `ativa` is asserted from the disk-level truth. */
function documentoPersistido(): EstadoOrganizacoes {
  const cru = MMKVStoreInitializer.getItem(COIAB_ORGANIZATIONS_STORAGE_KEY);
  if (typeof cru !== 'string') throw new Error('documento ausente');
  return JSON.parse(cru).state;
}

/**
 * #89 fase 2 — the navigable recovery exit (plano v2 §4): a device whose
 * role was blocked cold-starts into the recovery surface; the two new exits
 * (Trocar / Criar) must lead OUT of it, exactly as the drawer offers them.
 * Navigator real, core real, the role rewritten to BLOCKED before the first
 * render (the fase-1 harness). H1/H2 pin LIMITS (green = the limit, not the
 * desired behaviour); the test names say so.
 */
describe('#89 fase 2 — saída navegável da recovery de cold start (navigator real)', () => {
  const orgSetup = setupIntegrationTest();

  const B_ID = 'fedcba9876543210';
  const B_NOME = 'Organização B';
  const C_ID = 'cdef0123456789ab';
  const C_NOME = 'Organização C';

  beforeEach(() => {
    // The teardown of a FAILED test cannot be awaited by the next one; the
    // next device state must hydrate empty (segundaOrganizacao's ledger
    // discipline). MapeoTrack too: a seeded track would block the next
    // test's boot (#88).
    MMKVStoreInitializer.removeItem(COIAB_ORGANIZATIONS_STORAGE_KEY);
    MMKVStoreInitializer.removeItem('MapeoTrack');
    mockPublicacoes.length = 0;
    mockMotores.length = 0;
    mockEarlyAccess = true;
    mockBarreiraPrepare = undefined;
    mockFalharVerify = false;
  });
  afterEach(() => {
    MMKVStoreInitializer.removeItem(COIAB_ORGANIZATIONS_STORAGE_KEY);
    MMKVStoreInitializer.removeItem('MapeoTrack');
  });

  async function bloquearPapel(projectId: string) {
    const project = await orgSetup.client.getProject(projectId);
    await project.$member.assignRole(
      orgSetup.manager.deviceId,
      BLOCKED_ROLE_ID as Parameters<typeof project.$member.assignRole>[1],
    );
    expect((await project.$getOwnRole()).roleId).toBe(BLOCKED_ROLE_ID);
  }

  /** B's/C's real pair of core projects, marked for the §4.2 ids. */
  async function criarParDeProjetos(id: string, nome: string) {
    const monitoramento = await orgSetup.client.createProject({
      name: 'Monitoramento',
      projectDescription: markerFor(id, 'm', nome),
    });
    const alertas = await orgSetup.client.createProject({
      name: 'Alertas',
      projectDescription: markerFor(id, 'a', nome),
    });
    return {monitoramento, alertas};
  }

  function semear(documento: EstadoOrganizacoes) {
    MMKVStoreInitializer.setItem(
      COIAB_ORGANIZATIONS_STORAGE_KEY,
      JSON.stringify({state: documento, version: 1}),
    );
  }

  function documento(
    organizacoes: OrganizacaoLocal[],
    ativa: EstadoOrganizacoes['ativa'],
  ): EstadoOrganizacoes {
    return {versao: 1, organizacoes, ativa};
  }

  function organizacaoAtivaA(): OrganizacaoLocal {
    return organizacaoPronta(
      orgSetup.orgId,
      orgSetup.orgName,
      orgSetup.projectId,
      orgSetup.alertasProjectId,
    );
  }

  async function abrirRecoveryAteOTitulo() {
    expect(
      await screen.findByText('Could not open your organization', undefined, {
        timeout: 30_000,
      }),
    ).toBeOnTheScreen();
  }

  test('1 org + early access: recovery mostra nome e "Criar organização", sem "Trocar"; Voltar da introdução retorna', async () => {
    semearDocumentoPronta(
      orgSetup.projectId,
      orgSetup.alertasProjectId,
      orgSetup.orgId,
      orgSetup.orgName,
    );
    await bloquearPapel(orgSetup.projectId);
    await orgSetup.renderNavigation();

    // (AC1) The name (SPEC A §6.2:214 "Nome preservado") and the 1-org exit.
    expect(
      await screen.findByTestId(
        'ORG.provisioning-unavailable-name',
        {},
        {timeout: 30_000},
      ),
    ).toHaveTextContent(orgSetup.orgName);
    expect(
      screen.getByTestId('ORG.provisioning-create-organization-btn'),
    ).toBeOnTheScreen();
    // (AC2) One organization: no switch entry.
    expect(
      screen.queryByTestId('ORG.provisioning-switch-organization-btn'),
    ).not.toBeOnTheScreen();
    expect(rotas()).toEqual(['OrganizationProvisioning']);

    // (M1) Back from the creation intro returns to the recovery, with no
    // new engine publication.
    const publicacoesAntes = mockPublicacoes.length;
    await fireEvent.press(
      screen.getByTestId('ORG.provisioning-create-organization-btn'),
    );
    await waitFor(
      () =>
        expect(rotas()).toEqual([
          'OrganizationProvisioning',
          'CreateOrganization',
        ]),
      {timeout: 15_000},
    );
    // The introduction itself is up: its §B :54 title (the provisioning's
    // own exit button below the modal carries the same words, aria-hidden).
    expect(
      await screen.findByText('Create Organization', {}, {timeout: 15_000}),
    ).toBeOnTheScreen();
    expect(
      await screen.findByTestId(
        'ORG.create-intro-continue-btn',
        {},
        {
          timeout: 15_000,
        },
      ),
    ).toBeOnTheScreen();
    await act(async () => {
      mockNavigation.goBack();
    });
    await waitFor(() => expect(rotas()).toEqual(['OrganizationProvisioning']), {
      timeout: 15_000,
    });
    expect(
      await screen.findByTestId(
        'ORG.provisioning-unavailable-name',
        {},
        {timeout: 15_000},
      ),
    ).toHaveTextContent(orgSetup.orgName);
    expect(
      screen.getByTestId('ORG.provisioning-create-organization-btn'),
    ).toBeOnTheScreen();
    expect(mockPublicacoes).toHaveLength(publicacoesAntes);
  }, 90_000);

  test('1 org: "Criar organização" leva ao fluxo de criação e abre exatamente a nova', async () => {
    semearDocumentoPronta(
      orgSetup.projectId,
      orgSetup.alertasProjectId,
      orgSetup.orgId,
      orgSetup.orgName,
    );
    await bloquearPapel(orgSetup.projectId);
    await orgSetup.renderNavigation();
    await abrirRecoveryAteOTitulo();

    // RED: the exit button does not exist in the current code.
    await fireEvent.press(
      screen.getByTestId('ORG.provisioning-create-organization-btn'),
    );
    await waitFor(
      () =>
        expect(rotas()).toEqual([
          'OrganizationProvisioning',
          'CreateOrganization',
        ]),
      {timeout: 15_000},
    );
    await fireEvent.press(
      await screen.findByTestId(
        'ORG.create-intro-continue-btn',
        {},
        {
          timeout: 15_000,
        },
      ),
    );
    await fireEvent.changeText(
      screen.getByTestId('ORG.create-name-inp'),
      C_NOME,
    );
    await fireEvent.press(screen.getByTestId('ORG.create-btn'));

    // The document takes over the journey: C's provisioning surface owns the
    // preparation (the handover replace leaves provisioning twice on the
    // stack — R1's shape), then its confirmation.
    expect(
      await screen.findAllByText('Organization created', {}, {timeout: 30_000}),
    ).not.toHaveLength(0);
    await fireEvent.press(
      (
        await screen.findAllByTestId(
          'ORG.provisioning-open-organization-btn',
          {},
          {timeout: 15_000},
        )
      ).at(-1)!,
    );
    expect(
      await screen.findByTestId('MAIN.map-screen', {}, {timeout: 30_000}),
    ).toBeOnTheScreen();
    await waitFor(() => expect(rotas()).toEqual(['Home']), {timeout: 15_000});
    expect(
      await screen.findByTestId('HOME.header-title', {}, {timeout: 15_000}),
    ).toHaveTextContent(C_NOME);

    // (M4) The raw document: exactly C selected, A preserved BY ID.
    const cru = documentoPersistido();
    expect(cru.organizacoes).toHaveLength(2);
    const c = cru.organizacoes.find(org => org.id !== orgSetup.orgId);
    expect(c).toMatchObject({
      nome: C_NOME,
      estado: 'pronta',
      confirmacaoPendente: false,
    });
    expect(cru.ativa).toEqual({organizacaoId: c!.id, area: 'monitoramento'});
    const a = cru.organizacoes.find(org => org.id === orgSetup.orgId);
    expect(a).toMatchObject({
      id: orgSetup.orgId,
      estado: 'pronta',
      confirmacaoPendente: false,
    });
    expect(a!.materializacao.monitoramento.projectId).toBe(orgSetup.projectId);
    expect(a!.materializacao.alertas.projectId).toBe(orgSetup.alertasProjectId);
    expect(motor().instance.getState()).toMatchObject({
      status: 'ready',
      generation: 1,
      projectId: c!.materializacao.monitoramento.projectId,
    });
    expect(await orgSetup.client.listProjects()).toHaveLength(4);
  }, 120_000);

  test('A bloqueada + B pronta: "Trocar" abre o seletor com A "Atual"; fechar volta; B abre Home/Map', async () => {
    const b = await criarParDeProjetos(B_ID, B_NOME);
    semear(
      documento(
        [
          organizacaoAtivaA(),
          organizacaoPronta(B_ID, B_NOME, b.monitoramento, b.alertas),
        ],
        {organizacaoId: orgSetup.orgId, area: 'monitoramento'},
      ),
    );
    await bloquearPapel(orgSetup.projectId);
    await orgSetup.renderNavigation();
    await abrirRecoveryAteOTitulo();

    // RED: the exit button does not exist in the current code.
    await fireEvent.press(
      screen.getByTestId('ORG.provisioning-switch-organization-btn'),
    );
    await waitFor(
      () =>
        expect(rotas()).toEqual(['OrganizationProvisioning', 'Organizations']),
      {timeout: 15_000},
    );
    expect(
      await screen.findByTestId('ORGANIZATIONS.list', {}, {timeout: 15_000}),
    ).toBeOnTheScreen();
    // (M3) A carries the Current mark — badge and selected state — alone.
    const linhaA = screen.getByTestId(`ORGANIZATIONS.row-${orgSetup.orgId}`);
    expect(within(linhaA).getByText('Current')).toBeOnTheScreen();
    expect(linhaA.props.accessibilityState).toMatchObject({selected: true});
    const linhaB = screen.getByTestId(`ORGANIZATIONS.row-${B_ID}`);
    expect(within(linhaB).queryByText('Current')).not.toBeOnTheScreen();

    // (T2) Touching the current row only closes the selector: back to the
    // recovery, nothing activated.
    const publicacoesAntes = mockPublicacoes.length;
    await fireEvent.press(linhaA);
    await waitFor(() => expect(rotas()).toEqual(['OrganizationProvisioning']), {
      timeout: 15_000,
    });
    expect(mockPublicacoes).toHaveLength(publicacoesAntes);

    // Closing by Back lands in the same place — pure navigation, the engine
    // publishes nothing on the way back.
    await fireEvent.press(
      await screen.findByTestId(
        'ORG.provisioning-switch-organization-btn',
        {},
        {timeout: 15_000},
      ),
    );
    await waitFor(
      () =>
        expect(rotas()).toEqual(['OrganizationProvisioning', 'Organizations']),
      {timeout: 15_000},
    );
    const publicacoesAntesVoltar = mockPublicacoes.length;
    await act(async () => {
      mockNavigation.goBack();
    });
    await waitFor(() => expect(rotas()).toEqual(['OrganizationProvisioning']), {
      timeout: 15_000,
    });
    expect(mockPublicacoes).toHaveLength(publicacoesAntesVoltar);

    // Tapping B's row switches for real: Home/Map of B, `ativa` = B.
    await fireEvent.press(
      await screen.findByTestId(
        'ORG.provisioning-switch-organization-btn',
        {},
        {timeout: 15_000},
      ),
    );
    await waitFor(
      () =>
        expect(rotas()).toEqual(['OrganizationProvisioning', 'Organizations']),
      {timeout: 15_000},
    );
    await fireEvent.press(screen.getByTestId(`ORGANIZATIONS.row-${B_ID}`));
    await waitFor(
      () => expect(motor().instance.getState().status).toBe('ready'),
      {timeout: 30_000},
    );
    expect(motor().instance.getState()).toMatchObject({
      generation: 1,
      projectId: b.monitoramento,
    });
    expect(
      await screen.findByTestId('MAIN.map-screen', {}, {timeout: 30_000}),
    ).toBeOnTheScreen();
    await waitFor(() => expect(rotas()).toEqual(['Home']), {timeout: 15_000});
    expect(documentoPersistido().ativa).toEqual({
      organizacaoId: B_ID,
      area: 'monitoramento',
    });
    const cru = documentoPersistido();
    expect(
      cru.organizacoes.find(org => org.id === orgSetup.orgId),
    ).toMatchObject({
      estado: 'pronta',
      confirmacaoPendente: false,
      // A is preserved WHOLE: the switch never touches the blocked pair.
      materializacao: {
        monitoramento: {projectId: orgSetup.projectId},
        alertas: {projectId: orgSetup.alertasProjectId},
      },
    });
  }, 120_000);

  test('A bloqueada fora do índice 0: o nome exibido é o de A', async () => {
    const b = await criarParDeProjetos(B_ID, B_NOME);
    semear(
      documento(
        [
          organizacaoPronta(B_ID, B_NOME, b.monitoramento, b.alertas),
          organizacaoAtivaA(),
        ],
        {organizacaoId: orgSetup.orgId, area: 'monitoramento'},
      ),
    );
    await bloquearPapel(orgSetup.projectId);
    await orgSetup.renderNavigation();

    // RED: no name is rendered today. GREEN: exactly A's name (never B's —
    // the naive `organizacoes[0]` fallback would show B here).
    expect(
      await screen.findByTestId(
        'ORG.provisioning-unavailable-name',
        {},
        {timeout: 30_000},
      ),
    ).toHaveTextContent(orgSetup.orgName);
    expect(screen.queryByText(B_NOME)).not.toBeOnTheScreen();
    expect(motor().instance.getState()).toMatchObject({
      status: 'recovery',
      error: 'unavailable',
      generation: 0,
    });
    expect(rotas()).toEqual(['OrganizationProvisioning']);
  }, 90_000);

  test('early access desligado: nome sim, Trocar e Criar não', async () => {
    mockEarlyAccess = false;
    const b = await criarParDeProjetos(B_ID, B_NOME);
    semear(
      documento(
        [
          organizacaoAtivaA(),
          organizacaoPronta(B_ID, B_NOME, b.monitoramento, b.alertas),
        ],
        {organizacaoId: orgSetup.orgId, area: 'monitoramento'},
      ),
    );
    await bloquearPapel(orgSetup.projectId);
    await orgSetup.renderNavigation();

    // RED: no name is rendered today.
    expect(
      await screen.findByTestId(
        'ORG.provisioning-unavailable-name',
        {},
        {timeout: 30_000},
      ),
    ).toHaveTextContent(orgSetup.orgName);
    expect(
      screen.queryByTestId('ORG.provisioning-switch-organization-btn'),
    ).not.toBeOnTheScreen();
    expect(
      screen.queryByTestId('ORG.provisioning-create-organization-btn'),
    ).not.toBeOnTheScreen();
    expect(
      screen.getByTestId('ORG.provisioning-retry-activation-btn'),
    ).toBeEnabled();
  }, 90_000);

  test('o seletor escolhe organização que também falha: volta à recovery de A com as saídas', async () => {
    const b = await criarParDeProjetos(B_ID, B_NOME);
    semear(
      documento(
        [
          organizacaoAtivaA(),
          organizacaoPronta(B_ID, B_NOME, b.monitoramento, b.alertas),
        ],
        {organizacaoId: orgSetup.orgId, area: 'monitoramento'},
      ),
    );
    await bloquearPapel(orgSetup.projectId);
    await bloquearPapel(b.monitoramento);
    await bloquearPapel(b.alertas);
    await orgSetup.renderNavigation();
    await abrirRecoveryAteOTitulo();

    // RED: the exit button does not exist in the current code.
    await fireEvent.press(
      screen.getByTestId('ORG.provisioning-switch-organization-btn'),
    );
    await waitFor(
      () =>
        expect(rotas()).toEqual(['OrganizationProvisioning', 'Organizations']),
      {timeout: 15_000},
    );
    await fireEvent.press(screen.getByTestId(`ORGANIZATIONS.row-${B_ID}`));

    // B's failure publishes `opening` with generation 0 first: the loader
    // takes the whole navigator down — the selector is gone (D5) — and the
    // remount lands on A's recovery, with the exits offered again (T4).
    await waitFor(() => expect(rotas()).toEqual(['OrganizationProvisioning']), {
      timeout: 30_000,
    });
    expect(motor().instance.getState()).toMatchObject({
      status: 'recovery',
      generation: 0,
    });
    expect(
      await screen.findByTestId(
        'ORG.provisioning-unavailable-name',
        {},
        {timeout: 15_000},
      ),
    ).toHaveTextContent(orgSetup.orgName);
    expect(
      screen.getByTestId('ORG.provisioning-switch-organization-btn'),
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('ORG.provisioning-create-organization-btn'),
    ).toBeOnTheScreen();
    expect(documentoPersistido().ativa).toEqual({
      organizacaoId: orgSetup.orgId,
      area: 'monitoramento',
    });
    expect(screen.queryByTestId('ORGANIZATIONS.list')).not.toBeOnTheScreen();
  }, 120_000);

  test('#88: B interrompida é dona da superfície durante a retomada, sem Trocar/Criar; a confirmação de B abre Home', async () => {
    const bPreparando: OrganizacaoLocal = {
      id: B_ID,
      nome: B_NOME,
      estado: 'preparando',
      confirmacaoPendente: false,
      materializacao: {
        monitoramento: etapaAusente('monitoramento'),
        alertas: etapaAusente('alertas'),
      },
      areaEmExecucao: null,
      ultimoErro: null,
    };
    semear(
      documento([organizacaoAtivaA(), bPreparando], {
        organizacaoId: orgSetup.orgId,
        area: 'monitoramento',
      }),
    );
    await bloquearPapel(orgSetup.projectId);
    // (T6) Hold the resume's `prepare` so the REAL intermediate state is
    // observable: the barrier catches only B's resume (A is settled — its
    // boot never prepares anything).
    let liberarBarreira!: () => void;
    const liberada = new Promise<void>(resolve => {
      liberarBarreira = resolve;
    });
    mockBarreiraPrepare = {entrou: jest.fn(), liberada};
    await orgSetup.renderNavigation();

    // The resume is genuinely held inside `resume`'s prepare call.
    await waitFor(
      () => expect(mockBarreiraPrepare?.entrou).toHaveBeenCalled(),
      {timeout: 30_000},
    );
    // Guard (green in both states): B owns the surface while it prepares.
    expect(
      documentoPersistido().organizacoes.find(org => org.id === B_ID)?.estado,
    ).toBe('preparando');
    expect(
      screen.queryByText('Could not open your organization'),
    ).not.toBeOnTheScreen();
    expect(
      screen.queryByTestId('ORG.provisioning-unavailable-name'),
    ).not.toBeOnTheScreen();
    expect(
      screen.queryByTestId('ORG.provisioning-switch-organization-btn'),
    ).not.toBeOnTheScreen();
    expect(
      screen.queryByTestId('ORG.provisioning-create-organization-btn'),
    ).not.toBeOnTheScreen();
    expect(motor().instance.getState()).toMatchObject({status: 'recovery'});

    // Release: B materializes for real up to its pending confirmation, and
    // the exits still do not exist (the surface is B's confirmation, not an
    // unavailable one).
    await act(async () => {
      liberarBarreira();
    });
    await waitFor(
      () => {
        const segunda = documentoPersistido().organizacoes.find(
          org => org.id === B_ID,
        );
        expect(segunda?.estado).toBe('pronta');
        expect(segunda?.confirmacaoPendente).toBe(true);
      },
      {timeout: 60_000},
    );
    expect(
      await screen.findAllByText('Organization created', {}, {timeout: 30_000}),
    ).not.toHaveLength(0);
    expect(
      screen.queryByTestId('ORG.provisioning-switch-organization-btn'),
    ).not.toBeOnTheScreen();
    expect(
      screen.queryByTestId('ORG.provisioning-create-organization-btn'),
    ).not.toBeOnTheScreen();

    // Opening B lands on B's Home/Map.
    await fireEvent.press(
      (
        await screen.findAllByTestId(
          'ORG.provisioning-open-organization-btn',
          {},
          {timeout: 15_000},
        )
      ).at(-1)!,
    );
    expect(
      await screen.findByTestId('MAIN.map-screen', {}, {timeout: 30_000}),
    ).toBeOnTheScreen();
    expect(
      await screen.findByTestId('HOME.header-title', {}, {timeout: 15_000}),
    ).toHaveTextContent(B_NOME);
    expect(documentoPersistido().ativa).toEqual({
      organizacaoId: B_ID,
      area: 'monitoramento',
    });
  }, 120_000);

  test('pendência de A: Trocar → B é recusado com a string canônica e as saídas permanecem', async () => {
    const b = await criarParDeProjetos(B_ID, B_NOME);
    semear(
      documento(
        [
          organizacaoAtivaA(),
          organizacaoPronta(B_ID, B_NOME, b.monitoramento, b.alertas),
        ],
        {organizacaoId: orgSetup.orgId, area: 'monitoramento'},
      ),
    );
    // A's pending track is seeded BEFORE the render: the track store is
    // created by the providers wrapper at render time (segundaOrganizacao's
    // pattern) — and removed again by this suite's beforeEach/afterEach.
    MMKVStoreInitializer.setItem(
      'MapeoTrack',
      JSON.stringify({
        state: {description: 'trilha pendente', projectId: orgSetup.projectId},
        version: 2,
      }),
    );
    await bloquearPapel(orgSetup.projectId);
    await orgSetup.renderNavigation();
    await abrirRecoveryAteOTitulo();

    // RED: the exit button does not exist in the current code.
    await fireEvent.press(
      screen.getByTestId('ORG.provisioning-switch-organization-btn'),
    );
    await waitFor(
      () =>
        expect(rotas()).toEqual(['OrganizationProvisioning', 'Organizations']),
      {timeout: 15_000},
    );
    await fireEvent.press(screen.getByTestId(`ORGANIZATIONS.row-${B_ID}`));

    // The pending-work refusal happens BEFORE `opening` (activation.ts's
    // guard): the selector stays and explains with the canonical §4.4
    // string; the engine keeps recovery with the refusal code.
    expect(
      await screen.findByText(
        'Finish or discard the record before switching organization',
        undefined,
        {timeout: 15_000},
      ),
    ).toBeOnTheScreen();
    expect(motor().instance.getState()).toMatchObject({
      status: 'recovery',
      error: 'pending-work',
    });
    expect(documentoPersistido().ativa).toEqual({
      organizacaoId: orgSetup.orgId,
      area: 'monitoramento',
    });

    // Closing the selector: recovery/pending-work still counts as
    // `indisponivel` — the exits are still there.
    await fireEvent.press(
      screen.getByTestId(`ORGANIZATIONS.row-${orgSetup.orgId}`),
    );
    await waitFor(() => expect(rotas()).toEqual(['OrganizationProvisioning']), {
      timeout: 15_000,
    });
    expect(
      screen.getByTestId('ORG.provisioning-switch-organization-btn'),
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('ORG.provisioning-create-organization-btn'),
    ).toBeOnTheScreen();
  }, 120_000);

  test('perda em sessão (access-unavailable, gen>0): Trocar → B (medição)', async () => {
    const b = await criarParDeProjetos(B_ID, B_NOME);
    semear(
      documento(
        [
          organizacaoAtivaA(),
          organizacaoPronta(B_ID, B_NOME, b.monitoramento, b.alertas),
        ],
        {organizacaoId: orgSetup.orgId, area: 'monitoramento'},
      ),
    );
    await orgSetup.renderNavigation();
    expect(
      await screen.findByTestId('MAIN.map-screen', {}, {timeout: 30_000}),
    ).toBeOnTheScreen();

    // In-session loss (remocaoDoProjeto's harness): the device's role in A
    // is rewritten to BLOCKED while A is open and validated.
    await bloquearPapel(orgSetup.projectId);
    // The REAL percurso (review fronteira P2-3): the removal explanation is
    // presented over the surface BEFORE the loss is published — the user
    // closes the sheet, the leave+reset conclude, and only then is the
    // surface navigable again.
    await waitFor(
      () =>
        expect(rotas()).toEqual([
          'OrganizationProvisioning',
          'RemovedFromProjectBottomSheet',
        ]),
      {timeout: 30_000},
    );
    expect(
      await screen.findByText(
        'Could not open your organization',
        {includeHiddenElements: true},
        {timeout: 30_000},
      ),
    ).toBeOnTheScreen();
    const perda = motor().instance.getState();
    const geracaoDaPerda = perda.generation;
    expect(perda).toMatchObject({status: 'recovery'});

    // Close leaves the removed slot (a REAL core leave) and resets to the
    // provisioning surface alone.
    await fireEvent.press(screen.getByText('Close'));
    await waitFor(() => expect(rotas()).toEqual(['OrganizationProvisioning']), {
      timeout: 30_000,
    });

    // The sheet is gone: the exit is plainly pressable — no hidden elements.
    await fireEvent.press(
      await screen.findByTestId(
        'ORG.provisioning-switch-organization-btn',
        {},
        {timeout: 15_000},
      ),
    );
    await waitFor(() => expect(rotas()).toContain('Organizations'), {
      timeout: 15_000,
    });
    await fireEvent.press(screen.getByTestId(`ORGANIZATIONS.row-${B_ID}`));

    // MEDIÇÃO (N9): the expected outcome is the plain switch — ready on B's
    // Monitoramento with a NEW generation and `ativa` = B. If the measurement
    // shows {recovery, sync-restart-required} instead ($sync.stop() of the
    // blocked A failing, activation.ts's `stopped` path), THIS assertion is
    // replaced by exactly that observation, with `ativa` = A, and the
    // follow-up is recorded in the memo — not fixed here.
    await waitFor(
      () => {
        const estado = motor().instance.getState();
        expect(estado.status).toBe('ready');
        expect(estado.generation).toBe(geracaoDaPerda + 1);
      },
      {timeout: 30_000},
    );
    expect(motor().instance.getState()).toMatchObject({
      status: 'ready',
      error: undefined,
      generation: geracaoDaPerda + 1,
      projectId: b.monitoramento,
    });
    expect(
      await screen.findByTestId('MAIN.map-screen', {}, {timeout: 30_000}),
    ).toBeOnTheScreen();
    expect(documentoPersistido().ativa).toEqual({
      organizacaoId: B_ID,
      area: 'monitoramento',
    });
  }, 120_000);

  test('2+ orgs: Criar presente ao lado de Trocar e funcional até a Home da nova', async () => {
    const b = await criarParDeProjetos(B_ID, B_NOME);
    semear(
      documento(
        [
          organizacaoAtivaA(),
          organizacaoPronta(B_ID, B_NOME, b.monitoramento, b.alertas),
        ],
        {organizacaoId: orgSetup.orgId, area: 'monitoramento'},
      ),
    );
    await bloquearPapel(orgSetup.projectId);
    await orgSetup.renderNavigation();
    await abrirRecoveryAteOTitulo();

    // (M2) With 2+ organizations both exits exist. RED: the create button
    // does not exist in the current code. After the push the provisioning
    // screen sits aria-hidden below CreateOrganization, so the query opts
    // into hidden elements.
    await fireEvent.press(
      screen.getByTestId('ORG.provisioning-create-organization-btn'),
    );
    expect(
      screen.getByTestId('ORG.provisioning-switch-organization-btn', {
        includeHiddenElements: true,
      }),
    ).toBeOnTheScreen();

    await waitFor(
      () =>
        expect(rotas()).toEqual([
          'OrganizationProvisioning',
          'CreateOrganization',
        ]),
      {timeout: 15_000},
    );
    await fireEvent.press(
      await screen.findByTestId(
        'ORG.create-intro-continue-btn',
        {},
        {
          timeout: 15_000,
        },
      ),
    );
    await fireEvent.changeText(
      screen.getByTestId('ORG.create-name-inp'),
      C_NOME,
    );
    await fireEvent.press(screen.getByTestId('ORG.create-btn'));
    expect(
      await screen.findAllByText('Organization created', {}, {timeout: 30_000}),
    ).not.toHaveLength(0);
    await fireEvent.press(
      (
        await screen.findAllByTestId(
          'ORG.provisioning-open-organization-btn',
          {},
          {timeout: 15_000},
        )
      ).at(-1)!,
    );
    expect(
      await screen.findByTestId('MAIN.map-screen', {}, {timeout: 30_000}),
    ).toBeOnTheScreen();
    await waitFor(() => expect(rotas()).toEqual(['Home']), {timeout: 15_000});
    expect(
      await screen.findByTestId('HOME.header-title', {}, {timeout: 15_000}),
    ).toHaveTextContent(C_NOME);

    // (M4) Three organizations: exactly C selected; A and B preserved BY ID.
    const cru = documentoPersistido();
    expect(cru.organizacoes).toHaveLength(3);
    const c = cru.organizacoes.find(
      org => org.id !== orgSetup.orgId && org.id !== B_ID,
    );
    expect(c).toMatchObject({
      nome: C_NOME,
      estado: 'pronta',
      confirmacaoPendente: false,
    });
    expect(cru.ativa).toEqual({organizacaoId: c!.id, area: 'monitoramento'});
    const a = cru.organizacoes.find(org => org.id === orgSetup.orgId);
    expect(a).toMatchObject({
      id: orgSetup.orgId,
      estado: 'pronta',
      confirmacaoPendente: false,
    });
    expect(a!.materializacao.monitoramento.projectId).toBe(orgSetup.projectId);
    expect(a!.materializacao.alertas.projectId).toBe(orgSetup.alertasProjectId);
    const bDoc = cru.organizacoes.find(org => org.id === B_ID);
    expect(bDoc).toMatchObject({
      estado: 'pronta',
      confirmacaoPendente: false,
    });
    expect(bDoc!.materializacao.monitoramento.projectId).toBe(b.monitoramento);
    expect(bDoc!.materializacao.alertas.projectId).toBe(b.alertas);
    expect(motor().instance.getState()).toMatchObject({
      status: 'ready',
      generation: 1,
      projectId: c!.materializacao.monitoramento.projectId,
    });
    expect(await orgSetup.client.listProjects()).toHaveLength(6);
  }, 120_000);

  test('limite R1: C que falha depois de persistir o preparo não tem saída para A', async () => {
    semearDocumentoPronta(
      orgSetup.projectId,
      orgSetup.alertasProjectId,
      orgSetup.orgId,
      orgSetup.orgName,
    );
    await bloquearPapel(orgSetup.projectId);
    // (H1) The post-persistence verify fails: the materializer's catch calls
    // `fail()` and C is recorded as `falha_recuperavel` — the limit's state.
    mockFalharVerify = true;
    await orgSetup.renderNavigation();
    await abrirRecoveryAteOTitulo();

    // RED: the exit button does not exist in the current code.
    await fireEvent.press(
      screen.getByTestId('ORG.provisioning-create-organization-btn'),
    );
    await waitFor(
      () =>
        expect(rotas()).toEqual([
          'OrganizationProvisioning',
          'CreateOrganization',
        ]),
      {timeout: 15_000},
    );
    await fireEvent.press(
      await screen.findByTestId(
        'ORG.create-intro-continue-btn',
        {},
        {
          timeout: 15_000,
        },
      ),
    );
    await fireEvent.changeText(
      screen.getByTestId('ORG.create-name-inp'),
      C_NOME,
    );
    await fireEvent.press(screen.getByTestId('ORG.create-btn'));

    await waitFor(
      () => {
        const cru = documentoPersistido();
        const c = cru.organizacoes.find(org => org.id !== orgSetup.orgId);
        expect(c?.estado).toBe('falha_recuperavel');
      },
      {timeout: 60_000},
    );
    // The limit: C owns the surface — the preparation retry is the ONLY
    // action; no name, no exits, no way back to A.
    expect(
      await screen.findAllByTestId(
        'ORG.provisioning-retry-preparation-btn',
        {},
        {timeout: 30_000},
      ),
    ).not.toHaveLength(0);
    expect(
      screen.queryByTestId('ORG.provisioning-unavailable-name'),
    ).not.toBeOnTheScreen();
    expect(
      screen.queryByTestId('ORG.provisioning-switch-organization-btn'),
    ).not.toBeOnTheScreen();
    expect(
      screen.queryByTestId('ORG.provisioning-create-organization-btn'),
    ).not.toBeOnTheScreen();
    expect(
      screen.queryByTestId('ORG.provisioning-back-to-active-btn'),
    ).not.toBeOnTheScreen();
    expect(motor().instance.getState()).toMatchObject({
      status: 'recovery',
      generation: 0,
    });
    expect(documentoPersistido().ativa).toEqual({
      organizacaoId: orgSetup.orgId,
      area: 'monitoramento',
    });

    // Back in the stack shows C's surface again (same absences) — the
    // document, not the route, decides.
    await act(async () => {
      mockNavigation.goBack();
    });
    await waitFor(() => expect(rotas()).toEqual(['OrganizationProvisioning']), {
      timeout: 15_000,
    });
    expect(
      await screen.findAllByTestId(
        'ORG.provisioning-retry-preparation-btn',
        {},
        {timeout: 15_000},
      ),
    ).not.toHaveLength(0);
    expect(
      screen.queryByTestId('ORG.provisioning-unavailable-name'),
    ).not.toBeOnTheScreen();
    expect(
      screen.queryByTestId('ORG.provisioning-switch-organization-btn'),
    ).not.toBeOnTheScreen();
    expect(
      screen.queryByTestId('ORG.provisioning-create-organization-btn'),
    ).not.toBeOnTheScreen();
  }, 120_000);

  test('limite R2: C na confirmação que falha ao abrir permanece na confirmação', async () => {
    const c = await criarParDeProjetos(C_ID, C_NOME);
    semear(
      documento(
        [
          organizacaoAtivaA(),
          {
            ...organizacaoPronta(C_ID, C_NOME, c.monitoramento, c.alertas),
            confirmacaoPendente: true,
          },
        ],
        {organizacaoId: orgSetup.orgId, area: 'monitoramento'},
      ),
    );
    await bloquearPapel(orgSetup.projectId);
    await bloquearPapel(c.monitoramento);
    await bloquearPapel(c.alertas);
    await orgSetup.renderNavigation();

    // Guard (green in both states): C's confirmation is the authority of the
    // first render already — this is materializar.ts's settled state, not
    // something the new button creates.
    expect(
      await screen.findByText('Organization created', undefined, {
        timeout: 30_000,
      }),
    ).toBeOnTheScreen();

    // The failed open rides the gen-0 loader (aguardandoAbertura) and
    // remounts on C's confirmation — not on A's recovery.
    const publicacoesAntes = mockPublicacoes.length;
    await fireEvent.press(
      screen.getByTestId('ORG.provisioning-open-organization-btn'),
    );
    await waitFor(
      () => {
        const ultimas = mockPublicacoes
          .slice(publicacoesAntes)
          .map(publicacao => publicacao.status);
        expect(ultimas.slice(-2)).toEqual(['opening', 'recovery']);
      },
      {timeout: 30_000},
    );
    expect(motor().instance.getState()).toMatchObject({
      status: 'recovery',
      error: 'unavailable',
      generation: 0,
    });
    expect(
      await screen.findByText('Organization created', undefined, {
        timeout: 30_000,
      }),
    ).toBeOnTheScreen();
    expect(
      documentoPersistido().organizacoes.find(org => org.id === C_ID)
        ?.confirmacaoPendente,
    ).toBe(true);
    expect(
      screen.queryByTestId('ORG.provisioning-switch-organization-btn'),
    ).not.toBeOnTheScreen();
    expect(
      screen.queryByTestId('ORG.provisioning-create-organization-btn'),
    ).not.toBeOnTheScreen();
    expect(
      screen.queryByTestId('ORG.provisioning-unavailable-name'),
    ).not.toBeOnTheScreen();
    expect(
      screen.queryByTestId('ORG.provisioning-back-to-active-btn'),
    ).not.toBeOnTheScreen();
    expect(documentoPersistido().ativa).toEqual({
      organizacaoId: orgSetup.orgId,
      area: 'monitoramento',
    });
  }, 120_000);
});
