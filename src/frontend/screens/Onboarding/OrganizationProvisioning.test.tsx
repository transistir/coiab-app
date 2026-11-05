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
import {PendingArchiveResume} from '../../hooks/organization/usePendingArchiveResume';
import {
  CoiabOrganizationsStoreProvider,
  createCoiabOrganizationsStore,
  type CoiabOrganizationsStore,
} from '../../contexts/CoiabOrganizationsStoreContext';
import {
  createEarlyAccessStore,
  EarlyAccessStoreProvider,
  type EarlyAccessStore,
} from '../../contexts/EarlyAccessContext';
import {
  criarEtapaAreaAusente,
  type EstadoOrganizacoes,
  type EtapaArea,
  type OrganizacaoLocal,
} from '../../lib/organization/coiabOrganizations';
import {
  createUserProfileStore,
  UserProfileStoreProvider,
  type PendingArchiveIntent,
  type UserProfileStore,
} from '../../contexts/UserProfileStoreContext';

jest.mock('../../hooks/organization/useAddRemoteArchiveToOrganization', () => ({
  useAddRemoteArchiveToOrganization: jest.fn(),
}));

const archiveStart: jest.Mock = jest.fn(async () => ({error: undefined}));
const useArchiveMock = jest.requireMock(
  '../../hooks/organization/useAddRemoteArchiveToOrganization',
) as {useAddRemoteArchiveToOrganization: jest.Mock};

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
/** The recovery exits (89 fase 2, D2): selector and creation intro. */
const navigationNavigate = jest.fn();
const navigationMock = {
  reset: navigationReset,
  popTo: navigationPopTo,
  navigate: navigationNavigate,
  addListener: navigationAddListener,
  // The Home-reset hold (P2-3) reads the stack: this screen alone.
  getState: () => ({
    index: 0,
    routes: [
      {key: 'OrganizationProvisioning', name: 'OrganizationProvisioning'},
    ],
  }),
  // The context provider's value type (NavigationProp) requires the full
  // helper surface; the stub's contract is the calls the screen makes.
} as unknown as NavigationProp<ParamListBase>;
const screenProps = {
  navigation: navigationMock,
  route: {
    key: 'OrganizationProvisioning',
    name: 'OrganizationProvisioning',
    // #129/P1-A: the route carries the intent created by the navigation that
    // reached this screen; only that intent may be pinned.
    params: {intentId: 'intent-1'},
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
/** #129: the pending remote-archive URL lives in the local profile. */
let profileStore: UserProfileStore;
/** The early-access gate the new recovery exits read (89 fase 2, D1). */
let earlyAccess: EarlyAccessStore;

/**
 * The screen reads the document and the activation handle; nothing else.
 * No navigator: the screen does not navigate — routing belongs to the
 * startup gate and the generation rule, tested at the navigator level.
 */
function ProvisioningHarness({showScreen}: {showScreen: boolean}) {
  return (
    <IntlProvider locale="en" messages={{}}>
      <EarlyAccessStoreProvider value={earlyAccess}>
        <CoiabOrganizationsStoreProvider store={store}>
          <UserProfileStoreProvider store={profileStore}>
            <PendingArchiveResume />
            {showScreen ? (
              <NavigationContext.Provider value={navigationMock}>
                <NavigationRouteContext.Provider value={screenProps.route}>
                  <OrganizationProvisioning {...screenProps} />
                </NavigationRouteContext.Provider>
              </NavigationContext.Provider>
            ) : (
              <Text>NO-PROVISIONING</Text>
            )}
          </UserProfileStoreProvider>
        </CoiabOrganizationsStoreProvider>
      </EarlyAccessStoreProvider>
    </IntlProvider>
  );
}

async function renderScreen(showScreen = true) {
  const result = await render(<ProvisioningHarness showScreen={showScreen} />);
  return {
    ...result,
    setScreen: (show: boolean) =>
      result.rerender(<ProvisioningHarness showScreen={show} />),
  };
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

/** A second ready pair: the §4.2 parser rejects duplicate projectIds. */
const PAR_PRONTA_B: OrganizacaoLocal['materializacao'] = {
  monitoramento: etapa({
    etapa: 'verificado',
    projectId: 'proj-m-2',
    template: {versao: '1', hash: 'm'},
  }),
  alertas: etapa({
    etapa: 'verificado',
    projectId: 'proj-a-2',
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
  'You cannot leave this screen while a territory operation is in progress.';

beforeEach(() => {
  jest.clearAllMocks();
  store = createCoiabOrganizationsStore({persist: false});
  profileStore = createUserProfileStore();
  archiveStart.mockImplementation(async () => ({error: undefined}));
  useArchiveMock.useAddRemoteArchiveToOrganization.mockReturnValue({
    start: archiveStart,
    busy: false,
    progress: {monitoramento: 'idle', alertas: 'idle'},
    reset: jest.fn(),
  });
  // Early access OFF by default (production's default): since f12641db
  // neither the drawer nor this surface gates its organization exits, so
  // every exit asserted below proves the flag is irrelevant. S2 turns it ON
  // to show the same result either way.
  earlyAccess = createEarlyAccessStore({persist: false});
  earlyAccess.actions.setEarlyAccessEnabled(false);
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

      expect(screen.getByText('Territory created')).toBeOnTheScreen();
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
        screen.getByText('Could not finish creating the territory.'),
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

      expect(screen.getByText('Preparing your territory…')).toBeOnTheScreen();
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
  describe('pending remote archive URL (#129/P1)', () => {
    /** Seeds one intent; the default is the one THIS route owns, pinned. */
    function seedIntent(overrides: Partial<PendingArchiveIntent> = {}) {
      profileStore.actions.addPendingArchiveIntent({
        id: 'intent-1',
        url: 'https://exemplo.org/',
        organizationId: 'org-1',
        createdAt: Date.now(),
        sendingSince: null,
        appliedFor: null,
        ...overrides,
      });
    }

    test('a pinned intent is applied to BOTH slots once and removed', async () => {
      seedIntent();
      seedDocument([
        organizacao({
          estado: 'falha_recuperavel',
          materializacao: PAR_PRONTA,
        }),
      ]);

      await renderScreen();

      await waitFor(() => {
        expect(archiveStart).toHaveBeenCalledWith({
          slots: {m: 'proj-m-1', a: 'proj-a-1'},
          baseUrl: 'https://exemplo.org/',
        });
      });
      await waitFor(() => {
        expect(profileStore.instance.getState().pendingArchives).toStrictEqual(
          [],
        );
      });
      expect(archiveStart).toHaveBeenCalledTimes(1);
    });

    test('the provisioning surface pins ONLY the intent named by the route', async () => {
      seedIntent({organizationId: null});
      // A sibling intent is NOT this route's: it must stay orphan.
      seedIntent({
        id: 'intent-outro',
        url: 'https://outro.example/',
        organizationId: null,
      });
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

      await waitFor(() => {
        expect(
          profileStore.instance
            .getState()
            .pendingArchives.find(intent => intent.id === 'intent-1'),
        ).toMatchObject({
          url: 'https://exemplo.org/',
          organizationId: 'org-1',
          appliedFor: null,
        });
      });
      expect(
        profileStore.instance
          .getState()
          .pendingArchives.find(intent => intent.id === 'intent-outro')
          ?.organizationId,
      ).toBeNull();
      // Only one slot exists: the target is fixed but nothing is sent yet.
      expect(archiveStart).not.toHaveBeenCalled();
    });

    test('a failed pin retries only the captured organization and drops the intent when it leaves the document (P1-A)', async () => {
      seedIntent({organizationId: null});
      // Every pin write fails: the intent stays orphan, which is exactly the
      // window where a retry could otherwise resolve a NEW `preparando` org.
      const pin = jest
        .spyOn(profileStore.actions, 'updatePendingArchiveIntent')
        .mockImplementation(() => {
          throw new Error('disk full');
        });
      try {
        seedDocument([
          organizacao({
            id: 'org-1',
            estado: 'preparando',
            materializacao: PAR_PRONTA,
          }),
        ]);

        await renderScreen();
        await waitFor(() => {
          expect(pin).toHaveBeenCalledWith('intent-1', {
            organizationId: 'org-1',
          });
        });

        // The captured organization leaves the document; a different one
        // enters `preparando`.
        await act(async () => {
          seedDocument([
            organizacao({
              id: 'org-2',
              estado: 'preparando',
              materializacao: PAR_PRONTA_B,
            }),
          ]);
        });

        // The intent is discarded, never retargeted.
        await waitFor(() => {
          expect(
            profileStore.instance.getState().pendingArchives,
          ).toStrictEqual([]);
        });
        expect(pin).not.toHaveBeenCalledWith('intent-1', {
          organizationId: 'org-2',
        });
        expect(archiveStart).not.toHaveBeenCalled();
      } finally {
        pin.mockRestore();
      }
    });

    test('a failed intent removal keeps the captured organization and retries the drop without retargeting (P1-A)', async () => {
      jest.useFakeTimers();
      try {
        seedIntent({organizationId: null});
        // Every pin write fails: the intent stays orphan, the window where a
        // retry could otherwise resolve a NEW `preparando` organization.
        const pin = jest
          .spyOn(profileStore.actions, 'updatePendingArchiveIntent')
          .mockImplementation(() => {
            throw new Error('disk full');
          });
        const removeReal = profileStore.actions.removePendingArchiveIntent;
        let removeFails = true;
        const remove = jest
          .spyOn(profileStore.actions, 'removePendingArchiveIntent')
          .mockImplementation((id: string) => {
            if (removeFails) throw new Error('disk full');
            removeReal(id);
          });
        try {
          seedDocument([
            organizacao({
              id: 'org-1',
              estado: 'preparando',
              materializacao: PAR_PRONTA,
            }),
          ]);

          await renderScreen();
          await act(async () => {
            await Promise.resolve();
          });
          expect(pin).toHaveBeenCalledWith('intent-1', {
            organizationId: 'org-1',
          });

          // The captured organization leaves the document while a different
          // one takes the `preparando` slot, before the intent could be
          // dropped. The drop then fails too.
          await act(async () => {
            seedDocument([
              organizacao({
                id: 'org-2',
                estado: 'preparando',
                materializacao: PAR_PRONTA_B,
              }),
            ]);
          });
          // Two ticks of the existing retry timer: every removal attempt still
          // addresses org-1, so the second organization is never pinned or
          // sent to.
          await act(async () => {
            jest.advanceTimersByTime(1_000);
          });
          await act(async () => {
            jest.advanceTimersByTime(1_000);
          });
          expect(remove).toHaveBeenCalled();
          expect(pin).not.toHaveBeenCalledWith('intent-1', {
            organizationId: 'org-2',
          });
          expect(archiveStart).not.toHaveBeenCalled();
          expect(
            profileStore.instance.getState().pendingArchives,
          ).toStrictEqual([
            expect.objectContaining({id: 'intent-1', organizationId: null}),
          ]);

          // Persistence recovers: the next tick finishes the drop.
          removeFails = false;
          await act(async () => {
            jest.advanceTimersByTime(1_000);
          });
          expect(
            profileStore.instance.getState().pendingArchives,
          ).toStrictEqual([]);
          expect(archiveStart).not.toHaveBeenCalled();
        } finally {
          remove.mockRestore();
          pin.mockRestore();
        }
      } finally {
        jest.useRealTimers();
      }
    });

    test('appliedFor prevents a second application and only finishes the cleanup', async () => {
      seedIntent({appliedFor: 'org-1'});
      seedDocument([
        organizacao({estado: 'preparando', materializacao: PAR_PRONTA}),
      ]);

      await renderScreen();
      await act(async () => {
        await Promise.resolve();
      });

      expect(archiveStart).not.toHaveBeenCalled();
      await waitFor(() => {
        expect(profileStore.instance.getState().pendingArchives).toStrictEqual(
          [],
        );
      });
    });

    test('a known organizationId never falls back to another territory', async () => {
      seedIntent({organizationId: 'org-removida'});
      seedDocument([
        organizacao({
          id: 'org-outra',
          estado: 'preparando',
          materializacao: PAR_PRONTA,
        }),
      ]);

      await renderScreen();
      await act(async () => {
        await Promise.resolve();
      });

      expect(archiveStart).not.toHaveBeenCalled();
      expect(profileStore.instance.getState().pendingArchives).toHaveLength(1);
      expect(profileStore.instance.getState().pendingArchives[0]).toMatchObject(
        {
          url: 'https://exemplo.org/',
          organizationId: 'org-removida',
          appliedFor: null,
        },
      );
    });

    test('a failing add keeps the intent pending and the surface is never blocked', async () => {
      seedIntent();
      archiveStart.mockImplementation(async () => ({
        error: new Error('server unreachable'),
      }));
      seedDocument([
        organizacao({estado: 'preparando', materializacao: PAR_PRONTA}),
      ]);

      await renderScreen();

      await waitFor(() => {
        expect(archiveStart).toHaveBeenCalledTimes(1);
      });
      expect(profileStore.instance.getState().pendingArchives).toHaveLength(1);
      expect(profileStore.instance.getState().pendingArchives[0]).toMatchObject(
        {
          url: 'https://exemplo.org/',
          organizationId: 'org-1',
          appliedFor: null,
        },
      );
      // The pre-send mark is durable, so a remount cannot double-fire.
      expect(
        profileStore.instance.getState().pendingArchives[0]?.sendingSince,
      ).toEqual(expect.any(Number));
      // Fire-and-forget: the preparation surface still renders normally.
      expect(screen.getByText('Preparing your territory…')).toBeOnTheScreen();
    });

    test('unmounting and remounting the provisioning surface mid-flight does not duplicate the call', async () => {
      let releaseStart: (value: {error?: unknown}) => void = () => {};
      archiveStart.mockImplementation(
        () =>
          new Promise(resolve => {
            releaseStart = resolve;
          }),
      );
      seedIntent();
      seedDocument([
        organizacao({estado: 'preparando', materializacao: PAR_PRONTA}),
      ]);

      const view = await renderScreen();

      await waitFor(() => {
        expect(archiveStart).toHaveBeenCalledTimes(1);
      });

      // The screen goes away; the navigator-owned resume hook stays mounted
      // (exactly as in production, where Home remains underneath).
      await act(async () => {
        view.setScreen(false);
      });
      await act(async () => {
        view.setScreen(true);
      });

      expect(archiveStart).toHaveBeenCalledTimes(1);

      await act(async () => {
        releaseStart({error: undefined});
      });
      await waitFor(() => {
        expect(profileStore.instance.getState().pendingArchives).toStrictEqual(
          [],
        );
      });
      expect(archiveStart).toHaveBeenCalledTimes(1);
    });

    test('discards an orphan intent once the organization left preparation (P1-A)', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        seedIntent({
          id: 'intent-orfao',
          organizationId: null,
          createdAt: Date.now() - 120_000,
        });
        // No organization left in `preparando`: the creation that owned this
        // orphan is gone. The URL has no safe target and must be discarded.
        seedDocument([]);

        await renderScreen();

        await waitFor(() => {
          expect(
            profileStore.instance.getState().pendingArchives,
          ).toStrictEqual([]);
        });
        expect(archiveStart).not.toHaveBeenCalled();
        // PII-free: only the opaque intent id is logged.
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('orphan archive intent'),
          {intentId: 'intent-orfao'},
        );
      } finally {
        warn.mockRestore();
      }
    });

    test('an orphan intent is never applied to the current organization in preparation (P1-A)', async () => {
      // This intent was not named by the route, so nothing pins it. The
      // resume hook must not fall back to the `preparando` organization.
      seedIntent({id: 'intent-orfao', organizationId: null});
      seedDocument([
        organizacao({estado: 'preparando', materializacao: PAR_PRONTA}),
      ]);

      await renderScreen();
      await act(async () => {
        await Promise.resolve();
      });

      expect(archiveStart).not.toHaveBeenCalled();
      expect(
        profileStore.instance
          .getState()
          .pendingArchives.find(intent => intent.id === 'intent-orfao')
          ?.organizationId,
      ).toBeNull();
    });

    test('a completion removes only its own intent (A in flight, B created later) (P1-B)', async () => {
      let releaseA: (value: {error?: unknown}) => void = () => {};
      archiveStart.mockImplementationOnce(
        () =>
          new Promise(resolve => {
            releaseA = resolve;
          }),
      );
      seedIntent({id: 'intent-a', organizationId: 'org-1'});
      seedDocument([
        organizacao({estado: 'preparando', materializacao: PAR_PRONTA}),
      ]);

      await renderScreen();
      await waitFor(() => {
        expect(archiveStart).toHaveBeenCalledTimes(1);
      });

      // B is created while A is still in flight and targets another
      // organization (absent from the document, so it is not sent yet).
      await act(async () => {
        profileStore.actions.addPendingArchiveIntent({
          id: 'intent-b',
          url: 'https://b.example/',
          organizationId: 'org-2',
        });
      });

      await act(async () => {
        releaseA({error: undefined});
      });

      await waitFor(() => {
        expect(
          profileStore.instance
            .getState()
            .pendingArchives.map(intent => intent.id),
        ).toEqual(['intent-b']);
      });
      expect(archiveStart).toHaveBeenCalledTimes(1);
    });

    test('a failed completion persistence never resends in the session and persists on retry (P1-C)', async () => {
      let releaseA: (value: {error?: unknown}) => void = () => {};
      archiveStart.mockImplementationOnce(
        () =>
          new Promise(resolve => {
            releaseA = resolve;
          }),
      );
      seedIntent();
      seedDocument([
        organizacao({estado: 'preparando', materializacao: PAR_PRONTA}),
      ]);

      const realSetState = profileStore.instance.setState.bind(
        profileStore.instance,
      );
      let writes = 0;
      const setState = jest
        .spyOn(profileStore.instance, 'setState')
        .mockImplementation((partial, replace) => {
          writes += 1;
          // The pre-send mark (1) succeeds; the FIRST completion write (2)
          // fails; the delayed retry (3+) persists.
          if (writes === 2) throw new Error('disk full');
          realSetState(partial, replace);
        });

      try {
        await renderScreen();
        await waitFor(() => {
          expect(archiveStart).toHaveBeenCalledTimes(1);
        });
        expect(writes).toBe(1);

        await act(async () => {
          releaseA({error: undefined});
        });
        await waitFor(() => {
          expect(writes).toBe(2);
        });
        // In-session: the success is remembered in `appliedIds`, so no
        // second network call happens even though nothing was persisted.
        expect(archiveStart).toHaveBeenCalledTimes(1);

        // The simple delayed retry persists the removal.
        await waitFor(
          () => {
            expect(
              profileStore.instance.getState().pendingArchives,
            ).toStrictEqual([]);
          },
          {timeout: 4000},
        );
        expect(archiveStart).toHaveBeenCalledTimes(1);
      } finally {
        setState.mockRestore();
      }
    });

    test('a send mark older than 60 s is an interrupted attempt and resends once (P1-C)', async () => {
      archiveStart.mockImplementation(async () => ({
        error: new Error('offline'),
      }));
      seedIntent({sendingSince: Date.now() - 61_000});
      seedDocument([
        organizacao({estado: 'preparando', materializacao: PAR_PRONTA}),
      ]);

      await renderScreen();

      await waitFor(() => {
        expect(archiveStart).toHaveBeenCalledTimes(1);
      });
      // The stale mark did not freeze the intent: a fresh mark was written
      // before the single replay.
      expect(
        profileStore.instance.getState().pendingArchives[0]?.sendingSince,
      ).toBeGreaterThan(Date.now() - 10_000);
    });

    test('a fresh sending mark waits for the wake-up after the 60 s window (P2)', async () => {
      jest.useFakeTimers();
      try {
        // Just marked as sent: the window is still open and no store change
        // will ever announce that time passed.
        seedIntent({sendingSince: Date.now()});
        seedDocument([
          organizacao({estado: 'preparando', materializacao: PAR_PRONTA}),
        ]);

        await renderScreen();
        await act(async () => {
          await Promise.resolve();
        });
        expect(archiveStart).not.toHaveBeenCalled();

        // A full window with no store change: still nothing to send.
        await act(async () => {
          jest.advanceTimersByTime(60_000);
        });
        expect(archiveStart).not.toHaveBeenCalled();

        // The next 15 s wake-up re-evaluates and the stale mark allows the
        // single replay.
        await act(async () => {
          jest.advanceTimersByTime(15_000);
        });
        expect(archiveStart).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });

    test('a failed send is retried on the next wake-up after the window, one attempt per cycle (P2)', async () => {
      jest.useFakeTimers();
      try {
        archiveStart.mockImplementation(async () => ({
          error: new Error('offline'),
        }));
        seedIntent();
        seedDocument([
          organizacao({estado: 'preparando', materializacao: PAR_PRONTA}),
        ]);

        await renderScreen();
        await act(async () => {
          await Promise.resolve();
        });
        expect(archiveStart).toHaveBeenCalledTimes(1);

        // Nothing in the store changes after the failure; only the wake-up
        // can advance the stale window. It does not fire inside the window.
        await act(async () => {
          jest.advanceTimersByTime(60_000);
        });
        expect(archiveStart).toHaveBeenCalledTimes(1);

        // The next wake-up retries exactly once.
        await act(async () => {
          jest.advanceTimersByTime(15_000);
        });
        expect(archiveStart).toHaveBeenCalledTimes(2);

        // The retry wrote a fresh mark, so the following wake-up stays quiet:
        // no tight loop.
        await act(async () => {
          jest.advanceTimersByTime(15_000);
        });
        expect(archiveStart).toHaveBeenCalledTimes(2);
      } finally {
        jest.useRealTimers();
      }
    });
  });

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

      expect(screen.getByText('Preparing your territory…')).toBeOnTheScreen();
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
          screen.getByText('Could not open your territory'),
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

    // ——— 89 fase 2: the navigable recovery exit (plan v2 §4, D1/D2) ———

    const segundaPronta = () =>
      organizacao({
        id: 'org-2',
        nome: 'Segunda',
        estado: 'pronta',
        confirmacaoPendente: false,
        materializacao: PAR_PRONTA_B,
      });
    const segundaProntaComConfirmacao = () =>
      organizacao({
        id: 'org-2',
        nome: 'Segunda',
        estado: 'pronta',
        confirmacaoPendente: true,
        materializacao: PAR_PRONTA_B,
      });
    const ativaA = {organizacaoId: 'org-1', area: 'monitoramento'} as const;
    /** Recovery over a settled document: the estado base for the exits. */
    function ativarRecovery(
      status: 'recovery' | 'unavailable' | 'ready',
      error?: string,
    ) {
      activationMock.__setActivation({
        status,
        error,
        activate,
        retryPreparation,
        recoverPendingWork,
      });
    }

    test('S1: shows the ACTIVE organization name, not index 0', async () => {
      seedDocument([segundaPronta(), prontaAtiva.organizacao], ativaA);
      ativarRecovery('recovery', 'unavailable');
      await renderScreen();

      // RED: no name is rendered today (SPEC A §6.2:214 "Nome preservado").
      // GREEN: A's name — never B's (the naive `organizacoes[0]` fallback
      // would show B here).
      expect(
        screen.getByTestId('ORG.provisioning-unavailable-name'),
      ).toHaveTextContent('Primeira');
      expect(screen.queryByText('Segunda')).not.toBeOnTheScreen();
    });

    test('S2: 1 organization, early access ON — Criar yes, Trocar no; Criar navigates to CreateOrganization', async () => {
      seedDocument([prontaAtiva.organizacao], ativaA);
      ativarRecovery('recovery', 'unavailable');
      earlyAccess.actions.setEarlyAccessEnabled(true);
      const user = userEvent.setup();
      await renderScreen();

      // (AC2) One organization: no switch entry.
      expect(
        screen.queryByTestId('ORG.provisioning-switch-organization-btn'),
      ).not.toBeOnTheScreen();
      // The creation exit exists regardless of the early-access flag.
      await user.press(
        screen.getByTestId('ORG.provisioning-create-organization-btn'),
      );
      expect(navigationNavigate).toHaveBeenCalledTimes(1);
      expect(navigationNavigate).toHaveBeenCalledWith('CreateOrganization');
    });

    test('S3: 2 organizations, early access OFF — Trocar navigates to Organizations and Criar to CreateOrganization', async () => {
      seedDocument([prontaAtiva.organizacao, segundaPronta()], ativaA);
      ativarRecovery('recovery', 'unavailable');
      const user = userEvent.setup();
      await renderScreen();

      // Both exits are present with the flag off (production default).
      await user.press(
        screen.getByTestId('ORG.provisioning-switch-organization-btn'),
      );
      expect(navigationNavigate).toHaveBeenCalledWith('Organizations');
      await user.press(
        screen.getByTestId('ORG.provisioning-create-organization-btn'),
      );
      expect(navigationNavigate).toHaveBeenCalledWith('CreateOrganization');
    });

    test('S4: early access OFF — name yes, and creation is still offered', async () => {
      seedDocument([prontaAtiva.organizacao], ativaA);
      ativarRecovery('recovery', 'unavailable');
      earlyAccess.actions.setEarlyAccessEnabled(false);
      await renderScreen();

      expect(
        screen.getByTestId('ORG.provisioning-unavailable-name'),
      ).toHaveTextContent('Primeira');
      // One organization: still no selector.
      expect(
        screen.queryByTestId('ORG.provisioning-switch-organization-btn'),
      ).not.toBeOnTheScreen();
      // Parity with the drawer: creation needs only a resolvable derivation,
      // never early access.
      expect(
        screen.getByTestId('ORG.provisioning-create-organization-btn'),
      ).toBeOnTheScreen();
      expect(
        screen.getByTestId('ORG.provisioning-retry-activation-btn'),
      ).toBeEnabled();
    });

    test('a participant gets no creation exit (P1-1)', async () => {
      seedDocument([prontaAtiva.organizacao], ativaA);
      ativarRecovery('recovery', 'unavailable');
      profileStore.actions.setCoordinationRole('participant');
      await renderScreen();

      expect(
        screen.queryByTestId('ORG.provisioning-create-organization-btn'),
      ).not.toBeOnTheScreen();
      // The other exits are unaffected.
      expect(
        screen.getByTestId('ORG.provisioning-retry-activation-btn'),
      ).toBeOnTheScreen();
    });

    // (T5a) Every non-`indisponivel` state of the surface must stay exactly
    // as it is today — no name, no exits. Guard: green in the base state.
    test.each([
      {
        linha: 'B preparing',
        textoVisivel: undefined,
        montar: () => {
          seedDocument(
            [
              prontaAtiva.organizacao,
              organizacao({id: 'org-2', nome: 'Segunda'}),
            ],
            ativaA,
          );
          // The settled engine state: what keeps the surface closed is the
          // ORGANIZATION still un-settled (B preparing), never the status.
          ativarRecovery('recovery', 'unavailable');
        },
      },
      {
        linha: 'B failed preparation',
        textoVisivel: undefined,
        montar: () => {
          seedDocument(
            [
              prontaAtiva.organizacao,
              organizacao({
                id: 'org-2',
                nome: 'Segunda',
                estado: 'falha_recuperavel',
                ultimoErro: {
                  codigo: 'preparation-failed',
                  area: 'alertas',
                  ocorridoEm: '2026-09-25T00:00:00.000Z',
                },
              }),
            ],
            ativaA,
          );
          // Same settled engine state: B's persisted failure alone closes
          // the surface (the document's un-settled entry, not the status).
          ativarRecovery('recovery', 'unavailable');
        },
      },
      {
        linha: 'B ready with pending confirmation',
        textoVisivel: 'Territory created',
        montar: () => {
          seedDocument(
            [prontaAtiva.organizacao, segundaProntaComConfirmacao()],
            ativaA,
          );
          // And the pending confirmation: recovery/unavailable, yet the
          // `!confirmacaoPendente` clause — not the status — closes it.
          ativarRecovery('recovery', 'unavailable');
        },
      },
      {
        linha: 'unavailable + pending-work',
        textoVisivel: 'Finish or discard the record before switching territory',
        montar: () => {
          seedDocument([prontaAtiva.organizacao, segundaPronta()], ativaA);
          ativarRecovery('unavailable', 'pending-work');
        },
      },
      {
        linha: 'ready (A operating)',
        textoVisivel: undefined,
        montar: () => {
          seedDocument([prontaAtiva.organizacao, segundaPronta()], ativaA);
          ativarRecovery('ready');
        },
      },
    ] as Array<{linha: string; textoVisivel?: string; montar: () => void}>)(
      'outside indisponivel: no name, no exits ($linha)',
      async ({montar, textoVisivel}) => {
        montar();
        // TL-RN's render is async: the module-level `screen` binds only
        // after the act() promise settles.
        await renderScreen();

        // Unconditional on purpose (jest/no-conditional-expect): the row's
        // canonical text is on screen exactly when the row declares one.
        const textoNaTela = textoVisivel
          ? screen.queryByText(textoVisivel)
          : null;
        expect(textoNaTela !== null).toBe(textoVisivel !== undefined);
        expect(
          screen.queryByTestId('ORG.provisioning-unavailable-name'),
        ).not.toBeOnTheScreen();
        expect(
          screen.queryByTestId('ORG.provisioning-switch-organization-btn'),
        ).not.toBeOnTheScreen();
        expect(
          screen.queryByTestId('ORG.provisioning-create-organization-btn'),
        ).not.toBeOnTheScreen();
      },
    );

    // (T5b) The refusal keeps `recovery/pending-work` — `trabalhoPendente`
    // needs `unavailable`, so this still counts as `indisponivel`: the exits
    // must be offered.
    test('S5b: recovery/pending-work stays indisponivel — exits present', async () => {
      seedDocument([prontaAtiva.organizacao, segundaPronta()], ativaA);
      ativarRecovery('recovery', 'pending-work');
      await renderScreen();

      expect(
        screen.getByTestId('ORG.provisioning-unavailable-name'),
      ).toHaveTextContent('Primeira');
      // RED: the exit buttons do not exist today.
      expect(
        screen.getByTestId('ORG.provisioning-switch-organization-btn'),
      ).toBeOnTheScreen();
      expect(
        screen.getByTestId('ORG.provisioning-create-organization-btn'),
      ).toBeOnTheScreen();
      expect(
        screen.getByTestId('ORG.provisioning-retry-activation-btn'),
      ).toBeOnTheScreen();
    });

    // (R3) With the removal sheet above and A ready-and-operating, the
    // surface keeps A's rows and offers no way back: the sheet defers the
    // Home reset, and `operandoOutra` must not fire a second route to A.
    test('S6: removal sheet above + A ready outside index 0 — A rows, no Voltar, no reset', async () => {
      const NavStack = createNativeStackNavigator<AppStackParamsList>();
      const navigationRef = createNavigationContainerRef<AppStackParamsList>();
      const HomeStub = () => <Text>HOME-REACHED</Text>;
      const SheetStub = () => <Text>SHEET-REACHED</Text>;
      seedDocument([segundaPronta(), prontaAtiva.organizacao], ativaA);
      activationMock.__setActivation({
        status: 'ready',
        activate,
        retryPreparation,
        recoverPendingWork,
      });
      activeProjectIdMock.__projetarProjectIdAtivo('proj-m-1');
      await render(
        <IntlProvider locale="en" messages={{}}>
          <EarlyAccessStoreProvider value={earlyAccess}>
            <CoiabOrganizationsStoreProvider store={store}>
              <UserProfileStoreProvider store={profileStore}>
                <NavigationContainer
                  ref={navigationRef}
                  initialState={{
                    index: 1,
                    routes: [
                      {name: 'OrganizationProvisioning'},
                      {
                        name: 'RemovedFromProjectBottomSheet',
                        params: {projectId: 'proj-m-1'},
                      },
                    ],
                  }}>
                  <NavStack.Navigator>
                    {/* Home is REGISTERED so a reset fired during the hold
                  would land somewhere real instead of silently warning —
                  the routes assertion below is what pins the hold. */}
                    <NavStack.Screen name="Home" component={HomeStub} />
                    <NavStack.Screen
                      name="OrganizationProvisioning"
                      component={OrganizationProvisioning}
                    />
                    <NavStack.Screen
                      name="RemovedFromProjectBottomSheet"
                      component={SheetStub}
                      options={{presentation: 'transparentModal'}}
                    />
                  </NavStack.Navigator>
                </NavigationContainer>
              </UserProfileStoreProvider>
            </CoiabOrganizationsStoreProvider>
          </EarlyAccessStoreProvider>
        </IntlProvider>,
      );
      await screen.findByText('SHEET-REACHED');

      // RED today: the content authority is B (index 0), so the screen
      // reads A's rows as "operating another organization" and offers
      // Voltar para a ativa. The sheet makes the screen below aria-hidden,
      // so the query must opt into hidden elements to see it at all.
      expect(
        screen.queryByTestId('ORG.provisioning-back-to-active-btn', {
          includeHiddenElements: true,
        }),
      ).not.toBeOnTheScreen();
      // The hold: with Home a real destination, the stack the sheet sits
      // over is exactly the stack that stays — no Home reset fires while
      // the explanation is up.
      expect(
        navigationRef.getRootState().routes.map(item => item.name),
      ).toEqual(['OrganizationProvisioning', 'RemovedFromProjectBottomSheet']);
    }, 30_000);

    // (T3) A retry in flight disables the exits together with Tentar
    // novamente — the surface is single-threaded while `ativando`.
    test('S7: a retry in flight disables Trocar and Criar', async () => {
      // Two organizations: the switch exit (D2) needs 2+, and the retry
      // disables BOTH exits together with Tentar novamente.
      seedDocument([prontaAtiva.organizacao, segundaPronta()], ativaA);
      let releaseActivate: (value: boolean) => void = () => {};
      activate.mockImplementation(
        () =>
          new Promise<boolean>(resolve => {
            releaseActivate = resolve;
          }),
      );
      ativarRecovery('recovery', 'unavailable');
      const user = userEvent.setup();
      await renderScreen();

      await user.press(
        screen.getByTestId('ORG.provisioning-retry-activation-btn'),
      );
      // RED: the exit buttons do not exist today.
      expect(
        screen.getByTestId('ORG.provisioning-switch-organization-btn'),
      ).toBeDisabled();
      expect(
        screen.getByTestId('ORG.provisioning-create-organization-btn'),
      ).toBeDisabled();
      releaseActivate(true);
      await waitFor(() => {
        expect(
          screen.getByTestId('ORG.provisioning-switch-organization-btn'),
        ).toBeEnabled();
      });
      expect(
        screen.getByTestId('ORG.provisioning-create-organization-btn'),
      ).toBeEnabled();
    });

    // (S8) SPEC A §6.2:214 names the organization the SELECTION points to;
    // a selection orphaned from the document (an id no entry holds, which
    // the parser tolerates) has no name to preserve. MEASURED, not assumed:
    // on this state the exits are ALSO absent — their gates read the
    // document's own derivation (`derivarProjectIdAtivo` → null for an
    // orphan selection, OrganizationProvisioning.tsx `derivado !== null`),
    // never the name. The surface stays title + rows + Tentar novamente.
    test('S8: an orphan ativa (id not in the document) shows no name and no exits', async () => {
      seedDocument([prontaAtiva.organizacao, segundaPronta()], {
        organizacaoId: 'org-fantasma',
        area: 'monitoramento',
      });
      ativarRecovery('recovery', 'unavailable');
      await renderScreen();

      // The fallback entry owns the rows and the title, but the name is the
      // SELECTION's — and 'org-fantasma' resolves to nothing.
      expect(
        screen.getByText('Could not open your territory'),
      ).toBeOnTheScreen();
      expect(
        screen.queryByTestId('ORG.provisioning-unavailable-name'),
      ).not.toBeOnTheScreen();
      // The derivation gate turns both exits off with it; Tentar novamente
      // remains (the selection itself is non-null).
      expect(
        screen.queryByTestId('ORG.provisioning-switch-organization-btn'),
      ).not.toBeOnTheScreen();
      expect(
        screen.queryByTestId('ORG.provisioning-create-organization-btn'),
      ).not.toBeOnTheScreen();
      expect(
        screen.getByTestId('ORG.provisioning-retry-activation-btn'),
      ).toBeEnabled();
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
          'Finish or discard the record before switching territory',
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
          <EarlyAccessStoreProvider value={earlyAccess}>
            <CoiabOrganizationsStoreProvider store={store}>
              <UserProfileStoreProvider store={profileStore}>
                <NavigationContainer ref={navigationRef}>
                  <NavStack.Navigator initialRouteName="OrganizationProvisioning">
                    <NavStack.Screen name="Home" component={HomeStub} />
                    <NavStack.Screen
                      name="OrganizationProvisioning"
                      component={OrganizationProvisioning}
                    />
                  </NavStack.Navigator>
                </NavigationContainer>
              </UserProfileStoreProvider>
            </CoiabOrganizationsStoreProvider>
          </EarlyAccessStoreProvider>
        </IntlProvider>,
      );
      await screen.findByText('Preparing your territory…');

      await act(async () => {
        navigationRef.reset({index: 0, routes: [{name: 'Home'}]});
      });

      expect(screen.getByText('HOME-REACHED')).toBeOnTheScreen();
      expect(
        screen.queryByText('Preparing your territory…'),
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
      expect(screen.getByText('Preparing your territory…')).toBeOnTheScreen();
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

      expect(screen.getByText('Preparing your territory…')).toBeOnTheScreen();
      expect(
        screen.queryByLabelText('Preparing your territory'),
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
        screen.getByLabelText('Preparing your territory'),
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

    // Review fronteira P2-3: the removal explanation is presented over this
    // surface before the engine publishes the loss — A still reads `ready`
    // with its id projected. The sheet above holds the Home reset; once it
    // leaves the stack, the reset's own contract applies again.
    test('the removal sheet above holds the Home reset until it leaves the stack', async () => {
      const NavStack = createNativeStackNavigator<AppStackParamsList>();
      const navigationRef = createNavigationContainerRef<AppStackParamsList>();
      const HomeStub = () => <Text>HOME-REACHED</Text>;
      const SheetStub = () => <Text>SHEET-REACHED</Text>;
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
      await render(
        <IntlProvider locale="en" messages={{}}>
          <EarlyAccessStoreProvider value={earlyAccess}>
            <CoiabOrganizationsStoreProvider store={store}>
              <UserProfileStoreProvider store={profileStore}>
                <NavigationContainer
                  ref={navigationRef}
                  initialState={{
                    index: 1,
                    routes: [
                      {name: 'OrganizationProvisioning'},
                      {
                        name: 'RemovedFromProjectBottomSheet',
                        params: {projectId: 'proj-m-1'},
                      },
                    ],
                  }}>
                  <NavStack.Navigator>
                    <NavStack.Screen name="Home" component={HomeStub} />
                    <NavStack.Screen
                      name="OrganizationProvisioning"
                      component={OrganizationProvisioning}
                    />
                    <NavStack.Screen
                      name="RemovedFromProjectBottomSheet"
                      component={SheetStub}
                      options={{presentation: 'transparentModal'}}
                    />
                  </NavStack.Navigator>
                </NavigationContainer>
              </UserProfileStoreProvider>
            </CoiabOrganizationsStoreProvider>
          </EarlyAccessStoreProvider>
        </IntlProvider>,
      );
      await screen.findByText('SHEET-REACHED');
      expect(
        navigationRef.getRootState().routes.map(item => item.name),
      ).toEqual(['OrganizationProvisioning', 'RemovedFromProjectBottomSheet']);

      await act(async () => {
        navigationRef.goBack();
      });

      expect(await screen.findByText('HOME-REACHED')).toBeOnTheScreen();
      expect(
        navigationRef.getRootState().routes.map(item => item.name),
      ).toEqual(['Home']);
    });
  });
});
