import type {MapeoManager} from '@comapeo/core';
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

// `PRAZO_ARQUIVO_REMOTO_MS` is a production constant (60 s). The navigator
// suite overrides it through the factory the app already instantiates, so
// the "promise never resolves" case can assert the deadline in seconds while
// every other path stays real. The factory owns the override in its closure;
// the test configures it through the mock's own API.
jest.mock('../../lib/organization/arquivoRemoto', () => {
  const actual = jest.requireActual<
    typeof import('../../lib/organization/arquivoRemoto')
  >('../../lib/organization/arquivoRemoto');
  const estado: {timeoutMs?: number} = {};
  return {
    ...actual,
    configurarTimeoutDoArquivoRemoto: (timeoutMs?: number) => {
      estado.timeoutMs = timeoutMs;
    },
    createArquivoRemotoExecutor: (
      args: Parameters<typeof actual.createArquivoRemotoExecutor>[0],
    ) =>
      actual.createArquivoRemotoExecutor({
        ...args,
        ...(estado.timeoutMs !== undefined
          ? {timeoutMs: estado.timeoutMs}
          : {}),
      }),
  };
});

import {MMKVStoreInitializer} from '../../hooks/persistedState/createPersistedState';
import {COIAB_ORGANIZATIONS_STORAGE_KEY} from '../../contexts/CoiabOrganizationsStoreContext';
import {
  type ArquivoRemoto,
  type EstadoOrganizacoes,
  type OrganizacaoLocal,
} from '../../lib/organization/coiabOrganizations';
import {manifestosEmbarcados} from '../../lib/organization/pacotes';
import {
  setupIntegrationTest,
  semearDocumentoPronta,
} from '../../../../tests/integration/helpers/setupIntegrationTest';
import {setUpIPC} from '../../../../tests/integration/helpers/core';
import {COMPLETE_USER_PROFILE} from '../../../../tests/integration/helpers/react';
import {MockedAppNavigator} from '../../../../tests/integration/helpers/navigation';

const arquivoRemotoTestApi = jest.requireMock<{
  configurarTimeoutDoArquivoRemoto: (timeoutMs?: number) => void;
}>('../../lib/organization/arquivoRemoto');

const SEGUNDA_ID = 'fedcba9876543210';
const SEGUNDA_NOME = 'Kaxuyana-Tunayana';
const URL_B = 'https://arquivo-b.example/';

/** The RAW persisted document, exactly as the store writes it. */
function documentoPersistido(): EstadoOrganizacoes {
  const cru = MMKVStoreInitializer.getItem(COIAB_ORGANIZATIONS_STORAGE_KEY);
  if (typeof cru !== 'string') throw new Error('documento ausente');
  return JSON.parse(cru).state;
}

function rotas() {
  return mockNavigation.getRootState().routes.map(route => route.name);
}

function areaVerificada(
  projectId: string,
  area: 'monitoramento' | 'alertas',
): OrganizacaoLocal['materializacao']['monitoramento'] {
  return {
    etapa: 'verificado',
    projectId,
    template: {versao: '1', hash: area},
    idsAntesDaCriacao: null,
  };
}

function areaAusente(
  area: 'monitoramento' | 'alertas',
): OrganizacaoLocal['materializacao']['monitoramento'] {
  return {
    etapa: 'ausente',
    projectId: null,
    template: manifestosEmbarcados[area].ref,
    idsAntesDaCriacao: null,
  };
}

function arquivoPendente(url: string): ArquivoRemoto {
  return {
    url,
    estado: 'pendente',
    slots: {m: {estado: 'pendente'}, a: {estado: 'pendente'}},
  };
}

/**
 * A settled, active A plus a second entry in the document: B's interrupted
 * creation journal (`preparando`) — and, for the boot-reconciliation case,
 * an unfinished archive step on A itself.
 */
