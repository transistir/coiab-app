import * as React from 'react';
import {Text} from 'react-native';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {render, screen, userEvent} from '@testing-library/react-native';
import {IntlProvider} from 'react-intl';

import {LeaveProject} from './LeaveProject';
import {useLeaveProject, useManyProjects} from '@comapeo/core-react';
import {useCoiabOrganizationsState} from '../../contexts/CoiabOrganizationsStoreContext';
import {useOrganizationActivationContext} from '../../contexts/OrganizationActivationContext';
import {
  criarEstadoInicialOrganizacoes,
  type EstadoOrganizacoes,
} from '../../lib/organization/coiabOrganizations';
import type {AppStackParamsList} from '../../sharedTypes/navigation';

jest.mock('@comapeo/core-react', () => ({
  useLeaveProject: jest.fn(),
  useManyProjects: jest.fn(),
}));

jest.mock('../../hooks/server/projects', () => ({
  useProjectSettings: jest.fn(),
}));

import {useProjectSettings} from '../../hooks/server/projects';

jest.mock('../../contexts/ActiveProjectContext', () => ({
  useActiveProject: () => ({projectId: mockLeftProjectId, projectApi: {}}),
}));

jest.mock('../../contexts/ActiveProjectIdStoreContext', () => ({
  useProjetarProjectIdAtivo: () => mockProjetar,
}));

jest.mock('../../contexts/CoiabOrganizationsStoreContext', () => ({
  useCoiabOrganizationsState: jest.fn(),
}));

jest.mock('../../contexts/OrganizationActivationContext', () => ({
  useOrganizationActivationContext: jest.fn(),
}));

const mockLeftProjectId = 'project-left';
const mockSurvivingSlotId = 'project-surviving';
const mockOtherProjectId = 'project-other';

const useCoiabOrganizationsStateMock = useCoiabOrganizationsState as jest.Mock;
const useOrganizationActivationContextMock =
  useOrganizationActivationContext as jest.Mock;
const mockRevalidate = jest.fn();
const mockProjetar = jest.fn();
const mockLeaveMutate = jest.fn();

const useManyProjectsMock = useManyProjects as jest.Mock;
const useLeaveProjectMock = useLeaveProject as jest.Mock;

function mockProjectList(projectIds: string[]) {
  useManyProjectsMock.mockReturnValue({
    data: projectIds.map(projectId => ({
      projectId,
      name: projectId === mockLeftProjectId ? undefined : `Name ${projectId}`,
    })),
  });
}

/**
 * The §4.2 document the screen consults for slot membership: a ready
 * organization whose Monitoramento slot is the project being left.
 */
function documentoComSlotPronto(): EstadoOrganizacoes {
  return {
    versao: 1,
    organizacoes: [
      {
        id: 'a1b2c3d4e5f60718',
        nome: 'Org Um',
        estado: 'pronta',
        confirmacaoPendente: false,
        materializacao: {
          monitoramento: {
            etapa: 'verificado',
            projectId: mockLeftProjectId,
            template: {versao: '1', hash: 'monitoramento'},
            idsAntesDaCriacao: null,
          },
          alertas: {
            etapa: 'verificado',
            projectId: mockSurvivingSlotId,
            template: {versao: '1', hash: 'alertas'},
            idsAntesDaCriacao: null,
          },
        },
        areaEmExecucao: null,
        ultimoErro: null,
      },
    ],
    ativa: {organizacaoId: 'a1b2c3d4e5f60718', area: 'monitoramento'},
  };
}

const Stack = createNativeStackNavigator<AppStackParamsList>();

const HomeStub = () => <Text>HOME-REACHED</Text>;
const SuccessStub = () => <Text>SUCCESS-REACHED</Text>;
const ProvisioningStub = () => <Text>PROVISIONING-REACHED</Text>;
const LeftConfirmationStub = ({
  route,
}: {
  route: {params: {projectName: string}};
}) => <Text>LEFT-{route.params.projectName}</Text>;

async function renderScreen() {
  await render(
    <IntlProvider locale="en" messages={{}}>
      <NavigationContainer>
        <Stack.Navigator initialRouteName="LeaveProject">
          <Stack.Screen name="Home" component={HomeStub} />
          <Stack.Screen name="Success" component={SuccessStub} />
          <Stack.Screen
            name="OrganizationProvisioning"
            component={ProvisioningStub}
          />
          <Stack.Screen
            name="LeaveProject"
            component={LeaveProject}
            initialParams={{memberType: 'coordinator'}}
          />
          <Stack.Screen
            name="LeftProjectConfirmation"
            component={LeftConfirmationStub}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </IntlProvider>,
  );
}

const useProjectSettingsMock = useProjectSettings as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  useProjectSettingsMock.mockReturnValue({data: {name: 'Projeto X'}});
  useManyProjectsMock.mockReturnValue({data: []});
  useCoiabOrganizationsStateMock.mockReturnValue(
    criarEstadoInicialOrganizacoes(),
  );
  useOrganizationActivationContextMock.mockReturnValue({
    revalidate: mockRevalidate,
  });
  mockRevalidate.mockResolvedValue(false);
  useLeaveProjectMock.mockReturnValue({
    // The screen's logic lives in the onSuccess handler — run it inline.
    mutate: mockLeaveMutate.mockImplementation((_vars, opts) => {
      opts.onSuccess();
    }),
    reset: jest.fn(),
    status: 'idle',
    error: undefined,
  });
});

describe('LeaveProject', () => {
  test('an organization slot hands the routing to the activation engine: no navigation, no legacy id write (A §5.3)', async () => {
    useCoiabOrganizationsStateMock.mockReturnValue(documentoComSlotPronto());
    await renderScreen();

    await userEvent.press(screen.getByText('Yes, Leave'));

    expect(mockLeaveMutate).toHaveBeenCalledWith(
      {projectId: mockLeftProjectId},
      expect.anything(),
    );
    // The engine revalidates BOTH materialized slots of the organization
    // the document selects; a loss is published by the engine (`recovery`)
    // and routed by the navigation gate's continuous rule. This screen must
    // not race that publication with a reset of its own, and must not write
    // the legacy active id (the projection rewrites it at the next ready
    // generation).
    expect(mockRevalidate).toHaveBeenCalledTimes(1);
    expect(mockProjetar).not.toHaveBeenCalled();
    // The screen stays mounted: OrganizationProvisioning is registered in
    // this stack, yet the screen itself never routes there.
    expect(screen.getByText('Yes, Leave')).toBeOnTheScreen();
    expect(screen.queryByText('PROVISIONING-REACHED')).not.toBeOnTheScreen();
  });

  test('a non-org project switches to any remaining project', async () => {
    mockProjectList([mockLeftProjectId, mockOtherProjectId]);
    await renderScreen();

    await userEvent.press(screen.getByText('Yes, Leave'));

    expect(mockProjetar).toHaveBeenCalledWith(mockOtherProjectId);
  });

  test('a non-org project with nothing remaining clears the active id and resets to the org fork', async () => {
    mockProjectList([mockLeftProjectId]);
    await renderScreen();

    await userEvent.press(screen.getByText('Yes, Leave'));

    expect(mockProjetar).toHaveBeenCalledWith(undefined);
    expect(mockProjetar).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('SUCCESS-REACHED')).toBeOnTheScreen();
  });
});
