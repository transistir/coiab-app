// THROWAWAY PROBE p1 — import cost only: the harness module graph (HomeTabs,
// core/IPC helpers, providers) is loaded, but no core manager is created and
// nothing renders (useHomeTabsHarness is never called).
import {mark, startSampler} from './heapProbe';
import {useHomeTabsHarness} from '../homeTabsHarness';

mark(__filename, 'after-imports');
const stopSampler = startSampler(__filename);

afterAll(() => {
  stopSampler();
  mark(__filename, 'afterAll');
});

test('p1: harness import only, no render', () => {
  expect(typeof useHomeTabsHarness).toBe('function');
  mark(__filename, 'in-test');
});
