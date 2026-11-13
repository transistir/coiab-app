// THROWAWAY PROBE m2 — m1 with ONE change: the Menu screen loses its
// animation options. Delete with __probe__/.
//
// Lever: HomeTabs declares Menu's options inline (Tab/index.tsx), so a test
// cannot reach them through props. Instead the module mock below wraps the
// Navigator returned by the REAL createBottomTabNavigator and clones the
// `name="Menu"` Screen element (same element type, so useNavigationBuilder
// still recognises it) with `animation`, `sceneStyleInterpolator` and
// `transitionSpec` removed. Every other option and every other screen is
// untouched. That is exactly the tree HomeTabs would produce if those three
// lines were deleted from Tab/index.tsx: Menu falls back to the navigator
// default, `animation: 'none'`, like the other tabs.
import {startSampler} from './heapProbe';
import {useHomeTabsHarness} from '../homeTabsHarness';

import {screen, userEvent} from '@testing-library/react-native';

jest.mock('@react-navigation/bottom-tabs', () => {
  const actual = jest.requireActual('@react-navigation/bottom-tabs');
  const React = require('react');
  const g = globalThis as unknown as {__m2MenuStripped?: number};
  g.__m2MenuStripped = 0;

  function stripMenu(children: unknown): unknown {
    return React.Children.map(children, (child: unknown) => {
      if (!React.isValidElement(child)) return child;
      const props = (child as {props: {name?: string; options?: unknown}})
        .props;
      if (props.name !== 'Menu') return child;
      if (typeof props.options !== 'object' || props.options === null) {
        throw new Error('m2: Menu options are no longer a plain object');
      }
      const rest = {...(props.options as Record<string, unknown>)};
      delete rest.animation;
      delete rest.sceneStyleInterpolator;
      delete rest.transitionSpec;
      g.__m2MenuStripped! += 1;
      return React.cloneElement(child, {options: rest});
    });
  }

  return {
    ...actual,
    createBottomTabNavigator: (...args: unknown[]) => {
      const tab = actual.createBottomTabNavigator(...args);
      const Navigator = (props: {children?: unknown}) =>
        React.createElement(tab.Navigator, props, stripMenu(props.children));
      return {...tab, Navigator};
    },
  };
});

const stopSampler = startSampler(__filename);
afterAll(() => stopSampler());

describe('m2: Menu without the shift animation', () => {
  const h = useHomeTabsHarness();

  test('o download do Paneiro segue funcionando sem o drawer (#118)', async () => {
    await h.renderHomeTabs();
    // Probe integrity: the lever must have hit the Menu screen.
    expect(
      (globalThis as unknown as {__m2MenuStripped?: number}).__m2MenuStripped,
    ).toBeGreaterThan(0);
    const user = userEvent.setup();

    await user.press(await screen.findByTestId('tabBarButtonPaneiro'));
    // Sem observação nem trilha, o botão de download não existe.
    expect(screen.queryByLabelText('Download Observations')).toBeNull();
  });
});
