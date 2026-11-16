import type {
  NavigationContainerRef,
  InitialState,
} from '@react-navigation/native';
import type {AppStackParamsList} from '../../sharedTypes/navigation';

// Shared mocks: see seededDeepStack.helpers.tsx for why each one exists.
jest.mock('react-native/Libraries/Utilities/BackHandler', () =>
  jest
    .requireActual<typeof import('./seededDeepStack.helpers')>(
      './seededDeepStack.helpers',
    )
    .mockBackHandlerModule(),
);

let mockNavigation: NavigationContainerRef<AppStackParamsList>;
let mockSeededInitialState: InitialState | undefined;
let mockOnRootStateChange: ((state: InitialState) => void) | undefined;

jest.mock('../../../../tests/integration/helpers/navigation', () =>
  jest
    .requireActual<typeof import('./seededDeepStack.helpers')>(
      './seededDeepStack.helpers',
    )
    .mockSeededNavigatorModule({
      onRef: ref => {
        mockNavigation = ref;
      },
      getInitialState: () => mockSeededInitialState,
      onStateChange: state => {
        mockOnRootStateChange?.(state);
      },
    }),
);

jest.mock('@maplibre/maplibre-react-native', () =>
  jest
    .requireActual<typeof import('./seededDeepStack.helpers')>(
      './seededDeepStack.helpers',
    )
    .mockMaplibreModule(),
);

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

jest.mock('../../hooks/useStorageReadingQuery', () =>
  jest
    .requireActual<typeof import('./seededDeepStack.helpers')>(
      './seededDeepStack.helpers',
    )
    .mockStorageReadingQueryModule(),
);

jest.mock('../../hooks/server/presets', () => ({
  usePresetsQuery: () => ({data: []}),
}));

jest.mock('../../hooks/server/fields', () =>
  jest
    .requireActual<typeof import('./seededDeepStack.helpers')>(
      './seededDeepStack.helpers',
    )
    .mockFieldsModule(),
);

jest.mock('../../screens/ObservationFields', () =>
  jest
    .requireActual<typeof import('./seededDeepStack.helpers')>(
      './seededDeepStack.helpers',
    )
    .mockObservationFieldsModule(),
);

process.env.MAPBOX_ACCESS_TOKEN = 'test-token';

// Gate lives on globalThis because jest.mock factories are hoisted above
// module scope and may not close over module variables.
const gateHolder = globalThis as {__fieldsGate?: {released: boolean}};
if (!gateHolder.__fieldsGate) {
  gateHolder.__fieldsGate = {released: false};
}

import {act, render, screen} from '@testing-library/react-native';
import {DeviceEventEmitter, View} from 'react-native';

import {
  setupIntegrationTest,
  semearDocumentoPronta,
} from '../../../../tests/integration/helpers/setupIntegrationTest';
import {createAppProvidersWrapper} from '../../../../tests/integration/helpers/react';
import {withRealNavigator} from '../../../../.rnstorybook/decorators/withRealNavigator';
import {
  backHandlerHolder,
  guardHolder,
  seededDeepStackInitialState,
  spyOnStorybookConsole,
  type BackHandlerEvent,
  type BackPressHandler,
} from './seededDeepStack.helpers';

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

  async function renderSeededStackAndPressBack() {
    guardHolder.__hwBackGuard = {consumed: []};
    semearDocumentoPronta(
      orgSetup.projectId,
      orgSetup.alertasProjectId,
      orgSetup.orgId,
      orgSetup.orgName,
    );
    mockSeededInitialState = seededDeepStackInitialState();
    mockOnRootStateChange = undefined;

    await orgSetup.renderNavigation();

    // Let every post-mount query refresh tick land (as in the survival test
    // in seededDeepStack.navigator.test.tsx): the guard topology under test
    // must not race them.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
    });

    const routeBefore = mockNavigation.getCurrentRoute()?.name;
    const indexBefore = mockNavigation.getRootState()!.index;

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
    const indexAfter = mockNavigation.getRootState()!.index;
    const consumed = [...(guardHolder.__hwBackGuard?.consumed ?? [])];

    guardHolder.__hwBackGuard = undefined;
    mockSeededInitialState = undefined;
    mockOnRootStateChange = undefined;

    return {routeBefore, indexBefore, routeAfter, indexAfter, consumed};
  }

  // Documented topology mirror (control), NOT an anchor for the fix: it
  // reproduces the pre-fix child shape with the suite's own mock to show the
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
    semearDocumentoPronta(
      orgSetup.projectId,
      orgSetup.alertasProjectId,
      orgSetup.orgId,
      orgSetup.orgName,
    );
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
    semearDocumentoPronta(
      orgSetup.projectId,
      orgSetup.alertasProjectId,
      orgSetup.orgId,
      orgSetup.orgName,
    );
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
