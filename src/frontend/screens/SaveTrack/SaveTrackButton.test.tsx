import {fireEvent, render, screen} from '@testing-library/react-native';

const mockCreateTrack = jest.fn();
jest.mock('@comapeo/core-react', () => ({
  useCreateDocument: () => ({mutate: mockCreateTrack, status: 'idle'}),
}));

const mockNavigation = {navigate: jest.fn(), popTo: jest.fn()};
jest.mock('../../hooks/useNavigationWithTypes', () => ({
  useNavigationFromRoot: () => mockNavigation,
}));

let mockActiveProjectId = 'B-m';
jest.mock('../../contexts/ActiveProjectContext', () => ({
  useActiveProject: () => ({projectId: mockActiveProjectId}),
}));

jest.mock('@sentry/react-native', () => ({captureException: jest.fn()}));

import * as Sentry from '@sentry/react-native';
import {
  createTrackStore,
  TrackStoreProvider,
} from '../../contexts/TrackStoreContext';
import {SaveTrackButton} from './SaveTrackButton';

async function setup(
  activeProjectId: string,
  origemDaTrilha: string | null = 'A-m',
) {
  mockActiveProjectId = activeProjectId;
  const trackStore = createTrackStore();
  // Trilha persistida com a origem informada (carimbada quando aquele projeto
  // era o ativo); `undefined` reproduz uma trilha parada LEGADA, persistida
  // antes da camada de organização, sem carimbo de origem.
  trackStore.instance.setState({
    projectId: origemDaTrilha ?? undefined,
    description: 'trilha de A',
    locationHistory: [{latitude: 0, longitude: 0, timestamp: 1}],
    distance: 10,
  });
  await render(
    <TrackStoreProvider value={trackStore}>
      <SaveTrackButton />
    </TrackStoreProvider>,
  );
  return {trackStore};
}

beforeEach(() => {
  mockCreateTrack.mockClear();
  mockNavigation.navigate.mockClear();
  mockNavigation.popTo.mockClear();
  jest.mocked(Sentry.captureException).mockClear();
});

describe('assertOrigin no handler real de salvamento da trilha (FIX-F)', () => {
  test('origem divergente: escrita no core é impedida e o erro é tratado', async () => {
    const {trackStore} = await setup('B-m');

    await fireEvent.press(screen.getByLabelText('Save track.'));

    // A escrita no core NUNCA acontece com origem divergente.
    expect(mockCreateTrack).not.toHaveBeenCalled();
    // A recusa work-origin-mismatch é reportada e surfaced ao usuário.
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({message: 'work-origin-mismatch'}),
    );
    expect(mockNavigation.navigate).toHaveBeenCalledWith(
      'ErrorBottomSheet',
      expect.objectContaining({error: expect.any(Error)}),
    );
    // A trilha persistida permanece intacta (origem + pontos preservados).
    expect(trackStore.instance.getState()).toMatchObject({
      projectId: 'A-m',
      description: 'trilha de A',
    });
    expect(trackStore.instance.getState().locationHistory).toHaveLength(1);
  });

  test('origem convergente: salvamento segue o fluxo normal', async () => {
    await setup('A-m');

    await fireEvent.press(screen.getByLabelText('Save track.'));

    expect(mockCreateTrack).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(mockNavigation.navigate).not.toHaveBeenCalled();
  });

  test('trilha legada sem origem continua salvável no projeto ativo', async () => {
    const {trackStore} = await setup('B-m', null);
    // Trilha parada anterior a este PR: nenhuma origem persistida.
    expect(trackStore.instance.getState().projectId).toBeUndefined();

    await fireEvent.press(screen.getByLabelText('Save track.'));

    // Ausência de origem NÃO é divergência: a escrita no core acontece.
    expect(mockCreateTrack).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(mockNavigation.navigate).not.toHaveBeenCalled();
  });
});
