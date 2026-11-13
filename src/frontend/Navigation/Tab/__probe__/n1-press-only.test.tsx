// THROWAWAY PROBE n1 — press Paneiro and nothing else. Delete with __probe__/.
//
// m1 with every post-press query removed: no findBy/queryBy on the download
// button, no assertion on the Paneiro screen. The only query is the
// pre-press findByTestId that locates the tab button (it has to exist before
// it can be pressed). If this OOMs, mounting the Paneiro tab through the press
// is enough to start the runaway.
//
// Stage marks go to the real stderr (see heapProbe): the last mark printed
// before the FATAL shows whether the process died in the body or in teardown.
import {mark, startSampler} from './heapProbe';
import {useHomeTabsHarness} from '../homeTabsHarness';

import {screen, userEvent} from '@testing-library/react-native';

const stopSampler = startSampler(__filename);
afterAll(() => {
  mark(__filename, 'n1:afterAll (teardown finished)');
  stopSampler();
});

describe('n1: press Paneiro only', () => {
  const h = useHomeTabsHarness();

  test('press tabBarButtonPaneiro, then wait 500 ms', async () => {
    await h.renderHomeTabs();
    const button = await screen.findByTestId('tabBarButtonPaneiro');
    mark(__filename, 'n1:before-press');

    await userEvent.setup().press(button);
    mark(__filename, 'n1:after-press');

    await new Promise(r => setTimeout(r, 500));
    mark(__filename, 'n1:after-500ms (body done)');

    // Integrity without touching the rendered tree: the press must have
    // focused the Paneiro route, or the run is not data.
    const route = h.navigation.getCurrentRoute()?.name;
    process.stderr.write(`[n1-integrity] current route=${String(route)}\n`);
    if (route !== 'ObservationsList') {
      throw new Error(
        `n1 INVALID: the press did not reach ObservationsList (route=${String(route)}); this run is not data`,
      );
    }
  });
});
