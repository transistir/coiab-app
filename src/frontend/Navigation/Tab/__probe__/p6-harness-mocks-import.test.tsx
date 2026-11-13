// THROWAWAY PROBE p6 — index.test.tsx's exact module scope up to its imports
// (harness first, then the verbatim jest.mock block, then ../index), with no
// describe bodies. The real suite's imports are reproduced except the RNTL /
// styles ones, which p1-p3 already load.
import {useHomeTabsHarness} from '../homeTabsHarness';

jest.mock('../../../hooks/useTracking', () => {
  const actual = jest.requireActual<typeof import('../../../hooks/useTracking')>(
    '../../../hooks/useTracking',
  );
  return {...actual, useTracking: jest.fn(actual.useTracking)};
});
jest.mock('../../../hooks/useTrackTimer', () => {
  const actual = jest.requireActual<typeof import('../../../hooks/useTrackTimer')>(
    '../../../hooks/useTrackTimer',
  );
  return {...actual, useTrackTimer: jest.fn(actual.useTrackTimer)};
});
jest.mock('../../../images/Tracks.svg', () => 'TracksIcon');

import {useTracking} from '../../../hooks/useTracking';
import {useTrackTimer} from '../../../hooks/useTrackTimer';
import {TrackMapButton} from '../index';

test('imports', () => {
  expect(typeof useHomeTabsHarness).toBe('function');
  expect(jest.isMockFunction(useTracking)).toBe(true);
  expect(jest.isMockFunction(useTrackTimer)).toBe(true);
  expect(TrackMapButton).toBeDefined();
});
