import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import {createStore} from 'zustand';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {PermissionStatus} from 'expo-location';

const mockCreateObservationAsync = jest.fn();
jest.mock('@comapeo/core-react', () => ({
  useCreateDocument: () => ({
    mutateAsync: mockCreateObservationAsync,
    status: 'idle',
  }),
}));

const mockCreatePhotoAttachmentAsync = jest.fn();
const mockCreateAudioAttachmentAsync = jest.fn();
jest.mock('../../hooks/server/media', () => ({
  useCreatePhotoAttachment: () => ({
    mutateAsync: mockCreatePhotoAttachmentAsync,
    status: 'idle',
  }),
  useCreateAudioAttachment: () => ({
    mutateAsync: mockCreateAudioAttachmentAsync,
    status: 'idle',
  }),
}));

const mockNavigation = {
  navigate: jest.fn(),
  popTo: jest.fn(),
  getState: () => ({routes: []}),
};
jest.mock('../../hooks/useNavigationWithTypes', () => ({
  useNavigationFromRoot: () => mockNavigation,
}));

let mockActiveProjectId = 'B-m';
jest.mock('../../contexts/ActiveProjectContext', () => ({
  useActiveProject: () => ({projectId: mockActiveProjectId}),
}));

let mockAuthState: 'visible' | 'obscured' = 'visible';
jest.mock('../../contexts/AuthContext', () => ({
  useAuthContext: () => ({authState: mockAuthState}),
}));

jest.mock('@sentry/react-native', () => ({captureException: jest.fn()}));

jest.mock('react-intl', () => ({
  defineMessages: (messages: unknown) => messages,
  useIntl: () => ({
    formatMessage: ({defaultMessage}: {defaultMessage: string}) =>
      defaultMessage,
  }),
}));

// DraftObservationProvider renders against LocationContext; keep it inert
// (same pattern as DraftObservationContext.test.tsx).
jest.mock('../../contexts/LocationContext', () => {
  const actual = jest.requireActual('../../contexts/LocationContext');
  return {...actual, useLocationContext: jest.fn()};
});

import * as Sentry from '@sentry/react-native';
import {
  useLocationContext,
  type LocationState,
} from '../../contexts/LocationContext';
import {createDraftObservationStore} from '../../contexts/PersistedStores/DraftObservationStore';
import {DraftObservationProvider} from '../../contexts/DraftObservationContext';
import {
  createTrackStore,
  TrackStoreProvider,
} from '../../contexts/TrackStoreContext';
import {ObservationCreateSaveButton} from './ObservationCreateSaveButton';

const mockUseLocationContext = useLocationContext as jest.MockedFunction<
  typeof useLocationContext
>;

function createMockLocationStore() {
  return createStore<LocationState>()(() => ({
    location: undefined,
    throttledMapLocation: undefined,
    locationPermission: PermissionStatus.DENIED,
    providerStatus: {
      locationServicesEnabled: false,
      backgroundModeEnabled: false,
      gpsAvailable: false,
      networkAvailable: false,
      passiveAvailable: false,
    },
  }));
}

async function setup(
  activeProjectId: string,
  origemDoRascunho: string | null = 'A-m',
) {
  mockActiveProjectId = activeProjectId;
  const draftStore = createDraftObservationStore({persist: false});
  // Rascunho carimbado com a origem informada (projeto ativo quando foi
  // criado); `undefined` reproduz um rascunho LEGADO, persistido antes da
  // camada de organização, que nunca recebeu carimbo de origem.
  if (origemDoRascunho) {
    draftStore.setProjectResolver(() => origemDoRascunho);
  }
  draftStore.actions.createDraft();
  if (!origemDoRascunho) {
    // Payload legado DEPOIS da migração de versão (M-1): carimbo explícito
    // de legado, sem projeto de origem.
    draftStore.instance.setState({originStatus: 'legacy'});
  }
  // manualLocation faz handlePressSave salvar direto (sem diálogo de GPS).
  draftStore.actions.updatePosition({
    manualLocation: true,
    position: {coords: {latitude: 1, longitude: 2}},
  });
  const trackStore = createTrackStore();
  const queryClient = new QueryClient();
  await render(
    <QueryClientProvider client={queryClient}>
      <TrackStoreProvider value={trackStore}>
        <DraftObservationProvider draftObservationStore={draftStore}>
          <ObservationCreateSaveButton />
        </DraftObservationProvider>
      </TrackStoreProvider>
    </QueryClientProvider>,
  );
  return {draftStore};
}

