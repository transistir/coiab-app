import {act, renderHook} from '@testing-library/react-native';
import {type ReactNode} from 'react';
import {parse} from 'valibot';

import {
  createTrackStore,
  type TrackStore,
  TrackStoreProvider,
  useTrackActions,
  useTrackState,
  PresetSchema,
} from './TrackStoreContext';
import {calculateTotalDistance} from '../utils/distance.ts';

function createWrapper(trackStore: TrackStore) {
  return ({children}: {children: ReactNode}) => {
    return (
      <TrackStoreProvider value={trackStore}>{children}</TrackStoreProvider>
    );
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('PresetSchema', () => {
  it('validates geometry includes line', () => {
    expect(() =>
      parse(PresetSchema, {
        docId: 'id',
        name: 'Test Preset',
        geometry: ['point', 'line'],
        versionId: 'v1',
      }),
    ).not.toThrow();

    expect(() =>
      parse(PresetSchema, {
        docId: 'id',
        name: 'Test Preset',
        geometry: ['point'],
        versionId: 'v1',
      }),
    ).toThrow(/geometry must include "line"/);
  });
});

describe('useTrackState()', () => {
  test('initial state', async () => {
    const trackStore = createTrackStore();
    const wrapper = createWrapper(trackStore);

    const stateHook = await renderHook(() => useTrackState(), {
      wrapper,
    });

    expect(stateHook.result.current).toStrictEqual({
      description: '',
      distance: 0,
      isTracking: false,
      locationHistory: [],
      observationRefs: [],
      trackingSince: null,
      preset: null,
      docId: null,
    });
  });
});

describe('useTrackActions()', () => {
  test('setTracking()', async () => {
    const dateSpy = jest.spyOn(global, 'Date');

    const trackStore = createTrackStore();
    const wrapper = createWrapper(trackStore);

    const actionsHook = await renderHook(() => useTrackActions(), {
      wrapper,
    });
    const stateHook = await renderHook(() => useTrackState(), {
      wrapper,
    });

    await act(async () => {
      actionsHook.result.current.setTracking(true);
    });

    expect(stateHook.result.current).toStrictEqual({
      description: '',
      distance: 0,
      isTracking: true,
      locationHistory: [],
      observationRefs: [],
      trackingSince: dateSpy.mock.instances.at(-1),
      preset: null,
      docId: null,
    });

    await act(async () => {
      actionsHook.result.current.setTracking(false);
    });

    expect(stateHook.result.current).toStrictEqual({
      description: '',
      distance: 0,
      isTracking: false,
      locationHistory: [],
      observationRefs: [],
      trackingSince: null,
      preset: null,
      docId: null,
    });
  });

  test('addNewObservation()', async () => {
    const trackStore = createTrackStore();
    const wrapper = createWrapper(trackStore);

    const actionsHook = await renderHook(() => useTrackActions(), {
      wrapper,
    });
    const stateHook = await renderHook(() => useTrackState(), {
      wrapper,
    });

    await act(async () => {
      actionsHook.result.current.addNewObservation({
        docId: 'doc_1',
        versionId: 'version_1',
      });
    });

    expect(stateHook.result.current).toStrictEqual({
      description: '',
      distance: 0,
      isTracking: false,
      locationHistory: [],
      observationRefs: [{docId: 'doc_1', versionId: 'version_1'}],
      trackingSince: null,
      preset: null,
      docId: null,
    });
  });

  test('clearCurrentTrack()', async () => {
    const dateSpy = jest.spyOn(global, 'Date');

    const trackStore = createTrackStore();
    const wrapper = createWrapper(trackStore);

    const actionsHook = await renderHook(() => useTrackActions(), {
      wrapper,
    });
    const stateHook = await renderHook(() => useTrackState(), {
      wrapper,
    });

    await act(async () => {
      actionsHook.result.current.setTracking(true);
    });

    expect(stateHook.result.current).toStrictEqual({
      description: '',
      distance: 0,
      isTracking: true,
      locationHistory: [],
      observationRefs: [],
      trackingSince: dateSpy.mock.instances.at(-1),
      preset: null,
      docId: null,
    });

    await act(async () => {
      actionsHook.result.current.clearCurrentTrack();
    });

    expect(stateHook.result.current).toStrictEqual({
      // clearCurrentTrack drops the work origin along with the track.
      projectId: undefined,
      description: '',
      distance: 0,
      isTracking: false,
      locationHistory: [],
      observationRefs: [],
      trackingSince: null,
      preset: null,
      docId: null,
    });
  });

  test('setDescription()', async () => {
    const trackStore = createTrackStore();
    const wrapper = createWrapper(trackStore);

    const actionsHook = await renderHook(() => useTrackActions(), {
      wrapper,
    });
    const stateHook = await renderHook(() => useTrackState(), {
      wrapper,
    });

    await act(async () => {
      actionsHook.result.current.setDescription('some description');
    });

    expect(stateHook.result.current).toStrictEqual({
      description: 'some description',
      distance: 0,
      isTracking: false,
      locationHistory: [],
      observationRefs: [],
      trackingSince: null,
      preset: null,
      docId: null,
    });
  });

  test('addNewLocations()', async () => {
    const trackStore = createTrackStore();
    const wrapper = createWrapper(trackStore);

    const actionsHook = await renderHook(() => useTrackActions(), {
      wrapper,
    });
    const stateHook = await renderHook(() => useTrackState(), {
      wrapper,
    });

    const timestamp1 = Date.now();
    const timestamp2 = timestamp1 + 1_000;

    await act(async () => {
      actionsHook.result.current.addNewLocations([
        {latitude: 0, longitude: 0, timestamp: timestamp1},
        {latitude: 1, longitude: 1, timestamp: timestamp2},
      ]);
    });

    expect(stateHook.result.current).toMatchObject({
      description: '',
      isTracking: false,
      locationHistory: [
        {latitude: 0, longitude: 0, timestamp: timestamp1},
        {latitude: 1, longitude: 1, timestamp: timestamp2},
      ],
      observationRefs: [],
      trackingSince: null,
      distance: expect.any(Number),
    });
    expect(stateHook.result.current.distance).toBeGreaterThan(0);

    const previousDistance = stateHook.result.current.distance;

    const timestamp3 = timestamp2 + 1_000;

    await act(async () => {
      actionsHook.result.current.addNewLocations([
        {latitude: 0.5, longitude: 0.5, timestamp: timestamp3},
      ]);
    });

    expect(stateHook.result.current).toMatchObject({
      description: '',
      isTracking: false,
      locationHistory: [
        {latitude: 0, longitude: 0, timestamp: timestamp1},
        {latitude: 1, longitude: 1, timestamp: timestamp2},
        {latitude: 0.5, longitude: 0.5, timestamp: timestamp3},
      ],
      observationRefs: [],
      trackingSince: null,
      distance: expect.any(Number),
      preset: null,
      docId: null,
    });
    expect(stateHook.result.current.distance).toBeGreaterThan(previousDistance);
    expect(stateHook.result.current.distance).toBeCloseTo(
      calculateTotalDistance(stateHook.result.current.locationHistory),
      1,
    );

    // This test exists to check a previous implementation bug where adding more
    // than one location when there is already a location history would result
    // in incorrect distance calculation.
    await act(async () => {
      actionsHook.result.current.addNewLocations([
        {latitude: 0.5, longitude: 1, timestamp: timestamp3 + 1_000},
        {latitude: 0.5, longitude: 1.5, timestamp: timestamp3 + 2_000},
      ]);
    });

    expect(stateHook.result.current.distance).toBeCloseTo(
      calculateTotalDistance(stateHook.result.current.locationHistory),
      1,
    );
  });
});

describe('setTracking() e origem do trabalho (CA09)', () => {
  test('retomar trilha persistida de A-m com resolver B-m é recusado', () => {
    const trackStore = createTrackStore();
    trackStore.setProjectResolver(() => 'B-m');
    trackStore.instance.setState({
      projectId: 'A-m',
      description: 'trilha de A',
      locationHistory: [{latitude: 0, longitude: 0, timestamp: 1}],
      distance: 10,
    });

    expect(() => trackStore.actions.setTracking(true)).toThrow(
      'work-origin-mismatch',
    );

    const state = trackStore.instance.getState();
    expect(state.isTracking).toBe(false);
    expect(state.projectId).toBe('A-m');
    expect(state.locationHistory).toHaveLength(1);
  });

  test('retomar trilha com mesma origem preserva projectId e pontos', () => {
    const trackStore = createTrackStore();
    trackStore.setProjectResolver(() => 'A-m');
    trackStore.instance.setState({
      projectId: 'A-m',
      locationHistory: [{latitude: 0, longitude: 0, timestamp: 1}],
      distance: 10,
    });

    trackStore.actions.setTracking(true);

    expect(trackStore.instance.getState()).toMatchObject({
      isTracking: true,
      projectId: 'A-m',
    });
    expect(trackStore.instance.getState().locationHistory).toHaveLength(1);
  });

  test('trilha legada sem projectId retoma com origem do resolver', () => {
    const trackStore = createTrackStore();
    trackStore.setProjectResolver(() => 'B-m');
    trackStore.instance.setState({
      description: 'legada',
      locationHistory: [{latitude: 0, longitude: 0, timestamp: 1}],
    });

    trackStore.actions.setTracking(true);

    expect(trackStore.instance.getState()).toMatchObject({
      isTracking: true,
      projectId: 'B-m',
    });
  });
});
