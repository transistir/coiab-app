import type {
  NavigationContainerRef,
  InitialState,
} from '@react-navigation/native';
import type {AppStackParamsList} from '../../sharedTypes/navigation';

// jest-expo resolves the iOS no-op BackHandler (addEventListener does
// nothing and nothing ever dispatches). Mock the deep path that react-native
// itself requires with the real Android implementation — the one production
// Android runs, whose subscription array dispatches LAST-IN-FIRST-OUT. Every
// BackHandler consumer in this suite (the guard, the container's
// useBackButton, screen hooks) then shares that one subscription array. The
// mock also keeps its own mirror of that array (identity-deduped adds,
// identity-based removal — see BackHandler.android.js) and, when a test
// installs `__hwBackEvents` on globalThis (jest.mock factories are hoisted
// above module scope and may not close over module variables), records every
// add/remove together with a snapshot of the array as it stood at that
// instant. A test can then dispatch against the array as it was at ANY
// historical moment — in particular right after mount, before any
// re-render could churn subscriptions.
type BackPressHandler = () => boolean | null | undefined;
type BackHandlerEvent = {
  type: 'add' | 'remove';
  handler: BackPressHandler;
  /** Mirror of the subscription array immediately AFTER this event applied. */
  subscriptions: BackPressHandler[];
};
const backHandlerHolder = globalThis as {
  __hwBackEvents?: BackHandlerEvent[];
};

jest.mock('react-native/Libraries/Utilities/BackHandler', () => {
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
});

let mockNavigation: NavigationContainerRef<AppStackParamsList>;
let mockSeededInitialState: InitialState | undefined;
let mockOnRootStateChange: ((state: InitialState) => void) | undefined;

type HardwareBackGuard = {consumed: string[]};

// Gate lives on globalThis because jest.mock factories are hoisted above
// module scope and may not close over module variables.
const guardHolder = globalThis as {__hwBackGuard?: HardwareBackGuard};

jest.mock('../../../../tests/integration/helpers/navigation', () => {
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
    // real decorator below, not against this mirror.
    MockedAppNavigator: () => {
      const guard = (globalThis as {__hwBackGuard?: HardwareBackGuard})
        .__hwBackGuard;
      return (
        <NavigationContainer
          ref={(ref: NavigationContainerRef<AppStackParamsList>) => {
            mockNavigation = ref;
          }}
          initialState={mockSeededInitialState}
          onStateChange={(state: InitialState) => {
            mockOnRootStateChange?.(state as InitialState);
          }}>
          {guard ? (
            <ConsumeHardwareBackPress
              enabled={true}
              onConsumed={(reason: string) => {
                guard.consumed.push(reason);
              }}
            />
          ) : null}
          <RootStackNavigator />
        </NavigationContainer>
      );
    },
  };
});

// The full navigator mounts the real Home tabs (MapScreen included) — the
// map stack is stubbed exactly like index.navigator.test.tsx does.
jest.mock('@maplibre/maplibre-react-native', () => {
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
    LineJoin,
    LineCap,
  };
});

jest.mock('react-native-scale-bar', () => 'ScaleBar');

jest.mock('../../hooks/server/maps', () => ({
  useMapStyleJsonUrl: () => ({data: undefined}),
}));

jest.mock('../../hooks/useCurrentTime', () => ({
  useCurrentTime: () => new Date(),
}));

jest.mock('../../screens/MapScreen/MapLayers/ObservationMapLayer', () => ({
  ObservationMapLayer: () => null,
}));
jest.mock('../../screens/MapScreen/MapLayers/TracksMapLayer', () => ({
  TracksMapLayer: () => null,
}));
jest.mock(
  '../../screens/MapScreen/MapLayers/RemoteDetectionAlertsLayer',
  () => ({
    RemoteDetectionAlertsLayer: () => null,
  }),
);
jest.mock('../../screens/MapScreen/CurrentTrack/CurrentTrackMapLayer', () => ({
  CurrentTrackMapLayer: () => null,
}));
jest.mock('../../screens/MapScreen/CurrentTrack/UserTooltipMarker', () => ({
  UserTooltipMarker: () => null,
}));

jest.mock('../../hooks/useStorageReadingQuery', () => {
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
});

jest.mock('../../hooks/server/presets', () => ({
  usePresetsQuery: () => ({data: []}),
}));

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
jest.mock('../../hooks/server/fields', () => ({
  useFieldsQuery: () => ({data: FIELDS}),
}));

// Stub the screen UI: this test targets ROUTE reconciliation only. The real
// screen mounts @tanstack useSuspenseQuery chains (useManyDocs -> fetchOptimistic
// throws a promise) that loop without a Suspense boundary in the jest harness —
// an OOM artifact of the test env, not of production (CI pops with no crash).
// The real-screen pop evidence lives in CI captures; the fix is the
// withRealNavigator state-repair guard.
jest.mock('../../screens/ObservationFields', () => ({
  ObservationFields: () => null,
}));

