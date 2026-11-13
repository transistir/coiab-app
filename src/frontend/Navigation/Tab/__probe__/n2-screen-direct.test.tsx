// THROWAWAY PROBE n2 — the Paneiro screen (ObservationsList) mounted directly,
// WITHOUT the bottom-tab navigator. Delete with __probe__/.
//
// It uses the same core/IPC setup and module mocks (useHomeTabsHarness) and
// the same provider tree as renderHomeTabs: app wrapper, NavigationContainer,
// Suspense, ActiveProjectProvider and a native stack. The only change is that
// the stack's first screen is ObservationsList itself, under the same Suspense
// that HomeTabs' screenLayout puts around every tab. There is no Tab.Navigator,
// no TabBar, no HomeHeader and no headerRight (headerShown: false, as in the
// harness stack).
//
// Integrity: with an empty project, the screen renders observationsEmptyView.
// If that never appears, the screen did not mount and the run is INVALID.
import {mark, startSampler} from './heapProbe';
import {useHomeTabsHarness} from '../homeTabsHarness';

import * as React from 'react';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {render, screen} from '@testing-library/react-native';

import {createAppProvidersWrapper} from '../../../../../tests/integration/helpers/react';
import {executarEmOrdem} from '../../../../../tests/integration/helpers/orderedTeardown';
import {ActiveProjectProvider} from '../../../contexts/ActiveProjectContext';
import {sleep} from '../../../lib/sleep';
import {FullScreenCenteredLoader} from '../../../sharedComponents/FullScreenCenteredLoader';
import {ObservationsList} from '../../../screens/ObservationsList';

const Stack = createNativeStackNavigator();

// Same wrapper as HomeTabs' screenLayout, without the tab navigator.
function PaneiroDirect(props: object) {
  const Screen = ObservationsList as unknown as React.ComponentType<object>;
  return (
    <React.Suspense fallback={<FullScreenCenteredLoader />}>
      <Screen {...props} />
    </React.Suspense>
  );
}

const stopSampler = startSampler(__filename);
afterAll(() => {
  mark(__filename, 'n2:afterAll (teardown finished)');
  stopSampler();
});

describe('n2: Paneiro screen without the tab navigator', () => {
  const h = useHomeTabsHarness();

  // Nested so this afterEach runs BEFORE the harness's core teardown, keeping
  // the harness order: tree and providers first, then IPC/discovery/fastify.
  describe('direct mount', () => {
    let onTeardown: Array<() => unknown> = [];
    afterEach(async () => {
      await executarEmOrdem(onTeardown);
      onTeardown = [];
    }, 15_000);

    test('mount ObservationsList directly, then wait 500 ms', async () => {
      const app = createAppProvidersWrapper({
        mapeoApi: h.client,
        activeProjectId: h.projectId,
      });
      onTeardown.push(app.teardown);
      mark(__filename, 'n2:before-render');

      const {unmount} = await render(
        <NavigationContainer>
          <React.Suspense fallback={null}>
            <ActiveProjectProvider activeProjectId={h.projectId}>
              <Stack.Navigator screenOptions={{headerShown: false}}>
                <Stack.Screen name="ObservationsList" component={PaneiroDirect} />
              </Stack.Navigator>
            </ActiveProjectProvider>
          </React.Suspense>
        </NavigationContainer>,
        {wrapper: app.wrapper},
      );
      onTeardown.unshift(async () => {
        await unmount();
        await sleep(0);
      });
      mark(__filename, 'n2:after-render');

      try {
        await screen.findByTestId('observationsEmptyView');
      } catch (e) {
        throw new Error(
          `n2 INVALID: ObservationsList never mounted (no observationsEmptyView); this run is not data. ${String(e)}`,
        );
      }
      process.stderr.write('[n2-integrity] observationsEmptyView mounted\n');
      mark(__filename, 'n2:screen-mounted');

      await new Promise(r => setTimeout(r, 500));
      mark(__filename, 'n2:after-500ms (body done)');
    });
  });
});
