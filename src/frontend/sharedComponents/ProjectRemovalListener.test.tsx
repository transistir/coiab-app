import {render, waitFor} from '@testing-library/react-native';

import {ProjectRemovalListener} from './ProjectRemovalListener';
import {
  useSingleProject,
  useProjectOwnRoleChangeListener,
} from '@comapeo/core-react';
import {createCoiabOrganizationsStore} from '../contexts/CoiabOrganizationsStoreContext';
import {organizationDocument} from '../lib/organization/fixtures';

jest.mock('@comapeo/core-react', () => ({
  useSingleProject: jest.fn(),
  useProjectOwnRoleChangeListener: jest.fn(),
}));

jest.mock('../contexts/OrganizationActivationContext', () => ({
  useOrganizationActivationContext: () => mockActivationContext,
}));

jest.mock('../contexts/CoiabOrganizationsStoreContext', () => ({
  ...jest.requireActual('../contexts/CoiabOrganizationsStoreContext'),
  useCoiabOrganizationsState: () => mockStore.instance.getState(),
}));

const useSingleProjectMock = useSingleProject as jest.Mock;
const useProjectOwnRoleChangeListenerMock =
  useProjectOwnRoleChangeListener as jest.Mock;

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

describe('ProjectRemovalListener (Fase 11b)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockActivationContext.status = 'ready';
    mockStore.instance.setState(organizationDocument(), true);
    mockListeners.clear();
    useSingleProjectMock.mockImplementation(
      ({projectId}: {projectId: string}) => ({
        data: mockProjectApi(projectId),
      }),
    );
    useProjectOwnRoleChangeListenerMock.mockReturnValue(undefined);
  });

  test('mudança de papel em qualquer slot dispara revalidate (ambos os slots registrados)', async () => {
    const {monitoramento, alertas} =
      organizationDocument().organizacoes[0]!.materializacao;
    render(<ProjectRemovalListener />);

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
    for (const listener of mockListeners.get(alertas.projectId!) ?? []) {
      listener({role: {roleId: 'blocked'}});
    }
    expect(mockRevalidate).toHaveBeenCalledTimes(1);

    // E no slot selecionado também: QUALQUER mudança revalida — o motor
    // decide (confirma sem publicar ou publica a perda).
    for (const listener of mockListeners.get(monitoramento.projectId!) ?? []) {
      listener({role: {roleId: 'coordinator'}});
    }
    expect(mockRevalidate).toHaveBeenCalledTimes(2);
  });

  test('sem organização ativa nenhum listener é registrado', async () => {
    mockStore.instance.setState({...organizationDocument(), ativa: null}, true);
    render(<ProjectRemovalListener />);
    // O waitFor descarrega o trabalho agendado do React antes da asserção
    // negativa: nenhum slot existe, logo nenhum projeto é consultado.
    await waitFor(() => {
      expect(useSingleProjectMock).not.toHaveBeenCalled();
    });
    expect(useProjectOwnRoleChangeListenerMock).not.toHaveBeenCalled();
    expect(mockListeners.size).toBe(0);
    expect(mockRevalidate).not.toHaveBeenCalled();
  });

  test('com o motor em loading nada é anexado: a ativação é dona do motor e o listener não dispara', async () => {
    // Durante `loading`/`opening` uma ativação é dona do motor — os slots
    // montam (a organização ativa existe) mas o efeito do slot não anexa
    // ouvinte e nenhuma mudança de papel pode revalidar no meio.
    mockActivationContext.status = 'loading';
    render(<ProjectRemovalListener />);
    await waitFor(() => {
      expect(useSingleProjectMock).toHaveBeenCalledWith({
        projectId: 'A-m',
      });
    });
    expect(mockListeners.size).toBe(0);
    expect(mockRevalidate).not.toHaveBeenCalled();
  });
});
