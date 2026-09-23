import * as React from 'react';
import type {Decorator} from '@storybook/react-native';
import {BackHandler, View} from 'react-native';
import {
  NavigationContainer,
  type InitialState,
  type NavigationAction,
  type NavigationContainerRef,
  type NavigationState,
  type PartialState,
} from '@react-navigation/native';

import {RootStackNavigator} from '../../src/frontend/Navigation/Stack';
import type {AppStackParamsList} from '../../src/frontend/sharedTypes/navigation';
import {
  useFlowState,
  type FlowStateSpec,
  type ResolvedFlowState,
} from '../utils/flowState';
import {FlowStatePlaceholder} from '../utils/FlowStatePlaceholder';
import {FlowStateScope} from '../utils/FlowStateScope';

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

/** The shape a seeded `InitialState` and the navigator's own state share. */
type RouteTree = {
  index?: number;
  routes: ReadonlyArray<{name: string; key?: string; state?: RouteTree}>;
};

function focusedRoute(state: RouteTree | undefined) {
  return state?.routes[state.index ?? state.routes.length - 1];
}

/**
 * Whether the navigator has left the route path the story seeded, compared
 * one navigator level at a time and only as deep as the seed goes. A level the
 * seed leaves to its navigator's initial route (row 11's bare `Home`) or a
 * nested navigator that has not mounted yet is not a divergence: comparing the
 * leaf route against the seed's top route instead mistakes Home's own tabs for
 * a pop.
 */
function leftSeededPath(
  actual: RouteTree | undefined,
  seeded: RouteTree | undefined,
): boolean {
  if (!actual || !seeded) return false;
  const actualRoute = focusedRoute(actual);
  const seededRoute = focusedRoute(seeded);
  if (actualRoute?.name !== seededRoute?.name) return true;
  return leftSeededPath(actualRoute?.state, seededRoute?.state);
}

/**
 * The seeded state as a reset payload, carrying over the key of every route
 * the navigator already holds under the same name in the same position — one
 * navigator level at a time, as far as the seed goes.
 *
 * A keyless payload does not update those routes, it replaces them: React
 * Navigation keys every route it rehydrates, so routes the repair means to
 * keep are unmounted and remounted. When one of them hosts a nested navigator
 * — `Home` and its tabs, on every deep-stack story — that navigator's unmount
 * writes its parent's routes back from a read taken before the reset, and the
 * seeded state the reset had just stored is overwritten by the popped one.
 * React Navigation still reports the action as handled, so the repair looks
 * accepted, reaches no `onUnhandledAction`, and changes nothing (measured on
 * `@react-navigation/core` 7.21.2: preserving `Home`'s key alone is the
 * difference between the reset landing and being reverted). Carrying the keys
 * over leaves those routes — and their navigators — mounted, and only the
 * route the pop removed is created.
 */
function withCurrentRouteKeys(
  seeded: InitialState,
  current: RouteTree | undefined,
): PartialState<NavigationState> {
  return {
    ...seeded,
    routes: seeded.routes.map((route, index) => {
      const currentRoute = current?.routes[index];
      if (currentRoute?.name !== route.name) return route;
      return {
        ...route,
        key: currentRoute.key,
        // The seed owns every level it declares; a nested state it leaves out
        // stays out, so the nested navigator falls back to its initial route.
        state: route.state
          ? withCurrentRouteKeys(route.state, currentRoute.state)
          : undefined,
      };
    }),
  };
}

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
  // Stable callback identity keeps the guard's BackHandler subscription
  // stable across renders (its effect keys on [enabled, onConsumed]), so the
  // guard keeps its LIFO slot instead of churning (remove + re-add) on every
  // decorator render.
  const handleHardwareBackConsumed = React.useCallback(
    (reason: string) =>
      console.log(`STORYBOOK: hardware back consumed; ${reason}`),
    [],
  );
  const navigationRef =
    React.useRef<NavigationContainerRef<AppStackParamsList>>(null);
  const [activeRoute, setActiveRoute] = React.useState<ActiveRoute>();
  const [repairFailure, setRepairFailure] = React.useState<Error>();
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
  const seededTopRoute = focusedRoute(seededInitialState)?.name;
  const repairCountRef = React.useRef(0);
  // The exact payload the repair dispatched, so a refusal can be told apart
  // from any other unhandled action. Identity, not shape: the payload carries
  // the current route keys, so it is not the seeded object itself.
  const repairPayloadRef = React.useRef<
    PartialState<NavigationState> | undefined
  >(undefined);
  const announceActiveRoute = React.useCallback(() => {
    const navigation = navigationRef.current;
    const route = navigation?.getCurrentRoute();
    if (!navigation || !route || !readyKey) {
      console.error(
        `STORYBOOK: Flow readiness failed for story: ${context.id}; active route unavailable`,
      );
      return;
    }

    if (
      seededInitialState !== undefined &&
      repairCountRef.current < 1 &&
      leftSeededPath(navigation.getRootState(), seededInitialState)
    ) {
      repairCountRef.current += 1;
      console.warn(
        `STORYBOOK: state repair for story: ${context.id}; route ${route.name} -> ${seededTopRoute}`,
      );
      // Publish nothing until the navigator reports where the reset landed.
      // It lands on the next render, not during this call: React Navigation
      // stores a partial state uninitialized and keeps answering
      // getCurrentRoute() from the last render, so a route read here is still
      // the popped one. An accepted reset re-enters through onStateChange,
      // which publishes the route it really reached; a refused one changes no
      // state and reaches onUnhandledAction instead.
      const payload = withCurrentRouteKeys(
        seededInitialState,
        navigation.getRootState(),
      );
      repairPayloadRef.current = payload;
      setActiveRoute(undefined);
      navigation.reset(payload);
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
  const handleUnhandledAction = React.useCallback(
    (action: Readonly<NavigationAction>) => {
      if (
        action.type === 'RESET' &&
        action.payload === repairPayloadRef.current
      ) {
        setRepairFailure(
          new Error(
            `STORYBOOK: state repair failed for story: ${context.id}; the navigator refused the seeded state (expected route ${seededTopRoute})`,
          ),
        );
        return;
      }
      // Passing this handler replaces React Navigation's development-only
      // report of an unhandled action; keep that report for every other one.
      if (__DEV__) {
        console.error(
          `The action '${action.type}'${action.payload ? ` with payload ${JSON.stringify(action.payload)}` : ''} was not handled by any navigator.`,
        );
      }
    },
    [context.id, seededTopRoute],
  );

  // The seeded route is unreachable: fail the story where it shows (the
  // nearest error boundary) instead of leaving it without a readiness marker.
  if (repairFailure) throw repairFailure;

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
        <FlowStateScope
          key={`${context.id}:${ready.key}`}
          resolved={ready}
          fallback={<FlowStatePlaceholder spec={flow?.state} />}>
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
            }}
            onUnhandledAction={handleUnhandledAction}>
            <RootStackNavigator />
          </NavigationContainer>
          {/* Sibling AFTER the container, inside the same scope so a scope
              holding on its fallback mounts both together (see the guard's
              doc comment): child effects run before parent effects, so a
              guard inside the container would subscribe before it and LIFO
              dispatch would let the container pop the seeded stack first. */}
          <ConsumeHardwareBackPress
            enabled={consumeHardwareBackPress}
            onConsumed={handleHardwareBackConsumed}
          />
        </FlowStateScope>
      </View>
    </View>
  );
};
