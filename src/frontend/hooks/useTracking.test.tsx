import {act, renderHook} from '@testing-library/react-native';
import {type ReactNode} from 'react';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({navigate: mockNavigate}),
}));

jest.mock('@sentry/react-native', () => ({
  captureException: jest.fn(),
}));

jest.mock('expo-location', () => ({
  startLocationUpdatesAsync: jest.fn(async () => {}),
  stopLocationUpdatesAsync: jest.fn(async () => {}),
  Accuracy: {Highest: 5},
  LocationActivityType: {Fitness: 'fitness'},
}));

jest.mock('../contexts/LocationContext', () => ({
  useLocationContext: () => ({getState: () => ({location: null})}),
}));

import * as Location from 'expo-location';
import * as Sentry from '@sentry/react-native';
import {
  createTrackStore,
  type TrackStore,
  TrackStoreProvider,
} from '../contexts/TrackStoreContext';
import {useTracking} from './useTracking';

function createWrapper(trackStore: TrackStore) {
  return ({children}: {children: ReactNode}) => {
    return (
      <TrackStoreProvider value={trackStore}>{children}</TrackStoreProvider>
    );
  };
}

function seededTrackStore(activeProjectId: string) {
  const trackStore = createTrackStore();
  // Trilha persistida da organização A (A-m) com um ponto já gravado.
  trackStore.instance.setState({
    projectId: 'A-m',
    description: 'trilha de A',
    locationHistory: [{latitude: 0, longitude: 0, timestamp: 1}],
    distance: 10,
  });
  // Projeto operacional ativo divergente (B-m): o resolver do CA09 recusa.
  trackStore.setProjectResolver(() => activeProjectId);
  return trackStore;
}

beforeEach(() => {
  mockNavigate.mockClear();
  jest.mocked(Sentry.captureException).mockClear();
  jest.mocked(Location.startLocationUpdatesAsync).mockClear();
});

describe('startTracking e origem do trabalho (FIX-E)', () => {
  test('recusa de origem divergente não cega o estado: Sentry + ErrorBottomSheet, trilha intacta', async () => {
    const trackStore = seededTrackStore('B-m');
    const {result} = await renderHook(() => useTracking(), {
      wrapper: createWrapper(trackStore),
    });

    await act(async () => {
      result.current.startTracking();
    });

    // A recusa (work-origin-mismatch) foi reportada e surfaced ao usuário.
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({message: 'work-origin-mismatch'}),
    );
    expect(mockNavigate).toHaveBeenCalledWith(
      'ErrorBottomSheet',
      expect.objectContaining({error: expect.any(Error)}),
    );
    // A recusa aconteceu ANTES de qualquer mudança de estado — a trilha
    // persistida (origem + pontos) permanece intacta, isTracking continua
    // false (setTracking(false) cego destruiria trackingSince/estado).
    const state = trackStore.instance.getState();
    expect(state.isTracking).toBe(false);
    expect(state.projectId).toBe('A-m');
    expect(state.locationHistory).toHaveLength(1);
    expect(state.distance).toBe(10);
    // E o tracking de localização nunca chegou a iniciar.
    expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  test('origem convergente inicia o tracking normalmente', async () => {
    const trackStore = seededTrackStore('A-m');
    const {result} = await renderHook(() => useTracking(), {
      wrapper: createWrapper(trackStore),
    });

    await act(async () => {
      result.current.startTracking();
    });

    expect(Location.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(trackStore.instance.getState()).toMatchObject({
      isTracking: true,
      projectId: 'A-m',
    });
    expect(trackStore.instance.getState().locationHistory).toHaveLength(1);
  });
});
