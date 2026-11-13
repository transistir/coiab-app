// THROWAWAY PROBE m3 — m1 with ONE change: press Notificações instead of
// Paneiro, so the run leaves Menu the same way (a tab-bar press away from the
// initial Menu route) without mounting ObservationsList or its download
// headerRight. Delete with __probe__/.
import {startSampler} from './heapProbe';
import {useHomeTabsHarness} from '../homeTabsHarness';

import {screen, userEvent} from '@testing-library/react-native';

const stopSampler = startSampler(__filename);
afterAll(() => stopSampler());

describe('m3: leave Menu for Notificações', () => {
  const h = useHomeTabsHarness();

  test('leaving Menu without the download flow', async () => {
    await h.renderHomeTabs();
    const user = userEvent.setup();

    // The only change vs m1: a different destination tab.
    await user.press(await screen.findByTestId('tabBarButtonNotificacoes'));
    // Kept from m1 (trivially true here): same post-press query work.
    expect(screen.queryByLabelText('Download Observations')).toBeNull();
  });
});
