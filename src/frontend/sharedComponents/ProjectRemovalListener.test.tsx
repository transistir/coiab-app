import * as React from 'react';
import {Text} from 'react-native';
import {
  NavigationContainer,
  createNavigationContainerRef,
} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {
  act,
  render,
  screen,
  userEvent,
  waitFor,
} from '@testing-library/react-native';
import {IntlProvider} from 'react-intl';
import {useStore} from 'zustand';

import {ProjectRemovalListener} from './ProjectRemovalListener';
import {
  useLeaveProject,
  useOwnRoleInProject,
  useProjectSettings,
  useSingleProject,
  useProjectOwnRoleChangeListener,
} from '@comapeo/core-react';
import {createCoiabOrganizationsStore} from '../contexts/CoiabOrganizationsStoreContext';
import {organizationDocument} from '../lib/organization/fixtures';
import {createOrganizationActivation} from '../lib/organization/activation';
import {GenerationTransitionGate} from '../Navigation/Stack';
import {RemovedFromProjectBottomSheet} from '../screens/RemovedFromProjectBottomSheet';
import {BLOCKED_ROLE_ID, MEMBER_ROLE_ID} from '../sharedTypes';
import type {AppStackParamsList} from '../sharedTypes/navigation';

jest.mock('@comapeo/core-react', () => ({
  useSingleProject: jest.fn(),
  useProjectOwnRoleChangeListener: jest.fn(),
  useOwnRoleInProject: jest.fn(),
  useProjectSettings: jest.fn(),
  useLeaveProject: jest.fn(),
}));

// The listener reads the engine through the context hook; each test decides
// whether that is a fixed handle or a REAL engine's published state.
let mockUseActivation: () => unknown = () => mockActivationContext;
jest.mock('../contexts/OrganizationActivationContext', () => ({
  useOrganizationActivationContext: () => mockUseActivation(),
}));

jest.mock('../contexts/CoiabOrganizationsStoreContext', () => ({
  ...jest.requireActual('../contexts/CoiabOrganizationsStoreContext'),
  useCoiabOrganizationsState: () => mockStore.instance.getState(),
}));

const useSingleProjectMock = useSingleProject as jest.Mock;
const useProjectOwnRoleChangeListenerMock =
  useProjectOwnRoleChangeListener as jest.Mock;
const useOwnRoleInProjectMock = useOwnRoleInProject as jest.Mock;
const useProjectSettingsMock = useProjectSettings as jest.Mock;
const useLeaveProjectMock = useLeaveProject as jest.Mock;

const mockStore = createCoiabOrganizationsStore();
const mockRevalidate = jest.fn(async () => true);
const mockActivationContext = {
  status: 'ready',
  revalidate: mockRevalidate,
};

// project id → own-role-change listeners currently attached by the component
const mockListeners = new Map<string, Array<(event: unknown) => void>>();

function mockProjectApi(projectId: string) {
  return {
    addListener: (event: string, listener: (event: unknown) => void) => {
      if (event !== 'own-role-change') return;
      const anexados = mockListeners.get(projectId) ?? [];
      anexados.push(listener);
      mockListeners.set(projectId, anexados);
    },
    removeListener: (event: string, listener: (event: unknown) => void) => {
      if (event !== 'own-role-change') return;
      mockListeners.set(
        projectId,
        (mockListeners.get(projectId) ?? []).filter(item => item !== listener),
      );
    },
  };
}

function emitirPapel(projectId: string, roleId: string) {
  for (const listener of mockListeners.get(projectId) ?? []) {
    listener({role: {roleId}});
  }
}

const Stack = createNativeStackNavigator<AppStackParamsList>();
const navigationRef = createNavigationContainerRef<AppStackParamsList>();

const HomeComListener = () => (
  <>
    <ProjectRemovalListener />
    <Text>HOME-REACHED</Text>
  </>
);
const ProvisioningStub = () => <Text>PROVISIONING-REACHED</Text>;

/**
 * The real navigator shape the listener lives in: Home (which mounts the
 * listener, as HomeTabs does) and the removal sheet in the root stack, with
 * the REAL generation gate in the layout reading the engine's publication.
 */
function Navegador({
  status,
  generation,
}: {
  status: Parameters<typeof GenerationTransitionGate>[0]['status'];
  generation: number;
}) {
  return (
    <IntlProvider locale="en" messages={{}}>
      <NavigationContainer ref={navigationRef}>
        <Stack.Navigator
          initialRouteName="Home"
          layout={({children, state, navigation}) => (
            <>
              <GenerationTransitionGate
                state={state}
                navigation={navigation}
                status={status}
                generation={generation}
                enabled
              />
              {children}
            </>
          )}>
          <Stack.Screen name="Home" component={HomeComListener} />
          <Stack.Screen
            name="OrganizationProvisioning"
            component={ProvisioningStub}
          />
          <Stack.Screen
            name="RemovedFromProjectBottomSheet"
            component={RemovedFromProjectBottomSheet}
            options={{presentation: 'transparentModal', headerShown: false}}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </IntlProvider>
  );
}

const nomesDasRotas = () =>
  navigationRef.getRootState().routes.map(route => route.name);

