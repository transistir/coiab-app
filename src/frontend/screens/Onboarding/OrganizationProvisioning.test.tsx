import * as React from 'react';
import {Text} from 'react-native';
import {
  act,
  render,
  screen,
  userEvent,
  waitFor,
} from '@testing-library/react-native';
import {IntlProvider} from 'react-intl';
import {
  NavigationContainer,
  NavigationContext,
  NavigationRouteContext,
  createNavigationContainerRef,
  type NavigationProp,
  type ParamListBase,
} from '@react-navigation/native';
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack';

import {OrganizationProvisioning} from './OrganizationProvisioning';
import {
  CoiabOrganizationsStoreProvider,
  createCoiabOrganizationsStore,
  type CoiabOrganizationsStore,
} from '../../contexts/CoiabOrganizationsStoreContext';
import {
  criarEtapaAreaAusente,
  type EstadoOrganizacoes,
  type EtapaArea,
  type OrganizacaoLocal,
} from '../../lib/organization/coiabOrganizations';

jest.mock('../../contexts/ActiveProjectIdStoreContext', () => {
  const holder = {current: undefined as string | undefined};
  return {
    __projetarProjectIdAtivo: (projectId: string | undefined) => {
      holder.current = projectId;
    },
    useActiveProjectId: () => holder.current,
  };
});

const activeProjectIdMock = jest.requireMock(
  '../../contexts/ActiveProjectIdStoreContext',
) as {__projetarProjectIdAtivo(projectId: string | undefined): void};
import type {AppStackParamsList} from '../../sharedTypes/navigation';

/**
 * The screen's own Home reset is exercised at the navigator level; the stub
 * keeps the unit tree free of a navigator while still failing loudly if a
 * state change ever reaches for it.
 */
const navigationReset = jest.fn();
/** The explicit way back to the operating organization (review P1). */
const navigationPopTo = jest.fn();
/**
 * Registrations are recorded WITH their unsubscribe: the helper below must
 * dispatch only at a LIVE listener — a stale (already-unsubscribed) closure
 * would still execute when invoked directly.
 */
const navigationSubscriptions: Array<{
  event: string;
  listener: (...args: Array<unknown>) => unknown;
  active: boolean;
}> = [];
const navigationAddListener: jest.Mock = jest.fn(
  (event: string, listener: (...args: Array<unknown>) => unknown) => {
    const subscription = {
      event,
      listener,
      active: true,
      unsubscribe: () => {
        subscription.active = false;
      },
    };
    navigationSubscriptions.push(subscription);
    return subscription.unsubscribe;
  },
);
const navigationMock = {
  reset: navigationReset,
  popTo: navigationPopTo,
  addListener: navigationAddListener,
  // The context provider's value type (NavigationProp) requires the full
  // helper surface; the stub's contract is the calls the screen makes.
} as unknown as NavigationProp<ParamListBase>;
const screenProps = {
  navigation: navigationMock,
  route: {
    key: 'OrganizationProvisioning',
    name: 'OrganizationProvisioning',
  },
} as unknown as NativeStackScreenProps<
  AppStackParamsList,
  'OrganizationProvisioning'
>;
/**
 * jest-expo resolves the iOS no-op BackHandler (nothing dispatches), so the
 * hardware layer is asserted against the same module path the app runs on
 * Android, with subscriptions recorded for removal checks.
 */
jest.mock('react-native/Libraries/Utilities/BackHandler', () => {
  const live: Array<{handler: () => boolean}> = [];
  const addEventListener = jest.fn((_event: string, handler: () => boolean) => {
    live.push({handler});
    return {
      remove: jest.fn(() => {
        live.splice(
          live.findIndex(item => item.handler === handler),
          1,
        );
      }),
    };
  });
  // The deep-import shim is consumed as `.default` by react-native's index,
  // so the mock must carry the same shape.
  return {
    __esModule: true,
    __live: live,
    default: {exitApp: () => {}, addEventListener},
  };
});

const backHandlerMock = jest.requireMock(
  'react-native/Libraries/Utilities/BackHandler',
) as {
  __live: Array<{handler: () => boolean}>;
  default: {addEventListener: jest.Mock};
};

