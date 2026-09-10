import * as React from 'react';
import type {Decorator} from '@storybook/react-native';
import {BackHandler, View} from 'react-native';
import {
  NavigationContainer,
  type InitialState,
  type NavigationContainerRef,
} from '@react-navigation/native';

import {RootStackNavigator} from '../../src/frontend/Navigation/Stack';
import type {AppStackParamsList} from '../../src/frontend/sharedTypes/navigation';
import {
  useFlowState,
  type FlowStateSpec,
  type ResolvedFlowState,
} from '../utils/flowState';
import {FlowStatePlaceholder} from '../utils/FlowStatePlaceholder';

type FlowInitialState =
  InitialState | ((resolved: ResolvedFlowState) => InitialState);

type FlowParameters = {
  flow?: {
    state?: FlowStateSpec;
    initialState?: FlowInitialState;
  };
};

type ActiveRoute = {
  storyId: string;
  readyKey: string;
  routeName: string;
};

function assertFactoryUsesSeededObservationIds(
  initialState: InitialState,
  resolved: ResolvedFlowState,
) {
  const seededIds = new Set(resolved.observationIds);

  function visit(value: unknown) {
    if (!value || typeof value !== 'object') return;

    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    const record = value as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(record, 'observationId')) {
      const observationId = record.observationId;
      if (typeof observationId !== 'string' || !seededIds.has(observationId)) {
        throw new Error(
          `Storybook flow initialState requested missing seeded observation ID: ${String(observationId)}`,
        );
      }
    }

    Object.values(record).forEach(visit);
  }

  visit(initialState);
}

function guardMissingSeededObservationIds(
  resolved: ResolvedFlowState,
): ResolvedFlowState {
  const observationIds = new Proxy(resolved.observationIds, {
    get(target, property, receiver) {
      const isArrayIndex =
        typeof property === 'string' && /^(0|[1-9]\d*)$/.test(property);
      if (
        isArrayIndex &&
        !Object.prototype.hasOwnProperty.call(target, property)
      ) {
        throw new Error(
          `Storybook flow initialState requested missing seeded observation ID at index ${property}`,
        );
      }
      return Reflect.get(target, property, receiver);
    },
  });

  return {...resolved, observationIds};
}

/**
 * Real-navigator decorator — mounts `RootStackNavigator` (the actual
 * navigator the shipping app uses), not `AppNavigator`. Reimplements just
 * the two things `AppNavigator` contributes on top of it (a
 * `NavigationContainer` and this Suspense-free wrapper); it deliberately
 * skips `AppNavigator`'s `PostHogProvider` screen-tracking (would pollute
 * analytics with synthetic screen views) and its `SplashScreen.hide()` call
 * (already handled once by `StorybookRoot` in App.tsx).
 *
 * For **flow stories only** — atomic per-screen QA should keep using
 * `withNavigation`. A flow story's "component" is the journey, not a React
 * element: the story function should render `null` (or a short legend);
 * everything visible comes from this decorator via `parameters.flow`.
 *
 * `key={ready.key}` forces a fresh `NavigationContainer` mount once flow
 * state has been applied, since `getInitialRoute()` (in
 * `Navigation/Stack/index.tsx`) is only evaluated at mount.
 */
type ConsumeHardwareBackPressProps = {
  enabled: boolean;
  onConsumed?: (reason: string) => void;
};

/**
 * Must render as a SIBLING AFTER the NavigationContainer: React completes
 * effects for the container's subtree before mounting later siblings, so
 * this subscribes AFTER the container's own hardware-back handler — and with
 * React Native's LIFO subscription dispatch it fires first and consumes back
 * events before the navigator pops. Rendered as a child INSIDE the container
 * it would subscribe BEFORE it (child effects run before parent effects),
 * handing the back event to the container first. Story-only: the production
 * app never renders this decorator.
 */
