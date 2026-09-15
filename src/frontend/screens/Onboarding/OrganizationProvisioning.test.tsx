import * as React from 'react';
import {Alert, Text} from 'react-native';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {
  render,
  screen,
  userEvent,
  waitFor,
} from '@testing-library/react-native';
import {IntlProvider} from 'react-intl';
import {useManyInvites} from '@comapeo/core-react';

import {OrganizationProvisioning} from './OrganizationProvisioning';
import {
  useCreateOrganization,
  type CreateOrganizationStatus,
} from '../../hooks/organization/useCreateOrganization';
import {
  useDiscardIncompleteOrganization,
  type DiscardOrganizationStatus,
} from '../../hooks/organization/useDiscardIncompleteOrganization';
import {useOrganizations} from '../../hooks/organization/useOrganizations';
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
import {markerFor} from '../../lib/organization/marker';
import {
  organizationCreationProvenanceStore,
  recordOrganizationCreationProvenance,
} from '../../lib/organization/creationProvenance';
import type {DiscardResult} from '../../lib/organization/fanout';
import type {InviteLike} from '../../lib/organization/bundle';
import type {ReconstructedOrganization} from '../../lib/organization/reconstruct';
import type {AppStackParamsList} from '../../sharedTypes/navigation';

jest.mock('@comapeo/core-react', () => ({
  useManyInvites: jest.fn(),
}));

jest.mock('../../hooks/organization/useOrganizations', () => ({
  useOrganizations: jest.fn(),
}));

jest.mock('../../hooks/organization/useCreateOrganization', () => ({
  useCreateOrganization: jest.fn(),
}));

jest.mock('../../hooks/organization/useDiscardIncompleteOrganization', () => ({
  useDiscardIncompleteOrganization: jest.fn(),
}));

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

jest.mock('../../contexts/ActiveProjectIdStoreContext', () => {
  const holder = {current: undefined as string | undefined};
  return {
    __setActiveProjectId: (projectId: string | undefined) => {
      holder.current = projectId;
    },
    useActiveProjectId: () => holder.current,
  };
});

const useOrganizationsMock = useOrganizations as jest.Mock;
const useCreateOrganizationMock = useCreateOrganization as jest.Mock;
const useDiscardMock = useDiscardIncompleteOrganization as jest.Mock;
const useManyInvitesMock = useManyInvites as jest.Mock;

const start = jest.fn();
const discard = jest.fn();
const activate = jest.fn<Promise<boolean>, [string, {acknowledge: true}]>();
const retryPreparation = jest.fn<Promise<boolean>, [string]>();

const activationMock = jest.requireMock(
  '../../contexts/OrganizationActivationContext',
) as {__setActivation(activation: unknown): void};
const activeProjectIdMock = jest.requireMock(
  '../../contexts/ActiveProjectIdStoreContext',
) as {__setActiveProjectId(projectId: string | undefined): void};

type CreateOrganizationMockState = {
  start: (
    organizationName: string,
    providedOrganizationId?: string,
  ) => Promise<void>;
  reset: () => void;
  status: CreateOrganizationStatus;
  error: unknown;
  organizationId: string | undefined;
};

type DiscardMockState = {
  discard: (organizationId: string) => Promise<unknown>;
  reset: () => void;
  status: DiscardOrganizationStatus;
  error: unknown;
  result: DiscardResult | undefined;
  discardedOrganizationId: string | undefined;
};

function mockOrganizations(organizations: ReconstructedOrganization[]) {
  useOrganizationsMock.mockReturnValue(organizations);
}

function mockInvites(invites: InviteLike[]) {
  useManyInvitesMock.mockReturnValue({data: invites});
}

function mockCreateOrganization(
  overrides?: Partial<CreateOrganizationMockState>,
) {
  useCreateOrganizationMock.mockReturnValue({
    start,
    reset: jest.fn(),
    status: 'idle',
    error: undefined,
    organizationId: undefined,
    ...overrides,
  });
}

