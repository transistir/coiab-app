/**
 * Shared, NON-test module for the seeded deep stack suites:
 *
 * - seededDeepStack.navigator.test.tsx — RootStackNavigator seeded deep stack
 *   (story 18);
 * - seededDeepStack.guardOrder.test.tsx — hardware-back guard vs
 *   NavigationContainer subscription order;
 * - seededDeepStack.decorator.test.tsx — real decorator repairs a popped
 *   seeded deep stack.
 *
 * They used to share one file whose three `describe` blocks each booted a
 * real `@comapeo/core` client in the same jest worker. Each file now calls
 * `setupIntegrationTest()` once, and this module holds what they share.
 *
 * The `mock*Module` functions are jest.mock FACTORY BODIES: each suite still
 * calls `jest.mock(path, () => jest.requireActual<typeof import(
 * './seededDeepStack.helpers')>('./seededDeepStack.helpers').mockXModule())`
 * itself, so babel-jest hoists the registration in the suite and the module
 * paths stay relative to the suite. Everything they need is `require`d
 * inside the factory, exactly as the inline factories did; this module has
 * only type imports at top level, so loading it from a factory pulls in
 * nothing else.
 */
import {Suspense} from 'react';
import type {
  NavigationContainerRef,
  InitialState,
} from '@react-navigation/native';
import type {AppStackParamsList} from '../../sharedTypes/navigation';

// jest-expo resolves the iOS no-op BackHandler (addEventListener does
// nothing and nothing ever dispatches). Mock the deep path that react-native
// itself requires with the real Android implementation — the one production
// Android runs, whose subscription array dispatches LAST-IN-FIRST-OUT. Every
// BackHandler consumer in the suite (the guard, the container's
// useBackButton, screen hooks) then shares that one subscription array. The
// mock also keeps its own mirror of that array (identity-deduped adds,
// identity-based removal — see BackHandler.android.js) and, when a test
// installs `__hwBackEvents` on globalThis (jest.mock factories are hoisted
// above module scope and may not close over module variables), records every
// add/remove together with a snapshot of the array as it stood at that
// instant. A test can then dispatch against the array as it was at ANY
// historical moment — in particular right after mount, before any
// re-render could churn subscriptions.
export type BackPressHandler = () => boolean | null | undefined;
export type BackHandlerEvent = {
  type: 'add' | 'remove';
  handler: BackPressHandler;
  /** Mirror of the subscription array immediately AFTER this event applied. */
  subscriptions: BackPressHandler[];
};
export const backHandlerHolder = globalThis as {
  __hwBackEvents?: BackHandlerEvent[];
};

/** Factory body for `jest.mock('react-native/Libraries/Utilities/BackHandler')`. */
export function mockBackHandlerModule() {
  const android =
    require('react-native/Libraries/Utilities/BackHandler.android').default;
  const live: BackPressHandler[] = [];
  const record = (type: 'add' | 'remove', handler: BackPressHandler) => {
    const events = (globalThis as {__hwBackEvents?: BackHandlerEvent[]})
      .__hwBackEvents;
    events?.push({type, handler, subscriptions: [...live]});
  };
  return {
    __esModule: true,
    default: {
      exitApp: android.exitApp,
      addEventListener: (eventName: string, handler: BackPressHandler) => {
        if (live.indexOf(handler) === -1) live.push(handler);
        record('add', handler);
        const subscription = android.addEventListener(eventName, handler);
        return {
          remove: () => {
            const index = live.indexOf(handler);
            if (index !== -1) live.splice(index, 1);
            record('remove', handler);
            subscription.remove();
          },
        };
      },
    },
  };
}

export type HardwareBackGuard = {consumed: string[]};

// Gate lives on globalThis because jest.mock factories are hoisted above
// module scope and may not close over module variables.
export const guardHolder = globalThis as {__hwBackGuard?: HardwareBackGuard};

/**
 * The suite's `mock*` variables the mocked MockedAppNavigator reads and
 * writes. Passed as callbacks so the suite keeps owning them (a jest.mock
 * factory may close over `mock`-prefixed variables).
 */
export type SeededNavigatorBindings = {
  onRef?: (ref: NavigationContainerRef<AppStackParamsList>) => void;
  getInitialState?: () => InitialState | undefined;
  onStateChange?: (state: InitialState) => void;
};