process.env.MAPBOX_ACCESS_TOKEN = 'test-token';

// Gate lives on globalThis because jest.mock factories are hoisted above
// module scope and may not close over module variables.
const gateHolder = globalThis as {__fieldsGate?: {released: boolean}};
if (!gateHolder.__fieldsGate) {
  gateHolder.__fieldsGate = {released: false};
}

import {act, render, screen} from '@testing-library/react-native';
import {DeviceEventEmitter, View} from 'react-native';

import {setupIntegrationTest} from '../../../../tests/integration/helpers/setupIntegrationTest';
import {createAppProvidersWrapper} from '../../../../tests/integration/helpers/react';
import {withRealNavigator} from '../../../../.rnstorybook/decorators/withRealNavigator';

/**
 * Spy on BOTH console channels the real decorator logs through: state repair
 * goes to console.warn, readiness / nav-state-change / back-consumed go to
 * console.log. Behavioral assertions must read the merged stream, or a
 * repair can fire unnoticed through the unspied channel.
 */
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

/**
 * Story 18 regression (CI captures 34417507310 / 34422668174): with a seeded
 * deep stack [Home, ObservationCategoryChooser, ObservationCreate,
 * ObservationFields(index 3, fieldIds)] the app pops back to
 * ObservationCreate ~130ms after mount with no user interaction. Two state
 * changes fire in a row; the first screen-set reconciliation is the prime
 * suspect (auth-state / query-resolution ticks that change the navigator's
 * screen set after mount, making StackRouter prune and rebuild the state).
 */
describe('RootStackNavigator seeded deep stack (story 18)', () => {
  const orgSetup = setupIntegrationTest();

  test('a seeded ObservationFields stack survives post-mount query resolution', async () => {
    mockSeededInitialState = {
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

    const stateLog: Array<{index: number; routes: string[]}> = [];
    mockOnRootStateChange = state => {
      if (stateLog.length < 20) {
        stateLog.push({
          index: state.index ?? 0,
          routes: (state.routes ?? []).map(r => r.name),
        });
      }
    };

    await orgSetup.renderNavigation();

    // Let every post-mount query refresh tick land (device info, org list,
    // active project…): the APK pop happens ~130ms after mount.
    // First tick: queries resolve (gate released) ~like the emulator's
    // delayed useFieldsQuery.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
    });

    const currentName = mockNavigation.getCurrentRoute()?.name;
    // Diagnostics: shows every reconciliation the navigator performed.
    console.log(
      'state changes observed:',
      JSON.stringify(stateLog, undefined, 2),
    );

    expect(currentName).toBe('ObservationFields');
    expect(mockNavigation.getRootState().index).toBe(3);

    mockOnRootStateChange = undefined;
    mockSeededInitialState = undefined;
  }, 15000);
});

/**
 * Hardware-back guard topology (Greptile P1 on PR #63): the Storybook flow
 * decorator's ConsumeHardwareBackPress guard must subscribe AFTER the
 * NavigationContainer's own hardware-back handler. React Native's Android
 * BackHandler dispatches to its subscriptions LAST-IN-FIRST-OUT and stops at
 * the first handler returning true, so the handler registered LAST fires
 * FIRST. React runs child effects before parent effects, so a guard rendered
 * INSIDE the container subscribes before the container and the container's
 * handler (which pops) wins the dispatch. Rendered as a sibling AFTER the
 * container, the guard subscribes last and consumes the event first.
 */
