import type {NavigationProp} from '@react-navigation/native';
import type {AppStackParamsList} from '../../sharedTypes/navigation';

// Shared mocks: see seededDeepStack.helpers.tsx for why each one exists.
jest.mock('react-native/Libraries/Utilities/BackHandler', () =>
  jest
    .requireActual<typeof import('./seededDeepStack.helpers')>(
      './seededDeepStack.helpers',
    )
    .mockBackHandlerModule(),
);

// This suite never calls `renderNavigation`: the mock only keeps the shared
// helper from loading the real AppNavigator, as it did when the three suites
// shared one file.
jest.mock('../../../../tests/integration/helpers/navigation', () =>
  jest
    .requireActual<typeof import('./seededDeepStack.helpers')>(
      './seededDeepStack.helpers',
    )
    .mockSeededNavigatorModule(),
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
import {View} from 'react-native';

import {
  setupIntegrationTest,
  semearDocumentoPronta,
} from '../../../../tests/integration/helpers/setupIntegrationTest';
import {createAppProvidersWrapper} from '../../../../tests/integration/helpers/react';
import {withRealNavigator} from '../../../../.rnstorybook/decorators/withRealNavigator';
import {
  seededDeepStackInitialState,
  spyOnStorybookConsole,
} from './seededDeepStack.helpers';

/**
 * The pop the decorator's state repair exists for, on the real
 * RootStackNavigator: the seeded top route leaves the stack after readiness
 * with no hardware back for the guard to consume. The repair resets the
 * navigator to the seeded state and the marker follows the route the
 * navigator reports once that reset has landed.
 */
describe('real decorator repairs a popped seeded deep stack', () => {
  const orgSetup = setupIntegrationTest();

  test('regression: a post-mount pop of ObservationFields is reset to the seeded stack without failing the story', async () => {
    const consoleSpy = spyOnStorybookConsole();
    const fieldsHolder = globalThis as {
      __observationFieldsNavigation?: NavigationProp<AppStackParamsList>;
    };
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
    const storyId = 'seeded-deep-stack-repair';
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
      await screen.findByTestId(
        routeMarker('ObservationFields'),
        {},
        {timeout: 10000},
      );
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 500));
      });
      expect(consoleSpy.including('state repair')).toEqual([]);

      await act(async () => {
        fieldsHolder.__observationFieldsNavigation!.goBack();
      });
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 500));
      });

      expect(consoleSpy.including('state repair')).toEqual([
        `STORYBOOK: state repair for story: ${storyId}; route ObservationCreate -> ObservationFields`,
      ]);
      // The navigator is back on the seeded stack (the stub remounted with it
      // and handed over its new navigation object)...
      const repairedState =
        fieldsHolder.__observationFieldsNavigation!.getState();
      expect(repairedState.routes.map(route => route.name)).toEqual([
        'Home',
        'ObservationCategoryChooser',
        'ObservationCreate',
        'ObservationFields',
      ]);
      expect(repairedState.index).toBe(3);
      // ...and readiness names the route it reports.
      expect(consoleSpy.including('Flow ready for story').at(-1)).toContain(
        'route: ObservationFields;',
      );
      expect(screen.getByTestId(routeMarker('ObservationFields'))).toBeTruthy();
      expect(screen.queryByTestId(routeMarker('ObservationCreate'))).toBeNull();
    } finally {
      fieldsHolder.__observationFieldsNavigation = undefined;
      consoleSpy.restore();
      await act(async () => {
        view.unmount();
      });
      await appProviders.teardown();
    }
  }, 30000);
});
