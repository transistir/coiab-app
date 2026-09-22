import * as React from 'react';
import type {ComapeoCoreClientApi} from '@comapeo/ipc';
import {render, screen, within} from '@testing-library/react-native';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Home renders beneath the selector sheet: stub the native map surface the
// same way the real-navigator suite does
// (src/frontend/Navigation/Stack/index.navigator.test.tsx).
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
    MapView: Stub,
    Camera: Stub,
    MarkerView: Stub,
    UserLocation: Stub,
    LineJoin,
    LineCap,
  };
});
jest.mock('react-native-scale-bar', () => 'ScaleBar');
jest.mock('../../src/frontend/hooks/server/maps', () => ({
  useMapStyleJsonUrl: () => ({data: undefined}),
}));
jest.mock('../../src/frontend/hooks/useCurrentTime', () => ({
  useCurrentTime: () => new Date(),
}));
jest.mock(
  '../../src/frontend/screens/MapScreen/MapLayers/ObservationMapLayer',
  () => ({ObservationMapLayer: () => null}),
);
jest.mock(
  '../../src/frontend/screens/MapScreen/MapLayers/TracksMapLayer',
  () => ({
    TracksMapLayer: () => null,
  }),
);
jest.mock(
  '../../src/frontend/screens/MapScreen/MapLayers/RemoteDetectionAlertsLayer',
  () => ({RemoteDetectionAlertsLayer: () => null}),
);
jest.mock(
  '../../src/frontend/screens/MapScreen/CurrentTrack/CurrentTrackMapLayer',
  () => ({CurrentTrackMapLayer: () => null}),
);
jest.mock(
  '../../src/frontend/screens/MapScreen/CurrentTrack/UserTooltipMarker',
  () => ({UserTooltipMarker: () => null}),
);
jest.mock('../../src/frontend/hooks/useStorageReadingQuery', () => ({
  __esModule: true,
  useStorageReadingQuery: () => ({
    data: {freeBytes: 64 * 1024 * 1024 * 1024, totalBytes: Infinity},
  }),
  isLowStorage: () => false,
}));
jest.mock('../../src/frontend/hooks/server/presets', () => ({
  usePresetsQuery: () => ({data: []}),
}));

import {
  createManager,
  setUpIPC,
  useRealFetch,
} from '../../tests/integration/helpers/core';
import {createAppProvidersWrapper} from '../../tests/integration/helpers/react';
import {MMKVStoreInitializer} from '../../src/frontend/hooks/persistedState/createPersistedState';
import {COIAB_ORGANIZATIONS_STORAGE_KEY} from '../../src/frontend/contexts/CoiabOrganizationsStoreContext';
import {parseMarker} from '../../src/frontend/lib/organization/marker';
import {sleep} from '../../src/frontend/lib/sleep';
import {
  CreateSecondOrganization,
  HomeWithOrganization,
  OrganizationSelector,
  ReviewOrganizationInvite,
  SecondOrganizationProvisioning,
} from '../../src/frontend/flows/OrgLayer.stories';
import OrgLayerDrawerMeta, {
  CreateOrganizationEntry,
  SwitchOrganizationEntry,
} from '../../src/frontend/flows/OrgLayerDrawer.stories';
import {withFlowState} from '../decorators/withFlowState';
import {withNavigation} from '../decorators/withNavigation';
import {withRealNavigator} from '../decorators/withRealNavigator';
import {FLOW_STATES} from './flowState';

type StoryContext = Parameters<typeof withRealNavigator>[1];
type StoryFn = Parameters<typeof withRealNavigator>[0];

function storyContext(id: string, parameters: unknown): StoryContext {
  return {id, parameters} as unknown as StoryContext;
}

/** `Flows/OrgLayer`'s only decorator (the global `minimal` one passes through). */
function OrganizationSelectorStory() {
  return withRealNavigator(
    (() => null) as unknown as StoryFn,
    storyContext(
      'flows-orglayer--organization-selector',
      OrganizationSelector.parameters,
    ),
  );
}

