// THROWAWAY PROBE m1 (control) — test #2 of index.menu.test.tsx, body
// verbatim. Must OOM on CI to prove the probe reproduces the runaway; m2/m3
// are this file with exactly one change each. Delete with __probe__/.
import {startSampler} from './heapProbe';
import {useHomeTabsHarness} from '../homeTabsHarness';

import {screen, userEvent} from '@testing-library/react-native';

// Unref'd real-timer heap samples on stderr: if they stop while the heap
// climbs, the event loop is blocked (sync loop), not an async leak.
const stopSampler = startSampler(__filename);
afterAll(() => stopSampler());

describe('m1: control', () => {
  const h = useHomeTabsHarness();

  test('o download do Paneiro segue funcionando sem o drawer (#118)', async () => {
    await h.renderHomeTabs();
    const user = userEvent.setup();

    await user.press(await screen.findByTestId('tabBarButtonPaneiro'));
    // Sem observação nem trilha, o botão de download não existe.
    expect(screen.queryByLabelText('Download Observations')).toBeNull();
  });
});
