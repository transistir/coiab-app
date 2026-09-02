import * as React from 'react';
import type {Decorator} from '@storybook/react-native';
import {View} from 'react-native';

import {useFlowState, type FlowStateSpec} from '../utils/flowState';
import {FlowStatePlaceholder} from '../utils/FlowStatePlaceholder';

type FlowParameters = {
  flow?: {
    state?: FlowStateSpec;
  };
};

/**
 * The flow-state half of `withRealNavigator`, without the navigator, plus
 * the story-readiness marker the capture pipeline requires.
 *
 * Exists for stories that the capture manifest lists but that aren't a
 * navigation route, so `withRealNavigator`'s `initialState` can't reach
 * them — e.g. `DrawerMenu`, which `react-native-drawer-layout` renders with
 * component-local open/closed state, or a purely presentational leaf
 * component fixtured with props. Combine with `withNavigation` (or another
 * navigation decorator) for components that also call navigation hooks.
 *
 * `scripts/storybook-capture.sh` requires `STORYBOOK.flow-ready.<storyId>`
 * to be present in the Android UI hierarchy for **every** manifest row,
 * whatever readiness target that row uses (see `native_readiness_matches`),
 * and only `withRealNavigator` rendered it before. This decorator renders
 * the same marker, so any captured story can use it.
 *
 * `parameters.flow.state` is optional: `useFlowState(undefined)` resolves on
 * the first render (see its `if (!spec)` branch), so a leaf story that needs
 * no seeded backend state can use this decorator purely to obtain the
 * marker.
 */
export const withFlowState: Decorator = (Story, context) => {
  const {flow} = (context.parameters ?? {}) as FlowParameters;
  const ready = useFlowState(flow?.state);

  if (!ready) return <FlowStatePlaceholder spec={flow?.state} />;

  return (
    <View style={{flex: 1}} testID={`STORYBOOK.flow-ready.${context.id}`}>
      <Story />
    </View>
  );
};
