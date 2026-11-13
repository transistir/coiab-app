// THROWAWAY PROBE p3 — one mount of the 5-item tab bar case, same body as
// index.test.tsx 'a tab bar mostra exatamente 5 itens ...'. The index.test.tsx
// tracking/Tracks.svg mocks are left out: the tracking ones delegate to the
// real hooks and the SVG one only exposes `color`, neither changes the graph.
import {mark, startSampler} from './heapProbe';
import {useHomeTabsHarness} from '../homeTabsHarness';

import {screen} from '@testing-library/react-native';

mark(__filename, 'after-imports');
const stopSampler = startSampler(__filename);

afterAll(() => {
  // Runs after the harness afterEach, i.e. after unmount + core teardown.
  stopSampler();
  mark(__filename, 'after-teardown');
});

describe('p3: 5-item tab bar, one mount', () => {
  const h = useHomeTabsHarness();

  beforeEach(() => mark(__filename, 'after-core-setup'));

  test('a tab bar mostra exatamente 5 itens, Menu ativo por padrão', async () => {
    await h.renderHomeTabs();
    mark(__filename, 'after-render');

    const tabButtons = [
      'tabBarButtonMenu',
      'tabBarButtonPaneiro',
      'tabBarButtonMap',
      'tabBarButtonNotificacoes',
      'tabBarButtonConfiguracoes',
    ];
    for (const testID of tabButtons) {
      expect(await screen.findByTestId(testID)).toBeTruthy();
    }
    mark(__filename, 'after-find-tabs');
    expect(screen.queryByTestId('tabBarButtonCamera')).toBeNull();
    expect(screen.queryByTestId('tabBarButtonTracking')).toBeNull();
    expect(screen.queryByTestId('tabBarButtonFiltros')).toBeNull();
    expect(screen.queryByTestId('tabBarButtonEntroncamento')).toBeNull();

    expect(screen.queryByText('Menu')).toBeNull();
    expect(screen.queryByText('Paneiro')).toBeNull();
    expect(screen.queryByText('Filtros')).toBeNull();
    expect(screen.queryByText('Entroncamento')).toBeNull();

    expect(h.navigation.getCurrentRoute()?.name).toBe('Menu');
    expect(await screen.findByTestId('MENU.scrn')).toBeTruthy();
    expect(screen.getByTestId('ENTRONCAMENTO.scrn')).toBeTruthy();
    mark(__filename, 'after-assertions');
  }, 180_000);
});
