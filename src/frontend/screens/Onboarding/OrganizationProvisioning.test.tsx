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
const navigationAddListener: jest.Mock = jest.fn(() => () => {});
const screenProps = {
  navigation: {reset: navigationReset, addListener: navigationAddListener},
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
        <OrganizationProvisioning {...screenProps} />
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

beforeEach(() => {
  jest.clearAllMocks();
  store = createCoiabOrganizationsStore({persist: false});
  activate.mockResolvedValue(true);
  retryPreparation.mockResolvedValue(true);
  recoverPendingWork.mockResolvedValue(false);
  activationMock.__setActivation({
    activate,
    retryPreparation,
    recoverPendingWork,
  });
  activeProjectIdMock.__projetarProjectIdAtivo(undefined);
  backHandlerMock.__live.length = 0;
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

  // SPEC B §3.2:64/:68 (consult Phase 12:315): while preparando, Back is
  // blocked at every layer. In any other state the user leaves normally —
  // the 10b-i states' own exits must stay untouched.
  describe('back lock', () => {
    /** Dispatches a synthetic beforeRemove event at the active listener. */
    function preventBeforeRemove(actionType: string) {
      const registrations = navigationAddListener.mock.calls.filter(
        ([event]) => event === 'beforeRemove',
      );
      const listener = registrations.at(-1)?.[1] as
        | ((e: {
            data: {action: {type: string}};
            preventDefault: () => void;
          }) => void)
        | undefined;
      if (!listener) {
        throw new Error('no beforeRemove listener registered');
      }
      const preventDefault = jest.fn();
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

      // Back-type removals are prevented…
      expect(preventBeforeRemove('GO_BACK')).toHaveBeenCalled();
      expect(preventBeforeRemove('POP')).toHaveBeenCalled();
      // …while the screen's own Home reset passes untouched.
      expect(preventBeforeRemove('RESET')).not.toHaveBeenCalled();
    });

    test('leaving preparando removes the hardware-back consumption', async () => {
      seedDocument([organizacao({estado: 'preparando'})]);
      await renderScreen();
      expect(backHandlerMock.__live).toHaveLength(1);

      await act(async () => {
        seedDocument([organizacao({estado: 'falha_recuperavel'})]);
      });
      expect(backHandlerMock.__live).toHaveLength(0);
    });

    test.each([
      [
        'a recoverable failure',
        () => seedDocument([organizacao({estado: 'falha_recuperavel'})]),
      ],
      [
        'a pending confirmation',
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

        expect(
          navigationAddListener.mock.calls.filter(
            ([event]) => event === 'beforeRemove',
          ),
        ).toHaveLength(0);
        expect(backHandlerMock.default.addEventListener).not.toHaveBeenCalled();
      },
    );
  });
});
