import * as React from 'react';
import {Text} from 'react-native';
import {
  NavigationContainer,
  createNavigationContainerRef,
} from '@react-navigation/native';
import {
  createNativeStackNavigator,
  NativeStackScreenProps,
} from '@react-navigation/native-stack';
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/react-native';
import {IntlProvider} from 'react-intl';

import {CreateOrganization} from './CreateOrganization';
import {OrganizationProvisioning} from './OrganizationProvisioning';
import {
  useOrganizationMaterializer,
  type OrganizationMaterializerHandle,
} from '../../contexts/OrganizationMaterializerContext';
import {
  CoiabOrganizationsStoreProvider,
  createCoiabOrganizationsStore,
  type CoiabOrganizationsStore,
} from '../../contexts/CoiabOrganizationsStoreContext';
import {useProjetarProjectIdAtivo} from '../../contexts/ActiveProjectIdStoreContext';
import {ErroPacote} from '../../lib/organization/pacotes';
import {OrganizationOperationError} from '../../lib/organization/fanout';
import {createMaterializer} from '../../lib/organization/materializar';
import {repositorioDoStore} from '../../lib/organization/repositorio';
import {
  parseEstadoOrganizacoes,
  type EstadoOrganizacoes,
  type OrganizacaoLocal,
} from '../../lib/organization/coiabOrganizations';
import {CREATOR_ROLE_ID} from '../../sharedTypes';
import type {AppStackParamsList} from '../../sharedTypes/navigation';
import {useAddRemoteArchiveToOrganization} from '../../hooks/organization/useAddRemoteArchiveToOrganization';
import {
  createUserProfileStore,
  UserProfileStoreProvider,
  type UserProfileStore,
} from '../../contexts/UserProfileStoreContext';

// pt-BR copied verbatim from SPEC B :54/:55. The copy is asserted through
// the i18n keys (exact pt-BR text), not the English defaultMessage
// (SPEC B :100-102).
const PT_MESSAGES = {
  '$1screens.OrganizationSetup.createOrganization': 'Criar território',
  '$1screens.OrganizationSetup.createIntroBody':
    'Seu território terá Monitoramento e Alertas, com categorias prontas para usar. Você pode criá-lo sem internet.',
  '$1screens.OrganizationSetup.continueButton': 'Continuar',
  '$1screens.OrganizationSetup.nameLabel': 'Nome do território',
  '$1screens.OrganizationSetup.nameGuidance':
    'Escolha um nome para seu território.',
  '$1screens.OrganizationSetup.nameNotIdentity':
    'Usar o mesmo nome de outro território não conecta os dispositivos. Para participar de um território existente, aguarde um convite.',
  '$1screens.Onboarding.CreateOrganization.archiveUrlLabel':
    'Endereço do arquivo remoto',
  '$1screens.Onboarding.CreateOrganization.archiveUrlInvalid':
    'Informe uma URL HTTPS válida',
  '$1screens.Onboarding.CreateOrganization.creationInProgress':
    'Já existe uma criação de território em andamento.',
};

jest.mock('../../contexts/OrganizationMaterializerContext', () => ({
  useOrganizationMaterializer: jest.fn(),
}));

const useMaterializadorMock = useOrganizationMaterializer as jest.Mock;

jest.mock('../../contexts/ActiveProjectIdStoreContext', () => ({
  useProjetarProjectIdAtivo: jest.fn(),
  useActiveProjectId: () => undefined,
}));

const activation = {
  status: 'preparing' as const,
  preparacaoViva: true,
  activate: jest.fn(async () => true),
  retryPreparation: jest.fn(async () => true),
  recoverPendingWork: jest.fn(async () => false),
};

jest.mock('../../contexts/OrganizationActivationContext', () => {
  const holder = {current: undefined as unknown};
  return {
    __setActivation: (value: unknown) => {
      holder.current = value;
    },
    useOrganizationActivationContext: () => holder.current,
  };
});

const activationMock = jest.requireMock(
  '../../contexts/OrganizationActivationContext',
) as {__setActivation(value: unknown): void};

jest.mock('../../hooks/organization/useAddRemoteArchiveToOrganization', () => ({
  useAddRemoteArchiveToOrganization: jest.fn(),
}));

// The hardware layer the cold-start fallback subscribes to: the entries are
// recorded so a test can press Back the way the OS delivers it.
jest.mock('react-native/Libraries/Utilities/BackHandler', () => {
  const live: Array<{handler: () => boolean}> = [];
  const addEventListener = jest.fn((_event: string, handler: () => boolean) => {
    live.push({handler});
    return {
      remove: jest.fn(() => {
        const index = live.findIndex(item => item.handler === handler);
        if (index >= 0) live.splice(index, 1);
      }),
    };
  });
  return {
    __esModule: true,
    __live: live,
    default: {exitApp: jest.fn(), addEventListener},
  };
});

const backHandlerMock = jest.requireMock(
  'react-native/Libraries/Utilities/BackHandler',
) as {
  __live: Array<{handler: () => boolean}>;
  default: {addEventListener: jest.Mock};
};

const useArchiveMock = useAddRemoteArchiveToOrganization as jest.Mock;

const projetar = jest.fn();
// The screen chains `.catch/.finally` on the returned promise, so the
// default mock must resolve like the real `iniciar` does.
const iniciar = jest.fn(async () => {});
const archiveStart = jest.fn(async () => ({error: undefined}));

function mockMaterializador(
  overrides?: Partial<OrganizationMaterializerHandle>,
) {
  useMaterializadorMock.mockReturnValue({
    iniciar,
    retomar: jest.fn(),
    ...overrides,
  });
}

