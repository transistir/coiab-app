// THROWAWAY PROBE n3 — m1 with ONE change: the Paneiro (ObservationsList)
// screen loses its `headerRight` (DownloadObservationsButton). Delete with
// __probe__/.
//
// Lever: the same Navigator wrapper style as m2, aimed at
// `name="ObservationsList"`, deleting only `headerRight`. `header:
// headerSolido` and `headerTransparent` stay, so HomeHeader still mounts.
//
// Why m2 was inert: it read its counter right after `renderHomeTabs()`, but
// the harness mounts HomeTabs under a Suspense boundary, so the Tab.Navigator
// (and the lever inside it) had not rendered yet. Here the counter is checked
// only after findByTestId('tabBarButtonPaneiro') resolves, which needs the
// navigator to have rendered. It is checked again after the press. A counter
// of 0 fails the test with an "INVALID" message, so the run is not data.
import {mark, startSampler} from './heapProbe';
import {useHomeTabsHarness} from '../homeTabsHarness';

import {screen, userEvent} from '@testing-library/react-native';

type G = {__n3HeaderStripped?: number};

jest.mock('@react-navigation/bottom-tabs', () => {
  const actual = jest.requireActual('@react-navigation/bottom-tabs');
  const React = require('react');
  const g = globalThis as unknown as G;
  g.__n3HeaderStripped = 0;

  function stripHeaderRight(children: unknown): unknown {
    return React.Children.map(children, (child: unknown) => {
      if (!React.isValidElement(child)) return child;
      const props = (child as {props: {name?: string; options?: unknown}})
        .props;
      if (props.name !== 'ObservationsList') return child;
      if (typeof props.options !== 'object' || props.options === null) {
        throw new Error('n3: ObservationsList options are not a plain object');
      }
      const rest = {...(props.options as Record<string, unknown>)};
      if (!('headerRight' in rest)) {
        throw new Error('n3: ObservationsList has no headerRight to remove');
      }
      delete rest.headerRight;
      g.__n3HeaderStripped! += 1;
      return React.cloneElement(child, {options: rest});
    });
  }

  return {
    ...actual,
    createBottomTabNavigator: (...args: unknown[]) => {
      const tab = actual.createBottomTabNavigator(...args);
      const Navigator = (props: {children?: unknown}) =>
        React.createElement(
          tab.Navigator,
          props,
          stripHeaderRight(props.children),
        );
      return {...tab, Navigator};
    },
  };
});

function leverCount(): number {
  return (globalThis as unknown as G).__n3HeaderStripped ?? 0;
}

function assertLeverFired(stage: string) {
  const n = leverCount();
  process.stderr.write(`[n3-lever] ${stage} __n3HeaderStripped=${n}\n`);
  if (n === 0) {
    throw new Error(
      `n3 INVALID: the headerRight lever never fired (${stage}); this run is not data`,
    );
  }
}

const stopSampler = startSampler(__filename);
afterAll(() => {
  mark(__filename, 'n3:afterAll (teardown finished)');
  stopSampler();
});

describe('n3: Paneiro without its headerRight', () => {
  const h = useHomeTabsHarness();

  test('o download do Paneiro segue funcionando sem o drawer (#118)', async () => {
    await h.renderHomeTabs();
    const button = await screen.findByTestId('tabBarButtonPaneiro');
    // The navigator has rendered, so its children went through the lever.
    assertLeverFired('after-tab-bar');
    const user = userEvent.setup();
    mark(__filename, 'n3:before-press');

    await user.press(button);
    mark(__filename, 'n3:after-press');
    assertLeverFired('after-press');

    // m1's own post-press line, kept so the only difference stays the lever.
    expect(screen.queryByLabelText('Download Observations')).toBeNull();
    mark(__filename, 'n3:body done');
  });
});