function mockDiscard(overrides?: Partial<DiscardMockState>) {
  useDiscardMock.mockReturnValue({
    discard,
    reset: jest.fn(),
    status: 'idle',
    error: undefined,
    result: undefined,
    discardedOrganizationId: undefined,
    ...overrides,
  });
}

/** The buttons of the most recent `Alert.alert` call. */
function alertButtons(): Array<{text?: string; onPress?: () => void}> {
  const buttons = alertSpy.mock.calls[alertSpy.mock.calls.length - 1]?.[2];
  if (!Array.isArray(buttons)) throw new Error('no alert buttons');
  return buttons;
}

function pressAlertButton(text: string) {
  const button = alertButtons().find(entry => entry.text === text);
  if (!button) {
    throw new Error(
      `no alert button ${text}; got ${alertButtons()
        .map(entry => entry.text)
        .join(', ')}`,
    );
  }
  button.onPress?.();
}

const Stack = createNativeStackNavigator<AppStackParamsList>();

const HomeStub = () => <Text>HOME-REACHED</Text>;
const SuccessStub = () => <Text>START-OVER-FORK-REACHED</Text>;

type ProvisioningProps = React.ComponentProps<typeof OrganizationProvisioning>;

/**
 * Every `navigation.reset` the screen dispatches, in order. Two resets in
 * one commit settle on the last route, so the rendered screen alone cannot
 * tell a clean hop from a flash through another screen.
 */
let resetCalls: Array<Parameters<ProvisioningProps['navigation']['reset']>[0]>;

const RecordingProvisioning = (props: ProvisioningProps) => {
  const {navigation} = props;
  // Memoized on the real navigation object so the screen's effect deps stay
  // as stable as they are in the app.
  const recordingNavigation = React.useMemo(
    () => ({
      ...navigation,
      reset: (state: Parameters<typeof navigation.reset>[0]) => {
        resetCalls.push(state);
        navigation.reset(state);
      },
    }),
    [navigation],
  );
  return (
    <OrganizationProvisioning {...props} navigation={recordingNavigation} />
  );
};

/**
 * ONE navigator tree for the initial render and every rerender: a rerender
 * whose screen set differs from the mounted one remounts the navigator and
 * wipes its navigation state.
 */
let store: CoiabOrganizationsStore;
let queryClient: QueryClient;

function navigatorTree() {
  return (
    <IntlProvider locale="en" messages={{}}>
      <QueryClientProvider client={queryClient}>
        <CoiabOrganizationsStoreProvider store={store}>
          <NavigationContainer>
            <Stack.Navigator>
              <Stack.Screen
                name="OrganizationProvisioning"
                component={RecordingProvisioning}
                options={{headerShown: false}}
              />
              <Stack.Screen name="Home" component={HomeStub} />
              <Stack.Screen name="Success" component={SuccessStub} />
            </Stack.Navigator>
          </NavigationContainer>
        </CoiabOrganizationsStoreProvider>
      </QueryClientProvider>
    </IntlProvider>
  );
}

async function renderScreen() {
  return render(navigatorTree());
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
function seedDocument(organizacoes: OrganizacaoLocal[]) {
  store.instance.setState(
    {...documento(organizacoes), hidratacaoFalhou: false},
    true,
  );
}

const readyOrganization: ReconstructedOrganization = {
  state: 'ready',
  organizationId: 'a'.repeat(16),
  organizationName: 'Org',
  slots: {m: 'project-m', a: 'project-a'},
};

const invalidOrganization: ReconstructedOrganization = {
  state: 'invalid',
  organizationId: 'b'.repeat(16),
  reason: 'duplicate-slot',
  organizationName: undefined,
  slots: {},
};

const incompleteOrganization: ReconstructedOrganization = {
  state: 'incomplete',
  organizationId: 'c'.repeat(16),
  organizationName: 'Partial Org',
  slots: {m: 'project-m'},
};

const namelessIncompleteOrganization: ReconstructedOrganization = {
  state: 'incomplete',
  organizationId: 'd'.repeat(16),
  organizationName: undefined,
  slots: {a: 'project-a'},
};

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  resetCalls = [];
  organizationCreationProvenanceStore.setState({organizationIds: []});
  store = createCoiabOrganizationsStore({persist: false});
  queryClient = new QueryClient();
  mockOrganizations([]);
  mockCreateOrganization();
  mockDiscard();
  mockInvites([]);
  activate.mockResolvedValue(true);
  retryPreparation.mockResolvedValue(true);
  activationMock.__setActivation({activate, retryPreparation});
  activeProjectIdMock.__setActiveProjectId(undefined);
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  alertSpy.mockRestore();
});