// A parseable §4.2 document holding ONE organization in the state the
// materializer persists right after `iniciar` registers it (SPEC B §5.4
// step 2): `preparando`, both areas absent, no selection.
function documentoComOrganizacao(nome: string): EstadoOrganizacoes {
  return {
    versao: 1,
    organizacoes: [
      {
        id: '0123456789abcdef',
        nome,
        estado: 'preparando',
        confirmacaoPendente: false,
        materializacao: {
          monitoramento: {
            etapa: 'ausente',
            projectId: null,
            template: null,
            idsAntesDaCriacao: null,
          },
          alertas: {
            etapa: 'ausente',
            projectId: null,
            template: null,
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
 * A settled first organization: ready, acknowledged, both areas verified —
 * the §4.2 shape CA12's form-opening scenario operates on.
 */
function organizacaoPronta(nome: string): OrganizacaoLocal {
  return {
    ...documentoComOrganizacao(nome).organizacoes[0]!,
    estado: 'pronta',
    confirmacaoPendente: false,
    materializacao: {
      monitoramento: {
        etapa: 'verificado',
        projectId: 'p-m',
        template: {versao: '1', hash: 'm'},
        idsAntesDaCriacao: null,
      },
      alertas: {
        etapa: 'verificado',
        projectId: 'p-a',
        template: {versao: '1', hash: 'a'},
        idsAntesDaCriacao: null,
      },
    },
  };
}

/** The materializer's observable side effect: the document gains the org. */
const registrar = async (nome: string) => {
  // One tick after the start, like the real materializer: the document
  // settles while the creation hold is already registered, and the
  // handover replace commits after it.
  await Promise.resolve();
  store.instance.setState(documentoComOrganizacao(nome));
};

/** The materializer resolving with BOTH projects already created (#129). */
const registrarComProjetos = async (nome: string) => {
  await Promise.resolve();
  store.instance.setState({
    versao: 1,
    organizacoes: [
      {
        ...documentoComOrganizacao(nome).organizacoes[0]!,
        materializacao: {
          monitoramento: {
            etapa: 'criado',
            projectId: 'p-m',
            template: null,
            idsAntesDaCriacao: null,
          },
          alertas: {
            etapa: 'criado',
            projectId: 'p-a',
            template: null,
            idsAntesDaCriacao: null,
          },
        },
      },
    ],
    ativa: null,
  });
};

// A recoverable archive failure is exercised through the REAL materializer
// below; no mock journals an organization without `arquivoRemoto`.

let store: CoiabOrganizationsStore;
let profileStore: UserProfileStore;

const Stack = createNativeStackNavigator<AppStackParamsList>();
const navigationRef = createNavigationContainerRef<AppStackParamsList>();

const SuccessStub = () => <Text>SUCCESS-STUB</Text>;

const HomeStub = () => <Text>HOME-REACHED</Text>;
const ProvisioningStub = () => <Text>PROVISIONING-REACHED</Text>;
const JoinStub = () => <Text>JOIN-REACHED</Text>;

const ErrorStub = ({
  route,
}: NativeStackScreenProps<AppStackParamsList, 'ErrorBottomSheet'>) => (
  <>
    <Text>ERROR: {route.params.error.message}</Text>
    {/* The sheet's advanced section surfaces `error.code` (A4 pass-through). */}
    <Text>
      CODE: {(route.params.error as Error & {code?: string}).code ?? 'none'}
    </Text>
  </>
);

async function renderTree(
  ProvisioningComponent: React.ComponentType<
    NativeStackScreenProps<AppStackParamsList, 'OrganizationProvisioning'>
  >,
  initialRouteName: 'Success' | 'CreateOrganization',
) {
  await render(
    <IntlProvider locale="pt-BR" messages={PT_MESSAGES}>
      <NavigationContainer ref={navigationRef}>
        <CoiabOrganizationsStoreProvider store={store}>
          <UserProfileStoreProvider store={profileStore}>
            <Stack.Navigator initialRouteName={initialRouteName}>
              <Stack.Screen name="Success" component={SuccessStub} />
              <Stack.Screen
                name="CreateOrganization"
                component={CreateOrganization}
                options={{headerShown: false}}
              />
              <Stack.Screen name="Home" component={HomeStub} />
              <Stack.Screen
                name="OrganizationProvisioning"
                component={ProvisioningComponent}
              />
              <Stack.Screen
                name="JoinOrganizationIntro"
                component={JoinStub}
                options={{headerShown: false}}
              />
              <Stack.Screen
                name="ErrorBottomSheet"
                component={ErrorStub}
                options={{headerShown: false}}
              />
            </Stack.Navigator>
          </UserProfileStoreProvider>
        </CoiabOrganizationsStoreProvider>
      </NavigationContainer>
    </IntlProvider>,
  );
}

async function renderScreen(
  ProvisioningComponent: React.ComponentType<
    NativeStackScreenProps<AppStackParamsList, 'OrganizationProvisioning'>
  > = ProvisioningStub,
) {
  await renderTree(ProvisioningComponent, 'Success');
  // The native-stack navigator mounts asynchronously: wait for the initial
  // route to settle before dispatching, or the navigate becomes a no-op
  // ("navigation object hasn't been initialized").
  await screen.findByText('SUCCESS-STUB');
  await act(async () => {
    navigationRef.navigate('CreateOrganization');
  });
}

async function renderColdStartScreen() {
  await renderTree(ProvisioningStub, 'CreateOrganization');
  await screen.findByTestId('ORG.create-intro-continue-btn');
}

/** Delivers a hardware Back the way React Native walks the subscriptions. */
function pressHardwareBack() {
  for (const {handler} of [...backHandlerMock.__live].reverse()) {
    if (handler()) return true;
  }
  return false;
}

// The SPEC B §3.1 journey: Continuar on the intro leads to the name step.
async function irParaEtapaNome() {
  await fireEvent.press(screen.getByTestId('ORG.create-intro-continue-btn'));
  expect(screen.getByTestId('ORG.create-name-select')).toBeOnTheScreen();
}

// #129: the name is chosen from the predefined catalog (one entry today).
async function selecionarTerritorio() {
  await fireEvent.press(screen.getByTestId('ORG.create-name-option-4999'));
}

async function preencherUrl(url = 'https://exemplo.org/') {
  await fireEvent.changeText(
    screen.getByTestId('ORG.create-archive-url-inp'),
    url,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  backHandlerMock.__live.length = 0;
  store = createCoiabOrganizationsStore();
  profileStore = createUserProfileStore();
  activationMock.__setActivation(activation);
  (useProjetarProjectIdAtivo as jest.Mock).mockReturnValue(projetar);
  mockMaterializador();
  useArchiveMock.mockReturnValue({
    start: archiveStart,
    busy: false,
    progress: {monitoramento: 'idle', alertas: 'idle'},
    reset: jest.fn(),
  });
});

describe('CreateOrganization', () => {
  test('the intro step renders the SPEC B :54 copy and leads to the name step', async () => {
    await renderScreen();

    expect(screen.getByText('Criar território')).toBeOnTheScreen();
    expect(
      screen.getByText(
        'Seu território terá Monitoramento e Alertas, com categorias prontas para usar. Você pode criá-lo sem internet.',
      ),
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('ORG.create-intro-continue-btn'),
    ).toBeOnTheScreen();
    expect(
      screen.queryByTestId('ORG.create-name-select'),
    ).not.toBeOnTheScreen();

    await irParaEtapaNome();

    expect(
      screen.getByText('Escolha um nome para seu território.'),
    ).toBeOnTheScreen();
    expect(
      screen.getByText(
        'Usar o mesmo nome de outro território não conecta os dispositivos. Para participar de um território existente, aguarde um convite.',
      ),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('ORG.create-name-select')).toBeOnTheScreen();
    expect(screen.getByTestId('ORG.create-archive-url-inp')).toBeOnTheScreen();
    expect(screen.getByTestId('ORG.create-btn')).toBeOnTheScreen();
  });

  test('on a cold start with no previous route, hardware Back opens the role question (P1)', async () => {
    // The startup gate makes this the initial route for a coordinator, so
    // the navigator's own Back handler cannot pop anything; the screen's
    // fallback must land on the question (Success) instead of exiting.
    await renderColdStartScreen();

    expect(navigationRef.canGoBack()).toBe(false);

    await act(async () => {
      expect(pressHardwareBack()).toBe(true);
    });

    expect(await screen.findByText('SUCCESS-STUB')).toBeOnTheScreen();
    expect(
      screen.queryByTestId('ORG.create-intro-continue-btn'),
    ).not.toBeOnTheScreen();
  });

  test('a participant never sees the form and is sent to JoinOrganizationIntro (P1-1)', async () => {
    profileStore.actions.setCoordinationRole('participant');
    await renderScreen();

    expect(await screen.findByText('JOIN-REACHED')).toBeOnTheScreen();
    expect(
      screen.queryByTestId('ORG.create-intro-continue-btn'),
    ).not.toBeOnTheScreen();
    expect(
      screen.queryByTestId('ORG.create-name-select'),
    ).not.toBeOnTheScreen();
    expect(iniciar).not.toHaveBeenCalled();
  });

  test('back from the name step returns to the intro with no effects', async () => {
    await renderScreen();

    await irParaEtapaNome();

    navigationRef.goBack();

    expect(
      await screen.findByTestId('ORG.create-intro-continue-btn'),
    ).toBeOnTheScreen();
    expect(
      screen.queryByTestId('ORG.create-name-select'),
    ).not.toBeOnTheScreen();
    expect(iniciar).not.toHaveBeenCalled();
    // "sem efeitos": the document is untouched by the round-trip.
    expect(store.instance.getState().organizacoes).toHaveLength(0);
  });

  test('the create button stays disabled without a name and without a valid URL', async () => {
    await renderScreen();
    await irParaEtapaNome();

    // Nothing selected, empty URL.
    expect(screen.getByTestId('ORG.create-btn')).toBeDisabled();

    // Selecting a territory alone is not enough.
    await selecionarTerritorio();
    expect(screen.getByTestId('ORG.create-btn')).toBeDisabled();

    // A malformed URL keeps the button disabled and explains why.
    await preencherUrl('not a url');
    expect(screen.getByTestId('ORG.create-btn')).toBeDisabled();
    expect(
      screen.getByTestId('ORG.create-archive-url-invalid'),
    ).toHaveTextContent('Informe uma URL HTTPS válida');

    // http:// is rejected by the format-only validation (HTTPS required).
    await preencherUrl('http://exemplo.org');
    expect(screen.getByTestId('ORG.create-btn')).toBeDisabled();
    expect(
      screen.getByTestId('ORG.create-archive-url-invalid'),
    ).toBeOnTheScreen();
  });

  test('the create button is enabled with a selected territory and a valid HTTPS URL', async () => {
    await renderScreen();
    await irParaEtapaNome();

    await selecionarTerritorio();
    await preencherUrl('https://exemplo.org/');

    expect(screen.getByTestId('ORG.create-btn')).toBeEnabled();
    expect(
      screen.queryByTestId('ORG.create-archive-url-invalid'),
    ).not.toBeOnTheScreen();
  });

  test('presses create with the territory name and the normalized archive URL', async () => {
    // SPEC B §3.3/§5.3: between `pronta` and the "Abrir organização" tap the
    // device has NO active selection — `ativa` is born only in that tap's
    // single write, so the form must hand the materializer the selected
    // name and never repoint the legacy active id itself.
    await renderScreen();
    await irParaEtapaNome();

    await selecionarTerritorio();
    await preencherUrl('https://exemplo.org');
    await fireEvent.press(screen.getByTestId('ORG.create-btn'));

    await waitFor(() => {
      expect(iniciar).toHaveBeenCalledWith('Kaxuyana-Tunayana', {
        arquivoRemotoUrl: 'https://exemplo.org/',
      });
    });
    await waitFor(() => {
      expect(projetar).not.toHaveBeenCalled();
    });
  });

  test('iniciar recebe a URL normalizada e não grava intent (#142 fase C1)', async () => {
    const iniciarComProjetos = jest.fn(async (nome: string) => {
      await registrarComProjetos(nome);
    });
    mockMaterializador({iniciar: iniciarComProjetos});
    await renderScreen();
    await irParaEtapaNome();

    await selecionarTerritorio();
    // The normalization adds the trailing slash.
    await preencherUrl('https://exemplo.org');
    await fireEvent.press(screen.getByTestId('ORG.create-btn'));

    expect(await screen.findByText('PROVISIONING-REACHED')).toBeOnTheScreen();
    expect(iniciarComProjetos).toHaveBeenCalledWith('Kaxuyana-Tunayana', {
      arquivoRemotoUrl: 'https://exemplo.org/',
    });
    // The network add belongs to the journal, never to the form — even when
    // both project ids are already published.
    expect(archiveStart).not.toHaveBeenCalled();
    expect(Object.keys(profileStore.instance.getState()).sort()).toStrictEqual([
      'coordinationRole',
      'ethnicity',
      'village',
    ]);
  });

  test('a recoverable failure keeps the archive URL in the journal, not in the profile (#142 fase C1)', async () => {
    // The REAL materializer, over this screen's real store: the journal must
    // carry the URL through the first checkpoint and a later failure, and
    // survive a rehydration — a mock that registers an organization without
    // `arquivoRemoto` proves nothing about persistence.
    const projetos = new Map<string, ReturnType<typeof criarProjetoFake>>();
    function criarProjetoFake() {
      return {
        $member: {
          getById: jest.fn(async () => ({
            name: 'Teste',
            deviceType: 'mobile',
            role: {roleId: CREATOR_ROLE_ID},
          })),
        },
        $importCategories: jest.fn(async () => {}),
        $setProjectSettings: jest.fn(async () => {}),
        $getProjectSettings: jest.fn(async () => ({
          name: 'Monitoramento',
          sendStats: false,
          projectDescription: 'marker',
        })),
      };
    }
    const client = {
      getDeviceInfo: jest.fn(async () => ({
        deviceId: 'device-1',
        name: 'Teste',
        deviceType: 'mobile' as const,
      })),
      setDeviceInfo: jest.fn(async () => {}),
      listProjects: jest.fn(async () => []),
      createProject: jest.fn(async ({name}: {name: string}) => {
        // The SECOND area fails, i.e. AFTER the first checkpoint and after
        // Monitoramento was fully materialized.
        if (name === 'Alertas') throw new Error('alertas-failed');
        return 'projeto-m';
      }),
      getProject: jest.fn(async () => {
        let projeto = projetos.get('projeto-m');
        if (!projeto) {
          projeto = criarProjetoFake();
          projetos.set('projeto-m', projeto);
        }
        return projeto;
      }),
    };
    const templates = {
      prepare: jest.fn(async () => ({
        monitoramento: {
          ref: {versao: '1', hash: 'monitoramento'},
          filePath: '/fake/monitoramento.comapeocat',
        },
        alertas: {
          ref: {versao: '1', hash: 'alertas'},
          filePath: '/fake/alertas.comapeocat',
        },
      })),
      verify: jest.fn(async () => true),
    };
    const materializer = createMaterializer({
      client,
      templates,
      repository: repositorioDoStore(store),
      generateId: () => '0123456789abcdef',
      arquivoRemoto: {addServerPeer: jest.fn(async () => {})},
    });
    const iniciarReal = jest.fn(
      (nome: string, opcoes?: {arquivoRemotoUrl?: string}) =>
        materializer.start(nome, opcoes),
    );
    mockMaterializador({iniciar: iniciarReal});
    await renderScreen(OrganizationProvisioning);
    await irParaEtapaNome();

    await selecionarTerritorio();
    await preencherUrl('https://exemplo.org/');
    await fireEvent.press(screen.getByTestId('ORG.create-btn'));

    expect(
      await screen.findByText('Could not finish creating the territory.'),
    ).toBeOnTheScreen();
    expect(iniciarReal).toHaveBeenCalledWith('Kaxuyana-Tunayana', {
      arquivoRemotoUrl: 'https://exemplo.org/',
    });
    expect(Object.keys(profileStore.instance.getState()).sort()).toStrictEqual([
      'coordinationRole',
      'ethnicity',
      'village',
    ]);
    expect(archiveStart).not.toHaveBeenCalled();

    // Failure after the FIRST checkpoint, with the URL already in the same
    // `preparando` write: the persisted journal keeps it and a rehydration
    // reads it back.
    const persistida = store.instance.getState().organizacoes[0]!;
    expect(client.createProject).toHaveBeenCalledTimes(2);
    expect(persistida.estado).toBe('falha_recuperavel');
    expect(persistida.materializacao.monitoramento.etapa).toBe('verificado');
    expect(persistida.arquivoRemoto).toMatchObject({
      url: 'https://exemplo.org/',
      estado: 'pendente',
    });
    const reidratado = parseEstadoOrganizacoes(store.instance.getState());
    expect(reidratado?.organizacoes[0]?.arquivoRemoto?.url).toBe(
      'https://exemplo.org/',
    );
  });

  test('shows the loading state instead of the button while creating', async () => {
    // `iniciar` runs the whole materialization; until the document shows the
    // organization the form stays loading — and never goes back to idle on
    // its own (the promise keeps running at the root).
    mockMaterializador({
      iniciar: () => new Promise<void>(() => {}),
    });
    await renderScreen();
    await irParaEtapaNome();

    await selecionarTerritorio();
    await preencherUrl('https://exemplo.org/');
    await fireEvent.press(screen.getByTestId('ORG.create-btn'));

    expect(screen.queryByTestId('ORG.create-btn')).not.toBeOnTheScreen();
  });

  test('navigates to OrganizationProvisioning once the document shows the organization', async () => {
    // SPEC B §3.3 item 2/§5.4: the form does not own the post-registration
    // journey — as soon as the persisted document holds the organization
    // (the promise still running at the root), the provisioning surface
    // takes over. Home is never a form-local destination: only the
    // confirmation's "Abrir organização" tap may open it.
    mockMaterializador({iniciar: registrar});
    await renderScreen();
    await irParaEtapaNome();

    await selecionarTerritorio();
    await preencherUrl('https://exemplo.org/');
    await fireEvent.press(screen.getByTestId('ORG.create-btn'));

    expect(await screen.findByText('PROVISIONING-REACHED')).toBeOnTheScreen();
    // A replace, not a push: the form is gone with its draft handed over.
    expect(
      screen.queryByTestId('ORG.create-name-select'),
    ).not.toBeOnTheScreen();
    expect(screen.queryByText('HOME-REACHED')).not.toBeOnTheScreen();
  });

  test('a first creation whose resolved document has no resolvable selection replaces EXACTLY once', async () => {
    mockMaterializador({iniciar: registrar});
    await renderScreen();
    await irParaEtapaNome();

    // Count navigation outcomes at the container: every dispatch emits one
    // `state` event, so a landing on the provisioning surface is one event
    // whose focused route is `OrganizationProvisioning` — and a spurious
    // second replace is a second one.
    const landings: Array<string> = [];
    const unsubscribe = navigationRef.addListener('state', e => {
      const {state} = e.data;
      if (!state) return;
      const last = state.routes[state.routes.length - 1];
      if (last) landings.push(last.name);
    });
    try {
      await selecionarTerritorio();
      await preencherUrl('https://exemplo.org/');
      await fireEvent.press(screen.getByTestId('ORG.create-btn'));

      expect(await screen.findByText('PROVISIONING-REACHED')).toBeOnTheScreen();
      expect(landings).toEqual(['OrganizationProvisioning']);
      expect(
        screen.queryByTestId('ORG.create-name-select'),
      ).not.toBeOnTheScreen();
    } finally {
      unsubscribe();
    }
  });

  // REGRESSION PIN (Fase 5): the handover replace used to fire while the
  // creation hold (`usePreventRemove`) was registered and be re-dispatched
  // off the beforeRemove emission; the deferred commit removed the route
  // while the provider's registration still held it, and
  // PreventRemoveProvider crashed on the mount — "Couldn't find a route
  // with the key CreateOrganization-…". The handover now releases the hold
  // and dispatches from the handover effect, never re-dispatching a
  // prevented removal. The registrar below is SYNCHRONOUS — the document
  // settles inside the press's own commit, so the hold registers and the
  // replace races in ONE flush: the tightest form of the exact window that
  // crashed.
  test('the handover replace lands once when the creation hold releases in the same commit', async () => {
    const registrarSincrono = async (nome: string) => {
      store.instance.setState(documentoComOrganizacao(nome));
    };
    mockMaterializador({iniciar: registrarSincrono});
    await renderScreen();
    await irParaEtapaNome();

    const landings: Array<string> = [];
    const unsubscribe = navigationRef.addListener('state', e => {
      const {state} = e.data;
      if (!state) return;
      const last = state.routes[state.routes.length - 1];
      if (last) landings.push(last.name);
    });
    try {
      await selecionarTerritorio();
      await preencherUrl('https://exemplo.org/');
      await fireEvent.press(screen.getByTestId('ORG.create-btn'));

      expect(await screen.findByText('PROVISIONING-REACHED')).toBeOnTheScreen();
      expect(landings).toEqual(['OrganizationProvisioning']);
      // A replace, not a push: the form is gone with its draft handed over.
      expect(
        screen.queryByTestId('ORG.create-name-select'),
      ).not.toBeOnTheScreen();
    } finally {
      unsubscribe();
    }
  });

  test('a rejection with no document entry opens the error sheet and keeps the draft', async () => {
    // The materializer rejects before anything is persisted (a template
    // package failure, an MMKV write refusal): nothing was created, so the
    // form stays — draft intact — with the error explained.
    mockMaterializador({
      iniciar: async () => {
        throw new Error('boom');
      },
    });
    await renderScreen();
    await irParaEtapaNome();
    await selecionarTerritorio();
    await preencherUrl('https://exemplo.org/');
    await fireEvent.press(screen.getByTestId('ORG.create-btn'));

    expect(await screen.findByText('ERROR: boom')).toBeOnTheScreen();
    // The sheet is a modal over the form, so the form screen reads
    // aria-hidden — the draft's persistence is asserted through the hidden
    // query, exactly the value that was typed.
    expect(
      screen.getByTestId('ORG.create-archive-url-inp', {
        includeHiddenElements: true,
      }),
    ).toHaveProp('value', 'https://exemplo.org/');
    // The failure re-arms the form: the user can correct and retry.
    expect(
      screen.getByTestId('ORG.create-btn', {includeHiddenElements: true}),
    ).toBeOnTheScreen();
  });

  test('a pacote_nao_aprovado rejection reaches the sheet with its machine code and factual copy', async () => {
    // Decisão A/A2+A4: on a delivery binary that skipped the build hook,
    // the runtime gate refuses with zero writes; the sheet receives the
    // machine code (advanced section) and the minimal factual copy — never
    // a "…está salvo" claim (SPEC gap A4).
    mockMaterializador({
      iniciar: async () => {
        throw new ErroPacote(
          'pacote_nao_aprovado',
          'file:///fake-docs/coiab/pacotes/monitoramento.comapeocat',
        );
      },
    });
    await renderScreen();
    await irParaEtapaNome();
    await selecionarTerritorio();
    await preencherUrl('https://exemplo.org/');
    await fireEvent.press(screen.getByTestId('ORG.create-btn'));

    expect(
      await screen.findByText(
        'ERROR: Could not prepare the necessary files on this device. Nothing was created.',
      ),
    ).toBeOnTheScreen();
    expect(
      await screen.findByText('CODE: pacote_nao_aprovado'),
    ).toBeOnTheScreen();
    // The failure re-arms the form.
    expect(
      screen.getByTestId('ORG.create-btn', {includeHiddenElements: true}),
    ).toBeOnTheScreen();
  });

  test('an organization already in the document routes to OrganizationProvisioning instead of starting', async () => {
    // SPEC B §5.5/:240: a persisted organization — here a half-provisioned
    // one whose id survived an interrupted attempt — is never overwritten by
    // a new `iniciar`: the provisioning screen owns its recovery, so the
    // form must hand over before the first press.
    store.instance.setState(documentoComOrganizacao('Território Pendente'));
    await renderScreen();

    expect(await screen.findByText('PROVISIONING-REACHED')).toBeOnTheScreen();
    expect(
      screen.queryByTestId('ORG.create-name-select'),
    ).not.toBeOnTheScreen();
    expect(iniciar).not.toHaveBeenCalled();
  });

  test('a settled document (ready, acknowledged, active) leaves an explicitly opened form alone', async () => {
    // CA12: with a ready organization operating (the §4.2 rule-5 projection
    // resolves), opening the creation form from Home is an explicit act —
    // it must not be bounced to a confirmation the user already consumed,
    // and `iniciar` would refuse a second registration anyway.
    const pronta = organizacaoPronta('Território Ativo');
    store.instance.setState({
      versao: 1,
      organizacoes: [pronta],
      ativa: {organizacaoId: pronta.id, area: 'monitoramento'},
    } as EstadoOrganizacoes);
    await renderScreen();
    await irParaEtapaNome();
    expect(screen.getByTestId('ORG.create-name-select')).toBeOnTheScreen();
    expect(screen.queryByText('PROVISIONING-REACHED')).not.toBeOnTheScreen();
    expect(iniciar).not.toHaveBeenCalled();
  });

  test('a settled document re-opened without an active selection still routes to OrganizationProvisioning', async () => {
    // Redirect preserved (Fase 4): "opened the create screen with an
    // already-settled document" — A is pronta and acknowledged, but the
    // device is not operating it (no resolvable active selection), so the
    // confirmation/selection surface owns the document, not the form.
    store.instance.setState({
      versao: 1,
      organizacoes: [organizacaoPronta('Território Ativo')],
      ativa: null,
    } as EstadoOrganizacoes);
    await renderScreen();

    expect(await screen.findByText('PROVISIONING-REACHED')).toBeOnTheScreen();
    expect(
      screen.queryByTestId('ORG.create-name-select'),
    ).not.toBeOnTheScreen();
    expect(iniciar).not.toHaveBeenCalled();
  });

  test('a settled document does not short-circuit the second creation', async () => {
    // Fase 4: with A `pronta`, acknowledged and operating (the rule-5
    // projection resolves) and NOTHING in flight, B's press must reach the
    // materializer — the gate is no longer "any organization exists"
    // (`organizacoes[0]`), it is the materializer's own typed refusal.
    store.instance.setState({
      versao: 1,
      organizacoes: [organizacaoPronta('Território Ativo')],
      ativa: {organizacaoId: '0123456789abcdef', area: 'monitoramento'},
    } as EstadoOrganizacoes);
    await renderScreen();
    await irParaEtapaNome();
    await selecionarTerritorio();
    await preencherUrl('https://exemplo.org/');
    await fireEvent.press(screen.getByTestId('ORG.create-btn'));

    await waitFor(() => {
      expect(iniciar).toHaveBeenCalledWith('Kaxuyana-Tunayana', {
        arquivoRemotoUrl: 'https://exemplo.org/',
      });
    });
    // Once `iniciar` resolves, the provisioning surface owns the living
    // operation. The redirect effect stays silent here because
    // `derivarProjectIdAtivo` still resolves by A, so the screen hands
    // over itself.
    expect(await screen.findByText('PROVISIONING-REACHED')).toBeOnTheScreen();
    expect(
      screen.queryByTestId('ORG.create-name-select', {
        includeHiddenElements: true,
      }),
    ).not.toBeOnTheScreen();
  });

  test('a settled document still surfaces a genuine rejection in the sheet', async () => {
    // The race swallow keyed on `organizacoes[0]` silenced B's real failures
    // (template refusal, write refusal) whenever a settled organization was
    // present — a rejection with nothing in flight is an error sheet, never
    // silence.
    mockMaterializador({
      iniciar: async () => {
        throw new Error('boom');
      },
    });
    store.instance.setState({
      versao: 1,
      organizacoes: [organizacaoPronta('Território Ativo')],
      ativa: {organizacaoId: '0123456789abcdef', area: 'monitoramento'},
    } as EstadoOrganizacoes);
    await renderScreen();
    await irParaEtapaNome();
    await selecionarTerritorio();
    await preencherUrl('https://exemplo.org/');
    await fireEvent.press(screen.getByTestId('ORG.create-btn'));

    expect(await screen.findByText('ERROR: boom')).toBeOnTheScreen();
  });

  test('a start while another creation is in flight is surfaced as blocked, not swallowed', async () => {
    // SPEC B §5.5 guard lives in the materializer layer: a start whose
    // concurrent flight never landed its registration throws the typed
    // `creation-in-progress`. The screen must branch on the typed code —
    // not the message — and signal that state: never crash, never silence.
    iniciar.mockImplementation(async () => {
      throw new OrganizationOperationError(
        'creation-in-progress',
        'another organization creation is in progress',
      );
    });
    store.instance.setState({
      versao: 1,
      organizacoes: [organizacaoPronta('Território Ativo')],
      ativa: {organizacaoId: '0123456789abcdef', area: 'monitoramento'},
    } as EstadoOrganizacoes);
    await renderScreen();
    await irParaEtapaNome();
    await selecionarTerritorio();
    await preencherUrl('https://exemplo.org/');
    await fireEvent.press(screen.getByTestId('ORG.create-btn'));

    await waitFor(() => {
      expect(iniciar).toHaveBeenCalledWith('Kaxuyana-Tunayana', {
        arquivoRemotoUrl: 'https://exemplo.org/',
      });
    });
    expect(await screen.findByTestId('ORG.create-blocked')).toBeOnTheScreen();
    // The form stays usable and the press never crashed it.
    expect(
      screen.getByTestId('ORG.create-btn', {includeHiddenElements: true}),
    ).toBeOnTheScreen();
  });

  test('a new attempt clears the blocked message before the second start settles', async () => {
    // BLOCKER 1: `bloqueado` was write-once — the message claimed a creation
    // was in flight even after that flight ended and a fresh `iniciar`
    // started. The second start here never settles, so the form stays on its
    // loading state and the assertion cannot be satisfied by any handover.
    iniciar
      .mockRejectedValueOnce(
        new OrganizationOperationError(
          'creation-in-progress',
          'another organization creation is in progress',
        ),
      )
      .mockImplementation(() => new Promise<void>(() => {}));
    store.instance.setState({
      versao: 1,
      organizacoes: [organizacaoPronta('Território Ativo')],
      ativa: {organizacaoId: '0123456789abcdef', area: 'monitoramento'},
    } as EstadoOrganizacoes);
    await renderScreen();
    await irParaEtapaNome();
    await selecionarTerritorio();
    await preencherUrl('https://exemplo.org/');
    await fireEvent.press(screen.getByTestId('ORG.create-btn'));
    expect(await screen.findByTestId('ORG.create-blocked')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('ORG.create-btn'));
    // The new attempt is running (loading UI replaced the button) and the
    // falsified "creation in progress" message did not survive into it.
    expect(screen.queryByTestId('ORG.create-btn')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('ORG.create-blocked')).not.toBeOnTheScreen();
  });

  // SPEC B §3.2:64/:68 (Fase 5): while a start is in flight — or the blocked
  // banner is up — Back cannot remove this screen. The etapa-back (nome →
  // intro, §3.1) is the screen's own rule and stays; the LEAK is the back
  // from the intro, where nothing was listening: the pop removed the screen
  // with the operation (or the banner's re-arm contract) alive.
  describe('back lock during a live operation', () => {
    test('a back dispatch while a start is in flight never removes the screen', async () => {
      mockMaterializador({iniciar: () => new Promise<void>(() => {})});
      await renderScreen();
      await irParaEtapaNome();
      await selecionarTerritorio();
      await preencherUrl('https://exemplo.org/');
      await fireEvent.press(screen.getByTestId('ORG.create-btn'));
      // The start is in flight (the loading UI replaced the button).
      expect(screen.queryByTestId('ORG.create-btn')).not.toBeOnTheScreen();

      // The etapa-back is the screen's own §3.1 rule: intro, no pop.
      await act(async () => {
        navigationRef.goBack();
      });
      expect(
        screen.getByTestId('ORG.create-intro-continue-btn'),
      ).toBeOnTheScreen();
      expect(screen.queryByText('SUCCESS-STUB')).not.toBeOnTheScreen();

      // From the intro, back WOULD pop the screen with the start alive.
      await act(async () => {
        navigationRef.goBack();
      });
      expect(
        screen.getByTestId('ORG.create-intro-continue-btn'),
      ).toBeOnTheScreen();
      expect(screen.queryByText('SUCCESS-STUB')).not.toBeOnTheScreen();
    });

    test('a refused start releases the back hold', async () => {
      // B5-3 (fix round 2): the typed refusal (§5.5) means THIS screen's
      // start never happened — no call of its own is in flight, so §3.2's
      // narrow authorization does not extend to it. Back must work: the
      // §3.1 hop brings the intro, and the next back pops to Success.
      iniciar.mockImplementation(async () => {
        throw new OrganizationOperationError(
          'creation-in-progress',
          'another organization creation is in progress',
        );
      });
      store.instance.setState({
        versao: 1,
        organizacoes: [organizacaoPronta('Território Ativo')],
        ativa: {organizacaoId: '0123456789abcdef', area: 'monitoramento'},
      } as EstadoOrganizacoes);
      await renderScreen();
      await irParaEtapaNome();
      await selecionarTerritorio();
      await preencherUrl('https://exemplo.org/');
      await fireEvent.press(screen.getByTestId('ORG.create-btn'));
      expect(await screen.findByTestId('ORG.create-blocked')).toBeOnTheScreen();

      // The etapa-back is the screen's own §3.1 rule: intro, no pop.
      await act(async () => {
        navigationRef.goBack();
      });
      expect(
        screen.getByTestId('ORG.create-intro-continue-btn'),
      ).toBeOnTheScreen();
      expect(screen.queryByText('SUCCESS-STUB')).not.toBeOnTheScreen();

      // The refusal is not a live operation: the pop goes through.
      await act(async () => {
        navigationRef.goBack();
      });
      expect(screen.getByText('SUCCESS-STUB')).toBeOnTheScreen();
    });

    test('a refusal does not block the handover when the document settles without a selection', async () => {
      iniciar.mockRejectedValueOnce(
        new OrganizationOperationError(
          'creation-in-progress',
          'another organization creation is in progress',
        ),
      );
      store.instance.setState({
        versao: 1,
        organizacoes: [organizacaoPronta('Território Ativo')],
        ativa: {organizacaoId: '0123456789abcdef', area: 'monitoramento'},
      } as EstadoOrganizacoes);
      await renderScreen();
      await irParaEtapaNome();
      await selecionarTerritorio();
      await preencherUrl('https://exemplo.org/');
      await fireEvent.press(screen.getByTestId('ORG.create-btn'));
      expect(await screen.findByTestId('ORG.create-blocked')).toBeOnTheScreen();

      // The other flight registers its organization.
      await act(async () => {
        store.instance.setState(documentoComOrganizacao('Território Em Voo'));
      });
      expect(await screen.findByText('PROVISIONING-REACHED')).toBeOnTheScreen();
    });

    test('back during flight explains itself at the intro and the handover lands exactly once', async () => {
      let releaseStart: () => void = () => {};
      mockMaterializador({
        iniciar: (nome: string) =>
          new Promise<void>(resolve => {
            releaseStart = () => {
              void registrar(nome).then(() => resolve());
            };
          }),
      });
      await renderScreen();
      await irParaEtapaNome();

      const landings: Array<string> = [];
      const unsubscribe = navigationRef.addListener('state', e => {
        const {state} = e.data;
        if (!state) return;
        const last = state.routes[state.routes.length - 1];
        if (last) landings.push(last.name);
      });
      try {
        await selecionarTerritorio();
        await preencherUrl('https://exemplo.org/');
        await fireEvent.press(screen.getByTestId('ORG.create-btn'));
        // The start is in flight (the loading UI replaced the button).
        expect(screen.queryByTestId('ORG.create-btn')).not.toBeOnTheScreen();

        // The etapa-back brings the intro forward…
        await act(async () => {
          navigationRef.goBack();
        });
        expect(
          screen.getByTestId('ORG.create-intro-continue-btn'),
        ).toBeOnTheScreen();
        // …and the creating copy explains the still-alive flight (B5-2).
        expect(screen.getByTestId('ORG.create-creating')).toBeOnTheScreen();

        // A second back from the intro is held with the start alive.
        await act(async () => {
          navigationRef.goBack();
        });
        expect(
          screen.getByTestId('ORG.create-intro-continue-btn'),
        ).toBeOnTheScreen();
        expect(screen.queryByText('SUCCESS-STUB')).not.toBeOnTheScreen();

        // The start resolves: the document settles, the hold releases and
        // the handover replace lands — exactly one navigation event.
        await act(async () => {
          releaseStart();
        });
        expect(
          await screen.findByText('PROVISIONING-REACHED'),
        ).toBeOnTheScreen();
        expect(landings).toEqual(['OrganizationProvisioning']);
      } finally {
        unsubscribe();
      }
    });

    test('idle back from the intro still leaves the screen', async () => {
      await renderScreen();
      await act(async () => {
        navigationRef.goBack();
      });
      expect(screen.getByText('SUCCESS-STUB')).toBeOnTheScreen();
    });
  });

  // B5-4 on this screen (fix round 3): the generation gate's RESET is the
  // system's own routing (SPEC B §5.5's recovery table) — a prevented reset
  // is consumed-and-dropped because the gate advances its generation before
  // dispatching and never retries.
  describe('navigator-level reset passes the hold (GenerationTransitionGate)', () => {
    test('a system reset removes the held screen and lands on its destination', async () => {
      mockMaterializador({iniciar: () => new Promise<void>(() => {})});
      await renderScreen();
      await irParaEtapaNome();
      await selecionarTerritorio();
      await preencherUrl('https://exemplo.org/');
      await fireEvent.press(screen.getByTestId('ORG.create-btn'));
      // The hold is live: the loading UI replaced the button.
      expect(screen.queryByTestId('ORG.create-btn')).not.toBeOnTheScreen();

      await act(async () => {
        navigationRef.reset({index: 0, routes: [{name: 'Home'}]});
      });

      expect(screen.getByText('HOME-REACHED')).toBeOnTheScreen();
      expect(screen.queryByText('SUCCESS-STUB')).not.toBeOnTheScreen();
      expect(
        screen.queryByTestId('ORG.create-intro-continue-btn'),
      ).not.toBeOnTheScreen();
    });
  });
});