/** Factory body for `jest.mock('…/tests/integration/helpers/navigation')`. */
export function mockSeededNavigatorModule(
  bindings: SeededNavigatorBindings = {},
) {
  const React = require('react');
  const {BackHandler} = require('react-native');
  const {NavigationContainer} = require('@react-navigation/native');
  const {RootStackNavigator} = require('./index');

  // Mirror of the storybook flow decorator's ConsumeHardwareBackPress
  // (.rnstorybook/decorators/withRealNavigator.tsx).
  function ConsumeHardwareBackPress({
    enabled,
    onConsumed,
  }: {
    enabled: boolean;
    onConsumed?: (reason: string) => void;
  }) {
    React.useEffect(() => {
      if (!enabled) return;
      const subscription = BackHandler.addEventListener(
        'hardwareBackPress',
        () => {
          onConsumed?.('stack-seeded story; not popping');
          return true;
        },
      );
      return () => subscription.remove();
    }, [enabled, onConsumed]);
    return null;
  }

  return {
    // Mount only the navigator the shipping app renders, inside our own
    // NavigationContainer that owns the seeded deep-stack initialState —
    // the same shape the Storybook flow decorator (withRealNavigator) uses.
    // A guard installed via __hwBackGuard mirrors the PRE-FIX topology of
    // the decorator's ConsumeHardwareBackPress: rendered INSIDE the
    // NavigationContainer, so child effects subscribe it before the
    // container's own handler and LIFO dispatch lets the container pop
    // first. It exists only as the control that documents the failure
    // mode; the FIXED sibling topology is regression-tested against the
    // real decorator, not against this mirror.
    MockedAppNavigator: () => {
      const guard = (globalThis as {__hwBackGuard?: HardwareBackGuard})
        .__hwBackGuard;
      return (
        <NavigationContainer
          ref={(ref: NavigationContainerRef<AppStackParamsList>) => {
            bindings.onRef?.(ref);
          }}
          initialState={bindings.getInitialState?.()}
          onStateChange={(state: InitialState) => {
            bindings.onStateChange?.(state as InitialState);
          }}>
          {guard ? (
            <ConsumeHardwareBackPress
              enabled={true}
              onConsumed={(reason: string) => {
                guard.consumed.push(reason);
              }}
            />
          ) : null}
          <Suspense fallback={null}>
            <RootStackNavigator />
          </Suspense>
        </NavigationContainer>
      );
    },
  };
}

// The full navigator mounts the real Home tabs (MapScreen included) — the
// map stack is stubbed exactly like index.navigator.test.tsx does.
/** Factory body for `jest.mock('@maplibre/maplibre-react-native')`. */
export function mockMaplibreModule() {
  const React = require('react');
  const {View} = require('react-native');
  const Stub = (
    props: {children?: React.ReactNode} & Record<string, unknown>,
  ) => {
    const {children, ...rest} = props || {};
    return React.createElement(View, rest, children);
  };

  const LineJoin = {Round: 'round', Bevel: 'bevel', Miter: 'miter'};
  const LineCap = {Round: 'round', Butt: 'butt', Square: 'square'};

  return {
    __esModule: true,
    default: {
      MapView: Stub,
      Camera: Stub,
      UserLocation: Stub,
      ShapeSource: Stub,
      LineLayer: Stub,
      setAccessToken: jest.fn(),
      setTelemetryEnabled: jest.fn(),
    },
    // maplibre-react-native 11 renamed MapView/MarkerView to Map/Marker and
    // the merged MapScreen imports Map/Camera/UserLocation as named exports.
    MapView: Stub,
    Map: Stub,
    Marker: Stub,
    Camera: Stub,
    MarkerView: Stub,
    UserLocation: Stub,
    LineJoin,
    LineCap,
  };
}

/** Factory body for `jest.mock('../../hooks/useStorageReadingQuery')`. */
export function mockStorageReadingQueryModule() {
  const LOW = 500 * 1024 * 1024;
  return {
    __esModule: true,
    LOW_THRESHOLD_BYTES: LOW,
    useStorageReadingQuery: () => ({
      data: {freeBytes: 64 * 1024 * 1024 * 1024, totalBytes: Infinity},
    }),
    isLowStorage: (free: number | null, threshold: number = LOW) =>
      (free ?? Infinity) <= threshold,
  };
}

// Always-present, stable-identity field data: matches the seeded fieldIds so
// the screen's own goBack branch never fires, and avoids the undefined phase
// (an undefined->data transition re-suspends and loops the navigator).
const FIELDS = [
  {
    docId: 'field-1',
    versionId: 'field-1-v1',
    name: 'Test field',
    tagKey: 'test_field',
    type: 'text',
  },
];

/** Factory body for `jest.mock('../../hooks/server/fields')`. */
export function mockFieldsModule() {
  return {
    useFieldsQuery: () => ({data: FIELDS}),
  };
}

// Stub the screen UI: these suites target ROUTE reconciliation only. The real
// screen mounts @tanstack useSuspenseQuery chains (useManyDocs -> fetchOptimistic
// throws a promise) that loop without a Suspense boundary in the jest harness —
// an OOM artifact of the test env, not of production (CI pops with no crash).
// The real-screen pop evidence lives in CI captures; the fix is the
// withRealNavigator state-repair guard. The stub hands its navigation object
// to `__observationFieldsNavigation` (globalThis, for the same hoisting reason
// as the gates) so a test can pop the seeded top route for real.
/** Factory body for `jest.mock('../../screens/ObservationFields')`. */
export function mockObservationFieldsModule() {
  const React = require('react');
  return {
    ObservationFields: ({navigation}: {navigation: unknown}) => {
      React.useEffect(() => {
        (
          globalThis as {__observationFieldsNavigation?: unknown}
        ).__observationFieldsNavigation = navigation;
      }, [navigation]);
      return null;
    },
  };
}

/**
 * Spy on BOTH console channels the real decorator logs through: state repair
 * goes to console.warn, readiness / nav-state-change / back-consumed go to
 * console.log. Behavioral assertions must read the merged stream, or a
 * repair can fire unnoticed through the unspied channel.
 */
export function spyOnStorybookConsole() {
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

export function seededDeepStackInitialState(): InitialState {
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