function ConsumeHardwareBackPress({
  enabled,
  onConsumed,
}: ConsumeHardwareBackPressProps) {
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

export const withRealNavigator: Decorator = (Story, context) => {
  const {flow} = (context.parameters ?? {}) as FlowParameters;
  const ready = useFlowState(flow?.state);
  const readyKey = ready?.key;
  // Deep seeded stacks (e.g. CreateObservation ObservationFields/Detail) are
  // popped by a stray hardware-back a few hundred ms after mount; consume
  // back events so the seeded stack survives the capture window.
  const consumeHardwareBackPress = true;
  const navigationRef =
    React.useRef<NavigationContainerRef<AppStackParamsList>>(null);
  const [activeRoute, setActiveRoute] = React.useState<ActiveRoute>();
  // Expected state from the story's seeded initialState. Some post-mount
  // reconciliation (query refreshes re-running the flow-state effect,
  // navigator screen-set changes) can pop the seeded deep stack with no user
  // interaction; capture runs 34417507310/34422668174 showed ObservationFields
  // reverting to ObservationCreate ~60ms after readiness — and run
  // 34475503925 proved a marker-only repair masks the pop (the screenshot
  // still showed the wrong screen). Repair by resetting the navigator to the
  // full seeded state, once per mount, so the frame captures what the story
  // declares.
  const seededInitialState = React.useMemo(() => {
    if (typeof flow?.initialState === 'function') {
      return ready ? flow.initialState(ready) : undefined;
    }
    return flow?.initialState;
  }, [flow?.initialState, ready]);
  const seededTopRoute = seededInitialState?.routes.at(-1)?.name;
  const repairCountRef = React.useRef(0);
  const announceActiveRoute = React.useCallback(() => {
    const route = navigationRef.current?.getCurrentRoute();
    if (!route || !readyKey) {
      console.error(
        `STORYBOOK: Flow readiness failed for story: ${context.id}; active route unavailable`,
      );
      return;
    }

    if (
      seededTopRoute !== undefined &&
      seededInitialState !== undefined &&
      route.name !== seededTopRoute &&
      repairCountRef.current < 1
    ) {
      repairCountRef.current += 1;
      console.warn(
        `STORYBOOK: state repair for story: ${context.id}; route ${route.name} -> ${seededTopRoute}`,
      );
      navigationRef.current?.reset(seededInitialState);
      setActiveRoute({
        storyId: context.id,
        readyKey,
        routeName: seededTopRoute,
      });
      return;
    }

    setActiveRoute({
      storyId: context.id,
      readyKey,
      routeName: route.name,
    });

    // Retain this log for diagnostics. Capture acceptance uses the current
    // native markers rendered below, because an earlier route log cannot prove
    // which route is active when the screenshot is taken.
    console.log(
      `STORYBOOK: Flow ready for story: ${context.id}; route: ${route.name}; projectId: ${ready?.projectId ?? 'none'}; observationIds: ${JSON.stringify(ready?.observationIds ?? [])}`,
    );
  }, [context.id, readyKey, seededInitialState, seededTopRoute]);

  if (!ready) return <FlowStatePlaceholder spec={flow?.state} />;

  let initialState: InitialState | undefined;
  if (typeof flow?.initialState === 'function') {
    initialState = flow.initialState(guardMissingSeededObservationIds(ready));
    assertFactoryUsesSeededObservationIds(initialState, ready);
  } else {
    initialState = flow?.initialState;
  }

  const isCurrentRoute =
    activeRoute?.storyId === context.id && activeRoute.readyKey === ready.key;
  const storyReadyTestId = isCurrentRoute
    ? `STORYBOOK.flow-ready.${context.id}`
    : undefined;
  const routeReadyTestId = isCurrentRoute
    ? `${storyReadyTestId}.${activeRoute.routeName}`
    : undefined;

  return (
    <View style={{flex: 1}} testID={storyReadyTestId}>
      <View style={{flex: 1}} testID={routeReadyTestId}>
        <NavigationContainer
          key={`${context.id}:${ready.key}`}
          ref={navigationRef}
          initialState={initialState}
          onReady={announceActiveRoute}
          onStateChange={state => {
            console.log(
              `STORYBOOK: nav state change for story: ${context.id}; index: ${state?.index}; routes: ${JSON.stringify(state?.routes.map(r => r.name))}`,
            );
            announceActiveRoute();
          }}>
          <RootStackNavigator />
        </NavigationContainer>
        {/* Sibling AFTER the container (see the guard's doc comment): child
            effects run before parent effects, so a guard inside the
            container would subscribe before it and LIFO dispatch would let
            the container pop the seeded stack first. */}
        <ConsumeHardwareBackPress
          enabled={consumeHardwareBackPress}
          onConsumed={reason =>
            console.log(`STORYBOOK: hardware back consumed; ${reason}`)
          }
        />
      </View>
    </View>
  );
};
