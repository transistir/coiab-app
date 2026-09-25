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
import {act, fireEvent, screen, waitFor} from '@testing-library/react-native';

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
  type OrganizacaoLocal,
} from '../../lib/organization/coiabOrganizations';
import {manifestosEmbarcados} from '../../lib/organization/pacotes';
import {
  setupIntegrationTest,
  semearDocumentoPronta,
} from '../../../../tests/integration/helpers/setupIntegrationTest';

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
 * The §4.2 document for the second-creation journeys: A is fully settled
 * (ready, acknowledged) and operating Monitoramento; the second entry rides
 * in `overrides` — a fresh creation's `preparando` journal or a settled
 * re-delivery target. Every `pronta` area is verified so the §4.2 parser
 * accepts the document (a `pronta` organization needs verified areas, B
 * :255).
 */
function documentoComSegunda(
  monitoramentoId: string,
  alertasId: string,
  organizacaoId: string,
  nome: string,
  segunda: {
    id: string;
    nome: string;
    estado: 'preparando' | 'falha_recuperavel' | 'pronta';
    confirmacaoPendente: boolean;
    monitoramentoId?: string;
    alertasId?: string;
    ultimoErro?: OrganizacaoLocal['ultimoErro'];
  },
): EstadoOrganizacoes {
  const etapaSegunda = (
    projectId: string | undefined,
    area: 'monitoramento' | 'alertas',
  ): OrganizacaoLocal['materializacao']['monitoramento'] => ({
    etapa: projectId ? 'verificado' : 'ausente',
    projectId: projectId ?? null,
    // An absent area carries the package ref the materializer registered it
    // with — a resume re-verifies against it and the §4.2 parser refuses a
    // `verificado` checkpoint without one.
    template: projectId
      ? {versao: '1', hash: area}
      : manifestosEmbarcados[area].ref,
    idsAntesDaCriacao: null,
  });
  const organizacaoA: OrganizacaoLocal = {
    id: organizacaoId,
    nome: 'Test Org',
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
  return {
    versao: 1,
    organizacoes: [
      organizacaoA,
      {
        id: segunda.id,
        nome: segunda.nome,
        estado: segunda.estado,
        confirmacaoPendente: segunda.confirmacaoPendente,
        materializacao: {
          monitoramento: etapaSegunda(segunda.monitoramentoId, 'monitoramento'),
          alertas: etapaSegunda(segunda.alertasId, 'alertas'),
        },
        areaEmExecucao: null,
        ultimoErro: segunda.ultimoErro ?? null,
      },
    ],
    ativa: {organizacaoId: organizacaoId, area: 'monitoramento'},
  };
}

/**
 * CA06/CA07 at navigator level (plano Fase 7): the FULL second-creation
 * journey on the real RootStackNavigator — drawer entry, the two-stage
 * form, the document gaining B, the provisioning surface owning B's
 * confirmation, the open tap activating B, the generation gate resetting
 * to Home/Map with B's header, and the selector switching back to A.
 */
describe('segunda organização (navigator real)', () => {
  const orgSetup = setupIntegrationTest();

  afterEach(() => {
    MMKVStoreInitializer.removeItem(COIAB_ORGANIZATIONS_STORAGE_KEY);
    // A trilha semeada por um teste bloquearia o boot dos seguintes (#88).
    MMKVStoreInitializer.removeItem('MapeoTrack');
  });

  beforeEach(() => {
    // The teardown of a FAILED test cannot be awaited by the next one; the
    // next device state must hydrate empty (same ledger discipline as
    // index.navigator.test.tsx).
    MMKVStoreInitializer.removeItem(COIAB_ORGANIZATIONS_STORAGE_KEY);
    MMKVStoreInitializer.removeItem('MapeoTrack');
  });

  const SEGUNDA_ID = 'fedcba9876543210';
  const SEGUNDA_NOME = 'Organização B';

  async function habilitarEarlyAccessEAbrirDrawer() {
    await act(async () => {
      mockNavigation.navigate('EarlyAccess');
    });
    await fireEvent.press(
      await screen.findByTestId('EA.checkbox-off', {}, {timeout: 15_000}),
    );
    await act(async () => {
      mockNavigation.goBack();
    });
    await fireEvent.press(
      await screen.findByTestId('HOME.header-button', {}, {timeout: 15_000}),
    );
  }

  test('criar a segunda organização do drawer preserva A e abre B pela confirmação (CA06)', async () => {
    semearDocumentoPronta(
      orgSetup.projectId,
      orgSetup.alertasProjectId,
      orgSetup.orgId,
      orgSetup.orgName,
    );
    await orgSetup.renderNavigation();
    expect(
      await screen.findByTestId('MAIN.map-screen', {}, {timeout: 15_000}),
    ).toBeOnTheScreen();

    // Early access + drawer entry → CreateOrganization.
    await habilitarEarlyAccessEAbrirDrawer();
    await fireEvent.press(
      await screen.findByTestId(
        'MENU.criar-organizacao',
        {},
        {timeout: 15_000},
      ),
    );
    await waitFor(
      () =>
        expect(
          mockNavigation.getRootState().routes.map(route => route.name),
        ).toEqual(['Home', 'CreateOrganization']),
      {timeout: 15_000},
    );
    await fireEvent.press(screen.getByTestId('ORG.create-intro-continue-btn'));
    await fireEvent.changeText(
      screen.getByTestId('ORG.create-name-inp'),
      SEGUNDA_NOME,
    );
    await fireEvent.press(screen.getByTestId('ORG.create-btn'));

    // The document took over the journey: the provisioning surface owns
    // B's preparation while the flight keeps running at the root.
    await waitFor(
      () =>
        expect(
          mockNavigation.getRootState().routes.map(route => route.name),
        ).toEqual(['Home', 'OrganizationProvisioning']),
      {timeout: 15_000},
    );
    // B materialized for real: 2/2 verified → pending confirmation, with
    // the confirmation naming B (not A).
    expect(
      await screen.findByText('Organization created', undefined, {
        timeout: 15_000,
      }),
    ).toBeOnTheScreen();
    expect(
      await screen.findByText(
        `${SEGUNDA_NOME} is ready. Monitoring and Alerts are already available.`,
        undefined,
        {timeout: 15_000},
      ),
    ).toBeOnTheScreen();
    // A survived in the persisted document and keeps the active slot.
    const cru = documentoPersistido();
    expect(
      cru.organizacoes.find(org => org.nome === SEGUNDA_NOME)?.estado,
    ).toBe('pronta');
    expect(cru.ativa).toEqual({
      organizacaoId: orgSetup.orgId,
      area: 'monitoramento',
    });

    // The tap is the only way Home opens (SPEC A §4.2 regra 9): the
    // generation gate resets to Home/Map and the header shows B.
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
    ).toHaveTextContent(SEGUNDA_NOME);

    // The selector now exists (length >= 2) and switches back to A.
    await fireEvent.press(
      await screen.findByTestId('HOME.header-button', {}, {timeout: 15_000}),
    );
    await fireEvent.press(
      await screen.findByTestId(
        'MENU.trocar-organizacao',
        {},
        {
          timeout: 15_000,
        },
      ),
    );
    await waitFor(
      () =>
        expect(
          mockNavigation.getRootState().routes.map(route => route.name),
        ).toEqual(['Home', 'Organizations']),
      {timeout: 15_000},
    );
    expect(
      await screen.findByTestId('ORGANIZATIONS.list', {}, {timeout: 15_000}),
    ).toBeOnTheScreen();
    expect(screen.getByText('Test Org')).toBeOnTheScreen();
    expect(screen.getByText(SEGUNDA_NOME)).toBeOnTheScreen();

    // Tapping A's row switches back to A: Home in A's context.
    await fireEvent.press(
      screen.getByTestId(`ORGANIZATIONS.row-${orgSetup.orgId}`),
    );
    await waitFor(
      () =>
        expect(
          mockNavigation.getRootState().routes.map(route => route.name),
        ).toEqual(['Home']),
      {timeout: 15_000},
    );
    expect(
      await screen.findByTestId('MAIN.map-screen', {}, {timeout: 15_000}),
    ).toBeOnTheScreen();
    expect(
      await screen.findByTestId('HOME.header-title', {}, {timeout: 15_000}),
    ).toHaveTextContent(orgSetup.orgName);
    expect(documentoPersistido().ativa).toEqual({
      organizacaoId: orgSetup.orgId,
      area: 'monitoramento',
    });
    expect(derivarProjectIdAtivo(documentoPersistido())).toBe(
      orgSetup.projectId,
    );
    // CA4: exactly four projects — A's pair and B's pair, no third org.
    expect(await orgSetup.client.listProjects()).toHaveLength(4);
  }, 60_000);

  test('cold start com A ativa e B preparando retoma B sem derrubar A, e a superfície de B tem saída (P1)', async () => {
    // The process died while B was being created: A is settled and
    // operating, B rides in the document as `preparando` (both areas absent
    // — the materializer's fresh registration shape) and no operation is
    // alive for it any more.
    const documento = documentoComSegunda(
      orgSetup.projectId,
      orgSetup.alertasProjectId,
      orgSetup.orgId,
      orgSetup.orgName,
      {
        id: SEGUNDA_ID,
        nome: SEGUNDA_NOME,
        estado: 'preparando',
        confirmacaoPendente: false,
      },
    );
    MMKVStoreInitializer.setItem(
      COIAB_ORGANIZATIONS_STORAGE_KEY,
      JSON.stringify({state: documento, version: 1}),
    );
    await orgSetup.renderNavigation();

    // The boot resumes B even though A is the selection: B's journal is
    // materialized for real up to its pending confirmation, and A keeps the
    // active slot the whole time.
    await waitFor(
      () => {
        const segunda = documentoPersistido().organizacoes.find(
          org => org.id === SEGUNDA_ID,
        );
        expect(segunda?.estado).toBe('pronta');
        expect(segunda?.confirmacaoPendente).toBe(true);
      },
      {timeout: 30_000},
    );
    expect(documentoPersistido().ativa).toEqual({
      organizacaoId: orgSetup.orgId,
      area: 'monitoramento',
    });
    // A's session was never taken down by B's preparation: the engine
    // stayed open on A, so Home operates A.
    expect(
      await screen.findByTestId('MAIN.map-screen', {}, {timeout: 15_000}),
    ).toBeOnTheScreen();
    expect(
      await screen.findByTestId('HOME.header-title', {}, {timeout: 15_000}),
    ).toHaveTextContent(orgSetup.orgName);
    // B's pending confirmation is announced on A's Home.
    expect(screen.getByTestId('HOME.org-repair-btn')).toBeOnTheScreen();

    // The :257 guard still hands the creation route over to B's surface,
    // which now shows B's confirmation — never a buttonless spinner.
    await act(async () => {
      mockNavigation.navigate('CreateOrganization');
    });
    await waitFor(
      () => {
        const state = mockNavigation.getRootState();
        expect(state.routes[state.index]?.name).toBe(
          'OrganizationProvisioning',
        );
        expect(
          state.routes.some(route => route.name === 'CreateOrganization'),
        ).toBe(false);
      },
      {timeout: 15_000},
    );
    expect(
      await screen.findByText(
        `${SEGUNDA_NOME} is ready. Monitoring and Alerts are already available.`,
        undefined,
        {timeout: 15_000},
      ),
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('ORG.provisioning-open-organization-btn'),
    ).toBeOnTheScreen();
    expect(
      screen.queryByText('Preparing your organization…'),
    ).not.toBeOnTheScreen();

    // The way back to the operating organization: the surface returns to
    // A's Home without opening B.
    await fireEvent.press(
      screen.getByTestId('ORG.provisioning-back-to-active-btn'),
    );
    await waitFor(
      () =>
        expect(
          mockNavigation.getRootState().routes.map(route => route.name),
        ).toEqual(['Home']),
      {timeout: 15_000},
    );
    expect(
      await screen.findByTestId('HOME.header-title', {}, {timeout: 15_000}),
    ).toHaveTextContent(orgSetup.orgName);
    // No second creation happened and A is untouched.
    const cru = documentoPersistido();
    expect(cru.organizacoes).toHaveLength(2);
    expect(cru.ativa).toEqual({
      organizacaoId: orgSetup.orgId,
      area: 'monitoramento',
    });
    expect(await orgSetup.client.listProjects()).toHaveLength(4);
  }, 60_000);

  test('com B em falha_recuperavel, entrar em CreateOrganization substitui por OrganizationProvisioning (guarda :257)', async () => {
    // B's creation stopped recoverably: the document still carries it as
    // organization work alive (`organizacaoEmPreparo`), so the form must
    // hand over to the provisioning surface, which offers the retry.
    const documento = documentoComSegunda(
      orgSetup.projectId,
      orgSetup.alertasProjectId,
      orgSetup.orgId,
      orgSetup.orgName,
      {
        id: SEGUNDA_ID,
        nome: SEGUNDA_NOME,
        estado: 'falha_recuperavel',
        confirmacaoPendente: false,
        ultimoErro: {
          codigo: 'categories-not-synced',
          area: 'monitoramento',
          ocorridoEm: '2026-09-22T00:00:00.000Z',
        },
      },
    );
    MMKVStoreInitializer.setItem(
      COIAB_ORGANIZATIONS_STORAGE_KEY,
      JSON.stringify({state: documento, version: 1}),
    );
    await orgSetup.renderNavigation();
    // A is the operable selection, so the cold start opens A (review
    // fronteira P1: an un-settled second organization no longer races A's
    // activation for the landing screen); B's failure is announced there by
    // the repair banner.
    expect(
      await screen.findByTestId('HOME.header-title', {}, {timeout: 15_000}),
    ).toHaveTextContent(orgSetup.orgName);
    expect(
      await screen.findByTestId('HOME.org-repair-btn', {}, {timeout: 15_000}),
    ).toBeOnTheScreen();

    await act(async () => {
      mockNavigation.navigate('CreateOrganization');
    });
    await waitFor(
      () => {
        const state = mockNavigation.getRootState();
        expect(state.routes[state.index]?.name).toBe(
          'OrganizationProvisioning',
        );
        expect(
          state.routes.some(route => route.name === 'CreateOrganization'),
        ).toBe(false);
      },
      {timeout: 15_000},
    );
    expect(
      await screen.findByTestId('ORG.provisioning-retry-preparation-btn'),
    ).toBeOnTheScreen();
    expect(
      screen.queryByTestId('ORG.create-name-inp', {
        includeHiddenElements: true,
      }),
    ).not.toBeOnTheScreen();
    // No second creation: B stays the recoverable entry, A keeps operating.
    const cru = documentoPersistido();
    expect(cru.organizacoes).toHaveLength(2);
    expect(cru.organizacoes.find(org => org.id === SEGUNDA_ID)?.estado).toBe(
      'falha_recuperavel',
    );
    expect(cru.ativa).toEqual({
      organizacaoId: orgSetup.orgId,
      area: 'monitoramento',
    });
  }, 30_000);

  test('boot bloqueado por trilha pendente: recuperar o pendente retoma B sem reinício e o banner leva à confirmação de B (#88)', async () => {
    // O processo morreu com uma trilha de A em Monitoramento pendente E a
    // segunda organização em `preparando`: a seleção persistida é
    // A/alertas, o boot bloqueia (FIX-B) e segura TODO o trabalho de início
    // — a retomada de B inclusa — até a recuperação reabrir a origem.
    const documento = documentoComSegunda(
      orgSetup.projectId,
      orgSetup.alertasProjectId,
      orgSetup.orgId,
      orgSetup.orgName,
      {
        id: SEGUNDA_ID,
        nome: SEGUNDA_NOME,
        estado: 'preparando',
        confirmacaoPendente: false,
      },
    );
    documento.ativa = {organizacaoId: orgSetup.orgId, area: 'alertas'};
    MMKVStoreInitializer.setItem(
      COIAB_ORGANIZATIONS_STORAGE_KEY,
      JSON.stringify({state: documento, version: 1}),
    );
    // A semeadura da trilha vem ANTES do render: a store persistida da
    // trilha é criada pelo wrapper de providers no render (react.tsx:132).
    MMKVStoreInitializer.setItem(
      'MapeoTrack',
      JSON.stringify({
        state: {
          description: 'trilha pendente',
          projectId: orgSetup.projectId,
        },
        version: 2,
      }),
    );

    // Dois gates na leitura de PAPEL do projeto de Monitoramento de A (o
    // padrão de index.navigator.test.tsx): o espião vai na instância REAL
    // no manager, instalada ANTES do render, porque a recuperação dispara
    // na montagem do Provisioning (OrganizationProvisioning.tsx:219-222). A
    // leitura é classificada pela fase do documento CRU — o número de
    // leituras de A-m antes da recuperação não é fixo:
    // - com `ativa.area === 'alertas'` (antes do commit) é a validação 2/2
    //   da recuperação: fica presa no validationGate;
    // - com 'monitoramento' (depois do commit) é o refresh de query do
    //   contexto novo: fica presa no refreshGate.
    const monitoramentoApi = await orgSetup.manager.getProject(
      orgSetup.projectId,
    );
    const getOwnRoleReal = monitoramentoApi.$getOwnRole.bind(monitoramentoApi);
    let validacaoEsperando = false;
    let refreshWaiting = false;
    let releaseValidation!: () => void;
    const validationGate = new Promise<void>(resolve => {
      releaseValidation = resolve;
    });
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>(resolve => {
      releaseRefresh = resolve;
    });
    const spy = jest
      .spyOn(monitoramentoApi, '$getOwnRole')
      .mockImplementation(async () => {
        if (documentoPersistido().ativa?.area === 'alertas') {
          validacaoEsperando = true;
          await validationGate;
        } else {
          refreshWaiting = true;
          await refreshGate;
        }
        return getOwnRoleReal();
      });
    try {
      await orgSetup.renderNavigation();

      // Janela da validação (CA1): o loader na tela prova `opening` na
      // geração 0 — ou seja, a recuperação está em voo (o boot bloqueado
      // não valida papel). B segue intacta e nenhum projeto novo existe.
      expect(
        await screen.findByText('Loading organization…', undefined, {
          timeout: 15_000,
        }),
      ).toBeOnTheScreen();
      await waitFor(() => expect(validacaoEsperando).toBe(true));
      const cru = documentoPersistido();
      expect(cru.ativa).toEqual({
        organizacaoId: orgSetup.orgId,
        area: 'alertas',
      });
      const segunda = cru.organizacoes.find(org => org.id === SEGUNDA_ID);
      expect(segunda).toMatchObject({estado: 'preparando'});
      expect(segunda?.materializacao.monitoramento.etapa).toBe('ausente');
      expect(segunda?.materializacao.alertas.etapa).toBe('ausente');
      expect(await orgSetup.client.listProjects()).toHaveLength(2);

      // Libera a validação: `ativa` crua passa a {A, monitoramento}, o que
      // prova o caminho recoverPendingWork (CA2).
      await act(async () => {
        releaseValidation();
      });
      await waitFor(() =>
        expect(documentoPersistido().ativa).toEqual({
          organizacaoId: orgSetup.orgId,
          area: 'monitoramento',
        }),
      );

      // Janela do refresh (CA2, CA4): com o refresh de A preso, B
      // materializa em segundo plano até a confirmação pendente, a rota
      // corrente segue Home (a Home vem da rota inicial do navigator
      // remontado — sem voltar ao Provisioning) e os checkpoints de B não
      // derrubam o contexto de A.
      await waitFor(() => expect(refreshWaiting).toBe(true));
      await waitFor(
        () => {
          const confirmada = documentoPersistido().organizacoes.find(
            org => org.id === SEGUNDA_ID,
          );
          expect(confirmada?.estado).toBe('pronta');
          expect(confirmada?.confirmacaoPendente).toBe(true);
        },
        {timeout: 30_000},
      );
      const estado = mockNavigation.getRootState();
      expect(estado.routes[estado.index]?.name).toBe('Home');
      expect(documentoPersistido().ativa).toEqual({
        organizacaoId: orgSetup.orgId,
        area: 'monitoramento',
      });

      // Libera o refresh: Home opera A, com o banner de reparo visível.
      await act(async () => {
        releaseRefresh();
      });
      expect(
        await screen.findByTestId('MAIN.map-screen', {}, {timeout: 15_000}),
      ).toBeOnTheScreen();
      expect(
        await screen.findByTestId('HOME.header-title', {}, {timeout: 15_000}),
      ).toHaveTextContent(orgSetup.orgName);
      expect(screen.getByTestId('HOME.org-repair-btn')).toBeOnTheScreen();

      // Banner (M1, CA5): é assim que a superfície de B é alcançada sem
      // reinício — e ela mostra a CONFIRMAÇÃO de B, não o estado
      // interrompido com "Try again".
      await fireEvent.press(screen.getByTestId('HOME.org-repair-btn'));
      await waitFor(
        () => {
          const atual = mockNavigation.getRootState();
          expect(atual.routes[atual.index]?.name).toBe(
            'OrganizationProvisioning',
          );
        },
        {timeout: 15_000},
      );
      expect(
        await screen.findByText(
          `${SEGUNDA_NOME} is ready. Monitoring and Alerts are already available.`,
          undefined,
          {timeout: 15_000},
        ),
      ).toBeOnTheScreen();
      expect(
        screen.getByTestId('ORG.provisioning-open-organization-btn'),
      ).toBeOnTheScreen();
      expect(
        screen.queryByTestId('ORG.provisioning-retry-preparation-btn'),
      ).not.toBeOnTheScreen();

      // Uma só materialização (CA3, CA4): o par de A e o par de B.
      expect(await orgSetup.client.listProjects()).toHaveLength(4);
      expect(
        documentoPersistido().organizacoes.find(org => org.id === SEGUNDA_ID)
          ?.estado,
      ).toBe('pronta');
      expect(documentoPersistido().ativa).toEqual({
        organizacaoId: orgSetup.orgId,
        area: 'monitoramento',
      });
    } finally {
      releaseValidation();
      releaseRefresh();
      spy.mockRestore();
      MMKVStoreInitializer.removeItem('MapeoTrack');
    }
  }, 90_000);
});
