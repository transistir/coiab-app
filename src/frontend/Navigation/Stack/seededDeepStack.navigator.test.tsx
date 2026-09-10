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
// useBackButton, screen hooks) then shares that one subscription array, and
// every add/remove is recorded on globalThis (jest.mock factories are
// hoisted above module scope and may not close over module variables) so
// tests can assert the subscription order.
type BackHandlerOrderEvent = {type: 'add' | 'remove'; handler: unknown};
const backHandlerOrderHolder = globalThis as {
  __hwBackOrder?: Array<BackHandlerOrderEvent>;
};

jest.mock('react-native/Libraries/Utilities/BackHandler', () => {
  const android =
    require('react-native/Libraries/Utilities/BackHandler.android').default;
  return {
    __esModule: true,
    default: {
      exitApp: android.exitApp,
      addEventListener: (eventName: string, handler: unknown) => {
        const order = (globalThis as {__hwBackOrder?: BackHandlerOrderEvent[]})
          .__hwBackOrder;
        order?.push({type: 'add', handler});
        const subscription = android.addEventListener(eventName, handler);
        return {
          remove: () => {
            order?.push({type: 'remove', handler});
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

type HardwareBackGuardPosition = 'child' | 'sibling';
type HardwareBackGuard = {
  position: HardwareBackGuardPosition;
  consumed: string[];
};

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
    // The hardware-back guard position mirrors the decorator's topology:
    // unset = no guard (survival test below), 'child' = rendered inside the
    // container (pre-fix shape), 'sibling' = rendered after the container
    // (fixed shape).
    MockedAppNavigator: () => {
      const guard = (globalThis as {__hwBackGuard?: HardwareBackGuard})
        .__hwBackGuard;
      const guardElement = guard ? (
        <ConsumeHardwareBackPress
          enabled={true}
          onConsumed={(reason: string) => {
            guard.consumed.push(reason);
          }}
        />
      ) : null;
      return (
        <>
          <NavigationContainer
            ref={(ref: NavigationContainerRef<AppStackParamsList>) => {
              mockNavigation = ref;
            }}
            initialState={mockSeededInitialState}
            onStateChange={(state: InitialState) => {
              mockOnRootStateChange?.(state as InitialState);
            }}>
            {guard?.position === 'child' ? guardElement : null}
            <RootStackNavigator />
          </NavigationContainer>
          {guard?.position === 'sibling' ? guardElement : null}
        </>
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

  async function renderSeededStackAndPressBack(
    position: HardwareBackGuardPosition,
  ) {
    guardHolder.__hwBackGuard = {position, consumed: []};
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

  test('control: guard as a child INSIDE the container — the container pops the seeded stack (LIFO)', async () => {
    const result = await renderSeededStackAndPressBack('child');

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

  test('regression: guard as a SIBLING AFTER the container — the guard consumes the back event', async () => {
    const result = await renderSeededStackAndPressBack('sibling');

    expect(result.routeBefore).toBe('ObservationFields');
    expect(result.indexBefore).toBe(3);

    // Effects for the container's subtree complete before a later sibling
    // mounts, so the guard subscribed LAST and LIFO dispatch calls it FIRST;
    // returning true stops the dispatch before the navigator pops.
    expect(result.consumed).toEqual(['stack-seeded story; not popping']);
    expect(result.routeAfter).toBe('ObservationFields');
    expect(result.indexAfter).toBe(3);
  }, 15000);

  test('regression: the real withRealNavigator decorator subscribes the guard AFTER the container', async () => {
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
    const logsIncluding = (needle: string) =>
      consoleLog.mock.calls.filter(args => String(args[0]).includes(needle));

    const order: Array<BackHandlerOrderEvent> = [];
    backHandlerOrderHolder.__hwBackOrder = order;

    const appProviders = createAppProvidersWrapper({
      mapeoApi: orgSetup.client,
      activeProjectId: orgSetup.projectId,
    });
    const story = () => <View />;
    const context = {
      id: 'seeded-deep-stack-hw-back',
      parameters: {flow: {initialState: seededDeepStackInitialState()}},
    } as unknown as Parameters<typeof withRealNavigator>[1];
    // Storybook invokes decorators as components; render a host component so
    // the decorator's hooks run inside React's render.
    const DecoratorHost = () => withRealNavigator(story, context);
    const view = await render(<DecoratorHost />, {
      wrapper: appProviders.wrapper,
    });

    try {
      // Flow state resolves ('flow:none' — no seeding spec), then the
      // container mounts straight onto the seeded deep stack.
      await screen.findByTestId(
        'STORYBOOK.flow-ready.seeded-deep-stack-hw-back.ObservationFields',
        {timeout: 10000},
      );
      // No reconciliation pop happened pre-press in this harness.
      expect(logsIncluding('state repair')).toEqual([]);

      // Mount-time subscription order, read from the recorded BackHandler
      // calls. The decorator re-subscribes its guard on every render (inline
      // onConsumed), so the FIRST removal in the session is the churn
      // cleanup of the guard's mount-time registration. For the guard to win
      // the LIFO dispatch it must have subscribed LAST: nothing may sit
      // between its first subscription and its first churn — least of all
      // the container's own useBackButton handler, which subscribes in the
      // parent effect AFTER a guard rendered as a child of the container
      // (child effects run first) and would pop the seeded stack first.
      const firstAddIndex = order.findIndex(event => event.type === 'add');
      const firstRemoveIndex = order.findIndex(
        event => event.type === 'remove',
      );
      expect(firstAddIndex).toBeGreaterThanOrEqual(0);
      expect(firstRemoveIndex).toBeGreaterThan(firstAddIndex);
      const firstAdd = order[firstAddIndex];
      const firstRemove = order[firstRemoveIndex];
      const addBeforeFirstRemove = order[firstRemoveIndex - 1];
      if (!firstAdd || !firstRemove || !addBeforeFirstRemove) {
        throw new Error('BackHandler subscription order log is incomplete');
      }
      // (1) The session's first subscriber must not be the one churned out
      // of the array: pre-fix that first subscriber is the guard itself.
      expect(firstRemove.handler).not.toBe(firstAdd.handler);
      // (2) The guard's mount-time registration is the LAST one: the call
      // right before its churn removal is its own subscription.
      expect(addBeforeFirstRemove).toEqual({
        type: 'add',
        handler: firstRemove.handler,
      });

      const pressBack = async () => {
        await act(async () => {
          DeviceEventEmitter.emit('hardwareBackPress');
        });
        await act(async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
        });
      };

      await pressBack();
      await pressBack();

      // The guard consumed both events...
      expect(logsIncluding('hardware back consumed')).toHaveLength(2);
      // ...so the navigator never popped and the state-repair path never
      // had to mask a pop (a masked pop still shows the wrong screen in the
      // capture window — CI run 34475503925).
      expect(logsIncluding('state repair')).toEqual([]);
      expect(
        screen.queryByTestId(
          'STORYBOOK.flow-ready.seeded-deep-stack-hw-back.ObservationCreate',
        ),
      ).toBeNull();
      expect(
        screen.getByTestId(
          'STORYBOOK.flow-ready.seeded-deep-stack-hw-back.ObservationFields',
        ),
      ).toBeTruthy();
    } finally {
      backHandlerOrderHolder.__hwBackOrder = undefined;
      consoleLog.mockRestore();
      await act(async () => {
        view.unmount();
      });
      await appProviders.teardown();
    }
  }, 30000);
});