function documentoComSegunda(
  monitoramentoId: string,
  alertasId: string,
  organizacaoId: string,
  nome: string,
  segunda: {
    id: string;
    nome: string;
    estado: OrganizacaoLocal['estado'];
    confirmacaoPendente: boolean;
    monitoramentoId?: string;
    alertasId?: string;
    arquivoRemoto?: ArquivoRemoto;
  },
  arquivoNaAtiva?: ArquivoRemoto,
): EstadoOrganizacoes {
  return {
    versao: 1,
    organizacoes: [
      {
        id: organizacaoId,
        nome,
        estado: 'pronta',
        confirmacaoPendente: false,
        materializacao: {
          monitoramento: areaVerificada(monitoramentoId, 'monitoramento'),
          alertas: areaVerificada(alertasId, 'alertas'),
        },
        areaEmExecucao: null,
        ultimoErro: null,
        ...(arquivoNaAtiva ? {arquivoRemoto: arquivoNaAtiva} : {}),
      },
      {
        id: segunda.id,
        nome: segunda.nome,
        estado: segunda.estado,
        confirmacaoPendente: segunda.confirmacaoPendente,
        materializacao: {
          monitoramento: segunda.monitoramentoId
            ? areaVerificada(segunda.monitoramentoId, 'monitoramento')
            : areaAusente('monitoramento'),
          alertas: segunda.alertasId
            ? areaVerificada(segunda.alertasId, 'alertas')
            : areaAusente('alertas'),
        },
        areaEmExecucao: null,
        ultimoErro: null,
        ...(segunda.arquivoRemoto
          ? {arquivoRemoto: segunda.arquivoRemoto}
          : {}),
      },
    ],
    ativa: {organizacaoId, area: 'monitoramento'},
  };
}

function semear(documento: EstadoOrganizacoes) {
  MMKVStoreInitializer.setItem(
    COIAB_ORGANIZATIONS_STORAGE_KEY,
    JSON.stringify({state: documento, version: 1}),
  );
}

type ChamadaArquivo = {projectId: string; url: string};

/**
 * Replaces only the network boundary (`$member.addServerPeer`) of every
 * project the manager resolves. Everything else — the journal executor,
 * its durable checkpoints, the repository write and the persisted MMKV
 * document — stays real. Patching on the manager side is what the IPC
 * project channel actually calls (tests/integration/helpers/core.ts).
 */
function espiarArquivoRemoto(
  manager: MapeoManager,
  responder: (chamada: ChamadaArquivo) => Promise<void>,
) {
  const chamadas: ChamadaArquivo[] = [];
  const jaEspiados = new WeakSet<object>();
  const getProjectOriginal = manager.getProject.bind(manager);
  const spy = jest.spyOn(manager, 'getProject').mockImplementation(async id => {
    const projeto = await getProjectOriginal(id);
    if (!jaEspiados.has(projeto)) {
      jaEspiados.add(projeto);
      const membro = projeto.$member as {
        addServerPeer: (url: string) => Promise<void>;
      };
      membro.addServerPeer = async (url: string) => {
        const chamada = {projectId: id, url};
        chamadas.push(chamada);
        await responder(chamada);
      };
    }
    return projeto;
  });
  return {chamadas, spy};
}

/** A network whose pending sends are released explicitly by the test. */
function redeSuspensa() {
  const aguardando: Array<() => void> = [];
  return {
    responder: () =>
      new Promise<void>(resolve => {
        aguardando.push(resolve);
      }),
    liberar() {
      aguardando.splice(0).forEach(resolve => resolve());
    },
    get pendentes() {
      return aguardando.length;
    },
  };
}

