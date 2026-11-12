import * as React from 'react';
import type {InitialState} from '@react-navigation/native';
import {act, render, screen} from '@testing-library/react-native';
import {View} from 'react-native';

type BackPressHandler = () => boolean | null | undefined;
type BackHandlerEvent = {
  type: 'add' | 'remove';
  handler: BackPressHandler;
  subscriptions: BackPressHandler[];
};

type MockNavigationContainerProps = {
  children?: React.ReactNode;
  initialState?: InitialState;
  onReady?: () => void;
  onStateChange?: (state: InitialState) => void;
};

const backHandlerHolder = globalThis as {
  __storybookBackHandlers?: BackPressHandler[];
  __storybookBackEvents?: BackHandlerEvent[];
};

jest.mock('react-native/Libraries/Utilities/BackHandler', () => ({
  __esModule: true,
  default: {
    exitApp: jest.fn(),
    addEventListener: (_eventName: string, handler: BackPressHandler) => {
      const holder = globalThis as {
        __storybookBackHandlers?: BackPressHandler[];
        __storybookBackEvents?: BackHandlerEvent[];
      };
      const handlers = (holder.__storybookBackHandlers ??= []);
      const events = (holder.__storybookBackEvents ??= []);
      if (!handlers.includes(handler)) handlers.push(handler);
      events.push({type: 'add', handler, subscriptions: [...handlers]});
      return {
        remove: () => {
          const index = handlers.indexOf(handler);
          if (index !== -1) handlers.splice(index, 1);
          events.push({type: 'remove', handler, subscriptions: [...handlers]});
        },
      };
    },
  },
}));

const navigationHolder = globalThis as {
  __storybookNavigation?: {
    currentState?: InitialState;
    forceState?: (state: InitialState) => void;
    resetCalls: number;
  };
};

jest.mock('@react-navigation/native', () => {
  const React = require('react');
  const {BackHandler, View} = require('react-native');
  const holder = globalThis as {
    __storybookNavigation?: {
      currentState?: InitialState;
      forceState?: (state: InitialState) => void;
      resetCalls: number;
    };
  };

  return {
    // The production NavigationContainer API still exposes its ref this way.
    // eslint-disable-next-line @eslint-react/no-forward-ref
    NavigationContainer: React.forwardRef(function MockNavigationContainer(
      props: MockNavigationContainerProps,
      ref: unknown,
    ) {
      const [renderedState, setRenderedState] = React.useState(
        props.initialState,
      );
      const onReady = props.onReady;

      const [applyState] = React.useState(() => (nextState: InitialState) => {
        if (holder.__storybookNavigation) {
          holder.__storybookNavigation.currentState = nextState;
        }
        setRenderedState(nextState);
        props.onStateChange?.(nextState);
      });

      React.useImperativeHandle(
        ref as never,
        () => ({
          getCurrentRoute: () => {
            const current = holder.__storybookNavigation?.currentState;
            const index = current?.index ?? (current?.routes.length ?? 1) - 1;
            return current?.routes[index];
          },
          getRootState: () => holder.__storybookNavigation?.currentState,
          reset: (nextState: InitialState) => {
            if (holder.__storybookNavigation) {
              holder.__storybookNavigation.resetCalls += 1;
            }
            applyState(nextState);
          },
        }),
        [applyState],
      );

      React.useEffect(() => {
        if (!holder.__storybookNavigation) return;
        holder.__storybookNavigation.forceState = applyState;
        const subscription = BackHandler.addEventListener(
          'hardwareBackPress',
          () => {
            const current = holder.__storybookNavigation?.currentState;
            if (!current) return false;
            const index = current.index ?? current.routes.length - 1;
            if (index <= 0) return false;
            applyState({
              ...current,
              index: index - 1,
              routes: current.routes.slice(0, index),
            });
            return true;
          },
        );
        return () => subscription.remove();
      }, [applyState]);

      React.useEffect(() => {
        onReady?.();
      }, [onReady]);

      return (
        <View testID={`mock-navigation.${renderedState?.index ?? 'none'}`}>
          {props.children}
        </View>
      );
    }),
  };
});

jest.mock('./index', () => ({
  RootStackNavigator: () => null,
}));

const flowStateHolder = globalThis as {
  __storybookFlowState?: {
    key: string;
    projectId?: string;
    observationIds: readonly string[];
  };
};

jest.mock('../../../../.rnstorybook/utils/flowState', () => ({
  useFlowState: () =>
    (globalThis as typeof flowStateHolder).__storybookFlowState ?? null,
}));

import {withRealNavigator} from '../../../../.rnstorybook/decorators/withRealNavigator';