describe('OrganizationProvisioning', () => {
  // Legacy fail-closed surface (no persisted organization): the document
  // never existed, so the reconstruction alone rules navigation.
  describe('legacy reconstruction without a document', () => {
    test('shows the setup text while there is no ready organization', async () => {
      await renderScreen();

      expect(
        screen.getByText('Setting up your Organization…'),
      ).toBeOnTheScreen();
      expect(screen.queryByText('HOME-REACHED')).not.toBeOnTheScreen();
    });

    test('shows the error line when an organization is invalid, and stays put', async () => {
      mockOrganizations([invalidOrganization]);
      await renderScreen();

      expect(
        screen.getByText(
          'Something is wrong with this Organization. Contact support.',
        ),
      ).toBeOnTheScreen();
      expect(screen.queryByText('HOME-REACHED')).not.toBeOnTheScreen();
    });

    test('refuses to finish a setup this device cannot prove it started', async () => {
      // An organization degraded by a leave/removal is `incomplete` with a name
      // too — indistinguishable from an interrupted create without durable
      // provenance. Finishing it would fabricate an unrelated project and mark
      // the organization ready without the original slot's data or members.
      const user = userEvent.setup();
      mockOrganizations([incompleteOrganization]);
      await renderScreen();

      expect(
        screen.queryByTestId('ORG.provisioning-retry-btn'),
      ).not.toBeOnTheScreen();
      expect(
        screen.getByText(
          'This Organization was not left half-created on this device, so its setup cannot be finished here.',
        ),
      ).toBeOnTheScreen();
      // The escape hatch stays: the setup is not a permanent lockout.
      await user.press(screen.getByTestId('ORG.provisioning-discard-btn'));
      expect(start).not.toHaveBeenCalled();
    });

    test('stays on the repair surface while another organization is ready', async () => {
      // Mixed state: `some(ready)` must not send the invalid organization's
      // only diagnosis surface back to Home the moment it renders.
      mockOrganizations([readyOrganization, invalidOrganization]);
      await renderScreen();

      expect(screen.queryByText('HOME-REACHED')).not.toBeOnTheScreen();
      expect(
        screen.getByText(
          'Something is wrong with this Organization. Contact support.',
        ),
      ).toBeOnTheScreen();
    });

    test('offers to finish setting up for an incomplete organization with a name', async () => {
      mockOrganizations([incompleteOrganization]);
      recordOrganizationCreationProvenance(
        incompleteOrganization.organizationId,
      );
      await renderScreen();

      expect(
        screen.getByTestId('ORG.provisioning-retry-btn'),
      ).toBeOnTheScreen();
      expect(screen.getByText('Finish setting up')).toBeOnTheScreen();
    });

    test('pressing the retry resumes the reconstructed organization (idempotent fan-out)', async () => {
      const user = userEvent.setup();
      mockOrganizations([incompleteOrganization]);
      recordOrganizationCreationProvenance(
        incompleteOrganization.organizationId,
      );
      await renderScreen();

      await user.press(screen.getByTestId('ORG.provisioning-retry-btn'));

      expect(start).toHaveBeenCalledTimes(1);
      expect(start).toHaveBeenCalledWith('Partial Org', 'cccccccccccccccc');
    });

    test('stays passive (no retry) when the incomplete organization has no name', async () => {
      mockOrganizations([namelessIncompleteOrganization]);
      await renderScreen();

      expect(
        screen.getByText('Setting up your Organization…'),
      ).toBeOnTheScreen();
      expect(
        screen.queryByTestId('ORG.provisioning-retry-btn'),
      ).not.toBeOnTheScreen();
    });

    test('hides the retry button while a pending invite covers the missing slot', async () => {
      // The invite sheet completes the organization — fabricating the slot
      // here would create a private project alongside it.
      mockOrganizations([incompleteOrganization]);
      recordOrganizationCreationProvenance(
        incompleteOrganization.organizationId,
      );
      mockInvites([
        {
          inviteId: 'invite-a',
          projectDescription: markerFor('c'.repeat(16), 'a', 'Partial Org'),
          invitorDeviceId: 'invitor-1',
          roleName: 'Coordinator',
          receivedAt: 1,
          state: 'pending',
        },
      ]);
      await renderScreen();

      expect(
        screen.getByText('Setting up your Organization…'),
      ).toBeOnTheScreen();
      expect(
        screen.queryByTestId('ORG.provisioning-retry-btn'),
      ).not.toBeOnTheScreen();
    });

    test('hides the retry button while the fan-out is running', async () => {
      mockOrganizations([incompleteOrganization]);
      recordOrganizationCreationProvenance(
        incompleteOrganization.organizationId,
      );
      mockCreateOrganization({status: 'creating'});
      await renderScreen();

      expect(
        screen.queryByTestId('ORG.provisioning-retry-btn'),
      ).not.toBeOnTheScreen();
      expect(
        screen.getByText('Setting up your Organization…'),
      ).toBeOnTheScreen();
    });

    test('advances to Home when an organization becomes ready', async () => {
      const view = await renderScreen();

      mockOrganizations([readyOrganization]);
      // Re-render so the hook publishes the new organization state.
      view.rerender(navigatorTree());

      expect(await screen.findByText('HOME-REACHED')).toBeOnTheScreen();
    });

    test('offers the discard escape hatch even when the incomplete organization has no name', async () => {
      // A nameless incomplete org has no retry (no name, no marker can be
      // minted) — the discard is the only way out of the creation lockout.
      mockOrganizations([namelessIncompleteOrganization]);
      await renderScreen();

      expect(
        screen.getByTestId('ORG.provisioning-discard-btn'),
      ).toBeOnTheScreen();
    });

    test('discards only after the destructive confirm, and cancel leaves everything alone', async () => {
      const user = userEvent.setup();
      mockOrganizations([incompleteOrganization]);
      await renderScreen();

      await user.press(screen.getByTestId('ORG.provisioning-discard-btn'));

      expect(alertSpy).toHaveBeenCalledTimes(1);
      // The confirm must say what a leave costs: joined projects are left too.
      expect(alertSpy.mock.calls[0][1]).toBe(
        "This device will leave the projects in this setup. Other members will see this device leave the projects. If this device is a project's only coordinator, then no other device can add or remove devices, adjust project info, or update the categories set. Observations not yet synced from this device will no longer be available here, so export any important data first. Other members keep the projects and their copies.",
      );
      expect(discard).not.toHaveBeenCalled();

      pressAlertButton('Cancel');
      expect(discard).not.toHaveBeenCalled();

      await user.press(screen.getByTestId('ORG.provisioning-discard-btn'));
      pressAlertButton('Discard and start over');
      expect(discard).toHaveBeenCalledWith('cccccccccccccccc');
    });

    test('a fully discarded organization routes back to the start-over fork', async () => {
      mockOrganizations([namelessIncompleteOrganization]);
      mockDiscard({
        status: 'success',
        discardedOrganizationId: 'd'.repeat(16),
        result: {
          ok: true,
          removed: [{slot: 'a', projectId: 'project-a'}],
          skipped: [],
        } satisfies DiscardResult,
      });
      await renderScreen();

      expect(
        await screen.findByText('START-OVER-FORK-REACHED'),
      ).toBeOnTheScreen();
    });

    test('a successful discard next to a ready organization goes straight to the start-over fork, never through Home', async () => {
      // N10a: the discarded setup is filtered out of the collection, so the
      // device looks "ready, nothing degraded" on the same commit the discard
      // result lands. The discard owns that navigation — no Home flash first.
      mockOrganizations([readyOrganization]);
      mockDiscard({
        status: 'success',
        discardedOrganizationId: 'c'.repeat(16),
        result: {
          ok: true,
          removed: [{slot: 'm', projectId: 'project-m'}],
          skipped: [],
        } satisfies DiscardResult,
      });
      await renderScreen();

      expect(
        await screen.findByText('START-OVER-FORK-REACHED'),
      ).toBeOnTheScreen();
      expect(resetCalls).toEqual([{index: 0, routes: [{name: 'Success'}]}]);
    });

    test('a successful discard stays on the repair surface while another degraded organization remains', async () => {
      // Greptile P1: a discard that frees the device must not hide another
      // organization that still needs repair — the start-over fork only owns
      // the next decision when NOTHING on the device is degraded anymore.
      const user = userEvent.setup();
      mockOrganizations([incompleteOrganization, invalidOrganization]);
      mockDiscard({
        status: 'success',
        result: {
          ok: true,
          removed: [{slot: 'm', projectId: 'project-m'}],
          skipped: [],
        } satisfies DiscardResult,
      });
      await renderScreen();

      await user.press(screen.getByTestId('ORG.provisioning-discard-btn'));
      pressAlertButton('Discard and start over');

      // The discarded setup is gone; the remaining invalid organization's
      // diagnosis stays on screen — no automatic hop to the start-over fork.
      expect(
        await screen.findByText(
          'Something is wrong with this Organization. Contact support.',
        ),
      ).toBeOnTheScreen();
      expect(
        screen.queryByText('START-OVER-FORK-REACHED'),
      ).not.toBeOnTheScreen();
    });

    test('a skip because the setup changed mid-discard is explained the same way', async () => {
      mockOrganizations([incompleteOrganization]);
      mockDiscard({
        status: 'success',
        result: {
          ok: false,
          removed: [],
          skipped: [
            {slot: 'm', projectId: 'project-m', reason: 'no-longer-incomplete'},
          ],
        } satisfies DiscardResult,
      });
      await renderScreen();

      expect(
        screen.getByText(
          'Monitoramento changed while it was being discarded, so it was kept.',
        ),
      ).toBeOnTheScreen();
      expect(
        screen.queryByText('START-OVER-FORK-REACHED'),
      ).not.toBeOnTheScreen();
    });

    test('a pending join skip explains that the invitation must finish syncing', async () => {
      mockOrganizations([incompleteOrganization]);
      mockDiscard({
        status: 'success',
        result: {
          ok: false,
          removed: [{slot: 'm', projectId: 'project-m'}],
          skipped: [
            {slot: 'a', projectId: 'project-a', reason: 'join-pending'},
          ],
        } satisfies DiscardResult,
      });
      await renderScreen();

      expect(
        screen.getByText(
          'An invitation for this organization is still syncing. Try again once it finishes.',
        ),
      ).toBeOnTheScreen();
      expect(
        screen.queryByText('START-OVER-FORK-REACHED'),
      ).not.toBeOnTheScreen();
    });

    test('a failed discard says so and stays on the screen', async () => {
      // Finding 2: a discard error must reach the user — never a silent
      // return to a screen that looks untouched.
      const view = await renderScreen();
      expect(
        screen.queryByText(/went wrong while discarding/),
      ).not.toBeOnTheScreen();

      mockDiscard({status: 'error', error: new Error('IPC_GONE')});
      view.rerender(navigatorTree());

      expect(
        await screen.findByText(
          'Something went wrong while discarding this setup. It was not fully removed — you can try again.',
        ),
      ).toBeOnTheScreen();
      expect(
        screen.queryByText('START-OVER-FORK-REACHED'),
      ).not.toBeOnTheScreen();
      expect(screen.queryByText('HOME-REACHED')).not.toBeOnTheScreen();
      expect(
        screen.getByText('Setting up your Organization…'),
      ).toBeOnTheScreen();
    });

    test('hides the discard action while the fan-out runs', async () => {
      mockOrganizations([incompleteOrganization]);
      mockCreateOrganization({status: 'creating'});
      await renderScreen();

      expect(
        screen.queryByTestId('ORG.provisioning-discard-btn'),
      ).not.toBeOnTheScreen();
    });

    test('hides the discard action while a pending invite covers the missing slot', async () => {
      // The invite completes the organization — that is the expected path, not
      // tearing the setup down.
      mockOrganizations([incompleteOrganization]);
      mockInvites([
        {
          inviteId: 'invite-a',
          projectDescription: markerFor('c'.repeat(16), 'a', 'Partial Org'),
          invitorDeviceId: 'invitor-1',
          roleName: 'Coordinator',
          receivedAt: 1,
          state: 'pending',
        },
      ]);
      await renderScreen();

      expect(
        screen.queryByTestId('ORG.provisioning-discard-btn'),
      ).not.toBeOnTheScreen();
    });
  });

  // Document-driven view (SPEC B §4.4): the persisted document exists, so IT
  // decides what renders and when navigation may leave — never the
  // reconstruction.
  describe('document-driven provisioning', () => {
    test('a ready organization with a pending confirmation shows the button and does not reset to Home', async () => {
      seedDocument([
        organizacao({
          estado: 'pronta',
          confirmacaoPendente: true,
          materializacao: PAR_PRONTA,
        }),
      ]);
      // The reconstruction sees the projects as a ready organization — the
      // OLD screen reset to Home on exactly this input.
      mockOrganizations([readyOrganization]);
      await renderScreen();

      expect(screen.queryByText('HOME-REACHED')).not.toBeOnTheScreen();
      expect(resetCalls).toEqual([]);
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
      // A manual retry is a user decision, never an automatic fan-out.
      expect(start).not.toHaveBeenCalled();
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
      // The reconstruction sees the projects as a ready organization; the
      // document still owns the screen — it stays put with no navigation.
      mockOrganizations([readyOrganization]);
      await renderScreen();

      expect(
        screen.getByText('Preparing your organization…'),
      ).toBeOnTheScreen();
      expect(screen.queryByText('HOME-REACHED')).not.toBeOnTheScreen();
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
        screen.queryByTestId('ORG.provisioning-retry-btn'),
      ).not.toBeOnTheScreen();
      expect(
        screen.queryByTestId('ORG.provisioning-discard-btn'),
      ).not.toBeOnTheScreen();
    });

    test('after Abrir organização acknowledges and the projection lands, the screen resets to Home', async () => {
      seedDocument([
        organizacao({
          estado: 'pronta',
          confirmacaoPendente: true,
          materializacao: PAR_PRONTA,
        }),
      ]);
      mockOrganizations([readyOrganization]);
      // The engine's single write (SPEC A §4.2 regra 9) plus the projection
      // the activation provider publishes afterwards.
      activate.mockImplementation(async () => {
        store.actions.confirmarAbertura('org-1', 'monitoramento');
        activeProjectIdMock.__setActiveProjectId('proj-m-1');
        return true;
      });
      const user = userEvent.setup();
      const view = await renderScreen();

      await user.press(
        screen.getByTestId('ORG.provisioning-open-organization-btn'),
      );
      view.rerender(navigatorTree());

      expect(await screen.findByText('HOME-REACHED')).toBeOnTheScreen();
      expect(resetCalls).toEqual([{index: 0, routes: [{name: 'Home'}]}]);
      // The single write acknowledged and selected in one document revision.
      const settled = store.instance.getState();
      expect(settled.ativa).toEqual({
        organizacaoId: 'org-1',
        area: 'monitoramento',
      });
      expect(
        settled.organizacoes[0] && settled.organizacoes[0].confirmacaoPendente,
      ).toBe(false);
    });
  });
});
