import * as React from 'react';
import {Text} from 'react-native';
import type {
  InitialState,
  NavigationProp,
  ParamListBase,
} from '@react-navigation/native';
import {act, render, screen} from '@testing-library/react-native';

import {withRealNavigator} from './withRealNavigator';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The decorator's seeded-state repair against real React Navigation: the
 * decorator's own `NavigationContainer`, a real native stack standing in for
 * `RootStackNavigator` and, under `Home`, a real bottom-tab navigator like the
 * app's `HomeTabs`. A test only chooses which screens that stack registers —
 * the decision `RootStackNavigator` makes from the resolved flow state — and
 * flow state resolves at once: seeding is covered by `FlowStateScope.test.tsx`.
 */
let mockRegisteredScreens: readonly string[] = [];
let mockHomeTabsMountLate = false;
const mockScreenNavigation: Record<string, NavigationProp<ParamListBase>> = {};
const mockReady = {key: 'flow:none', observationIds: []};

jest.mock('../utils/flowState', () => ({
  useFlowState: () => mockReady,
}));

jest.mock('../../src/frontend/Navigation/Stack', () => {
  const React = require('react');
  const {View} = require('react-native');
  const {
    createNativeStackNavigator,
  } = require('@react-navigation/native-stack');
  const {createBottomTabNavigator} = require('@react-navigation/bottom-tabs');
  const Stack = createNativeStackNavigator();
  const Tabs = createBottomTabNavigator();

  function Screen({
    navigation,
    route,
  }: {
    navigation: NavigationProp<ParamListBase>;
    route: {name: string};
  }) {
    React.useEffect(() => {
      mockScreenNavigation[route.name] = navigation;
    }, [navigation, route.name]);
    return <View testID={`SCREEN.${route.name}`} />;
  }

  // Mounting late models a Home whose tabs arrive in a later commit than the
  // stack screen hosting them.
  function HomeTabs() {
    const [tabsMounted, setTabsMounted] = React.useState(
      !mockHomeTabsMountLate,
    );
    React.useEffect(() => {
      if (tabsMounted) return;
      const timeout = setTimeout(() => setTabsMounted(true), 10);
      return () => clearTimeout(timeout);
    }, [tabsMounted]);
    if (!tabsMounted) return null;
    return (
      <Tabs.Navigator>
        <Tabs.Screen name="Map" component={Screen} />
        <Tabs.Screen name="ObservationsList" component={Screen} />
      </Tabs.Navigator>
    );
  }

  return {
    RootStackNavigator: () => (
      <Stack.Navigator>
        {mockRegisteredScreens.map(name => (
          <Stack.Screen
            key={name}
            name={name}
            component={name === 'Home' ? HomeTabs : Screen}
          />
        ))}
      </Stack.Navigator>
    ),
  };
});

type StoryContext = Parameters<typeof withRealNavigator>[1];
type StoryFn = Parameters<typeof withRealNavigator>[0];

/** Storybook's own boundary stands here: what reaches it broke the story. */
class StoryErrorBoundary extends React.Component<
  {caught: Error[]; children: React.ReactNode},
  {error?: Error}
> {
  state: {error?: Error} = {};

  static getDerivedStateFromError(error: Error) {
    return {error};
  }

  componentDidCatch(error: Error) {
    this.props.caught.push(error);
  }

  render() {
    return this.state.error ? (
      <Text testID="STORY.error">{this.state.error.message}</Text>
    ) : (
      this.props.children
    );
  }
}

const OBSERVATION_FIELDS_STACK: InitialState = {
  routes: [
    {name: 'Home', state: {routes: [{name: 'Map'}], index: 0}},
    {name: 'ObservationCategoryChooser'},
    {name: 'ObservationCreate'},
    {name: 'ObservationFields'},
  ],
  index: 3,
};

const OBSERVATION_FLOW_SCREENS = [
  'Home',
  'ObservationCategoryChooser',
  'ObservationCreate',
  'ObservationFields',
];

function routeMarker(storyId: string, routeName: string) {
  return `STORYBOOK.flow-ready.${storyId}.${routeName}`;
}

