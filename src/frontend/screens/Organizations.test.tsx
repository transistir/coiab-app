import * as React from 'react';
import {render, screen, userEvent} from '@testing-library/react-native';
import {IntlProvider} from 'react-intl';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';

import {Organizations} from './Organizations';
import {
  CoiabOrganizationsStoreProvider,
  createCoiabOrganizationsStore,
  type CoiabOrganizationsStore,
} from '../contexts/CoiabOrganizationsStoreContext';
import {
  ordenarOrganizacoes,
  type EstadoOrganizacoes,
  type OrganizacaoLocal,
} from '../lib/organization/coiabOrganizations';
import type {AppStackParamsList} from '../sharedTypes/navigation';

/**
 * The screen consumes the SHARED activation engine (the provider at the app
 * root builds one; a second engine per screen would re-run initialize on the
 * document). The test stubs the handle the context publishes — the screen's
 * own contract is what `useOrganizationActivation` publishes: `activate(id):
 * Promise<boolean>`.
 */
jest.mock('../contexts/OrganizationActivationContext', () => {
  const holder = {current: undefined as unknown};
  return {
    __setActivation: (activation: unknown) => {
      holder.current = activation;
    },
    useOrganizationActivationContext: () => {
      if (holder.current === undefined) {
        throw new Error('OrganizationActivationContext missing');
      }
      return holder.current;
    },
  };
});

const activate = jest.fn<Promise<boolean>, [string]>();

/**
 * The sheet wrapper (the shipping modal chrome) reads the generic
 * `useNavigation` for its beforeRemove animation handling; the screen's own
 * navigation contract is asserted against the props stub below. The stub
 * keeps the wrapper mounted without dragging a whole navigator into this
 * unit tree.
 */
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      goBack: jest.fn(),
      reset: jest.fn(),
      navigate: jest.fn(),
      dispatch: jest.fn(),
      replace: jest.fn(),
      pop: jest.fn(),
      addListener: jest.fn(() => () => {}),
    }),
  };
});
const activationMock = jest.requireMock(
  '../contexts/OrganizationActivationContext',
) as {__setActivation(activation: unknown): void};

/**
 * No navigator: the screen's own navigation contract (goBack on the current
 * row, the Home/Map reset on success) is asserted against the stub, failing
 * loudly if a state change ever reaches for it.
 */
const navigationGoBack = jest.fn();
const navigationReset = jest.fn();
const screenProps = {
  navigation: {goBack: navigationGoBack, reset: navigationReset},
} as unknown as NativeStackScreenProps<AppStackParamsList, 'Organizations'>;

let store: CoiabOrganizationsStore;

function renderScreen() {
  return render(
    <IntlProvider locale="en" messages={{}}>
      <CoiabOrganizationsStoreProvider store={store}>
        <Organizations {...screenProps} />
      </CoiabOrganizationsStoreProvider>
    </IntlProvider>,
  );
}

/** Parser-valid organization (SPEC A §4.2) with distinct materialized ids. */
function organizacao(
  id: string,
  nome: string,
  overrides: Partial<OrganizacaoLocal> = {},
): OrganizacaoLocal {
  return {
    id,
    nome,
    estado: 'pronta',
    confirmacaoPendente: false,
    materializacao: {
      monitoramento: {
        etapa: 'verificado',
        projectId: `proj-${id}-m`,
        template: {versao: '1', hash: 'm'},
        idsAntesDaCriacao: null,
      },
      alertas: {
        etapa: 'verificado',
        projectId: `proj-${id}-a`,
        template: {versao: '1', hash: 'a'},
        idsAntesDaCriacao: null,
      },
    },
    areaEmExecucao: null,
    ultimoErro: null,
    ...overrides,
  };
}

/** Parser-valid document (SPEC A §4.2): what the selector renders from. */
function documento(
  organizacoes: OrganizacaoLocal[],
  ativa: EstadoOrganizacoes['ativa'] = null,
): EstadoOrganizacoes {
  return {versao: 1, organizacoes, ativa};
}

