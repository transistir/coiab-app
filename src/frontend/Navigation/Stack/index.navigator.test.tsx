import type {NavigationContainerRef} from '@react-navigation/native';
import type {AppStackParamsList} from '../../sharedTypes/navigation';

// The engine's async publications (zustand → navigation resets) must run
// under React's act scheduler; RNTL toggles the flag only around its own
// calls, and this test's transitions arrive in core callbacks outside them.
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

/**
 * The §4.2 document for the pending-confirmation startup (SPEC B §3.3
 * items 2-3): the materialized organization is `pronta` with its pending
 * confirmation, `ativa` stays `null` until the "Abrir organização" tap,
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
  semearDocumentoPronta,
} from '../../../../tests/integration/helpers/setupIntegrationTest';
import {markerFor} from '../../lib/organization/marker';

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

  afterEach(() => {
    // The document is durable by design too: a seeded pending confirmation
    // must not leak from the test that wrote it into the next device state.
    MMKVStoreInitializer.removeItem(COIAB_ORGANIZATIONS_STORAGE_KEY);
  });

  beforeEach(() => {
    // The teardown of a FAILED test cannot be awaited by the next one: an
    // engine operation left mid-flight by a failure is killed when Core's
    // IPC stops, and its rejection path writes the recovered journal
    // (fail()) into MMKV AFTER the afterEach above. The next device state
    // must hydrate empty, so the reset repeats at the start of every test —
    // the write always settles during the afterEach teardown phase (the
    // closed RPC channel rejects before the next test boots Core), and
    // nothing reads the durable key between here and each test's own
    // render/seed.
    MMKVStoreInitializer.removeItem(COIAB_ORGANIZATIONS_STORAGE_KEY);
  });

  test('a delayed project refresh holds the confirmation up without offering creation again', async () => {
    await freshSetup.renderNavigationAsync();
    await fireEvent.press(
      await screen.findByTestId('ONBOARDING.create-org-btn'),
    );
    await fireEvent.press(screen.getByTestId('ORG.create-intro-continue-btn'));
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
      // I/O-bound wait (real project creation, package imports, the
      // invalidated refetch): the CI job's 1000 ms default budget broke
      // this under 3-worker load — the JoinProjectIntro precedent.
      await waitFor(() => expect(refreshWaiting).toBe(true), {
        timeout: 15_000,
      });
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
  }, 20000);

  test('an unmarked project with an active id lands on the Success fork (none-with-projects)', async () => {
    // e.g. a legacy invite accept: a plain project, no Organization.
    const legacyProjectId = await freshSetup.client.createProject({
      name: 'Legacy invite project',
    });
    await freshSetup.renderNavigationAsync({activeProjectId: legacyProjectId});

    expect(await screen.findByText('Wait for an invitation')).toBeOnTheScreen();
    expect(screen.getByText('test is ready!')).toBeOnTheScreen();
  });

  test('um documento vazio com os dois projetos marcados no core abre a bifurcação criar/aguardar (A :131)', async () => {
    // Os dois projetos do orgSetup carregam os marcadores m/a e o core os
    // reconstrói como uma organização pronta — mas o documento persistido é
    // que decide, e ele está vazio: a bifurcação é a única superfície. Os
    // dados marcados ficam preservados (plan Q7), porém não são
    // reconhecidos como organização.
    await orgSetup.renderNavigation();
    expect(await screen.findByText('Wait for an invitation')).toBeOnTheScreen();
    expect(screen.getByText('test is ready!')).toBeOnTheScreen();
    expect(screen.queryByTestId('MAIN.map-screen')).not.toBeOnTheScreen();
  });

  test('a validação de papel atrasada prende o device no loader canônico e depois abre Home, sem flash da bifurcação (SPEC A §6.2 row 1)', async () => {
    semearDocumentoPronta(
      orgSetup.projectId,
      orgSetup.alertasProjectId,
      orgSetup.orgId,
      orgSetup.orgName,
    );
    const alertasApi = await orgSetup.manager.getProject(
      orgSetup.alertasProjectId,
    );
    const getOwnRoleReal = alertasApi.$getOwnRole.bind(alertasApi);
    let releaseValidacao!: () => void;
    const validacaoPresa = new Promise<void>(resolve => {
      releaseValidacao = resolve;
    });
    const spy = jest
      .spyOn(alertasApi, '$getOwnRole')
      .mockImplementation(async () => {
        await validacaoPresa;
        return getOwnRoleReal();
      });
    try {
      await orgSetup.renderNavigation();
      // A janela de carregamento: loader canônico na tela e NENHUMA rota
      // registrada — a bifurcação (Success) nunca chega a montar.
      expect(
        await screen.findByText('Loading organization…'),
      ).toBeOnTheScreen();
      expect(
        screen.queryByText('Wait for an invitation'),
      ).not.toBeOnTheScreen();
      expect(screen.queryByTestId('MAIN.map-screen')).not.toBeOnTheScreen();
      await act(async () => {
        releaseValidacao();
      });
      expect(
        await screen.findByTestId('MAIN.map-screen', {}, {timeout: 10000}),
      ).toBeOnTheScreen();
      expect(
        screen.queryByText('Wait for an invitation'),
      ).not.toBeOnTheScreen();
    } finally {
      releaseValidacao();
      spy.mockRestore();
    }
  }, 20000);

  test('acesso ao Alertas revogado no core real abre a superfície de recuperação e preserva ativa cru (SPEC A §4.2 regra 8)', async () => {
    semearDocumentoPronta(
      orgSetup.projectId,
      orgSetup.alertasProjectId,
      orgSetup.orgId,
      orgSetup.orgName,
    );
    // A revogação no core real: o dispositivo sai do projeto de Alertas. A
    // revalidação da restauração valida AS DUAS áreas e falha em acesso — a
    // publicação é recovery, a Home não opera a organização e o documento
    // cru mantém a seleção intacta.
    await orgSetup.manager.leaveProject(orgSetup.alertasProjectId);
    await orgSetup.renderNavigation();
    // A tela guiada pelo documento monta na superfície de recuperação: as
    // duas linhas de área (o glossário canônico §4.4) são o conteúdo dela.
    expect(
      await screen.findByText('Monitoring', {}, {timeout: 10000}),
    ).toBeOnTheScreen();
    expect(
      mockNavigation.getRootState().routes.map(route => route.name),
    ).toEqual(['OrganizationProvisioning']);
    expect(screen.queryByTestId('MAIN.map-screen')).not.toBeOnTheScreen();
    const raw = documentoPersistido();
    expect(raw.ativa).toEqual({
      organizacaoId: orgSetup.orgId,
      area: 'monitoramento',
    });
  }, 20000);

  test('remoção da área NÃO selecionada em runtime: o motor publica a perda e a área não troca (A CA10)', async () => {
    semearDocumentoPronta(
      orgSetup.projectId,
      orgSetup.alertasProjectId,
      orgSetup.orgId,
      orgSetup.orgName,
    );
    await orgSetup.renderNavigation();
    try {
      globalThis.IS_REACT_ACT_ENVIRONMENT = true;
      await orgSetup.manager.leaveProject(orgSetup.alertasProjectId);
      await waitFor(
        () => {
          expect(
            mockNavigation.getRootState()?.routes.map(route => route.name),
          ).toEqual(['OrganizationProvisioning']);
        },
        {timeout: 15000},
      );
    } catch {
      throw new Error('CA10 did not route to provisioning');
    }
    expect(
      await screen.findByText('Monitoring', {}, {timeout: 15000}),
    ).toBeOnTheScreen();
    expect(
      mockNavigation.getRootState().routes.map(route => route.name),
    ).toEqual(['OrganizationProvisioning']);
    expect(screen.queryByTestId('MAIN.map-screen')).not.toBeOnTheScreen();
    const raw = documentoPersistido();
    expect(raw.ativa).toEqual({
      organizacaoId: orgSetup.orgId,
      area: 'monitoramento',
    });
  }, 30000);

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
      // Mesma espera de I/O do teste 1 (refresh de query atrasada sob
      // carga): o orçamento de 1000 ms do waitFor é insuficiente no CI.
      await waitFor(() => expect(refreshWaiting).toBe(true), {
        timeout: 15_000,
      });

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
  }, 20000);

  test('e2e: criar → confirmação → Abrir organização → Home com o nome da organização (SPEC B §3.3)', async () => {
    await freshSetup.renderNavigationAsync();
    await fireEvent.press(
      await screen.findByTestId('ONBOARDING.create-org-btn'),
    );
    await fireEvent.press(screen.getByTestId('ORG.create-intro-continue-btn'));
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
    // para a Home (SPEC A §4.2 regra 9). Espera de I/O real (materialização
    // no core: dois projetos + imports + conferência): o default de 1000 ms
    // é insuficiente sob carga — precedente JoinProjectIntro.
    expect(
      await screen.findByText('Organization created', undefined, {
        timeout: 15_000,
      }),
    ).toBeOnTheScreen();
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
    await fireEvent.press(screen.getByTestId('ORG.create-intro-continue-btn'));
    await fireEvent.changeText(
      screen.getByTestId('ORG.create-name-inp'),
      'Minha Org',
    );
    await fireEvent.press(screen.getByTestId('ORG.create-btn'));
    // Aguarda a publicação pronta SEM tocar em Abrir organização. Espera de
    // I/O real (materialização no core): o default de 1000 ms é insuficiente
    // sob carga — precedente JoinProjectIntro.
    await screen.findByText('Organization created', undefined, {
      timeout: 15_000,
    });

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

  test('troca de área pelo drawer: reset para Home/Map no projeto de Alertas, documento cru em alertas e Back não reapresenta a Observation (SPEC A §6.1/D12, CA16/CA08)', async () => {
    // Documento semeado: organização PRONTA, confirmação concluída e seleção
    // Monitoramento, com os dois slots ligados aos projetos reais do core.
    const mProjectId = orgSetup.projectId;
    const aProjectId = orgSetup.alertasProjectId;
    semearDocumentoPronta(
      mProjectId,
      aProjectId,
      orgSetup.orgId,
      orgSetup.orgName,
    );

    await orgSetup.renderNavigation();
    expect(await screen.findByTestId('MAIN.map-screen')).toBeOnTheScreen();

    // CA16 no navigator real: o drawer mostra o nome da organização e os dois
    // acessos fixos, com Monitoramento marcado como corrente.
    await fireEvent.press(await screen.findByTestId('HOME.header-button'));
    expect(
      await screen.findByTestId('MENU.area-monitoramento'),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('MENU.area-alertas')).toBeOnTheScreen();
    expect(screen.getByText(orgSetup.orgName)).toBeOnTheScreen();
    expect(
      screen.getByTestId('MENU.area-monitoramento').props.accessibilityState,
    ).toEqual({selected: true});
    expect(
      screen.getByTestId('MENU.area-alertas').props.accessibilityState,
    ).toEqual({selected: false});
    // Dois gates na leitura de PAPEL do projeto de Alertas no core (AGENTS.md:
    // navigator real com refresh de query atrasado). O espião é o `$getOwnRole`
    // da instância REAL do projeto no servidor de IPC: é o que a validação do
    // motor e a refresh de query do remount chamam de fato (o cache do cliente
    // de IPC não toca `manager.getProject` de novo).
    // 1ª leitura pós-montagem = a validação do motor no toque: fica presa
    // ENQUANTO a rota Observation é semeada na pilha — a troca publica com
    // ela na pilha;
    // 2ª leitura pós-montagem = a refresh de query do contexto NOVO (o
    // remount do grupo e do listener após o reset), que atrasa.
    const alertasApi = await orgSetup.manager.getProject(aProjectId);
    const getOwnRoleReal = alertasApi.$getOwnRole.bind(alertasApi);
    let releaseValidation!: () => void;
    const validationGate = new Promise<void>(resolve => {
      releaseValidation = resolve;
    });
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>(resolve => {
      releaseRefresh = resolve;
    });
    let refreshWaiting = false;
    let leiturasAlertas = 0;
    const spy = jest
      .spyOn(alertasApi, '$getOwnRole')
      .mockImplementation(async () => {
        leiturasAlertas += 1;
        if (leiturasAlertas === 1) {
          await validationGate;
        }
        if (leiturasAlertas >= 2) {
          refreshWaiting = true;
          await refreshGate;
        }
        return getOwnRoleReal();
      });
    try {
      // Uma rota Observation na pilha: documento real do projeto de
      // Monitoramento, para a tela suspender sobre dados reais e não no
      // limbo de um id inexistente.
      const projectApi = await orgSetup.client.getProject(mProjectId);
      const observation = await projectApi.observation.create({
        schemaName: 'observation' as const,
        attachments: [],
        tags: {},
        lat: 10,
        lon: 10,
        metadata: {
          manualLocation: false,
          position: {
            mocked: false,
            timestamp: new Date().toISOString(),
            coords: {latitude: 10, longitude: 10},
          },
        },
      });

      // O toque em Alertas inicia a ativação (o motor valida o papel do
      // destino); a validação está presa no gate, então o reset ainda não
      // disparou.
      await fireEvent.press(screen.getByTestId('MENU.area-alertas'));
      expect(
        mockNavigation.getRootState().routes.map(route => route.name),
      ).toEqual(['Home']);

      // O estado de navegação semeado (AGENTS.md): uma Observation entra na
      // pilha enquanto a troca está EM VOO — o estado que o reset da troca
      // precisa reconciliar e podar.
      await act(async () => {
        mockNavigation.navigate('Observation', {
          observationId: observation.docId,
        });
      });
      expect(
        mockNavigation.getRootState().routes.map(route => route.name),
      ).toEqual(['Home', 'Observation']);

      await act(async () => {
        releaseValidation();
      });
      // O reset atravessa chamadas reais de RPC (limpeza da origem): espera
      // o roteador terminar a reconciliação.
      await waitFor(() =>
        expect(
          mockNavigation.getRootState().routes.map(route => route.name),
        ).toEqual(['Home']),
      );
      // O refresh de query do destino atrasa (o remount do grupo consultou o
      // papel do projeto de Alertas de novo e ficou preso no gate): a Home
      // suspende sobre ele — nada da área antiga reaparece. Espera de I/O
      // real: o default de 1000 ms é insuficiente sob carga.
      await waitFor(() => expect(refreshWaiting).toBe(true), {
        timeout: 15_000,
      });
      expect(
        mockNavigation.getRootState().routes.map(route => route.name),
      ).toEqual(['Home']);

      // O documento cru registra a área trocada e dele deriva EXATAMENTE o
      // projeto de Alertas (SPEC A §4.2 regra 5).
      const raw = documentoPersistido();
      expect(raw.ativa).toEqual({
        organizacaoId: orgSetup.orgId,
        area: 'alertas',
      });
      expect(derivarProjectIdAtivo(raw)).toBe(aProjectId);

      // O refresh atrasado resolve e a tela de mapa abre no contexto novo —
      // nada ressuscita a rota podada.
      await act(async () => releaseRefresh());
      await act(async () => {
        await getOwnRoleReal();
      });
      expect(
        await screen.findByTestId('MAIN.map-screen', {}, {timeout: 10000}),
      ).toBeOnTheScreen();
      expect(
        mockNavigation.getRootState().routes.map(route => route.name),
      ).toEqual(['Home']);

      // Back NÃO volta para a Observation (SPEC A §5.2:168).
      await act(async () => {
        mockNavigation.goBack();
      });
      expect(
        mockNavigation.getRootState().routes.map(route => route.name),
      ).toEqual(['Home']);
      expect(screen.getByTestId('MAIN.map-screen')).toBeOnTheScreen();
    } finally {
      releaseValidation();
      releaseRefresh();
      spy.mockRestore();
    }
  }, 30000);
});