jest.mock('../../contexts/OrganizationActivationContext', () => {
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

const activate = jest.fn<Promise<boolean>, [string, {acknowledge: true}]>();
const retryPreparation = jest.fn<Promise<boolean>, [string]>();
const recoverPendingWork = jest.fn<Promise<boolean>, []>();

const activationMock = jest.requireMock(
  '../../contexts/OrganizationActivationContext',
) as {__setActivation(activation: unknown): void};

let store: CoiabOrganizationsStore;

/**
 * The screen reads the document and the activation handle; nothing else.
 * No navigator: the screen does not navigate — routing belongs to the
 * startup gate and the generation rule, tested at the navigator level.
 */
function renderScreen() {
  return render(
    <IntlProvider locale="en" messages={{}}>
      <CoiabOrganizationsStoreProvider store={store}>
        <NavigationContext.Provider value={navigationMock}>
          <NavigationRouteContext.Provider value={screenProps.route}>
            <OrganizationProvisioning {...screenProps} />
          </NavigationRouteContext.Provider>
        </NavigationContext.Provider>
      </CoiabOrganizationsStoreProvider>
    </IntlProvider>,
  );
}

function etapa(overrides: Partial<EtapaArea>): EtapaArea {
  return {...criarEtapaAreaAusente(), ...overrides};
}

const PAR_PRONTA: OrganizacaoLocal['materializacao'] = {
  monitoramento: etapa({
    etapa: 'verificado',
    projectId: 'proj-m-1',
    template: {versao: '1', hash: 'm'},
  }),
  alertas: etapa({
    etapa: 'verificado',
    projectId: 'proj-a-1',
    template: {versao: '1', hash: 'a'},
  }),
};

function organizacao(
  overrides: Partial<OrganizacaoLocal> = {},
): OrganizacaoLocal {
  return {
    id: 'org-1',
    nome: 'Primeira',
    estado: 'preparando',
    confirmacaoPendente: false,
    materializacao: {
      monitoramento: criarEtapaAreaAusente(),
      alertas: criarEtapaAreaAusente(),
    },
    areaEmExecucao: null,
    ultimoErro: null,
    ...overrides,
  };
}

/** Parser-valid document (SPEC A §4.2): what the startup gate routes on. */
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

/** Exact English text of the slow-preparation notice (SPEC B §3.2:68). */
const SLOW_NOTICE =
  'Preparation is taking a while. If it does not continue, close and reopen the application.';

/** Exact English text of the blocked-back notice (Fase 5, ⚑ COPY PENDING). */
const BACK_BLOCKED =
  'You cannot leave this screen while an organization operation is in progress.';

beforeEach(() => {
  jest.clearAllMocks();
  store = createCoiabOrganizationsStore({persist: false});
  activate.mockResolvedValue(true);
  retryPreparation.mockResolvedValue(true);
  recoverPendingWork.mockResolvedValue(false);
  // A document in `preparando` is, by default, a call in flight in this
  // session; the interrupted case (nothing alive) is set per test.
  activationMock.__setActivation({
    activate,
    retryPreparation,
    recoverPendingWork,
    preparacaoViva: true,
  });
  activeProjectIdMock.__projetarProjectIdAtivo(undefined);
  backHandlerMock.__live.length = 0;
  // jest.clearAllMocks resets the mock's call log but not this ledger.
  navigationSubscriptions.length = 0;
});

describe('OrganizationProvisioning', () => {
  // Document-driven view (SPEC B §4.4): the persisted document exists, so IT
  // decides what renders. The activation engine owns every exit.
  describe('document-driven provisioning', () => {
    test('a ready organization with a pending confirmation shows the confirmation and no other button', async () => {
      seedDocument([
        organizacao({
          estado: 'pronta',
          confirmacaoPendente: true,
          materializacao: PAR_PRONTA,
        }),
      ]);

      await renderScreen();

      expect(screen.getByText('Organization created')).toBeOnTheScreen();
      expect(
        screen.getByText(
          'Primeira is ready. Monitoring and Alerts are already available.',
        ),
      ).toBeOnTheScreen();
      expect(screen.getAllByText('Ready')).toHaveLength(2);
      expect(
        screen.getByTestId('ORG.provisioning-open-organization-btn'),
      ).toBeOnTheScreen();
      expect(
        screen.queryByTestId('ORG.provisioning-retry-preparation-btn'),
      ).not.toBeOnTheScreen();
      expect(
        screen.queryByTestId('ORG.provisioning-retry-activation-btn'),
      ).not.toBeOnTheScreen();
    });

    test('a double tap on Abrir organização produces ONE activate call', async () => {
      seedDocument([
        organizacao({
          estado: 'pronta',
          confirmacaoPendente: true,
          materializacao: PAR_PRONTA,
        }),
      ]);
      // Hold the call in flight until the test releases it: the second tap
      // must land while the first is still running.
      let releaseActivate: (value: boolean) => void = () => {};
      activate.mockImplementation(
        () =>
          new Promise<boolean>(resolve => {
            releaseActivate = resolve;
          }),
      );
      const user = userEvent.setup();
      await renderScreen();

      const buttonTestId = 'ORG.provisioning-open-organization-btn';
      await user.press(screen.getByTestId(buttonTestId));
      // The call is in flight: the button is disabled for a second tap.
      expect(screen.getByTestId(buttonTestId)).toBeDisabled();
      await user.press(screen.getByTestId(buttonTestId));
      releaseActivate(true);
      await waitFor(() => {
        expect(screen.getByTestId(buttonTestId)).toBeEnabled();
      });

      expect(activate).toHaveBeenCalledTimes(1);
      expect(activate).toHaveBeenCalledWith('org-1', {acknowledge: true});
    });

    test('a recoverable failure shows the canonical sentences and Tentar novamente calls retryPreparation', async () => {
      seedDocument([
        organizacao({
          estado: 'falha_recuperavel',
          materializacao: {
            monitoramento: etapa({
              etapa: 'verificado',
              projectId: 'proj-m-1',
              template: {versao: '1', hash: 'm'},
            }),
            alertas: etapa({etapa: 'criado', projectId: 'proj-a-1'}),
          },
          ultimoErro: {
            codigo: 'preparation-failed',
            area: 'alertas',
            ocorridoEm: '2026-09-15T00:00:00.000Z',
          },
        }),
      ]);
      const user = userEvent.setup();
      await renderScreen();

      expect(
        screen.getByText('Could not finish creating the organization.'),
      ).toBeOnTheScreen();
      expect(
        screen.getByText(
          'What was already prepared is saved. Try again to finish.',
        ),
      ).toBeOnTheScreen();
      // The failed area is named; the verified one stays Ready.
      expect(screen.getByText('Monitoring')).toBeOnTheScreen();
      expect(screen.getAllByText('Ready')).toHaveLength(1);
      expect(screen.getByText('Alerts')).toBeOnTheScreen();
      expect(screen.getByText('Not completed')).toBeOnTheScreen();

      await user.press(
        screen.getByTestId('ORG.provisioning-retry-preparation-btn'),
      );

      expect(retryPreparation).toHaveBeenCalledTimes(1);
      expect(retryPreparation).toHaveBeenCalledWith('org-1');
      expect(activate).not.toHaveBeenCalled();
    });

    test('preparando shows one row per area with the right states and no buttons', async () => {
      seedDocument([
        organizacao({
          estado: 'preparando',
          materializacao: {
            monitoramento: etapa({etapa: 'criado', projectId: 'proj-m-1'}),
            alertas: etapa({etapa: 'ausente'}),
          },
        }),
      ]);
      await renderScreen();

      expect(
        screen.getByText('Preparing your organization…'),
      ).toBeOnTheScreen();
      expect(screen.getByText('Monitoring')).toBeOnTheScreen();
      expect(screen.getByText('Preparing')).toBeOnTheScreen();
      expect(screen.getByText('Alerts')).toBeOnTheScreen();
      expect(screen.getByText('Waiting')).toBeOnTheScreen();
      // SPEC A §4.2:210 — while preparing, the screen has NO buttons at all.
      expect(
        screen.queryByTestId('ORG.provisioning-open-organization-btn'),
      ).not.toBeOnTheScreen();
      expect(
        screen.queryByTestId('ORG.provisioning-retry-preparation-btn'),
      ).not.toBeOnTheScreen();
      expect(
        screen.queryByTestId('ORG.provisioning-retry-activation-btn'),
      ).not.toBeOnTheScreen();
    });
  });

  // Multi-organization document (comportamento 5): A settled, ready and
  // acknowledged FIRST, B still `preparando` behind it. The content
  // authority is the organization in preparation — the rows are B's own
  // journal, never the settled first entry's.
  describe('multi-organization document', () => {
    test("renders the preparing organization's area rows, not the settled first one's", async () => {
      seedDocument([
        organizacao({
          estado: 'pronta',
          confirmacaoPendente: false,
          materializacao: PAR_PRONTA,
        }),
        organizacao({
          id: 'org-2',
          nome: 'Segunda',
          estado: 'preparando',
          materializacao: {
            monitoramento: etapa({etapa: 'criado', projectId: 'proj-m-2'}),
            alertas: etapa({etapa: 'ausente'}),
          },
        }),
      ]);
      await renderScreen();

      expect(
        screen.getByText('Preparing your organization…'),
      ).toBeOnTheScreen();
      // B's rows: one preparing, one waiting.
      expect(screen.getByText('Monitoring')).toBeOnTheScreen();
      expect(screen.getByText('Preparing')).toBeOnTheScreen();
      expect(screen.getByText('Alerts')).toBeOnTheScreen();
      expect(screen.getByText('Waiting')).toBeOnTheScreen();
      // Never A's settled "Ready" rows.
      expect(screen.queryAllByText('Ready')).toHaveLength(0);
    });
  });

  // Fail-closed open states (SPEC B §4.4 table row "Organização indisponível"):
  // the document is settled ('pronta', acknowledged) but the activation engine
  // refused to open it — the screen must say so and offer Tentar novamente
  // through the engine.
  describe('open organization failed (recovery / unavailable)', () => {
    const prontaAtiva = {
      organizacao: organizacao({
        estado: 'pronta',
        confirmacaoPendente: false,
        materializacao: PAR_PRONTA,
      }),
      ativa: {organizacaoId: 'org-1', area: 'monitoramento'} as const,
    };

    test.each([
      ['recovery', 'access-unavailable'],
      ['unavailable', 'unavailable'],
    ] as const)(
      'status %s shows the unavailable copy and Tentar novamente reactivates with the document area',
      async (status, error) => {
        seedDocument([prontaAtiva.organizacao], prontaAtiva.ativa);
        activationMock.__setActivation({
          status,
          error,
          activate,
          retryPreparation,
          recoverPendingWork,
        });
        const user = userEvent.setup();
        await renderScreen();

        expect(
          screen.getByText('Could not open your organization'),
        ).toBeOnTheScreen();
        // The failed open is not the confirmation (no Abrir organização)
        // and not a preparation retry.
        expect(
          screen.queryByTestId('ORG.provisioning-open-organization-btn'),
        ).not.toBeOnTheScreen();
        expect(
          screen.queryByTestId('ORG.provisioning-retry-preparation-btn'),
        ).not.toBeOnTheScreen();

        await user.press(
          screen.getByTestId('ORG.provisioning-retry-activation-btn'),
        );
        expect(activate).toHaveBeenCalledTimes(1);
        expect(activate).toHaveBeenCalledWith('org-1', {area: 'monitoramento'});
        expect(retryPreparation).not.toHaveBeenCalled();
      },
    );

    test('a double tap on Tentar novamente produces ONE activate call', async () => {
      seedDocument([prontaAtiva.organizacao], prontaAtiva.ativa);
      // Hold the call in flight until the test releases it: the second tap
      // must land while the first is still running.
      let releaseActivate: (value: boolean) => void = () => {};
      activate.mockImplementation(
        () =>
          new Promise<boolean>(resolve => {
            releaseActivate = resolve;
          }),
      );
      activationMock.__setActivation({
        status: 'recovery',
        error: 'access-unavailable',
        activate,
        retryPreparation,
        recoverPendingWork,
      });
      const user = userEvent.setup();
      await renderScreen();

      const buttonTestId = 'ORG.provisioning-retry-activation-btn';
      await user.press(screen.getByTestId(buttonTestId));
      // The call is in flight: the ref guard disables the button itself.
      expect(screen.getByTestId(buttonTestId)).toBeDisabled();
      await user.press(screen.getByTestId(buttonTestId));
      releaseActivate(true);
      await waitFor(() => {
        expect(screen.getByTestId(buttonTestId)).toBeEnabled();
      });

      expect(activate).toHaveBeenCalledTimes(1);
      expect(activate).toHaveBeenCalledWith('org-1', {area: 'monitoramento'});
    });
  });

  // Blocked boot (SPEC A §4.4:149 canonical pending-work string, CA15): the
  // engine published 'unavailable' + 'pending-work' with the origin preserved.
  // The §4.4 string is the content, and reopening the origin is what
  // concludes the work — the screen asks the engine, it does not fabricate
  // its own path back.
  describe('pending-work', () => {
    test('shows the §4.4 string and calls recoverPendingWork', async () => {
      seedDocument(
        [
          organizacao({
            estado: 'pronta',
            confirmacaoPendente: false,
            materializacao: PAR_PRONTA,
          }),
        ],
        {organizacaoId: 'org-1', area: 'monitoramento'},
      );
      activationMock.__setActivation({
        status: 'unavailable',
        error: 'pending-work',
        activate,
        retryPreparation,
        recoverPendingWork,
      });
      await renderScreen();

      expect(
        screen.getByText(
          'Finish or discard the record before switching organization',
        ),
      ).toBeOnTheScreen();
      expect(recoverPendingWork).toHaveBeenCalledTimes(1);
      // No manual reactivation on this state: the work origin is the only
      // exit and the engine owns it.
      expect(
        screen.queryByTestId('ORG.provisioning-retry-activation-btn'),
      ).not.toBeOnTheScreen();
    });
  });

  // SPEC B §3.2:68 — after 30 s in preparando the screen says so and NEVER
  // retries: a presentation timeout does not cancel a native operation, so
  // time alone must not authorize another call.
  describe('slow preparation notice', () => {
    test('after 30 s the notice shows and no retry is ever fired', async () => {
      seedDocument([organizacao({estado: 'preparando'})]);
      jest.useFakeTimers();
      try {
        await renderScreen();

        await act(async () => {
          jest.advanceTimersByTime(29_999);
        });
        expect(screen.queryByText(SLOW_NOTICE)).not.toBeOnTheScreen();

        await act(async () => {
          jest.advanceTimersByTime(1);
        });
        expect(screen.getByText(SLOW_NOTICE)).toBeOnTheScreen();

        // Far past the notice: still shown, still no call.
        await act(async () => {
          jest.advanceTimersByTime(300_000);
        });
        expect(screen.getByText(SLOW_NOTICE)).toBeOnTheScreen();
        expect(retryPreparation).not.toHaveBeenCalled();
        expect(activate).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    test('leaving preparando hides the notice and re-entering restarts the wait', async () => {
      seedDocument([organizacao({estado: 'preparando'})]);
      jest.useFakeTimers();
      try {
        await renderScreen();
        await act(async () => {
          jest.advanceTimersByTime(30_000);
        });
        expect(screen.getByText(SLOW_NOTICE)).toBeOnTheScreen();

        await act(async () => {
          seedDocument([organizacao({estado: 'falha_recuperavel'})]);
        });
        expect(screen.queryByText(SLOW_NOTICE)).not.toBeOnTheScreen();

        // A fresh wait: nothing before the new 30 s.
        await act(async () => {
          seedDocument([organizacao({estado: 'preparando'})]);
        });
        await act(async () => {
          jest.advanceTimersByTime(29_999);
        });
        expect(screen.queryByText(SLOW_NOTICE)).not.toBeOnTheScreen();
        await act(async () => {
          jest.advanceTimersByTime(1);
        });
        expect(screen.getByText(SLOW_NOTICE)).toBeOnTheScreen();
      } finally {
        jest.useRealTimers();
      }
    });
  });

  // SPEC B §3.2:64/:68 (Fase 5, fix round 2): the hold is the SPEC's own
  // narrow one. §3.2 authorizes the block ONLY "durante uma chamada de
  // criação/importação" — an organization exactly in `preparando` — and
  // only for the user's exits: "bloquear a saída pelo cabeçalho, gesto e
  // botão Voltar do Android". A recoverable failure is NOT a call in
  // flight ("Após uma falha, manter a tela de recuperação e permitir sair
  // do app pelo sistema") and neither is a pending confirmation ("Antes de
  // confirmar, voltar é permitido") — Back passes in both, so the repair
  // banner's entry (a failure behind a ready organization) never traps the
  // user. Programmatic removals are not user exits: the generation gate's
  // RESET is the system's mandatory routing (§5.5's recovery table) and
  // passes untouched — a prevented RESET is consumed-and-dropped, since
  // the gate advances its generation before dispatching and never retries.
  describe('back lock', () => {
    /**
     * Dispatches a synthetic beforeRemove event at the screen's active
     * listener. No listener registered means the screen intercepts nothing:
     * the returned spy can then only be "not called" — so the
     * `not.toHaveBeenCalled()` passing-through pins are valid, but they
     * would also pass vacuously against a listener that registered and
     * ignored the event; the navigator-level RESET pin below is what
     * proves a dispatch actually lands.
     */
    function preventBeforeRemove(actionType: string) {
      const live = navigationSubscriptions.filter(
        subscription =>
          subscription.event === 'beforeRemove' && subscription.active,
      );
      const listener = live.at(-1)?.listener as
        | ((e: {
            data: {action: {type: string}};
            preventDefault: () => void;
          }) => void)
        | undefined;
      const preventDefault = jest.fn();
      if (!listener) return preventDefault;
      listener({data: {action: {type: actionType}}, preventDefault});
      return preventDefault;
    }

    test('back is prevented while preparando', async () => {
      seedDocument([organizacao({estado: 'preparando'})]);
      await renderScreen();

      // Android hardware back is consumed.
      expect(backHandlerMock.default.addEventListener).toHaveBeenCalledTimes(1);
      expect(backHandlerMock.__live).toHaveLength(1);
      const [backEvent, backHandler] =
        backHandlerMock.default.addEventListener.mock.calls[0];
      expect(backEvent).toBe('hardwareBackPress');
      expect(backHandler()).toBe(true);

      // A back attempt is answered with prevention and the explanation…
      await act(async () => {
        expect(preventBeforeRemove('GO_BACK')).toHaveBeenCalled();
      });
      expect(screen.getByText(BACK_BLOCKED)).toBeOnTheScreen();
      await act(async () => {
        expect(preventBeforeRemove('POP')).toHaveBeenCalled();
      });
      // …while a programmatic RESET (the generation gate's system routing)
      // passes untouched — preventing it would consume-and-drop the gate's
      // only dispatch.
      expect(preventBeforeRemove('RESET')).not.toHaveBeenCalled();
    });

    test('a blocked back attempt explains itself and clears when the operation settles', async () => {
      seedDocument([organizacao({estado: 'preparando'})]);
      await renderScreen();
      expect(screen.queryByText(BACK_BLOCKED)).not.toBeOnTheScreen();

      await act(async () => {
        preventBeforeRemove('GO_BACK');
      });
      expect(screen.getByText(BACK_BLOCKED)).toBeOnTheScreen();

      await act(async () => {
        seedDocument([
          organizacao({
            estado: 'pronta',
            confirmacaoPendente: false,
            materializacao: PAR_PRONTA,
          }),
        ]);
      });
      expect(screen.queryByText(BACK_BLOCKED)).not.toBeOnTheScreen();
    });

    test('leaving the in-preparation document removes the hardware-back consumption', async () => {
      seedDocument([organizacao({estado: 'preparando'})]);
      await renderScreen();
      expect(backHandlerMock.__live).toHaveLength(1);

      // §3.2: a persisted failure is not a call in flight — the recovery
      // screen must "permitir sair do app pelo sistema".
      await act(async () => {
        seedDocument([organizacao({estado: 'falha_recuperavel'})]);
      });
      expect(backHandlerMock.__live).toHaveLength(0);
      expect(preventBeforeRemove('GO_BACK')).not.toHaveBeenCalled();
    });

    test.each([
      [
        'a recoverable failure — not a call in flight, §3.2 lets the user leave',
        () => seedDocument([organizacao({estado: 'falha_recuperavel'})]),
      ],
      [
        'a pending confirmation — "antes de confirmar, voltar é permitido"',
        () =>
          seedDocument([
            organizacao({
              estado: 'pronta',
              confirmacaoPendente: true,
              materializacao: PAR_PRONTA,
            }),
          ]),
      ],
      [
        'a recoverable failure behind a ready organization — the repair banner entry',
        () =>
          seedDocument([
            organizacao({
              estado: 'pronta',
              confirmacaoPendente: false,
              materializacao: PAR_PRONTA,
            }),
            organizacao({
              id: 'org-2',
              nome: 'Segunda',
              estado: 'falha_recuperavel',
            }),
          ]),
      ],
      [
        'an unavailable settled organization',
        () => {
          seedDocument(
            [
              organizacao({
                estado: 'pronta',
                confirmacaoPendente: false,
                materializacao: PAR_PRONTA,
              }),
            ],
            {organizacaoId: 'org-1', area: 'monitoramento'},
          );
          activationMock.__setActivation({
            status: 'unavailable',
            error: 'unavailable',
            activate,
            retryPreparation,
            recoverPendingWork,
          });
        },
      ],
      [
        'a pending-work blocked boot',
        () => {
          seedDocument(
            [
              organizacao({
                estado: 'pronta',
                confirmacaoPendente: false,
                materializacao: PAR_PRONTA,
              }),
            ],
            {organizacaoId: 'org-1', area: 'monitoramento'},
          );
          activationMock.__setActivation({
            status: 'unavailable',
            error: 'pending-work',
            activate,
            retryPreparation,
            recoverPendingWork,
          });
        },
      ],
      ['a missing document', () => {}],
    ] as Array<[string, () => void]>)(
      'back is not blocked while there is %s',
      async (_label, seed) => {
        seed();
        await renderScreen();

        expect(backHandlerMock.default.addEventListener).not.toHaveBeenCalled();
        // The screen's listener is registered only while a call is in
        // flight; with none, nothing answers a back attempt with
        // prevention.
        expect(preventBeforeRemove('GO_BACK')).not.toHaveBeenCalled();
      },
    );
  });

  // B5-4 (fix round 2): the generation gate's RESET is the system's own
  // routing (SPEC B §5.5's recovery table, §3.3's ordered routing) — a
  // prevented reset is consumed-and-dropped because the gate advances its
  // generation before dispatching and never retries. Pinned at the
  // navigator level with the REAL PreventRemoveProvider: a RESET dispatch
  // (the exact shape GenerationTransitionGate sends in
  // Navigation/Stack/index.tsx) that removes the held screen must LAND.
  describe('navigator-level reset passes the hold (GenerationTransitionGate)', () => {
    const NavStack = createNativeStackNavigator<AppStackParamsList>();
    const navigationRef = createNavigationContainerRef<AppStackParamsList>();
    const HomeStub = () => <Text>HOME-REACHED</Text>;

    test('a system reset removes the held screen and lands on its destination', async () => {
      seedDocument([organizacao({estado: 'preparando'})]);
      await render(
        <IntlProvider locale="en" messages={{}}>
          <CoiabOrganizationsStoreProvider store={store}>
            <NavigationContainer ref={navigationRef}>
              <NavStack.Navigator initialRouteName="OrganizationProvisioning">
                <NavStack.Screen name="Home" component={HomeStub} />
                <NavStack.Screen
                  name="OrganizationProvisioning"
                  component={OrganizationProvisioning}
                />
              </NavStack.Navigator>
            </NavigationContainer>
          </CoiabOrganizationsStoreProvider>
        </IntlProvider>,
      );
      await screen.findByText('Preparing your organization…');

      await act(async () => {
        navigationRef.reset({index: 0, routes: [{name: 'Home'}]});
      });

      expect(screen.getByText('HOME-REACHED')).toBeOnTheScreen();
      expect(
        screen.queryByText('Preparing your organization…'),
      ).not.toBeOnTheScreen();
    });
  });

  // BLOCKER B1 (review 7b1a023d): the Fase 4 handover navigates here the
  // moment A is ready AND operating — the engine never unpublishes its
  // 'ready' status when B enters preparation, and both ids resolve A. The
  // surviving hop must not read that pair as "go Home" while the document
  // still holds an un-settled organization: the surface owns B's
  // preparation (§4.2 content authority — Fase 3 already renders it).
  describe('second-creation handover (BLOCKER B1)', () => {
    test('a ready-and-operating A with B still preparing does NOT reset to Home', async () => {
      seedDocument(
        [
          organizacao({
            estado: 'pronta',
            confirmacaoPendente: false,
            materializacao: PAR_PRONTA,
          }),
          organizacao({
            id: 'org-2',
            nome: 'Segunda',
            estado: 'preparando',
            materializacao: {
              monitoramento: etapa({etapa: 'criado', projectId: 'proj-m-2'}),
              alertas: etapa({etapa: 'ausente'}),
            },
          }),
        ],
        {organizacaoId: 'org-1', area: 'monitoramento'},
      );
      activationMock.__setActivation({
        status: 'ready',
        activate,
        retryPreparation,
        recoverPendingWork,
      });
      // Both the projected id and the document's derivation resolve A.
      activeProjectIdMock.__projetarProjectIdAtivo('proj-m-1');
      await renderScreen();

      // The surface stays the owner of B's preparation…
      expect(
        screen.getByText('Preparing your organization…'),
      ).toBeOnTheScreen();
      // …so the validated pair (ready + matching ids) must not bounce Home.
      expect(navigationReset).not.toHaveBeenCalled();
    });
  });

  // Review fronteira P1: a `preparando` document with NO materialization
  // alive in this session was interrupted (the process died mid-preparation).
  // The surface is never a buttonless spinner: it offers the resume, lets
  // Back through, and — with another organization operating — the way back.
  describe('interrupted preparation (review fronteira P1)', () => {
    const operandoAComBPreparando = () => {
      seedDocument(
        [
          organizacao({
            estado: 'pronta',
            confirmacaoPendente: false,
            materializacao: PAR_PRONTA,
          }),
          organizacao({id: 'org-2', nome: 'Segunda', estado: 'preparando'}),
        ],
        {organizacaoId: 'org-1', area: 'monitoramento'},
      );
      activeProjectIdMock.__projetarProjectIdAtivo('proj-m-1');
    };

    test('without a live call the surface offers the resume and does not hold Back', async () => {
      seedDocument([organizacao({estado: 'preparando'})]);
      activationMock.__setActivation({
        activate,
        retryPreparation,
        recoverPendingWork,
        preparacaoViva: false,
      });
      const user = userEvent.setup();
      await renderScreen();

      expect(
        screen.getByText('Preparing your organization…'),
      ).toBeOnTheScreen();
      expect(
        screen.queryByLabelText('Preparing your organization'),
      ).not.toBeOnTheScreen();
      expect(backHandlerMock.default.addEventListener).not.toHaveBeenCalled();
      expect(
        navigationSubscriptions.filter(
          subscription =>
            subscription.event === 'beforeRemove' && subscription.active,
        ),
      ).toHaveLength(0);
      // No other organization operates: there is nowhere to go back to.
      expect(
        screen.queryByTestId('ORG.provisioning-back-to-active-btn'),
      ).not.toBeOnTheScreen();

      await user.press(
        screen.getByTestId('ORG.provisioning-retry-preparation-btn'),
      );
      expect(retryPreparation).toHaveBeenCalledTimes(1);
      expect(retryPreparation).toHaveBeenCalledWith('org-1');
    });

    test('with A operating, Back returns to A without touching B', async () => {
      operandoAComBPreparando();
      activationMock.__setActivation({
        status: 'ready',
        activate,
        retryPreparation,
        recoverPendingWork,
        preparacaoViva: false,
      });
      const user = userEvent.setup();
      await renderScreen();

      await user.press(
        screen.getByTestId('ORG.provisioning-back-to-active-btn'),
      );
      expect(navigationPopTo).toHaveBeenCalledWith('Home', {screen: 'Map'});
      expect(navigationReset).not.toHaveBeenCalled();
      expect(retryPreparation).not.toHaveBeenCalled();
      expect(activate).not.toHaveBeenCalled();
    });

    test('while the call is alive there is no exit and no resume', async () => {
      operandoAComBPreparando();
      activationMock.__setActivation({
        status: 'ready',
        activate,
        retryPreparation,
        recoverPendingWork,
        preparacaoViva: true,
      });
      await renderScreen();

      expect(
        screen.getByLabelText('Preparing your organization'),
      ).toBeOnTheScreen();
      expect(
        screen.queryByTestId('ORG.provisioning-back-to-active-btn'),
      ).not.toBeOnTheScreen();
      expect(
        screen.queryByTestId('ORG.provisioning-retry-preparation-btn'),
      ).not.toBeOnTheScreen();
      expect(backHandlerMock.__live).toHaveLength(1);
    });
  });

  // The reset's original contract (first accept/activation): a document with
  // ONLY a settled, acknowledged organization — no preparation anywhere —
  // still opens Home through the validated pair. BLOCKER B1's gate must not
  // kill this path.
  describe('settled-document Home reset (first-accept contract)', () => {
    test('a ready-and-operating settled document with no preparation resets to Home', async () => {
      seedDocument(
        [
          organizacao({
            estado: 'pronta',
            confirmacaoPendente: false,
            materializacao: PAR_PRONTA,
          }),
        ],
        {organizacaoId: 'org-1', area: 'monitoramento'},
      );
      activationMock.__setActivation({
        status: 'ready',
        activate,
        retryPreparation,
        recoverPendingWork,
      });
      activeProjectIdMock.__projetarProjectIdAtivo('proj-m-1');
      await renderScreen();

      expect(navigationReset).toHaveBeenCalledTimes(1);
      expect(navigationReset).toHaveBeenCalledWith({
        index: 0,
        routes: [{name: 'Home'}],
      });
    });

    test('a mismatched projected id never validates the reset', async () => {
      seedDocument(
        [
          organizacao({
            estado: 'pronta',
            confirmacaoPendente: false,
            materializacao: PAR_PRONTA,
          }),
        ],
        {organizacaoId: 'org-1', area: 'monitoramento'},
      );
      activationMock.__setActivation({
        status: 'ready',
        activate,
        retryPreparation,
        recoverPendingWork,
      });
      activeProjectIdMock.__projetarProjectIdAtivo('proj-other');
      await renderScreen();

      expect(navigationReset).not.toHaveBeenCalled();
    });
  });
});