describe('ProjectRemovalListener (Fase 11b)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseActivation = () => mockActivationContext;
    mockActivationContext.status = 'ready';
    mockStore.instance.setState(organizationDocument(), true);
    mockListeners.clear();
    useSingleProjectMock.mockImplementation(
      ({projectId}: {projectId: string}) => ({
        data: mockProjectApi(projectId),
      }),
    );
    useProjectOwnRoleChangeListenerMock.mockReturnValue(undefined);
    useOwnRoleInProjectMock.mockReturnValue({data: {reason: undefined}});
    useProjectSettingsMock.mockImplementation(
      ({projectId}: {projectId: string}) => ({
        data: {name: `Projeto ${projectId}`, projectColor: '#444444'},
      }),
    );
    useLeaveProjectMock.mockReturnValue({
      mutate: jest.fn((_vars, opts) => opts.onSuccess()),
      status: 'idle',
    });
  });

  test('mudança de papel em qualquer slot dispara revalidate (ambos os slots registrados)', async () => {
    const {monitoramento, alertas} =
      organizationDocument().organizacoes[0]!.materializacao;
    await render(<Navegador status="ready" generation={1} />);

    // O hook real do core-react é registrado para OS DOIS slots e o efeito
    // do slot anexa o ouvinte do evento do próprio projeto.
    await waitFor(() => {
      expect(
        mockListeners.get(monitoramento.projectId!) ?? [],
      ).not.toHaveLength(0);
      expect(mockListeners.get(alertas.projectId!) ?? []).not.toHaveLength(0);
    });
    expect(useProjectOwnRoleChangeListenerMock).toHaveBeenCalledWith({
      projectId: monitoramento.projectId,
    });
    expect(useProjectOwnRoleChangeListenerMock).toHaveBeenCalledWith({
      projectId: alertas.projectId,
    });

    // Uma mudança de papel no slot NÃO selecionado (Alertas) revalida.
    await act(async () => {
      emitirPapel(alertas.projectId!, 'coordinator');
    });
    expect(mockRevalidate).toHaveBeenCalledTimes(1);

    // E no slot selecionado também: QUALQUER mudança revalida — o motor
    // decide (confirma sem publicar ou publica a perda).
    await act(async () => {
      emitirPapel(monitoramento.projectId!, 'coordinator');
    });
    expect(mockRevalidate).toHaveBeenCalledTimes(2);
    // A change that is not a removal never navigates.
    expect(nomesDasRotas()).toEqual(['Home']);
  });

  test('sem organização ativa nenhum listener é registrado', async () => {
    mockStore.instance.setState({...organizationDocument(), ativa: null}, true);
    await render(<Navegador status="ready" generation={1} />);
    await screen.findByText('HOME-REACHED');
    expect(useSingleProjectMock).not.toHaveBeenCalled();
    expect(useProjectOwnRoleChangeListenerMock).not.toHaveBeenCalled();
    expect(mockListeners.size).toBe(0);
    expect(mockRevalidate).not.toHaveBeenCalled();
  });

  test('com o motor em loading nada é anexado: a ativação é dona do motor e o listener não dispara', async () => {
    // Durante `loading`/`opening` uma ativação é dona do motor — os slots
    // montam (a organização ativa existe) mas o efeito do slot não anexa
    // ouvinte e nenhuma mudança de papel pode revalidar no meio.
    mockActivationContext.status = 'loading';
    await render(<Navegador status="loading" generation={0} />);
    await waitFor(() => {
      expect(useSingleProjectMock).toHaveBeenCalledWith({
        projectId: 'A-m',
      });
    });
    expect(mockListeners.size).toBe(0);
    expect(mockRevalidate).not.toHaveBeenCalled();
  });

  // Review fronteira P2-3: a removal is EXPLAINED. The real engine publishes
  // the loss (recovery) and the real generation gate routes it; the sheet
  // must survive that routing and name the removed slot — here the one that
  // is NOT selected (A operates Alertas, Monitoramento is blocked).
  test('papel bloqueado apresenta o RemovedFromProjectBottomSheet sobre a recuperação e o Close leva ao provisioning', async () => {
    let papel = MEMBER_ROLE_ID;
    const engine = createOrganizationActivation({
      store: mockStore,
      getProject: async () => ({$getOwnRole: async () => ({roleId: papel})}),
    });
    await engine.initialize();
    expect(engine.instance.getState().status).toBe('ready');
    mockUseActivation = function useMotorReal() {
      const state = useStore(engine.instance);
      return {...state, revalidate: engine.revalidate};
    };
    function NavegadorDoMotor() {
      const {status, generation} = useStore(engine.instance);
      return <Navegador status={status} generation={generation} />;
    }
    await render(<NavegadorDoMotor />);
    await waitFor(() => {
      expect(mockListeners.get('A-m') ?? []).not.toHaveLength(0);
    });

    papel = BLOCKED_ROLE_ID;
    await act(async () => {
      emitirPapel('A-m', BLOCKED_ROLE_ID);
    });

    // The engine lost the context…
    await waitFor(() =>
      expect(engine.instance.getState()).toMatchObject({
        status: 'recovery',
        error: 'access-unavailable',
      }),
    );
    // …and the gate kept the explanation over the provisioning surface.
    expect(nomesDasRotas()).toEqual([
      'OrganizationProvisioning',
      'RemovedFromProjectBottomSheet',
    ]);
    expect(
      await screen.findByText('THIS DEVICE REMOVED FROM…'),
    ).toBeOnTheScreen();
    expect(screen.getByText('Projeto A-m')).toBeOnTheScreen();

    await userEvent.press(screen.getByText('Close'));
    const leave = useLeaveProjectMock.mock.results.at(-1)!.value.mutate;
    expect(leave).toHaveBeenCalledWith({projectId: 'A-m'}, expect.anything());
    await waitFor(() =>
      expect(nomesDasRotas()).toEqual(['OrganizationProvisioning']),
    );
    expect(await screen.findByText('PROVISIONING-REACHED')).toBeOnTheScreen();
  });
});
