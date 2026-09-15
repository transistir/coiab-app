import * as React from 'react';
import {
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
    __setActiveProjectId: (projectId: string | undefined) => {
      holder.current = projectId;
    },
    useActiveProjectId: () => holder.current,
  };
});

const activeProjectIdMock = jest.requireMock(
  '../../contexts/ActiveProjectIdStoreContext',
) as {__setActiveProjectId(projectId: string | undefined): void};
import type {AppStackParamsList} from '../../sharedTypes/navigation';

/**
 * The screen's own Home reset is exercised at the navigator level; the stub
 * keeps the unit tree free of a navigator while still failing loudly if a
 * state change ever reaches for it.
 */
const navigationReset = jest.fn();
const screenProps = {
  navigation: {reset: navigationReset},
  route: {
    key: 'OrganizationProvisioning',
    name: 'OrganizationProvisioning',
  },
} as unknown as NativeStackScreenProps<
  AppStackParamsList,
  'OrganizationProvisioning'
>;

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
  activeProjectIdMock.__setActiveProjectId(undefined);
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
});