function HomeWithOrganizationStory() {
  return withRealNavigator(
    (() => null) as unknown as StoryFn,
    storyContext(
      'flows-orglayer--home-with-organization',
      HomeWithOrganization.parameters,
    ),
  );
}

function ReviewOrganizationInviteStory() {
  return withRealNavigator(
    (() => null) as unknown as StoryFn,
    storyContext(
      'flows-orglayer--review-organization-invite',
      ReviewOrganizationInvite.parameters,
    ),
  );
}

const CREATE_SECOND_STORY_ID = 'flows-orglayer--create-second-organization';

function CreateSecondOrganizationStory() {
  return withRealNavigator(
    (() => null) as unknown as StoryFn,
    storyContext(CREATE_SECOND_STORY_ID, CreateSecondOrganization.parameters),
  );
}

const SECOND_PROVISIONING_STORY_ID =
  'flows-orglayer--second-organization-provisioning';

function SecondOrganizationProvisioningStory() {
  return withRealNavigator(
    (() => null) as unknown as StoryFn,
    storyContext(
      SECOND_PROVISIONING_STORY_ID,
      SecondOrganizationProvisioning.parameters,
    ),
  );
}

const DRAWER_STORY_ID = 'flows-orglayerdrawer--switch-organization-entry';
const CREATE_ENTRY_STORY_ID = 'flows-orglayerdrawer--create-organization-entry';

/**
 * `Flows/OrgLayerDrawer` declares `[withFlowState, withNavigation]`; Storybook
 * applies the first innermost, so `withNavigation` wraps `withFlowState`,
 * which wraps the story component.
 */
function drawerStory(parameters: unknown, id: string = DRAWER_STORY_ID) {
  const context = storyContext(id, parameters);
  const FlowStateStory = () =>
    withFlowState(OrgLayerDrawerMeta.component as unknown as StoryFn, context);
  return function DrawerStory() {
    return withNavigation(FlowStateStory as unknown as StoryFn, context);
  };
}

const ROW_A = 'ORGANIZATIONS.row-aaaaaaaaaaaaaaaa';
const ROW_B = 'ORGANIZATIONS.row-bbbbbbbbbbbbbbbb';

/**
 * An organizations seed as the app's persisted store holds it; by default the
 * two-organization one.
 */
function expectPersistedOrganizations(
  organizations: string[] = [
    'aaaaaaaaaaaaaaaa:pronta',
    'bbbbbbbbbbbbbbbb:pronta',
  ],
  activeId = 'bbbbbbbbbbbbbbbb',
) {
  const persisted = JSON.parse(
    MMKVStoreInitializer.getItem(COIAB_ORGANIZATIONS_STORAGE_KEY) as string,
  ).state;
  expect(
    persisted.organizacoes.map(
      (organization: {id: string; estado: string}) =>
        `${organization.id}:${organization.estado}`,
    ),
  ).toEqual(organizations);
  expect(persisted.ativa).toEqual({
    organizacaoId: activeId,
    area: 'monitoramento',
  });
}

