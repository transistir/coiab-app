import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import {createStore} from 'zustand';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {PermissionStatus} from 'expo-location';

const mockUpdateObservationAsync = jest.fn();
jest.mock('@comapeo/core-react', () => ({
  useUpdateDocument: () => ({
    mutateAsync: mockUpdateObservationAsync,
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

const mockNavigation = {navigate: jest.fn(), goBack: jest.fn()};
jest.mock('../../hooks/useNavigationWithTypes', () => ({
  useNavigationFromRoot: () => mockNavigation,
}));

let mockActiveProjectId = 'B-m';
jest.mock('../../contexts/ActiveProjectContext', () => ({
  useActiveProject: () => ({projectId: mockActiveProjectId}),
}));

jest.mock('@sentry/react-native', () => ({captureException: jest.fn()}));

// DraftObservationProvider renders against LocationContext; keep it inert
// (same pattern as ObservationCreateSaveButton.test.tsx).
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
import {ObservationEditSaveButton} from './ObservationEditSaveButton';

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

const unsavedPhoto = {
  id: 0,
  type: 'photo' as const,
  timestamp: 1,
  raw: {uri: 'file://raw.jpg', processingState: 'complete' as const},
  original: {uri: 'file://original.jpg', processingState: 'complete' as const},
  thumbnail: {uri: 'file://thumb.jpg', processingState: 'complete' as const},
  preview: {uri: 'file://preview.jpg', processingState: 'complete' as const},
};

const unsavedAudio = {
  id: 1,
  type: 'audio' as const,
  timestamp: 1,
  duration: 1000,
  original: {uri: 'file://audio.m4a', processingState: 'complete' as const},
};

// Observação já salva (edição): carrega docId + versionId para o botão de
// edição não abortar antes de chegar ao gate de origem.
const existingObservation = {
  docId: 'obs-1',
  versionId: 'v1',
  originalVersionId: 'v1',
  schemaName: 'observation' as const,
  lat: 1,
  lon: 2,
  metadata: {manualLocation: false},
  tags: {notes: 'obs de A'},
  attachments: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  links: [],
  deleted: false,
  createdBy: 'test-device',
};

async function setup(activeProjectId: string, origemDoRascunho = 'A-m') {
  mockActiveProjectId = activeProjectId;
  const draftStore = createDraftObservationStore({persist: false});
  // Rascunho de edição carimbado com a origem informada (projeto ativo quando
  // a edição começou), como faz Observation/index.tsx via createDraft().
  draftStore.setProjectResolver(() => origemDoRascunho);
  draftStore.actions.createDraft(existingObservation);
  draftStore.instance.setState(() => ({
    unsavedAttachments: [unsavedPhoto, unsavedAudio],
  }));
  const queryClient = new QueryClient();
  await render(
    <QueryClientProvider client={queryClient}>
      <DraftObservationProvider draftObservationStore={draftStore}>
        <ObservationEditSaveButton />
      </DraftObservationProvider>
    </QueryClientProvider>,
  );
  return {draftStore};
}

beforeEach(() => {
  mockUseLocationContext.mockReturnValue(createMockLocationStore());
  mockUpdateObservationAsync.mockReset();
  mockUpdateObservationAsync.mockResolvedValue({
    docId: 'obs-1',
    versionId: 'v2',
  });
  mockCreatePhotoAttachmentAsync.mockReset();
  mockCreatePhotoAttachmentAsync.mockResolvedValue({
    type: 'photo',
    hash: 'h',
    driveDiscoveryId: 'd',
    name: 'photo.jpg',
  });
  mockCreateAudioAttachmentAsync.mockReset();
  mockCreateAudioAttachmentAsync.mockResolvedValue({
    type: 'audio',
    hash: 'h',
    driveDiscoveryId: 'd',
    name: 'audio.m4a',
  });
  mockNavigation.navigate.mockClear();
  mockNavigation.goBack.mockClear();
  jest.mocked(Sentry.captureException).mockClear();
});

describe('assertOrigin no handler real de edição da observação (review round 2)', () => {
  test('rascunho de origem divergente: anexos não são escritos e o erro é tratado', async () => {
    const {draftStore} = await setup('B-m');

    await fireEvent.press(screen.getByTestId('OBS.edit-save-btn'));

    // Nenhuma escrita de anexo acontece com origem divergente — o gate de
    // origem precede qualquer gravação no media store do projeto ativo.
    expect(mockCreatePhotoAttachmentAsync).not.toHaveBeenCalled();
    expect(mockCreateAudioAttachmentAsync).not.toHaveBeenCalled();
    // A observação nunca é atualizada no core.
    expect(mockUpdateObservationAsync).not.toHaveBeenCalled();
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
    expect(mockNavigation.goBack).not.toHaveBeenCalled();
  });

  test('rascunho de origem convergente: salva anexos e a observação normalmente', async () => {
    const {draftStore} = await setup('A-m');

    await fireEvent.press(screen.getByTestId('OBS.edit-save-btn'));

    await waitFor(() => {
      expect(mockUpdateObservationAsync).toHaveBeenCalledTimes(1);
    });
    expect(mockCreatePhotoAttachmentAsync).toHaveBeenCalledTimes(1);
    expect(mockCreateAudioAttachmentAsync).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(mockNavigation.navigate).not.toHaveBeenCalled();
    // handleSaveSuccess limpou o rascunho e voltou à tela anterior.
    await waitFor(() => {
      expect(draftStore.instance.getState().value).toBeNull();
    });
    expect(mockNavigation.goBack).toHaveBeenCalled();
  });
});
