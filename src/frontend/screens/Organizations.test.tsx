import * as React from 'react';
import {
  act,
  render,
  screen,
  userEvent,
  waitFor,
} from '@testing-library/react-native';
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
 * Promise<boolean>` and the `error` code the engine sets when a switch does
 * not go through. As with the real provider's context value, publishing a
 * new handle re-renders the consumer.
 */
jest.mock('../contexts/OrganizationActivationContext', () => {
  const {useSyncExternalStore} = jest.requireActual('react');
  const holder = {current: undefined as unknown};
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  return {
    __setActivation: (activation: unknown) => {
      holder.current = activation;
      for (const listener of listeners) listener();
    },
    useOrganizationActivationContext: () => {
      const value = useSyncExternalStore(subscribe, () => holder.current);
      if (value === undefined) {
        throw new Error('OrganizationActivationContext missing');
      }
      return value;
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
 * row, the Home/Map reset on success, and no route at all for a blocked or
 * failed switch, whose explanation is text inside the sheet) is asserted
 * against these spies. A spy records a call instead of failing, and a throw
 * inside the switch's `try` would be swallowed by its `catch` anyway — so
 * every test that taps a row asserts explicitly on each method it must not
 * reach.
 */
const navigationGoBack = jest.fn();
const navigationReset = jest.fn();
const navigationNavigate = jest.fn();
const screenProps = {
  navigation: {
    goBack: navigationGoBack,
    reset: navigationReset,
    navigate: navigationNavigate,
  },
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
    expect(navigationNavigate).not.toHaveBeenCalled();
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
    expect(navigationNavigate).not.toHaveBeenCalled();
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
    expect(navigationNavigate).not.toHaveBeenCalled();
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
    expect(navigationNavigate).not.toHaveBeenCalled();
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

/** SPEC A §4.4:148 — “Não foi possível abrir sua organização”. */
const INDISPONIVEL = 'Could not open your organization';
/** SPEC A §4.4:149 — “Conclua ou descarte o registro antes de trocar de organização”. */
const TRABALHO_PENDENTE =
  'Finish or discard the record before switching organization';
/** SPEC A §5.2:167 — “A sincronização precisa ser iniciada novamente.” */
const REINICIAR_SINCRONIZACAO = 'Sync needs to be started again.';
/** Every explanation the sheet can give for a switch that did not go through. */
const EXPLICACOES = [INDISPONIVEL, TRABALHO_PENDENTE, REINICIAR_SINCRONIZACAO];

describe('Organizations (SPEC A §5.2:165/§6.2:215 — feedback da troca)', () => {
  test('§5.2:165: ativação pendente mostra "Opening organization…" sozinha, sem as linhas e sem tocar a seleção', async () => {
    const user = userEvent.setup();
    // The attempt never settles on its own: the sheet is observed MID-flight.
    let resolver!: (ok: boolean) => void;
    activate.mockReturnValue(
      new Promise<boolean>(resolve => {
        resolver = resolve;
      }),
    );
    seedDocument([organizacao('id-b', 'Rio'), organizacao('id-a', 'Mata')], {
      organizacaoId: 'id-b',
      area: 'alertas',
    });
    await renderScreen();

    await user.press(screen.getByTestId('ORGANIZATIONS.row-id-a'));

    // The canonical opening state (SPEC A §5.2:165, "Abrindo organização…")
    // stands ALONE — no mixed content from the organizations the list shows.
    expect(screen.getByText('Opening organization…')).toBeOnTheScreen();
    expect(screen.queryByTestId('ORGANIZATIONS.list')).not.toBeOnTheScreen();
    expect(
      screen.queryByTestId('ORGANIZATIONS.row-id-a'),
    ).not.toBeOnTheScreen();
    // "sem alterar a seleção persistida": A stays selected in the document.
    expect(store.instance.getState().ativa).toEqual({
      organizacaoId: 'id-b',
      area: 'alertas',
    });
    // Nothing navigated anywhere while the attempt is in flight.
    expect(activate).toHaveBeenCalledTimes(1);
    expect(navigationReset).not.toHaveBeenCalled();
    expect(navigationNavigate).not.toHaveBeenCalled();
    expect(navigationGoBack).not.toHaveBeenCalled();

    // Settling the attempt still lands the PROVEN success destination: the
    // opening state never wedges the Home/Map reset (§5.2:168).
    await act(async () => {
      resolver(true);
    });
    await waitFor(() => expect(navigationReset).toHaveBeenCalledTimes(1));
    expect(navigationReset.mock.calls[0]![0]).toEqual({
      index: 0,
      routes: [{name: 'Home', params: {screen: 'Map'}}],
    });
    expect(navigationNavigate).not.toHaveBeenCalled();
    expect(navigationGoBack).not.toHaveBeenCalled();
  });

  test.each([
    ['pending-work', TRABALHO_PENDENTE],
    ['unavailable', INDISPONIVEL],
    ['access-unavailable', INDISPONIVEL],
    // The sync commands were already stopped (SPEC A §5.2:167): the SPEC's
    // own sentence, not the generic unavailable copy.
    ['sync-restart-required', REINICIAR_SINCRONIZACAO],
    // No canonical string exists for a concurrent activation (SPEC A
    // §5.2:163): the generic unavailable copy, never an invented sentence.
    ['operation-in-progress', INDISPONIVEL],
  ] as const)(
    '§6.2:215: activate false com error %s explica, visível no próprio seletor: "%s"',
    async (codigo, explicacao) => {
      const user = userEvent.setup();
      // As the engine does, the code is published on the handle before the
      // `false` answer settles — and only then: at tap time the handle
      // carries no error, so a code read in the tap's closure would be stale.
      activate.mockImplementation(async () => {
        activationMock.__setActivation({activate, error: codigo});
        return false;
      });
      seedDocument([organizacao('id-b', 'Rio'), organizacao('id-a', 'Mata')], {
        organizacaoId: 'id-b',
        area: 'alertas',
      });
      await renderScreen();
      expect(screen.queryByText(explicacao)).not.toBeOnTheScreen();

      await user.press(screen.getByTestId('ORGANIZATIONS.row-id-a'));

      // The rendered text, inside the selector itself: nothing to expand, no
      // route, no sheet stacked on top — and only this code's explanation.
      expect(await screen.findByText(explicacao)).toBeVisible();
      for (const outra of EXPLICACOES.filter(texto => texto !== explicacao)) {
        expect(screen.queryByText(outra)).not.toBeOnTheScreen();
      }
      expect(screen.getByTestId('ORGANIZATIONS.list')).toBeOnTheScreen();
      expect(activate).toHaveBeenCalledWith('id-a');
      expect(navigationNavigate).not.toHaveBeenCalled();
      expect(navigationReset).not.toHaveBeenCalled();
      expect(navigationGoBack).not.toHaveBeenCalled();
      // The previous organization and area stay selected.
      expect(store.instance.getState().ativa).toEqual({
        organizacaoId: 'id-b',
        area: 'alertas',
      });
    },
  );

  test('§6.2:215: rejeição de activate é tratada — explicação genérica visível no seletor, nenhuma promise rejeitada solta', async () => {
    const user = userEvent.setup();
    // A code an EARLIER attempt left on the handle: it neither shows when the
    // sheet opens nor explains a rejection, which publishes no code at all.
    activationMock.__setActivation({activate, error: 'pending-work'});
    activate.mockRejectedValue(new Error('boom'));
    seedDocument([organizacao('id-b', 'Rio'), organizacao('id-a', 'Mata')], {
      organizacaoId: 'id-b',
      area: 'alertas',
    });
    await renderScreen();
    expect(screen.queryByText(TRABALHO_PENDENTE)).not.toBeOnTheScreen();
    expect(screen.queryByText(INDISPONIVEL)).not.toBeOnTheScreen();

    await user.press(screen.getByTestId('ORGANIZATIONS.row-id-a'));

    // A rejection must never escape as an unhandled promise: it takes the
    // same §6.2:215 road as a `false` answer — canonical copy in the sheet,
    // previous organization and area kept.
    expect(await screen.findByText(INDISPONIVEL)).toBeVisible();
    expect(screen.queryByText(TRABALHO_PENDENTE)).not.toBeOnTheScreen();
    expect(screen.getByTestId('ORGANIZATIONS.list')).toBeOnTheScreen();
    expect(navigationNavigate).not.toHaveBeenCalled();
    expect(navigationReset).not.toHaveBeenCalled();
    expect(navigationGoBack).not.toHaveBeenCalled();
    expect(store.instance.getState().ativa).toEqual({
      organizacaoId: 'id-b',
      area: 'alertas',
    });
  });

  test('§6.2:215: depois de uma troca que falhou, tocar de novo é nova tentativa e a explicação passa a ser a da nova resposta', async () => {
    const user = userEvent.setup();
    const codigos = ['pending-work', 'unavailable'];
    activate.mockImplementation(async () => {
      activationMock.__setActivation({activate, error: codigos.shift()});
      return false;
    });
    seedDocument([organizacao('id-b', 'Rio'), organizacao('id-a', 'Mata')], {
      organizacaoId: 'id-b',
      area: 'alertas',
    });
    await renderScreen();

    await user.press(screen.getByTestId('ORGANIZATIONS.row-id-a'));
    expect(await screen.findByText(TRABALHO_PENDENTE)).toBeVisible();

    await user.press(screen.getByTestId('ORGANIZATIONS.row-id-a'));

    expect(await screen.findByText(INDISPONIVEL)).toBeVisible();
    expect(screen.queryByText(TRABALHO_PENDENTE)).not.toBeOnTheScreen();
    expect(activate).toHaveBeenCalledTimes(2);
    expect(navigationNavigate).not.toHaveBeenCalled();
    expect(navigationReset).not.toHaveBeenCalled();
    expect(navigationGoBack).not.toHaveBeenCalled();
    expect(store.instance.getState().ativa).toEqual({
      organizacaoId: 'id-b',
      area: 'alertas',
    });
  });
});