/** Seeds the persisted document this screen renders from. */
function seedDocument(
  organizacoes: OrganizacaoLocal[],
  ativa: EstadoOrganizacoes['ativa'] = null,
) {
  store.instance.setState(
    {...documento(organizacoes, ativa), hidratacaoFalhou: false},
    true,
  );
}

/** The rendered row ids in traversal order, straight off the list element. */
function renderedRowIds(): string[] {
  const list = screen.getByTestId('ORGANIZATIONS.list');
  // The list renders one mapped array; a single row collapses to one child.
  const rendered = list.props.children;
  const rows = Array.isArray(rendered) ? rendered : [rendered];
  return rows.map(child => {
    const testID = (child as React.ReactElement<{testID: string}>).props.testID;
    if (typeof testID !== 'string') {
      throw new Error('row without testID');
    }
    return testID.replace('ORGANIZATIONS.row-', '');
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  store = createCoiabOrganizationsStore({persist: false});
  activate.mockResolvedValue(true);
  activationMock.__setActivation({activate});
});

describe('Organizations (SPEC A §6.1, consult Phase 13)', () => {
  test('renderiza na ordem e com os rótulos de ordenarOrganizacoes, marcas e estados identificados', async () => {
    seedDocument(
      [
        organizacao('id-b', 'Rio'),
        organizacao('id-a', 'Rio'),
        organizacao('id-c', 'Serra', {estado: 'preparando'}),
        organizacao('id-d', 'Vale', {estado: 'falha_recuperavel'}),
        organizacao('id-e', 'Lago', {
          estado: 'pronta',
          confirmacaoPendente: true,
        }),
      ],
      {organizacaoId: 'id-b', area: 'monitoramento'},
    );
    await renderScreen();

    // The rendered sequence IS the pure function's output — the screen does
    // not reorder, rename or recompute anything (CA05).
    const esperado = ordenarOrganizacoes(store.instance.getState());
    expect(renderedRowIds()).toEqual(esperado.map(linha => linha.id));
    expect(esperado.map(linha => linha.rotulo)).toEqual([
      'Rio · id-b',
      'Lago',
      'Rio · id-a',
      'Serra',
      'Vale',
    ]);
    for (const linha of esperado) {
      expect(screen.getByText(linha.rotulo)).toBeOnTheScreen();
      expect(screen.getByTestId(`ORGANIZATIONS.row-${linha.id}`)).toBeDefined();
    }
    // The active organization first, marked as current (badge + selection
    // state); nothing else carries the mark.
    expect(esperado[0]).toEqual({
      id: 'id-b',
      rotulo: 'Rio · id-b',
      atual: true,
      ativavel: true,
    });
    expect(
      screen.getByTestId('ORGANIZATIONS.row-id-b').props.accessibilityState,
    ).toEqual({selected: true});
    expect(screen.getByText('Current')).toBeOnTheScreen();
    // Incomplete/unavailable organizations are identified with their state.
    expect(screen.getByText('Organization created')).toBeOnTheScreen();
    expect(screen.getByText('Preparing your organization…')).toBeOnTheScreen();
    expect(
      screen.getByText('Could not finish creating the organization.'),
    ).toBeOnTheScreen();
  });

  test('toque na organização atual fecha o modal (goBack), sem ativar', async () => {
    const user = userEvent.setup();
    seedDocument([organizacao('id-b', 'Rio'), organizacao('id-a', 'Mata')], {
      organizacaoId: 'id-b',
      area: 'alertas',
    });
    await renderScreen();

    await user.press(screen.getByTestId('ORGANIZATIONS.row-id-b'));

    expect(navigationGoBack).toHaveBeenCalledTimes(1);
    expect(activate).not.toHaveBeenCalled();
    expect(navigationReset).not.toHaveBeenCalled();
  });

  test('toque na ativável chama activate com o id certo e, no sucesso, reseta para Home/Map', async () => {
    const user = userEvent.setup();
    seedDocument([organizacao('id-b', 'Rio'), organizacao('id-a', 'Mata')], {
      organizacaoId: 'id-b',
      area: 'alertas',
    });
    await renderScreen();

    await user.press(screen.getByTestId('ORGANIZATIONS.row-id-a'));

    expect(activate).toHaveBeenCalledTimes(1);
    expect(activate).toHaveBeenCalledWith('id-a');
    expect(navigationGoBack).not.toHaveBeenCalled();
    expect(navigationReset).toHaveBeenCalledTimes(1);
    expect(navigationReset.mock.calls[0]![0]).toEqual({
      index: 0,
      routes: [{name: 'Home', params: {screen: 'Map'}}],
    });
  });

  test('activate respondendo false NÃO reseta: o modal fica aberto', async () => {
    const user = userEvent.setup();
    activate.mockResolvedValue(false);
    seedDocument([organizacao('id-b', 'Rio'), organizacao('id-a', 'Mata')], {
      organizacaoId: 'id-b',
      area: 'alertas',
    });
    await renderScreen();

    await user.press(screen.getByTestId('ORGANIZATIONS.row-id-a'));

    expect(activate).toHaveBeenCalledTimes(1);
    expect(activate).toHaveBeenCalledWith('id-a');
    expect(navigationReset).not.toHaveBeenCalled();
    expect(navigationGoBack).not.toHaveBeenCalled();
  });

  test('toque em linha não ativável (preparando, falha, confirmação) não chama activate', async () => {
    const user = userEvent.setup();
    seedDocument(
      [
        organizacao('id-b', 'Rio'),
        organizacao('id-c', 'Serra', {estado: 'preparando'}),
        organizacao('id-d', 'Vale', {estado: 'falha_recuperavel'}),
        organizacao('id-e', 'Lago', {
          estado: 'pronta',
          confirmacaoPendente: true,
        }),
      ],
      {organizacaoId: 'id-b', area: 'monitoramento'},
    );
    await renderScreen();

    await user.press(screen.getByTestId('ORGANIZATIONS.row-id-c'));
    await user.press(screen.getByTestId('ORGANIZATIONS.row-id-d'));
    await user.press(screen.getByTestId('ORGANIZATIONS.row-id-e'));

    expect(activate).not.toHaveBeenCalled();
    expect(navigationReset).not.toHaveBeenCalled();
    expect(navigationGoBack).not.toHaveBeenCalled();
  });

  test('§6.1: o seletor não lista os projetos internos das organizações', async () => {
    seedDocument([organizacao('id-b', 'Rio'), organizacao('id-a', 'Mata')], {
      organizacaoId: 'id-b',
      area: 'monitoramento',
    });
    await renderScreen();

    // Every internal project id stays out of the screen.
    for (const organizacao of store.instance.getState().organizacoes) {
      expect(
        screen.queryByText(`proj-${organizacao.id}-m`),
      ).not.toBeOnTheScreen();
      expect(
        screen.queryByText(`proj-${organizacao.id}-a`),
      ).not.toBeOnTheScreen();
    }
    // The selector lists organizations — never areas.
    expect(screen.queryByText('Monitoring')).not.toBeOnTheScreen();
    expect(screen.queryByText('Alerts')).not.toBeOnTheScreen();
  });

  test('§6.1: o seletor não inicia a criação de outra organização', async () => {
    seedDocument([organizacao('id-b', 'Rio'), organizacao('id-a', 'Mata')], {
      organizacaoId: 'id-b',
      area: 'alertas',
    });
    await renderScreen();

    // None of the retired creation entries the journeys used to carry.
    expect(screen.queryByText('Create organization')).not.toBeOnTheScreen();
    expect(screen.queryByText('New Collaboration')).not.toBeOnTheScreen();
  });
});