describe('withRealNavigator seeded-state repair (real navigation)', () => {
  let caught: Error[];
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;
  let unmount: (() => unknown) | undefined;

  const logged = (spy: jest.SpyInstance, needle: string) =>
    spy.mock.calls
      .map(args => String(args[0]))
      .filter(message => message.includes(needle));

  beforeEach(() => {
    caught = [];
    mockHomeTabsMountLate = false;
    for (const name of Object.keys(mockScreenNavigation)) {
      delete mockScreenNavigation[name];
    }
    log = jest.spyOn(console, 'log').mockImplementation(() => {});
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    // React reports the error a boundary caught through console.error.
    error = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    await unmount?.();
    unmount = undefined;
    log.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  });

  async function renderStory(storyId: string, initialState: InitialState) {
    const context = {
      id: storyId,
      parameters: {flow: {initialState}},
    } as unknown as StoryContext;
    const story = (() => null) as unknown as StoryFn;
    // Storybook invokes decorators as components.
    const DecoratorHost = () => withRealNavigator(story, context);
    const view = await render(
      <StoryErrorBoundary caught={caught}>
        <DecoratorHost />
      </StoryErrorBoundary>,
    );
    unmount = view.unmount;
  }

  async function settle() {
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });
  }

  test('(a) a reset the navigator accepts after a post-mount pop repairs the seeded stack without failing the story', async () => {
    mockRegisteredScreens = OBSERVATION_FLOW_SCREENS;
    const storyId = 'repair-accepted';
    await renderStory(storyId, OBSERVATION_FIELDS_STACK);

    expect(
      await screen.findByTestId(routeMarker(storyId, 'ObservationFields')),
    ).toBeOnTheScreen();

    // The pop the repair exists for: the seeded top route leaves the stack
    // after readiness was published, with no story interaction.
    await act(async () => {
      mockScreenNavigation.ObservationFields!.goBack();
    });
    await settle();

    expect(caught).toEqual([]);
    expect(logged(warn, 'state repair')).toEqual([
      `STORYBOOK: state repair for story: ${storyId}; route ObservationCreate -> ObservationFields`,
    ]);
    // The navigator really is back on the seeded stack...
    expect(
      mockScreenNavigation
        .ObservationCreate!.getState()
        .routes.map(route => route.name),
    ).toEqual(OBSERVATION_FLOW_SCREENS);
    expect(mockScreenNavigation.ObservationCreate!.getState().index).toBe(3);
    // ...and the marker names the route the navigator reports, published
    // only once the reset had reached it.
    expect(
      screen.getByTestId(routeMarker(storyId, 'ObservationFields')),
    ).toBeOnTheScreen();
    expect(
      screen.queryByTestId(routeMarker(storyId, 'ObservationCreate')),
    ).not.toBeOnTheScreen();
    expect(logged(log, 'Flow ready for story').at(-1)).toContain(
      'route: ObservationFields;',
    );
  });

  test('(b) a reset the navigator refuses fails the story instead of publishing the seeded route', async () => {
    // The seeded route is not in the registered screen set, as when the flow
    // state leaves the app on onboarding: the container falls back to the
    // stack's first screen and can never reach the seed.
    mockRegisteredScreens = ['Success', 'OrganizationProvisioning'];
    const storyId = 'repair-refused';
    await renderStory(storyId, {routes: [{name: 'Home'}], index: 0});

    expect(await screen.findByTestId('STORY.error')).toBeOnTheScreen();
    expect(caught.map(caughtError => caughtError.message)).toEqual([
      expect.stringContaining(
        `STORYBOOK: state repair failed for story: ${storyId};`,
      ),
    ]);
    expect(caught[0]!.message).toContain('Home');
    expect(logged(log, 'Flow ready for story')).toEqual([]);
    expect(
      screen.queryByTestId(`STORYBOOK.flow-ready.${storyId}`),
    ).not.toBeOnTheScreen();
  });

  test('(c) Home tabs mounted with the stack are the seeded route, not a pop to repair', async () => {
    mockRegisteredScreens = ['Home', 'Success'];
    const storyId = 'nested-seed';
    await renderStory(storyId, {
      routes: [{name: 'Home', state: {routes: [{name: 'Map'}], index: 0}}],
      index: 0,
    });
    await settle();

    expect(caught).toEqual([]);
    expect(logged(warn, 'state repair')).toEqual([]);
    // The tabs were already there when the container became ready.
    expect(logged(log, 'nav state change')).toEqual([]);
    expect(
      await screen.findByTestId(routeMarker(storyId, 'Map')),
    ).toBeOnTheScreen();
  });

  test('(c) Home tabs mounting after readiness reach the seeded tab, not the first one', async () => {
    // Row 19's seed: `Home` with its tabs seeded onto the SECOND tab. If a
    // late mount went through the tab navigator's own initial route first,
    // the leaf would be `Map` where the seed says `ObservationsList` and the
    // repair would fire on a story that is merely still mounting.
    mockRegisteredScreens = ['Home', 'Success'];
    mockHomeTabsMountLate = true;
    const storyId = 'late-tabs-nested-seed';
    await renderStory(storyId, {
      routes: [
        {name: 'Home', state: {routes: [{name: 'ObservationsList'}], index: 0}},
      ],
      index: 0,
    });
    await settle();
    await settle();

    expect(caught).toEqual([]);
    expect(logged(warn, 'state repair')).toEqual([]);
    // Readiness came first on Home, then on the seeded tab — never on `Map`.
    expect(logged(log, 'Flow ready for story')[0]).toContain('route: Home;');
    expect(logged(log, 'Flow ready for story').at(-1)).toContain(
      'route: ObservationsList;',
    );
    expect(
      logged(log, 'Flow ready for story').filter(message =>
        message.includes('route: Map;'),
      ),
    ).toEqual([]);
    expect(
      await screen.findByTestId(routeMarker(storyId, 'ObservationsList')),
    ).toBeOnTheScreen();
  });

  test('(c) Home tabs mounting after readiness change the leaf route without triggering a repair', async () => {
    mockRegisteredScreens = ['Home', 'Success'];
    mockHomeTabsMountLate = true;
    const storyId = 'late-tabs';
    // Row 11's seed: Home alone, its tabs left to their initial route.
    await renderStory(storyId, {routes: [{name: 'Home'}], index: 0});
    await settle();
    await settle();

    expect(caught).toEqual([]);
    expect(logged(warn, 'state repair')).toEqual([]);
    // Readiness came first, on Home; the tabs reached the container later, as
    // a state change.
    expect(logged(log, 'Flow ready for story')[0]).toContain('route: Home;');
    expect(logged(log, 'nav state change')).not.toEqual([]);
    expect(
      await screen.findByTestId(routeMarker(storyId, 'Map')),
    ).toBeOnTheScreen();
    expect(logged(log, 'Flow ready for story').at(-1)).toContain('route: Map;');
  });
});