beforeEach(() => {
  mockAuthState = 'visible';
  mockUseLocationContext.mockReturnValue(createMockLocationStore());
  mockCreateObservationAsync.mockReset();
  mockCreateObservationAsync.mockResolvedValue({
    docId: 'obs-1',
    versionId: 'v1',
  });
  mockCreatePhotoAttachmentAsync.mockClear();
  mockCreateAudioAttachmentAsync.mockClear();
  mockNavigation.navigate.mockClear();
  mockNavigation.popTo.mockClear();
  jest.mocked(Sentry.captureException).mockClear();
});

describe('assertOrigin no handler real de salvamento da observação (FIX-F)', () => {
  test('rascunho de origem divergente: escrita no core é impedida e o erro é tratado', async () => {
    const {draftStore} = await setup('B-m');

    await fireEvent.press(screen.getByTestId('OBS.edit-save-btn'));

    // Nenhuma escrita no core acontece com origem divergente.
    expect(mockCreateObservationAsync).not.toHaveBeenCalled();
    expect(mockCreatePhotoAttachmentAsync).not.toHaveBeenCalled();
    expect(mockCreateAudioAttachmentAsync).not.toHaveBeenCalled();
    // A recusa work-origin-mismatch é reportada e surfaced ao usuário.
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({message: 'work-origin-mismatch'}),
    );
    expect(mockNavigation.navigate).toHaveBeenCalledWith(
      'ErrorBottomSheet',
      expect.objectContaining({error: expect.any(Error)}),
    );
    // O rascunho persistido NÃO é limpo por uma recusa — permanece intacto.
    expect(draftStore.instance.getState().value).not.toBeNull();
    expect(draftStore.instance.getState().projectId).toBe('A-m');
    expect(mockNavigation.popTo).not.toHaveBeenCalled();
  });

  test('rascunho de origem convergente: salva, limpa e navega normalmente', async () => {
    const {draftStore} = await setup('A-m');

    await fireEvent.press(screen.getByTestId('OBS.edit-save-btn'));

    await waitFor(() => {
      expect(mockCreateObservationAsync).toHaveBeenCalledTimes(1);
    });
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(mockNavigation.navigate).not.toHaveBeenCalled();
    // finalizeSave limpou o rascunho e voltou ao mapa.
    await waitFor(() => {
      expect(draftStore.instance.getState().value).toBeNull();
    });
    expect(mockNavigation.popTo).toHaveBeenCalledWith('Home', {
      screen: 'Map',
    });
  });
});

describe('rascunho legado sem origem (compatibilidade pré-multi-projeto)', () => {
  test('rascunho sem projectId continua salvável no projeto ativo', async () => {
    const {draftStore} = await setup('B-m', null);
    // Rascunho anterior a este PR: nenhuma origem persistida.
    expect(draftStore.instance.getState().projectId).toBeUndefined();

    await fireEvent.press(screen.getByTestId('OBS.edit-save-btn'));

    // Ausência de origem NÃO é divergência: a escrita no core acontece.
    await waitFor(() => {
      expect(mockCreateObservationAsync).toHaveBeenCalledTimes(1);
    });
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(mockNavigation.navigate).not.toHaveBeenCalled();
  });
});

describe('modo obscured (A-v4-4, CA09): kill-switch pré-existente do upstream', () => {
  // Regressão apenas: o ramo obscured não escreve nada no core e NÃO
  // reatribui a origem do rascunho ao projeto ativo. assertOrigin não é
  // exigido antes dessa saída (CA09/§5.3:180 exigem que o rascunho de A não
  // seja SALVO em B — e aqui nada é salvo); clearDraft() permanece FORA do
  // try, como no comportamento pré-existente.
  test('caminho obscured não executa escrita de observação nem reatribui origem', async () => {
    mockAuthState = 'obscured';
    // Rascunho com origem A-m; contexto ativo divergente (B-m).
    const {draftStore} = await setup('B-m');

    await fireEvent.press(screen.getByTestId('OBS.edit-save-btn'));

    // Nenhuma escrita de observação (nem anexos) acontece no ramo obscured.
    expect(mockCreateObservationAsync).not.toHaveBeenCalled();
    expect(mockCreatePhotoAttachmentAsync).not.toHaveBeenCalled();
    expect(mockCreateAudioAttachmentAsync).not.toHaveBeenCalled();
    // A origem NÃO é reatribuída ao projeto ativo: o estado esvaziado não
    // carrega projectId — muito menos o divergente 'B-m'.
    expect(draftStore.instance.getState().projectId).not.toBe('B-m');
    expect(draftStore.instance.getState().projectId).toBeUndefined();
    // Kill-switch não é caminho de erro: nada reportado nem surfaced.
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(mockNavigation.navigate).not.toHaveBeenCalled();
    expect(mockNavigation.popTo).toHaveBeenCalledWith('Home', {screen: 'Map'});
  });
});
