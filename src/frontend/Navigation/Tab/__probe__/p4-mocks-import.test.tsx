// THROWAWAY PROBE p4 — index.test.tsx's module-level jest.mock block (verbatim)
// plus the import of ../index, WITHOUT the harness. Compare with p5 (same
// import, no mocks) and p6 (harness + same mocks + same import).
jest.mock('../../hooks/useTracking', () => {
  const actual = jest.requireActual<typeof import('../../hooks/useTracking')>(
    '../../hooks/useTracking',
  );
  return {...actual, useTracking: jest.fn(actual.useTracking)};
});
jest.mock('../../hooks/useTrackTimer', () => {
  const actual = jest.requireActual<typeof import('../../hooks/useTrackTimer')>(
    '../../hooks/useTrackTimer',
  );
  return {...actual, useTrackTimer: jest.fn(actual.useTrackTimer)};
});
jest.mock('../../images/Tracks.svg', () => 'TracksIcon');

import {TrackMapButton} from '../index';

test('imports', () => expect(TrackMapButton).toBeDefined());
