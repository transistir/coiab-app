import * as React from 'react';
import type {InitialState} from '@react-navigation/native';
import {render, screen} from '@testing-library/react-native';

import {createAppProvidersWrapper} from '../../tests/integration/helpers/react';
import {setupIntegrationTest} from '../../tests/integration/helpers/setupIntegrationTest';
import {COIAB_ORGANIZATIONS_STORAGE_KEY} from '../../src/frontend/contexts/CoiabOrganizationsStoreContext';
import {MMKVStoreInitializer} from '../../src/frontend/hooks/persistedState/createPersistedState';
import {criarEstadoInicialOrganizacoes} from '../../src/frontend/lib/organization/coiabOrganizations';
import {FLOW_STATES, type FlowStateSpec} from '../utils/flowState';
import {withRealNavigator} from './withRealNavigator';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The app screens registered next to OrganizationProvisioning import the map
// stack; stubbed as the navigator suites do (index.navigator.test.tsx).
jest.mock('@maplibre/maplibre-react-native', () => {
  const React = require('react');
  const {View} = require('react-native');
  const Stub = (
    props: {children?: React.ReactNode} & Record<string, unknown>,
  ) => {
    const {children, ...rest} = props || {};
    return React.createElement(View, rest, children);
  };
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
    MapView: Stub,
    Camera: Stub,
    MarkerView: Stub,
    UserLocation: Stub,
    LineJoin: {Round: 'round', Bevel: 'bevel', Miter: 'miter'},
    LineCap: {Round: 'round', Butt: 'butt', Square: 'square'},
  };
});
jest.mock('react-native-scale-bar', () => 'ScaleBar');

type StoryContext = Parameters<typeof withRealNavigator>[1];
type StoryFn = Parameters<typeof withRealNavigator>[0];

const provisioningState: InitialState = {
  routes: [{name: 'OrganizationProvisioning'}],
  index: 0,
};

/** A flow story the way Storybook hands it to the decorator. */
function storyContext(id: string, state: FlowStateSpec): StoryContext {
  return {
    id,
    parameters: {flow: {state, initialState: provisioningState}},
  } as unknown as StoryContext;
}

const story = (() => null) as unknown as StoryFn;

// Storybook invokes decorators as components.
function StoryHost({context}: {context: StoryContext}) {
  return withRealNavigator(story, context);
}

const TITLE = 'Could not open your organization';
const NAME = 'ORG.provisioning-unavailable-name';
const RETRY = 'ORG.provisioning-retry-activation-btn';
const SWITCH = 'ORG.provisioning-switch-organization-btn';
const CREATE = 'ORG.provisioning-create-organization-btn';

async function findReadyOnProvisioning(storyId: string) {
  expect(
    await screen.findByTestId(
      `STORYBOOK.flow-ready.${storyId}.OrganizationProvisioning`,
      {},
      {timeout: 30_000},
    ),
  ).toBeOnTheScreen();
  // The marker comes with the container's readiness, while the screen may
  // still be suspended: the capture rows wait on the surface's own testIDs.
  expect(
    await screen.findByText(TITLE, {}, {timeout: 30_000}),
  ).toBeOnTheScreen();
  expect(screen.getByTestId(RETRY)).toBeOnTheScreen();
  expect(screen.queryByTestId('MAIN.map-screen')).not.toBeOnTheScreen();
}

/**
 * The unopenable rows end to end, the way a capture run plays them: the real
 * `withRealNavigator` and `RootStackNavigator` over the app's providers and a
 * real core, one story after another on the same root engine. The decorator
 * may only publish its readiness marker on the recovery surface each story
 * declares.
 */
describe('withRealNavigator over an unopenable organization seed', () => {
  const orgSetup = setupIntegrationTest();

  test('each recovery row reaches its OrganizationProvisioning surface', async () => {
    // A fresh install's document, so the run starts on an engine that never
    // opened an organization.
    MMKVStoreInitializer.setItem(
      COIAB_ORGANIZATIONS_STORAGE_KEY,
      JSON.stringify({state: criarEstadoInicialOrganizacoes(), version: 1}),
    );
    const appProviders = createAppProvidersWrapper({
      mapeoApi: orgSetup.client,
    });
    const one = 'flows-orglayer--organization-unavailable';
    const view = await render(
      <StoryHost
        context={storyContext(one, FLOW_STATES.oneOrganizationUnavailable)}
      />,
      {wrapper: appProviders.wrapper},
    );

    try {
      await findReadyOnProvisioning(one);
      expect(screen.getByTestId(NAME)).toHaveTextContent(
        'Test Organization A',
      );
      // One organization and early access off: no exit but the retry.
      expect(screen.queryByTestId(SWITCH)).not.toBeOnTheScreen();
      expect(screen.queryByTestId(CREATE)).not.toBeOnTheScreen();

      const two = 'flows-orglayer--organization-unavailable-two-organizations';
      await view.rerender(
        <StoryHost
          context={storyContext(two, FLOW_STATES.twoOrganizationsUnavailable)}
        />,
      );
      await findReadyOnProvisioning(two);
      expect(screen.getByTestId(NAME)).toHaveTextContent(
        'Test Organization B',
      );
      expect(screen.getByTestId(SWITCH)).toBeOnTheScreen();
      expect(screen.getByTestId(CREATE)).toBeOnTheScreen();

      const orphan =
        'flows-orglayer--organization-unavailable-orphaned-selection';
      await view.rerender(
        <StoryHost
          context={storyContext(
            orphan,
            FLOW_STATES.orphanedOrganizationSelection,
          )}
        />,
      );
      await findReadyOnProvisioning(orphan);
      // Nothing is derived from an orphaned selection: no name, no exits.
      expect(screen.queryByTestId(NAME)).not.toBeOnTheScreen();
      expect(screen.queryByTestId(SWITCH)).not.toBeOnTheScreen();
      expect(screen.queryByTestId(CREATE)).not.toBeOnTheScreen();
    } finally {
      await view.unmount();
      await appProviders.teardown();
    }
  }, 180_000);
});