describe('arquivo remoto no journal da organização (#142, navigator real)', () => {
  const orgSetup = setupIntegrationTest();

  beforeEach(() => {
    // A failed test's teardown cannot be awaited by the next one: the next
    // device state must hydrate empty (same ledger discipline as the other
    // navigator suites).
    MMKVStoreInitializer.removeItem(COIAB_ORGANIZATIONS_STORAGE_KEY);
    MMKVStoreInitializer.removeItem('MapeoTrack');
    arquivoRemotoTestApi.configurarTimeoutDoArquivoRemoto(undefined);
  });

  afterEach(() => {
    MMKVStoreInitializer.removeItem(COIAB_ORGANIZATIONS_STORAGE_KEY);
    MMKVStoreInitializer.removeItem('MapeoTrack');
    arquivoRemotoTestApi.configurarTimeoutDoArquivoRemoto(undefined);
  });

  test('kick em preparando antes do handover: reabrir retoma B e aplica o arquivo uma vez por slot, só nos ids de B', async () => {
    semearDocumentoPronta(
      orgSetup.projectId,
      orgSetup.alertasProjectId,
      orgSetup.orgId,
      orgSetup.orgName,
    );

    // #142: typing the archive URL gates create on the live `/info`
    // validation. Answer that single probe with a valid archive name; every
    // other request falls through to the real fetch so Core is unaffected.
    const fetchOriginal = global.fetch;
    global.fetch = jest.fn((input: unknown, init?: unknown) => {
      const url = typeof input === 'string' ? input : String(input);
      if (url === new URL('/info', URL_B).toString()) {
        return Promise.resolve({
          status: 200,
          json: async () => ({data: {name: 'Arquivo B'}}),
        } as Response);
      }
      return (fetchOriginal as (i: unknown, n?: unknown) => Promise<Response>)(
        input,
        init,
      );
    }) as unknown as typeof global.fetch;

    const rede = espiarArquivoRemoto(orgSetup.manager, async () => {});
    // The FIRST project creation of B never returns: the process "dies"
    // while the materializer is awaiting Core, with B already persisted as
    // `preparando` and its archive URL in the same journal entry.
    const criarOriginal = orgSetup.manager.createProject.bind(orgSetup.manager);
    let suspenderProximaCriacao = true;
    let encerrarOperacaoAntiga: ((error: Error) => void) | undefined;
    const criarSpy = jest
      .spyOn(orgSetup.manager, 'createProject')
      .mockImplementation(options => {
        if (suspenderProximaCriacao) {
          suspenderProximaCriacao = false;
          return new Promise<never>((_, reject) => {
            encerrarOperacaoAntiga = reject;
          });
        }
        return criarOriginal(options);
      });

    let desmontar = await orgSetup.renderNavigation({
      userProfile: {...COMPLETE_USER_PROFILE, coordinationRole: 'coordinator'},
    });
    let desmontarSegundo: (() => Promise<void>) | undefined;
    let segundo: ReturnType<typeof setUpIPC> | undefined;

    try {
      expect(
        await screen.findByTestId('ENTRONCAMENTO.scrn', {}, {timeout: 15_000}),
      ).toBeOnTheScreen();

      // Configurações → Criar território → create B with its archive URL.
      await fireEvent.press(
        await screen.findByTestId(
          'tabBarButtonConfiguracoes',
          {},
          {timeout: 15_000},
        ),
      );
      await fireEvent.press(
        await screen.findByTestId(
          'settingsCreateOrganizationButton',
          {},
          {timeout: 15_000},
        ),
      );
      await fireEvent.press(
        await screen.findByTestId(
          'ORG.create-intro-continue-btn',
          {},
          {timeout: 15_000},
        ),
      );
      await fireEvent.press(screen.getByTestId('ORG.create-name-option-4999'));
      await fireEvent.changeText(
        screen.getByTestId('ORG.create-archive-url-inp'),
        URL_B,
      );
      // The 600 ms debounce must elapse and the mocked 200 must land before
      // the button unlocks.
      await waitFor(
        () => expect(screen.getByTestId('ORG.create-btn')).toBeEnabled(),
        {timeout: 15_000},
      );
      await fireEvent.press(screen.getByTestId('ORG.create-btn'));

      // The document already owns B before the handover: B is `preparando`,
      // has no project id yet and carries the normalized archive URL.
      let idB = '';
      await waitFor(
        () => {
          const b = documentoPersistido().organizacoes.find(
            org => org.nome === SEGUNDA_NOME,
          );
          idB = b?.id ?? '';
          expect(b?.estado).toBe('preparando');
          expect(b?.arquivoRemoto).toMatchObject({
            url: URL_B,
            estado: 'pendente',
          });
          expect(b?.materializacao.monitoramento.projectId).toBeNull();
        },
        {timeout: 15_000},
      );
      // No handover happened: the flight is still unresolved, so the form
      // stays put (the provisioning surface only takes over a settled start).
      expect(rotas()).toEqual(['Home', 'AppSettings', 'CreateOrganization']);

      // KILL: the whole tree goes down; the hung Core promise belongs to a
      // process that no longer exists. A real restart starts with empty
      // module-level registries, so the reopened tree gets its own IPC client
      // over the same manager.
      await desmontar();
      desmontar = async () => {};
      segundo = setUpIPC({manager: orgSetup.manager});
      // The dead operation stays suspended forever; the new process must be
      // able to create B's projects.
      suspenderProximaCriacao = false;

      desmontarSegundo = await orgSetup.renderNavigation({
        mapeoApi: segundo.client,
      });

      await waitFor(
        () => {
          const b = documentoPersistido().organizacoes.find(
            org => org.id === idB,
          );
          expect(b?.estado).toBe('pronta');
          expect(b?.confirmacaoPendente).toBe(true);
          expect(b?.arquivoRemoto?.estado).toBe('concluido');
        },
        {timeout: 30_000},
      );

      const bFinal = documentoPersistido().organizacoes.find(
        org => org.id === idB,
      )!;
      const idsB = [
        bFinal.materializacao.monitoramento.projectId,
        bFinal.materializacao.alertas.projectId,
      ];
      expect(idsB[0]).not.toBeNull();
      expect(idsB[1]).not.toBeNull();
      expect(idsB[0]).not.toBe(idsB[1]);

      // Exactly one send per slot, in B's own project ids.
      expect(rede.chamadas).toHaveLength(2);
      expect(new Set(rede.chamadas.map(chamada => chamada.projectId))).toEqual(
        new Set(idsB),
      );
      expect(rede.chamadas.map(chamada => chamada.url)).toEqual([URL_B, URL_B]);
      // A's projects were never a target — the archive follows the journal
      // entry's own ids, never the active organization.
      const idsA = [orgSetup.projectId, orgSetup.alertasProjectId];
      expect(
        rede.chamadas.some(chamada => idsA.includes(chamada.projectId)),
      ).toBe(false);

      // A survived untouched, still the active organization, and the reopen
      // created exactly B's pair (4 projects total, no duplicate).
      const cru = documentoPersistido();
      expect(cru.ativa).toEqual({
        organizacaoId: orgSetup.orgId,
        area: 'monitoramento',
      });
      expect(cru.organizacoes).toHaveLength(2);
      expect(await orgSetup.client.listProjects()).toHaveLength(4);
    } finally {
      await desmontarSegundo?.();
      await desmontar();
      // The dead process never observes the response: release the suspended
      // RPC so the harness can drain, then let the abandoned operation settle
      // against its own (unmounted) store before the first client closes.
      encerrarOperacaoAntiga?.(new Error('process-killed'));
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
      });
      if (segundo) await segundo.stop({drainTimeoutMs: 1_000});
      criarSpy.mockRestore();
      rede.spy.mockRestore();
      global.fetch = fetchOriginal;
    }
  }, 90_000);

  test('isolamento de alvo: B conclui tarde enquanto A está ativa — nenhum envio aos ids de A e ativa continua A', async () => {
    semear(
      documentoComSegunda(
        orgSetup.projectId,
        orgSetup.alertasProjectId,
        orgSetup.orgId,
        orgSetup.orgName,
        {
          id: SEGUNDA_ID,
          nome: SEGUNDA_NOME,
          estado: 'preparando',
          confirmacaoPendente: false,
          arquivoRemoto: arquivoPendente(URL_B),
        },
      ),
    );

    const rede = redeSuspensa();
    const arquivo = espiarArquivoRemoto(orgSetup.manager, rede.responder);

    try {
      await orgSetup.renderNavigation();

      // A opens while B resumes in the background; B reaches the archive
      // step (both local slots verified) and its two sends stay pending.
      expect(
        await screen.findByTestId('ENTRONCAMENTO.scrn', {}, {timeout: 15_000}),
      ).toBeOnTheScreen();
      await waitFor(() => expect(rede.pendentes).toBe(2), {
        timeout: 30_000,
      });

      // The user goes back to A through the real selector while B is still
      // late. A is the current row: selecting it closes the sheet, which is
      // the UI's "return to the operating organization" action.
      await fireEvent.press(
        await screen.findByTestId(
          'tabBarButtonConfiguracoes',
          {},
          {timeout: 15_000},
        ),
      );
      await fireEvent.press(
        await screen.findByTestId(
          'settingsSwitchTerritoryButton',
          {},
          {timeout: 15_000},
        ),
      );
      await waitFor(() =>
        expect(rotas()).toEqual(['Home', 'AppSettings', 'Organizations']),
      );
      await fireEvent.press(
        screen.getByTestId(`ORGANIZATIONS.row-${orgSetup.orgId}`),
      );
      await waitFor(() => expect(rotas()).toEqual(['Home', 'AppSettings']));
      await act(async () => {
        mockNavigation.goBack();
      });
      await waitFor(() => expect(rotas()).toEqual(['Home']));
      expect(documentoPersistido().ativa).toEqual({
        organizacaoId: orgSetup.orgId,
        area: 'monitoramento',
      });

      // B finishes LATE, after the user is back on A.
      rede.liberar();
      await waitFor(
        () => {
          const b = documentoPersistido().organizacoes.find(
            org => org.id === SEGUNDA_ID,
          );
          expect(b?.estado).toBe('pronta');
          expect(b?.confirmacaoPendente).toBe(true);
          expect(b?.arquivoRemoto?.estado).toBe('concluido');
        },
        {timeout: 30_000},
      );

      const bFinal = documentoPersistido().organizacoes.find(
        org => org.id === SEGUNDA_ID,
      )!;
      const idsB = [
        bFinal.materializacao.monitoramento.projectId,
        bFinal.materializacao.alertas.projectId,
      ];
      expect(rede.pendentes).toBe(0);
      expect(arquivo.chamadas).toHaveLength(2);
      expect(
        new Set(arquivo.chamadas.map(chamada => chamada.projectId)),
      ).toEqual(new Set(idsB));
      expect(arquivo.chamadas.map(chamada => chamada.url)).toEqual([
        URL_B,
        URL_B,
      ]);
      const idsA = [orgSetup.projectId, orgSetup.alertasProjectId];
      expect(
        arquivo.chamadas.some(chamada => idsA.includes(chamada.projectId)),
      ).toBe(false);
      // The late completion never moved the selection nor the route.
      expect(documentoPersistido().ativa).toEqual({
        organizacaoId: orgSetup.orgId,
        area: 'monitoramento',
      });
      expect(rotas()).toEqual(['Home']);
    } finally {
      // A failed assertion must not leave the two native sends pending: the
      // harness drains project RPCs at teardown and would report them.
      rede.liberar();
      arquivo.spy.mockRestore();
    }
  }, 90_000);

  test('servidor pendurado: o app abre, remount no prazo não duplica starts e o prazo vira falha_recuperavel sem bloquear a organização', async () => {
    // A is settled and operating; B's creation journal was interrupted with
    // both areas still absent and its archive URL already recorded. The boot
    // resumes B in the background — the archive step of that SAME journal.
    semear(
      documentoComSegunda(
        orgSetup.projectId,
        orgSetup.alertasProjectId,
        orgSetup.orgId,
        orgSetup.orgName,
        {
          id: SEGUNDA_ID,
          nome: SEGUNDA_NOME,
          estado: 'preparando',
          confirmacaoPendente: false,
          arquivoRemoto: arquivoPendente(URL_B),
        },
      ),
    );

    const rede = redeSuspensa();
    const arquivo = espiarArquivoRemoto(orgSetup.manager, rede.responder);
    // Production's 60 s deadline is compressed for the test; every other
    // path (journal write, executor, MMKV) is real.
    arquivoRemotoTestApi.configurarTimeoutDoArquivoRemoto(5_000);
    const desmontar = await orgSetup.renderNavigation();

    try {
      // The app is NOT blocked: A opens while B's archive promise hangs.
      expect(
        await screen.findByTestId('ENTRONCAMENTO.scrn', {}, {timeout: 15_000}),
      ).toBeOnTheScreen();
      await waitFor(() => expect(rede.pendentes).toBe(2), {
        timeout: 30_000,
      });
      const aplicar = documentoPersistido().organizacoes.find(
        org => org.id === SEGUNDA_ID,
      );
      expect(aplicar?.estado).toBe('preparando');
      expect(aplicar?.arquivoRemoto?.estado).toBe('aplicando');

      const chamadasAntesDoRemount = arquivo.chamadas.length;
      expect(chamadasAntesDoRemount).toBe(2);

      // Navigator remount inside the deadline: the providers (and the
      // root-owned executor/repository) stay mounted, so the same native
      // promises are still alive. A remount must JOIN those sends, never
      // start them again.
      await screen.rerender(<MockedAppNavigator key="remount-no-prazo" />);
      expect(
        await screen.findByTestId('ENTRONCAMENTO.scrn', {}, {timeout: 15_000}),
      ).toBeOnTheScreen();
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
      });
      expect(arquivo.chamadas).toHaveLength(chamadasAntesDoRemount);

      // The unanswered promise is bounded: after the deadline both slots
      // become recoverable failures, and the SAME journal then publishes B
      // `pronta` + pending confirmation — the archive failure never blocks
      // the organization's publication.
      await waitFor(
        () => {
          const b = documentoPersistido().organizacoes.find(
            org => org.id === SEGUNDA_ID,
          );
          expect(b?.estado).toBe('pronta');
          expect(b?.confirmacaoPendente).toBe(true);
          expect(b?.arquivoRemoto?.estado).toBe('falha_recuperavel');
          expect(b?.arquivoRemoto?.slots.m).toMatchObject({
            estado: 'falha_recuperavel',
            erro: 'prazo-excedido',
          });
          expect(b?.arquivoRemoto?.slots.a).toMatchObject({
            estado: 'falha_recuperavel',
            erro: 'prazo-excedido',
          });
        },
        {timeout: 20_000},
      );
      // No send was retried by the remount or by the deadline.
      expect(arquivo.chamadas).toHaveLength(chamadasAntesDoRemount);
      // A stays the operating organization throughout.
      expect(documentoPersistido().ativa).toEqual({
        organizacaoId: orgSetup.orgId,
        area: 'monitoramento',
      });

      // B is genuinely OPENABLE despite the archive failure: its
      // provisioning surface shows the confirmation and the open action.
      await act(async () => {
        mockNavigation.navigate('CreateOrganization');
      });
      await waitFor(
        () => {
          const state = mockNavigation.getRootState();
          expect(state.routes[state.index]?.name).toBe(
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
        screen.getByTestId('ORG.provisioning-retry-archive-btn'),
      ).toBeOnTheScreen();
    } finally {
      // Release the two unanswered native sends before the harness drains
      // the project RPCs. The late response only patches its own attempt;
      // every assertion above already ran on the deadline's failed state.
      rede.liberar();
      await act(async () => {
        await Promise.resolve();
      });
      await desmontar();
      arquivo.spy.mockRestore();
      arquivoRemotoTestApi.configurarTimeoutDoArquivoRemoto(undefined);
    }
  }, 90_000);
});
