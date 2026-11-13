// THROWAWAY PROBE p2 — one mount of the menu case, same body as
// index.menu.test.tsx 'o conteúdo do menu monta uma única vez (#118)'.
import {mark, startSampler} from './heapProbe';
import {useHomeTabsHarness} from '../homeTabsHarness';

import {screen, userEvent} from '@testing-library/react-native';

mark(__filename, 'after-imports');
const stopSampler = startSampler(__filename);

afterAll(() => {
  // Runs after the harness afterEach, i.e. after unmount + core teardown.
  stopSampler();
  mark(__filename, 'after-teardown');
});

describe('p2: menu, one mount', () => {
  const h = useHomeTabsHarness();

  // Registered after the harness's beforeEach, so it runs once the manager,
  // fastify and IPC are up and the project exists — before any render.
  beforeEach(() => mark(__filename, 'after-core-setup'));

  test('o conteúdo do menu monta uma única vez (#118)', async () => {
    await h.renderHomeTabs();
    mark(__filename, 'after-render');
    const user = userEvent.setup();

    await user.press(await screen.findByTestId('tabBarButtonMenu'));
    mark(__filename, 'after-press-menu');

    const copias = await screen.findAllByTestId('MENU.main-action-button', {
      includeHiddenElements: true,
    });
    expect(copias).toHaveLength(1);
    mark(__filename, 'after-assertions');
    // Long timeout on purpose: let an async climb run to the ceiling instead
    // of being cut by the 5 s default.
  }, 180_000);
});