describe('hardware-back guard vs NavigationContainer subscription order', () => {
  const orgSetup = setupIntegrationTest();

  afterEach(() => {
    guardHolder.__hwBackGuard = undefined;
  });

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

  async function renderSeededStackAndPressBack() {
    guardHolder.__hwBackGuard = {consumed: []};
    mockSeededInitialState = seededDeepStackInitialState();
    mockOnRootStateChange = undefined;

    await orgSetup.renderNavigation();

    // Let every post-mount query refresh tick land (as in the survival test
    // above): the guard topology under test must not race them.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
    });

    const routeBefore = mockNavigation.getCurrentRoute()?.name;
    const indexBefore = mockNavigation.getRootState().index;

    // RN 0.85 exports DeviceEventEmitter === RCTDeviceEventEmitter — the
    // exact emitter BackHandler.android.js dispatches through; it invokes
    // the subscriptions with no event argument (LIFO, stops at first true).
    await act(async () => {
      DeviceEventEmitter.emit('hardwareBackPress');
    });
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    const routeAfter = mockNavigation.getCurrentRoute()?.name;
    const indexAfter = mockNavigation.getRootState().index;
    const consumed = [...(guardHolder.__hwBackGuard?.consumed ?? [])];

    guardHolder.__hwBackGuard = undefined;
    mockSeededInitialState = undefined;
    mockOnRootStateChange = undefined;

    return {routeBefore, indexBefore, routeAfter, indexAfter, consumed};
  }

  // Documented topology mirror (control), NOT an anchor for the fix: it
  // reproduces the pre-fix child shape with this file's own mock to show the
  // LIFO failure mode. The regression tests below mount the REAL decorator
  // and would catch a revert of the fix in withRealNavigator.tsx.
  test('control: guard as a child INSIDE the container — the container pops the seeded stack (LIFO)', async () => {
    const result = await renderSeededStackAndPressBack();

    expect(result.routeBefore).toBe('ObservationFields');
    expect(result.indexBefore).toBe(3);

    // Child effects run before the container's own effect, so the container
    // subscribed LAST and LIFO dispatch hands the back event to it FIRST.
    expect(result.routeAfter).toBe('ObservationCreate');
    expect(result.indexAfter).toBe(2);
    // The dispatch stopped at the container (it returned true after
    // goBack()): the guard never saw the event.
    expect(result.consumed).toEqual([]);
  }, 15000);

  // Mounts the REAL decorator (.rnstorybook/decorators/withRealNavigator.tsx)
  // on the seeded deep stack and dispatches a REAL back event at steady
  // state: the guard must consume it, with no pop and no state repair
  // masking one. Note this alone does not anchor the topology fix — with an
  // inline onConsumed the pre-fix guard churns to the LIFO top after the
  // first re-render, so the steady-state press is consumed either way; the
  // MOUNT-TIME order test below is what catches a revert.
  test('regression: the real decorator renders the guard AFTER the container — a back press leaves the seeded stack intact', async () => {
    const consoleSpy = spyOnStorybookConsole();

    const appProviders = createAppProvidersWrapper({
      mapeoApi: orgSetup.client,
      activeProjectId: orgSetup.projectId,
    });
    const story = () => <View />;
    const storyId = 'seeded-deep-stack-sibling-guard';
    const context = {
      id: storyId,
      parameters: {flow: {initialState: seededDeepStackInitialState()}},
    } as unknown as Parameters<typeof withRealNavigator>[1];
    // Storybook invokes decorators as components; render a host component so
    // the decorator's hooks run inside React's render.
    const DecoratorHost = () => withRealNavigator(story, context);
    const view = await render(<DecoratorHost />, {
      wrapper: appProviders.wrapper,
    });
    const routeMarker = (route: string) =>
      `STORYBOOK.flow-ready.${storyId}.${route}`;

    try {
      // Flow state resolves ('flow:none' — no seeding spec), then the
      // container mounts straight onto the seeded deep stack.
      await screen.findByTestId(
        routeMarker('ObservationFields'),
        {},
        {timeout: 10000},
      );

      // Let post-mount query refreshes land before baselining the log, so a
      // late reconciliation tick cannot be mistaken for a back-press state
      // change.
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 500));
      });

      // Readiness was announced through the log channel, for the seeded top
      // route.
      const readyEntries = consoleSpy.including('Flow ready for story');
      expect(readyEntries.length).toBeGreaterThan(0);
      expect(readyEntries[readyEntries.length - 1]).toContain(
        'route: ObservationFields',
      );
      // No reconciliation pop happened pre-press: zero repairs in EITHER
      // console channel (repair logs via console.warn — an unspied channel
      // would hide it — readiness via console.log).
      expect(consoleSpy.including('state repair')).toEqual([]);
      // Whatever state the navigator did announce, the seeded top route was
      // still at index 3.
      for (const entry of consoleSpy.including('nav state change')) {
        expect(entry).toMatch(/index: 3;/);
      }
      const navStateChangesBefore = consoleSpy.including('nav state change');

      // RN 0.85 exports DeviceEventEmitter === RCTDeviceEventEmitter — the
      // exact emitter BackHandler.android.js dispatches through (LIFO, stops
      // at first true).
      await act(async () => {
        DeviceEventEmitter.emit('hardwareBackPress');
      });
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
      });

      // The guard consumed the event (log channel)...
      expect(consoleSpy.including('hardware back consumed')).toHaveLength(1);
      // ...so the navigator never popped: no state change fired at all —
      // with zero repairs the state is still the seeded initialState, i.e.
      // route ObservationFields at index 3 — and the state-repair path never
      // had to mask a pop (a masked pop still shows the wrong screen in the
      // capture window — CI run 34475503925).
      expect(consoleSpy.including('nav state change')).toEqual(
        navStateChangesBefore,
      );
      expect(consoleSpy.including('state repair')).toEqual([]);
      expect(screen.queryByTestId(routeMarker('ObservationCreate'))).toBeNull();
      expect(screen.getByTestId(routeMarker('ObservationFields'))).toBeTruthy();
    } finally {
      consoleSpy.restore();
      await act(async () => {
        view.unmount();
      });
      await appProviders.teardown();
    }
  }, 30000);

  // Anchors the guard's subscription ORDER to the mount-time topology,
  // churn-independently. The mock's event log carries a snapshot of the
  // subscription array at every add/remove, so this test can dispatch a back
  // event against the array exactly as a press arriving RIGHT AFTER MOUNT
  // would find it — before any re-render could churn subscriptions. That
  // window is the only place the pre-fix topology differs: with an INLINE
  // onConsumed the pre-fix guard (child INSIDE the container) subscribes
  // before the container's handler, loses the LIFO dispatch, and pops —
  // until the first re-render churns it to the LIFO top and masks the bug.
  // The assertion below reads only the mount-time snapshot (adds before the
  // first removal), so it passes for both an inline and a memoized guard
  // onConsumed and fails against the pre-fix child topology.
  test('regression: at mount time the real decorator subscribes the guard LAST — it is dispatched FIRST and consumes', async () => {
    const consoleSpy = spyOnStorybookConsole();
    const events: BackHandlerEvent[] = [];
    backHandlerHolder.__hwBackEvents = events;

    const appProviders = createAppProvidersWrapper({
      mapeoApi: orgSetup.client,
      activeProjectId: orgSetup.projectId,
    });
    const story = () => <View />;
    const storyId = 'seeded-deep-stack-guard-order';
    const context = {
      id: storyId,
      parameters: {flow: {initialState: seededDeepStackInitialState()}},
    } as unknown as Parameters<typeof withRealNavigator>[1];
    const DecoratorHost = () => withRealNavigator(story, context);
    const view = await render(<DecoratorHost />, {
      wrapper: appProviders.wrapper,
    });
    const routeMarker = (route: string) =>
      `STORYBOOK.flow-ready.${storyId}.${route}`;

    try {
      // Flow state resolves ('flow:none' — no seeding spec), then the
      // container mounts straight onto the seeded deep stack.
      await screen.findByTestId(
        routeMarker('ObservationFields'),
        {},
        {timeout: 10000},
      );
      expect(
        consoleSpy.including('Flow ready for story').length,
      ).toBeGreaterThan(0);
      expect(consoleSpy.including('state repair')).toEqual([]);

      // The mount-time array: everything subscribed before the FIRST removal
      // — i.e. before any re-render churn (an inline onConsumed re-runs the
      // guard's effect on every decorator render). Its last entry is what a
      // back press arriving right after mount dispatches FIRST.
      const firstRemoveIndex = events.findIndex(
        event => event.type === 'remove',
      );
      const mountTimeAdds = events
        .slice(0, firstRemoveIndex === -1 ? events.length : firstRemoveIndex)
        .filter(event => event.type === 'add');
      const lastMountAdd = mountTimeAdds[mountTimeAdds.length - 1];
      if (!lastMountAdd) {
        throw new Error('no mount-time BackHandler subscriptions recorded');
      }
      const recordedAtMount = lastMountAdd.subscriptions;
      // At least the container's useBackButton handler and the guard; the
      // dispatch below must stop at the guard before reaching the
      // container's.
      expect(recordedAtMount.length).toBeGreaterThanOrEqual(2);

      // Dispatch the back event against the RECORDING, exactly as
      // BackHandler.android's emitter listener does: iterate LIFO, stop at
      // the first handler returning true.
      const called: BackPressHandler[] = [];
      await act(async () => {
        for (let i = recordedAtMount.length - 1; i >= 0; i--) {
          const handler = recordedAtMount[i]!;
          called.push(handler);
          if (handler() === true) break;
        }
      });

      // The handler recorded LAST at mount time (LIFO: dispatched FIRST)
      // consumed the event on the first call...
      expect(called).toHaveLength(1);
      expect(called[0]).toBe(recordedAtMount[recordedAtMount.length - 1]);
      // ...and that handler is the guard (log channel), not the container's
      // useBackButton (which pops and would have changed the route).
      expect(consoleSpy.including('hardware back consumed')).toHaveLength(1);
      expect(consoleSpy.including('state repair')).toEqual([]);
      expect(screen.getByTestId(routeMarker('ObservationFields'))).toBeTruthy();
      expect(screen.queryByTestId(routeMarker('ObservationCreate'))).toBeNull();
    } finally {
      backHandlerHolder.__hwBackEvents = undefined;
      consoleSpy.restore();
      await act(async () => {
        view.unmount();
      });
      await appProviders.teardown();
    }
  }, 30000);
});