describe('organization stories (FlowStateScope)', () => {
  let client: ComapeoCoreClientApi;
  let onTeardown: Array<() => unknown> = [];

  beforeEach(async () => {
    MMKVStoreInitializer.removeItem(COIAB_ORGANIZATIONS_STORAGE_KEY);
    onTeardown = [useRealFetch()];
    const {manager, fastifyController} = await createManager({
      name: 'test',
      deviceType: 'mobile',
    });
    const ipc = setUpIPC({manager});
    client = ipc.client;
    onTeardown.push(ipc.stop);
    await fastifyController.start();
    onTeardown.push(() => fastifyController.stop());
  });

  afterEach(async () => {
    for (const fn of onTeardown) await fn();
  });

  async function renderStory(Story: React.ComponentType) {
    const appProviders = createAppProvidersWrapper({mapeoApi: client});
    onTeardown.push(appProviders.teardown);
    const {unmount} = await render(<Story />, {wrapper: appProviders.wrapper});
    onTeardown.unshift(async () => {
      await unmount();
      await sleep(0);
    });
  }

  test('HomeWithOrganization shows Home instead of the organization fork', async () => {
    await renderStory(HomeWithOrganizationStory);

    expect(
      await screen.findByTestId('MAIN.map-screen', {}, {timeout: 30_000}),
    ).toBeOnTheScreen();
    expect(
      screen.queryByTestId('ONBOARDING.create-org-btn'),
    ).not.toBeOnTheScreen();
    expect(
      screen.queryByTestId('ONBOARDING.join-org-btn'),
    ).not.toBeOnTheScreen();
    expect(
      JSON.parse(
        MMKVStoreInitializer.getItem(COIAB_ORGANIZATIONS_STORAGE_KEY) as string,
      ).state.ativa,
    ).toEqual({
      organizacaoId: '0123456789abcdef',
      area: 'monitoramento',
    });
  }, 60_000);

  test('ReviewOrganizationInvite shows the invitation review surface', async () => {
    await renderStory(ReviewOrganizationInviteStory);

    expect(
      await screen.findByText('You are inviting:', {}, {timeout: 30_000}),
    ).toBeOnTheScreen();
    expect(screen.getByText('Field Device')).toBeOnTheScreen();
    expect(screen.getByTestId('ORG.send-invite-btn')).toBeOnTheScreen();
    expect(screen.queryByText('No Organization found')).not.toBeOnTheScreen();
  }, 60_000);

  test('the selector row: the story opens both organizations, the active one listed first', async () => {
    await renderStory(OrganizationSelectorStory);

    const list = await screen.findByTestId(
      'ORGANIZATIONS.list',
      {},
      {timeout: 30_000},
    );
    // The capture row's readiness pair: the story marker plus its testID.
    expect(
      screen.getByTestId(
        'STORYBOOK.flow-ready.flows-orglayer--organization-selector',
      ),
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId(
        'STORYBOOK.flow-ready.flows-orglayer--organization-selector.Organizations',
      ),
    ).toBeOnTheScreen();
    // Home stays mounted beneath the sheet, hidden from accessibility as a
    // covered screen is.
    expect(
      screen.getByTestId('MAIN.map-screen', {includeHiddenElements: true}),
    ).toBeOnTheScreen();

    // B sorts after A by name; it leads because it is the active one.
    expect(
      within(list)
        .getAllByTestId(/^ORGANIZATIONS\.row-/)
        .map(row => row.props.testID),
    ).toEqual([ROW_B, ROW_A]);
    expect(
      within(screen.getByTestId(ROW_B)).getByText('Current'),
    ).toBeOnTheScreen();
    expect(
      within(screen.getByTestId(ROW_A)).queryByText('Current'),
    ).not.toBeOnTheScreen();

    // The document reached the story through the app's persisted store, the
    // one production hydrates; the backend holds both organizations' two area
    // projects.
    expectPersistedOrganizations();
    expect(
      (await client.listProjects())
        .map(project => parseMarker(project.projectDescription ?? ''))
        .map(marker => `${marker?.organizationId}:${marker?.slot}`)
        .sort(),
    ).toEqual([
      'aaaaaaaaaaaaaaaa:a',
      'aaaaaaaaaaaaaaaa:m',
      'bbbbbbbbbbbbbbbb:a',
      'bbbbbbbbbbbbbbbb:m',
    ]);
  }, 60_000);

  test('the drawer row: the switch-organization entry is shown', async () => {
    await renderStory(drawerStory(SwitchOrganizationEntry.parameters));

    expect(
      await screen.findByTestId(
        'MENU.trocar-organizacao',
        {},
        {timeout: 30_000},
      ),
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId(`STORYBOOK.flow-ready.${DRAWER_STORY_ID}`),
    ).toBeOnTheScreen();
    expect(screen.getByText('Test Organization B')).toBeOnTheScreen();
    expectPersistedOrganizations();
  }, 60_000);

  test('the drawer create row: one ready organization offers the create entry, not the selector', async () => {
    await renderStory(
      drawerStory(CreateOrganizationEntry.parameters, CREATE_ENTRY_STORY_ID),
    );

    expect(
      await screen.findByTestId(
        'MENU.criar-organizacao',
        {},
        {timeout: 30_000},
      ),
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId(`STORYBOOK.flow-ready.${CREATE_ENTRY_STORY_ID}`),
    ).toBeOnTheScreen();
    expect(
      screen.queryByTestId('MENU.trocar-organizacao'),
    ).not.toBeOnTheScreen();
    expectPersistedOrganizations(
      ['aaaaaaaaaaaaaaaa:pronta'],
      'aaaaaaaaaaaaaaaa',
    );
  }, 60_000);

  test('the create-second row: CreateOrganization renders its form over Home and a ready organization', async () => {
    await renderStory(CreateSecondOrganizationStory);

    expect(
      await screen.findByTestId(
        'ORG.create-intro-continue-btn',
        {},
        {timeout: 30_000},
      ),
    ).toBeOnTheScreen();
    // The capture row's readiness pair: the story marker plus its route.
    expect(
      screen.getByTestId(
        `STORYBOOK.flow-ready.${CREATE_SECOND_STORY_ID}.CreateOrganization`,
      ),
    ).toBeOnTheScreen();
    // The real path: the drawer entry pushes over Home, which stays mounted.
    expect(
      screen.getByTestId('MAIN.map-screen', {includeHiddenElements: true}),
    ).toBeOnTheScreen();
    expectPersistedOrganizations(
      ['aaaaaaaaaaaaaaaa:pronta'],
      'aaaaaaaaaaaaaaaa',
    );
  }, 60_000);

  test('the second-provisioning row: the organization in preparation is shown, not the open one', async () => {
    await renderStory(SecondOrganizationProvisioningStory);

    expect(
      await screen.findByText(
        'Preparing your organization…',
        {},
        {timeout: 30_000},
      ),
    ).toBeOnTheScreen();
    // The capture row's readiness pair: the story marker plus its route.
    expect(
      screen.getByTestId(
        `STORYBOOK.flow-ready.${SECOND_PROVISIONING_STORY_ID}.OrganizationProvisioning`,
      ),
    ).toBeOnTheScreen();
    // B's rows — Monitoramento done, Alertas in execution. A, ready, would
    // show no preparation rows at all.
    expect(screen.getByText('Ready')).toBeOnTheScreen();
    expect(screen.getByText('Preparing')).toBeOnTheScreen();
    expect(
      screen.getByTestId('MAIN.map-screen', {includeHiddenElements: true}),
    ).toBeOnTheScreen();

    // A stays open and active; B is persisted mid-materialization.
    expectPersistedOrganizations(
      ['aaaaaaaaaaaaaaaa:pronta', 'bbbbbbbbbbbbbbbb:preparando'],
      'aaaaaaaaaaaaaaaa',
    );
    expect(
      (await client.listProjects())
        .map(project => parseMarker(project.projectDescription ?? ''))
        .map(marker => `${marker?.organizationId}:${marker?.slot}`)
        .sort(),
    ).toEqual([
      'aaaaaaaaaaaaaaaa:a',
      'aaaaaaaaaaaaaaaa:m',
      'bbbbbbbbbbbbbbbb:a',
      'bbbbbbbbbbbbbbbb:m',
    ]);
  }, 60_000);

  test('without the earlyAccess axis the app flag stays in charge and the entry does not exist', async () => {
    await renderStory(
      drawerStory({
        flow: {
          state: {
            ...FLOW_STATES.twoOrganizationsEarlyAccess,
            earlyAccess: undefined,
          },
        },
      }),
    );

    // The organization card rendered, so the entry's absence is a decision.
    expect(
      await screen.findByTestId(
        'MENU.area-monitoramento',
        {},
        {timeout: 30_000},
      ),
    ).toBeOnTheScreen();
    expect(
      screen.queryByTestId('MENU.trocar-organizacao'),
    ).not.toBeOnTheScreen();
  }, 60_000);
});
