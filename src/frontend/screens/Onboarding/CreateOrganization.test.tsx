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
import {markerFor} from '../../lib/organization/marker';
import {ErroPacote} from '../../lib/organization/pacotes';
import type {
  EstadoOrganizacoes,
  OrganizacaoLocal,
} from '../../lib/organization/coiabOrganizations';
import type {AppStackParamsList} from '../../sharedTypes/navigation';

// pt-BR copied verbatim from SPEC B :54/:55/:252. The copy is asserted
// through the i18n keys (exact pt-BR text), not the English defaultMessage
// (SPEC B :100-102). `tooLong` is deliberately absent: the marker-bound
// message (flag #14) is preserved as-is and asserted by its English
// defaultMessage below.
const PT_MESSAGES = {
  '$1screens.OrganizationSetup.createOrganization': 'Criar organização',
  '$1screens.OrganizationSetup.createIntroBody':
    'Sua organização terá Monitoramento e Alertas, com categorias prontas para usar. Você pode criá-la sem internet.',
  '$1screens.OrganizationSetup.continueButton': 'Continuar',
  '$1screens.OrganizationSetup.nameLabel': 'Nome da organização',
  '$1screens.OrganizationSetup.nameGuidance':
    'Escolha um nome para sua organização.',
  '$1screens.OrganizationSetup.nameNotIdentity':
    'Usar o mesmo nome de outra organização não conecta os dispositivos. Para participar de uma organização existente, aguarde um convite.',
  '$1screens.OrganizationSetup.emptyName': 'Informe o nome da organização.',
};

jest.mock('../../contexts/OrganizationMaterializerContext', () => ({
  useOrganizationMaterializer: jest.fn(),
}));

const useMaterializadorMock = useOrganizationMaterializer as jest.Mock;

jest.mock('../../contexts/ActiveProjectIdStoreContext', () => ({
  useProjetarProjectIdAtivo: jest.fn(),
}));

const projetar = jest.fn();
// The screen chains `.catch/.finally` on the returned promise, so the
// default mock must resolve like the real `iniciar` does.
const iniciar = jest.fn(async () => {});

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

/** The materializer's observable side effect: the document gains the org. */
const registrar = async (nome: string) => {
  store.instance.setState(documentoComOrganizacao(nome));
};

let store: CoiabOrganizationsStore;

const Stack = createNativeStackNavigator<AppStackParamsList>();
const navigationRef = createNavigationContainerRef<AppStackParamsList>();

const SuccessStub = () => <Text>SUCCESS-STUB</Text>;

const HomeStub = () => <Text>HOME-REACHED</Text>;
const ProvisioningStub = () => <Text>PROVISIONING-REACHED</Text>;

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

async function renderScreen() {
  await render(
    <IntlProvider locale="pt-BR" messages={PT_MESSAGES}>
      <NavigationContainer ref={navigationRef}>
        <CoiabOrganizationsStoreProvider store={store}>
          <Stack.Navigator initialRouteName="Success">
            <Stack.Screen name="Success" component={SuccessStub} />
            <Stack.Screen
              name="CreateOrganization"
              component={CreateOrganization}
              options={{headerShown: false}}
            />
            <Stack.Screen name="Home" component={HomeStub} />
            <Stack.Screen
              name="OrganizationProvisioning"
              component={ProvisioningStub}
            />
            <Stack.Screen
              name="ErrorBottomSheet"
              component={ErrorStub}
              options={{headerShown: false}}
            />
          </Stack.Navigator>
        </CoiabOrganizationsStoreProvider>
      </NavigationContainer>
    </IntlProvider>,
  );
  // The native-stack navigator mounts asynchronously: wait for the initial
  // route to settle before dispatching, or the navigate becomes a no-op
  // ("navigation object hasn't been initialized").
  await screen.findByText('SUCCESS-STUB');
  await act(async () => {
    navigationRef.navigate('CreateOrganization');
  });
}

// The SPEC B §3.1 journey: Continuar on the intro leads to the name step.
async function irParaEtapaNome() {
  await fireEvent.press(screen.getByTestId('ORG.create-intro-continue-btn'));
  expect(screen.getByTestId('ORG.create-name-inp')).toBeOnTheScreen();
}