function seededDeepStackInitialState(): InitialState {
  return {
    routes: [
      {
        name: 'Home',
        state: {routes: [{name: 'Map'}], index: 0},
      },
      {name: 'ObservationCategoryChooser'},
      {name: 'ObservationCreate'},
      {name: 'ObservationFields', params: {fieldIds: ['field-1']}},
    ],
    index: 3,
  };
}

function stateThrough(routeName: string): InitialState {
  const seeded = seededDeepStackInitialState();
  const index = seeded.routes.findIndex(route => route.name === routeName);
  return {...seeded, index, routes: seeded.routes.slice(0, index + 1)};
}

function renderDecorator(storyId: string) {
  const initialState = seededDeepStackInitialState();
  if (navigationHolder.__storybookNavigation) {
    navigationHolder.__storybookNavigation.currentState = initialState;
  }
  const context = {
    id: storyId,
    parameters: {flow: {initialState}},
  } as unknown as Parameters<typeof withRealNavigator>[1];
  const DecoratorHost = () => withRealNavigator(() => <View />, context);
  return render(<DecoratorHost />);
}

function routeMarker(storyId: string, routeName: string) {
  return `STORYBOOK.flow-ready.${storyId}.${routeName}`;
}

function spyOnStorybookConsole() {
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const including = (needle: string) =>
    [...log.mock.calls, ...warn.mock.calls]
      .map(args => String(args[0]))
      .filter(message => message.includes(needle));
  return {
    including,
    restore: () => {
      log.mockRestore();
      warn.mockRestore();
    },
  };
}

function dispatchHardwareBack() {
  const called: BackPressHandler[] = [];
  const handlers = backHandlerHolder.__storybookBackHandlers ?? [];
  for (let index = handlers.length - 1; index >= 0; index--) {
    const handler = handlers[index];
    if (!handler) continue;
    called.push(handler);
    if (handler() === true) break;
  }
  return called;
}

beforeEach(() => {
  backHandlerHolder.__storybookBackHandlers = [];
  backHandlerHolder.__storybookBackEvents = [];
  navigationHolder.__storybookNavigation = {resetCalls: 0};
  flowStateHolder.__storybookFlowState = {
    key: 'flow:ready',
    projectId: 'project-1',
    observationIds: ['observation-1'],
  };
});

describe('withRealNavigator seeded deep stack', () => {
  test('repairs an unexpected post-mount pop with the complete seeded state', async () => {
    const storyId = 'seeded-deep-stack-repair';
    const consoleSpy = spyOnStorybookConsole();
    const view = await renderDecorator(storyId);

    try {
      await screen.findByTestId(routeMarker(storyId, 'ObservationFields'));

      await act(async () => {
        navigationHolder.__storybookNavigation?.forceState?.(
          stateThrough('ObservationCreate'),
        );
      });

      expect(navigationHolder.__storybookNavigation?.resetCalls).toBe(1);
      expect(navigationHolder.__storybookNavigation?.currentState?.index).toBe(
        3,
      );
      expect(
        screen.getByTestId(routeMarker(storyId, 'ObservationFields')),
      ).toBeTruthy();
      expect(consoleSpy.including('state repair')).toHaveLength(1);
      expect(consoleSpy.including('nav state change')).not.toHaveLength(0);
      expect(consoleSpy.including('projectId: project-1')).not.toHaveLength(0);
      expect(consoleSpy.including('observation-1')).not.toHaveLength(0);
    } finally {
      consoleSpy.restore();
      await act(async () => view.unmount());
    }
  });

  test('subscribes a stable Storybook guard last and consumes hardware back', async () => {
    const storyId = 'seeded-deep-stack-hardware-back';
    const consoleSpy = spyOnStorybookConsole();
    const view = await renderDecorator(storyId);

    try {
      await screen.findByTestId(routeMarker(storyId, 'ObservationFields'));
      await act(async () => Promise.resolve());

      const events = backHandlerHolder.__storybookBackEvents ?? [];
      expect(events.filter(event => event.type === 'add')).toHaveLength(2);
      expect(events.filter(event => event.type === 'remove')).toHaveLength(0);

      let called: BackPressHandler[] = [];
      await act(async () => {
        called = dispatchHardwareBack();
      });

      expect(called).toHaveLength(1);
      expect(consoleSpy.including('hardware back consumed')).toHaveLength(1);
      expect(navigationHolder.__storybookNavigation?.resetCalls).toBe(0);
      expect(navigationHolder.__storybookNavigation?.currentState?.index).toBe(
        3,
      );
      expect(
        screen.getByTestId(routeMarker(storyId, 'ObservationFields')),
      ).toBeTruthy();
    } finally {
      consoleSpy.restore();
      await act(async () => view.unmount());
    }
  });
});