beforeEach(() => {
  jest.clearAllMocks();
  store = createCoiabOrganizationsStore();
  (useProjetarProjectIdAtivo as jest.Mock).mockReturnValue(projetar);
  mockMaterializador();
});

describe('CreateOrganization', () => {
  // The real bound is the minted marker `coiab-org:v1:<16>:<slot>:<name>`
  // (SPEC 4.1/E3): 32 overhead chars — the format has a colon after the slot
  // too — so the encoded name must fit 28. Measured off the real format so
  // this suite fails if the guard and the marker ever disagree again.
  const MARKER_OVERHEAD = markerFor('0123456789abcdef', 'm', 'x').length - 1;
  const MAX_ENCODED_NAME = 60 - MARKER_OVERHEAD;

  test('the guard bound mints a marker of exactly 60 chars, never 61', () => {
    // Pins the overhead: both colons after the slot count, so 28 encoded
    // chars land the marker on exactly 60 and the 29th overflows it.
    expect(MAX_ENCODED_NAME).toBe(28);
    expect(
      markerFor('0123456789abcdef', 'm', 'a'.repeat(MAX_ENCODED_NAME)),
    ).toHaveLength(60);
    expect(
      markerFor('0123456789abcdef', 'm', 'a'.repeat(MAX_ENCODED_NAME + 1)),
    ).toHaveLength(61);
  });

  test('the intro step renders the SPEC B :54 copy and leads to the name step', async () => {
    await renderScreen();

    expect(screen.getByText('Criar organização')).toBeOnTheScreen();
    expect(
      screen.getByText(
        'Sua organização terá Monitoramento e Alertas, com categorias prontas para usar. Você pode criá-la sem internet.',
      ),
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('ORG.create-intro-continue-btn'),
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('ORG.create-name-inp')).not.toBeOnTheScreen();

    await irParaEtapaNome();

    expect(
      screen.getByText('Escolha um nome para sua organização.'),
    ).toBeOnTheScreen();
    expect(
      screen.getByText(
        'Usar o mesmo nome de outra organização não conecta os dispositivos. Para participar de uma organização existente, aguarde um convite.',
      ),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('ORG.create-name-inp')).toBeOnTheScreen();
    expect(screen.getByTestId('ORG.create-btn')).toBeOnTheScreen();
  });

  test('back from the name step returns to the intro with no effects', async () => {
    await renderScreen();

    await irParaEtapaNome();

    navigationRef.goBack();

    expect(
      await screen.findByTestId('ORG.create-intro-continue-btn'),
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('ORG.create-name-inp')).not.toBeOnTheScreen();
    expect(iniciar).not.toHaveBeenCalled();
    // "sem efeitos": the document is untouched by the round-trip.
    expect(store.instance.getState().organizacoes).toHaveLength(0);
  });

  test('the name step labels the field and the submit button per SPEC B :55', async () => {
    await renderScreen();

    await irParaEtapaNome();

    expect(screen.getByTestId('ORG.create-name-inp')).toHaveProp(
      'placeholder',
      'Nome da organização',
    );
    expect(screen.getByTestId('ORG.create-btn')).toHaveTextContent(
      'Criar organização',
    );
  });

  test('an empty submit shows the required-name message and never calls the core', async () => {
    // SPEC B :252: an empty (or whitespace-only) name is rejected BEFORE
    // persisting the intent — the message explains, nothing is created.
    await renderScreen();

    await irParaEtapaNome();
    await fireEvent.press(screen.getByTestId('ORG.create-btn'));

    expect(
      screen.getByText('Informe o nome da organização.'),
    ).toBeOnTheScreen();
    expect(iniciar).not.toHaveBeenCalled();

    // A whitespace-only name is equally rejected (trim).
    await fireEvent.changeText(
      screen.getByTestId('ORG.create-name-inp'),
      '   ',
    );
    expect(
      screen.queryByText('Informe o nome da organização.'),
    ).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('ORG.create-btn'));
    expect(
      screen.getByText('Informe o nome da organização.'),
    ).toBeOnTheScreen();
    expect(iniciar).not.toHaveBeenCalled();
  });

  test('presses create with the trimmed name and never writes the active project', async () => {
    // SPEC B §3.3/§5.3: between `pronta` and the "Abrir organização" tap the
    // device has NO active selection — `ativa` is born only in that tap's
    // single write, so the form must hand the materializer the trimmed name
    // and never repoint the legacy active id itself.
    await renderScreen();
    await irParaEtapaNome();

    await fireEvent.changeText(
      screen.getByTestId('ORG.create-name-inp'),
      '  Órgão Teste  ',
    );

    await fireEvent.press(screen.getByTestId('ORG.create-btn'));

    await waitFor(() => {
      expect(iniciar).toHaveBeenCalledWith('Órgão Teste');
    });
    await waitFor(() => {
      expect(projetar).not.toHaveBeenCalled();
    });
  });

  test('an ASCII name at the exact encoded-marker boundary stays enabled', async () => {
    await renderScreen();
    await irParaEtapaNome();

    // 32 + 28 = 60 — the marker fits exactly.
    await fireEvent.changeText(
      screen.getByTestId('ORG.create-name-inp'),
      'a'.repeat(MAX_ENCODED_NAME),
    );
    expect(screen.getByTestId('ORG.create-btn')).toBeEnabled();
    expect(
      screen.queryByText('Organization name is too long'),
    ).not.toBeOnTheScreen();

    // One more char makes the marker overflow 60 — the button is disabled
    // even though the raw input is far below its 60-char maxLength.
    await fireEvent.changeText(
      screen.getByTestId('ORG.create-name-inp'),
      'a'.repeat(MAX_ENCODED_NAME + 1),
    );
    expect(screen.getByTestId('ORG.create-btn')).toBeDisabled();
    expect(screen.getByText('Organization name is too long')).toBeOnTheScreen();
  });

  test('an accented name is guarded by its encoded length, not the raw one', async () => {
    await renderScreen();
    await irParaEtapaNome();

    // 'Órganização' is 11 raw chars but encodes to 26 (each accented char
    // becomes %XX%XX): 32 + 26 = 58, inside the bound. Pinned so the
    // boundary walk below stays meaningful.
    expect(encodeURIComponent('Órganização')).toHaveLength(26);
    await fireEvent.changeText(
      screen.getByTestId('ORG.create-name-inp'),
      'Órganização',
    );
    expect(screen.getByTestId('ORG.create-btn')).toBeEnabled();

    // Appending ASCII chars walks the encoded length onto the boundary:
    // 26 + 2 = 28 still fits exactly; +1 more overflows.
    await fireEvent.changeText(
      screen.getByTestId('ORG.create-name-inp'),
      'Órganização' +
        'x'.repeat(MAX_ENCODED_NAME - encodeURIComponent('Órganização').length),
    );
    expect(screen.getByTestId('ORG.create-btn')).toBeEnabled();

    await fireEvent.changeText(
      screen.getByTestId('ORG.create-name-inp'),
      'Órganização' +
        'x'.repeat(
          MAX_ENCODED_NAME - encodeURIComponent('Órganização').length + 1,
        ),
    );
    expect(screen.getByTestId('ORG.create-btn')).toBeDisabled();
    expect(screen.getByText('Organization name is too long')).toBeOnTheScreen();
  });

  test('an emoji name is guarded by its encoded length', async () => {
    await renderScreen();
    await irParaEtapaNome();

    // Each 🌴 encodes to 12 chars (%F0%9F%8C%B4, 4 bytes × 3): two fit the
    // 28-char encoded-name bound, three do not — both far below the raw
    // 60-char input maxLength.
    await fireEvent.changeText(
      screen.getByTestId('ORG.create-name-inp'),
      '🌴'.repeat(2),
    );
    expect(screen.getByTestId('ORG.create-btn')).toBeEnabled();

    await fireEvent.changeText(
      screen.getByTestId('ORG.create-name-inp'),
      '🌴'.repeat(3),
    );
    expect(screen.getByTestId('ORG.create-btn')).toBeDisabled();
    expect(screen.getByText('Organization name is too long')).toBeOnTheScreen();
  });

  test('the character counter reads the encoded length against the guard bound', async () => {
    await renderScreen();
    await irParaEtapaNome();

    // ASCII only: encoded and raw lengths agree, and the denominator is the
    // encoded-name bound (28), not the marker length (60).
    await fireEvent.changeText(
      screen.getByTestId('ORG.create-name-inp'),
      'Minha Organizacao',
    );
    expect(encodeURIComponent('Minha Organizacao')).toHaveLength(19);
    expect(screen.getByText(`19/${MAX_ENCODED_NAME}`)).toBeOnTheScreen();

    // Accents expand under encoding, and the guard counts the encoded form —
    // so the counter must too, or it would read 11 while the guard counts 29.
    await fireEvent.changeText(
      screen.getByTestId('ORG.create-name-inp'),
      'Órganização',
    );
    expect(
      screen.getByText(
        `${encodeURIComponent('Órganização').length}/${MAX_ENCODED_NAME}`,
      ),
    ).toBeOnTheScreen();
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

    await fireEvent.changeText(
      screen.getByTestId('ORG.create-name-inp'),
      'Minha Org',
    );
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

    await fireEvent.changeText(
      screen.getByTestId('ORG.create-name-inp'),
      'Órgão Teste',
    );
    await fireEvent.press(screen.getByTestId('ORG.create-btn'));

    expect(await screen.findByText('PROVISIONING-REACHED')).toBeOnTheScreen();
    // A replace, not a push: the form is gone with its draft handed over.
    expect(screen.queryByTestId('ORG.create-name-inp')).not.toBeOnTheScreen();
    expect(screen.queryByText('HOME-REACHED')).not.toBeOnTheScreen();
  });

  test('a rejection with no document entry opens the error sheet and keeps the name', async () => {
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
    await fireEvent.changeText(
      screen.getByTestId('ORG.create-name-inp'),
      '  Órgão Teste  ',
    );
    await fireEvent.press(screen.getByTestId('ORG.create-btn'));

    expect(await screen.findByText('ERROR: boom')).toBeOnTheScreen();
    // The sheet is a modal over the form, so the form screen reads
    // aria-hidden — the draft's persistence is asserted through the
    // hidden query, exactly the value that was typed.
    expect(
      screen.getByTestId('ORG.create-name-inp', {includeHiddenElements: true}),
    ).toHaveProp('value', '  Órgão Teste  ');
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
    await fireEvent.changeText(
      screen.getByTestId('ORG.create-name-inp'),
      '  Órgão Teste  ',
    );
    await fireEvent.press(screen.getByTestId('ORG.create-btn'));

    expect(
      await screen.findByText(
        'ERROR: Could not prepare the necessary files on this device. Nothing was created.',
      ),
    ).toBeOnTheScreen();
    expect(
      await screen.findByText('CODE: pacote_nao_aprovado'),
    ).toBeOnTheScreen();
    // The failure re-arms the form: draft intact for a retry.
    expect(
      screen.getByTestId('ORG.create-btn', {includeHiddenElements: true}),
    ).toBeOnTheScreen();
  });

  test('an organization already in the document routes to OrganizationProvisioning instead of starting', async () => {
    // SPEC B §5.5/:240: a persisted organization — here a half-provisioned
    // one whose id survived an interrupted attempt — is never overwritten by
    // a new `iniciar`: the provisioning screen owns its recovery, so the
    // form must hand over before the first press.
    store.instance.setState(documentoComOrganizacao('Órgão Pendente'));
    await renderScreen();

    expect(await screen.findByText('PROVISIONING-REACHED')).toBeOnTheScreen();
    expect(screen.queryByTestId('ORG.create-name-inp')).not.toBeOnTheScreen();
    expect(iniciar).not.toHaveBeenCalled();
  });

  test('a settled document (ready, acknowledged, active) leaves an explicitly opened form alone', async () => {
    // CA12: with a ready organization operating (the §4.2 rule-5 projection
    // resolves), opening the creation form from Home is an explicit act —
    // it must not be bounced to a confirmation the user already consumed,
    // and `iniciar` would refuse a second registration anyway.
    const pronta: OrganizacaoLocal = {
      ...documentoComOrganizacao('Órgão Ativa').organizacoes[0]!,
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
    store.instance.setState({
      versao: 1,
      organizacoes: [pronta],
      ativa: {organizacaoId: pronta.id, area: 'monitoramento'},
    } as EstadoOrganizacoes);
    await renderScreen();
    await irParaEtapaNome();
    expect(screen.getByTestId('ORG.create-name-inp')).toBeOnTheScreen();
    expect(screen.queryByText('PROVISIONING-REACHED')).not.toBeOnTheScreen();
    expect(iniciar).not.toHaveBeenCalled();
  });
});
