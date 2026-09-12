import type {NavigationContainerRef} from '@react-navigation/native';
import type {AppStackParamsList} from '../../sharedTypes/navigation';

let mockNavigation: NavigationContainerRef<AppStackParamsList>;
jest.mock('../../../../tests/integration/helpers/navigation', () => {
  const {AppNavigator} = require('../../AppNavigator');
  return {
    MockedAppNavigator: () => {
      return (
        <AppNavigator
          permissionAsked
          navigationIntegration={{
            registerNavigationContainer: (ref: {
              current: NavigationContainerRef<AppStackParamsList>;
            }) => {
              mockNavigation = ref.current;
            },
          }}
        />
      );
    },
  };
});
import {act, fireEvent, screen, waitFor} from '@testing-library/react-native';

// The full navigator mounts the real Home tabs (MapScreen included) — the
// map stack is stubbed exactly like MapScreen.lowStorage.test.tsx does.
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

process.env.MAPBOX_ACCESS_TOKEN = 'test-token';

import {
  setupIntegrationTest,
  setupIntegrationTestWithoutProject,
} from '../../../../tests/integration/helpers/setupIntegrationTest';
import {markerFor} from '../../lib/organization/marker';
import {
  organizationCreationProvenanceStore,
  recordOrganizationCreationProvenance,
} from '../../lib/organization/creationProvenance';

/**
 * The startup gate mounted for real (SPEC 10.1): getInitialRoute picks the
 * first screen from the reconstructed Organization state, so each device
 * state below is seeded through the actual core client before rendering the
 * full navigator.
 */
describe('RootStackNavigator startup gate (SPEC 10.1)', () => {
  // Hook registration lives at the describe level — the helpers install
  // beforeEach/afterEach that boot and tear down a real core manager per test.
  const freshSetup = setupIntegrationTestWithoutProject();
  const orgSetup = setupIntegrationTest();

  beforeEach(() => {
    // The provenance record is durable by design — it must not leak from the
    // test that wrote it into the next device state.
    organizationCreationProvenanceStore.setState({organizationIds: []});
  });

  test('creation with a delayed project refresh stays on Home without offering creation again', async () => {
    await freshSetup.renderNavigationAsync();
    await fireEvent.press(
      await screen.findByTestId('ONBOARDING.create-org-btn'),
    );
    await fireEvent.changeText(
      screen.getByTestId('ORG.create-name-inp'),
      'New Org',
    );

    const listProjects = freshSetup.manager.listProjects.bind(
      freshSetup.manager,
    );
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>(resolve => {
      releaseRefresh = resolve;
    });
    let refreshWaiting = false;
    const spy = jest
      .spyOn(freshSetup.manager, 'listProjects')
      .mockImplementation(async () => {
        const projects = await listProjects();
        if (projects.length === 2) {
          refreshWaiting = true;
          await refreshGate;
        }
        return projects;
      });
    try {
      await fireEvent.press(screen.getByTestId('ORG.create-btn'));
      await waitFor(() => expect(refreshWaiting).toBe(true));
      expect(await listProjects()).toHaveLength(2);
      expect(screen.getByText('Creating Organization…')).toBeOnTheScreen();
      expect(
        screen.queryByTestId('ONBOARDING.create-org-btn'),
      ).not.toBeOnTheScreen();
      await act(async () => releaseRefresh());
      expect(await screen.findByTestId('MAIN.map-screen')).toBeOnTheScreen();
      await act(async () => {
        await listProjects();
      });
      expect(screen.getByTestId('MAIN.map-screen')).toBeOnTheScreen();
      expect(
        screen.queryByTestId('ONBOARDING.create-org-btn'),
      ).not.toBeOnTheScreen();
      expect(screen.queryByTestId('ORG.create-btn')).not.toBeOnTheScreen();
      expect(await listProjects()).toHaveLength(2);
    } finally {
      releaseRefresh();
      spy.mockRestore();
    }
  });

  test('Home creation returns to Home after creating a second organization', async () => {
    await orgSetup.renderNavigation();
    expect(await screen.findByTestId('MAIN.map-screen')).toBeOnTheScreen();
    const navigation = mockNavigation;
    await act(async () => navigation.navigate('CreateOrganization'));
    expect(screen.getByTestId('ORG.create-name-inp')).toBeOnTheScreen();
    expect(navigation.getRootState().routes.map(route => route.name)).toEqual([
      'Home',
      'CreateOrganization',
    ]);
    expect(screen.queryByTestId('MAIN.map-screen')).not.toBeOnTheScreen();
    await fireEvent.changeText(
      screen.getByTestId('ORG.create-name-inp'),
      'Second Org',
    );
    await fireEvent.press(screen.getByTestId('ORG.create-btn'));
    await waitFor(async () =>
      expect(await orgSetup.manager.listProjects()).toHaveLength(4),
    );
    await waitFor(
      () => {
        expect(screen.getByTestId('MAIN.map-screen')).toBeOnTheScreen();
        expect(
          screen.queryByTestId('ORG.create-name-inp'),
        ).not.toBeOnTheScreen();
      },
      {timeout: 5000},
    );
    expect(navigation.getRootState().routes.map(route => route.name)).toEqual([
      'Home',
    ]);
    // Completion is consumed: opening another form must not dismiss it.
    await act(async () => navigation.navigate('CreateOrganization'));
    expect(screen.getByTestId('ORG.create-name-inp')).toBeOnTheScreen();
    expect(screen.queryByTestId('MAIN.map-screen')).not.toBeOnTheScreen();
  }, 15000);

  test('an unmarked project with an active id lands on the Success fork (none-with-projects)', async () => {
    // e.g. a legacy invite accept: a plain project, no Organization.
    const legacyProjectId = await freshSetup.client.createProject({
      name: 'Legacy invite project',
    });
    await freshSetup.renderNavigationAsync({activeProjectId: legacyProjectId});

    expect(await screen.findByText('Join an Organization')).toBeOnTheScreen();
    expect(screen.getByText('test is ready!')).toBeOnTheScreen();
  });

  test('a one-slot organization lands on OrganizationProvisioning', async () => {
    const mProjectId = await freshSetup.client.createProject({
      name: 'Monitoramento',
      projectDescription: markerFor(freshSetup.orgId, 'm', freshSetup.orgName),
    });
    // The create this device started was interrupted before the second slot.
    recordOrganizationCreationProvenance(freshSetup.orgId);
    await freshSetup.renderNavigationAsync({activeProjectId: mProjectId});

    expect(
      await screen.findByText('Setting up your Organization…'),
    ).toBeOnTheScreen();
    // Restart-safe recovery (SPEC 5/E7): the incomplete org carries its name,
    // so the screen offers to finish the interrupted provisioning.
    expect(screen.getByTestId('ORG.provisioning-retry-btn')).toBeOnTheScreen();
  });

  test('a one-slot organization with no creation provenance refuses to finish', async () => {
    // Same local state as the test above WITHOUT the record: this is what a
    // leave or a remote removal leaves behind, and finishing it would create
    // an unrelated project in the missing slot and call the organization
    // ready without the original slot's data or members.
    const mProjectId = await freshSetup.client.createProject({
      name: 'Monitoramento',
      projectDescription: markerFor(freshSetup.orgId, 'm', freshSetup.orgName),
    });
    await freshSetup.renderNavigationAsync({activeProjectId: mProjectId});

    expect(
      await screen.findByText(
        'This Organization was not left half-created on this device, so its setup cannot be finished here.',
      ),
    ).toBeOnTheScreen();
    expect(
      screen.queryByTestId('ORG.provisioning-retry-btn'),
    ).not.toBeOnTheScreen();
    // The escape hatch stays reachable: no permanent creation lockout.
    expect(
      screen.getByTestId('ORG.provisioning-discard-btn'),
    ).toBeOnTheScreen();
  });

  test('leaving a slot of the only organization lands on the provisioning gate', async () => {
    // SPEC 3.8/10.1: the surviving slot reconstructs as `incomplete`, which
    // Home may not operate — the runtime gate must route there even though
    // `initialRouteName` was read when the navigator mounted on Home.
    await orgSetup.renderNavigation();
    expect(await screen.findByTestId('MAIN.map-screen')).toBeOnTheScreen();
    const navigation = mockNavigation;
    await act(async () =>
      navigation.navigate('LeaveProject', {memberType: 'participant'}),
    );
    await fireEvent.press(await screen.findByText('Yes, Leave'));

    await waitFor(async () => {
      const joined = (await orgSetup.manager.listProjects()).filter(
        project => project.status === 'joined',
      );
      expect(joined).toHaveLength(1);
    });
    expect(
      await screen.findByText('Setting up your Organization…'),
    ).toBeOnTheScreen();
    expect(navigation.getRootState().routes.map(route => route.name)).toEqual([
      'OrganizationProvisioning',
    ]);
    expect(screen.queryByTestId('MAIN.map-screen')).not.toBeOnTheScreen();
  }, 15000);

  test('an invalid organization stays reachable from Home while another is ready', async () => {
    // Mixed state: `some(ready)` sends the device to Home, so the invalid
    // organization's diagnosis has to be reachable FROM Home — and must not
    // bounce back to it the moment it renders.
    const duplicateSlotMarker = markerFor('f'.repeat(16), 'm', 'Broken Org');
    await orgSetup.client.createProject({
      name: 'Monitoramento',
      projectDescription: duplicateSlotMarker,
    });
    await orgSetup.client.createProject({
      name: 'Monitoramento (duplicado)',
      projectDescription: duplicateSlotMarker,
    });
    await orgSetup.renderNavigation();

    expect(await screen.findByTestId('MAIN.map-screen')).toBeOnTheScreen();
    const navigation = mockNavigation;
    await fireEvent.press(await screen.findByTestId('HOME.org-repair-btn'));

    expect(
      await screen.findByText(
        'Something is wrong with this Organization. Contact support.',
      ),
    ).toBeOnTheScreen();
    expect(navigation.getRootState().routes.map(route => route.name)).toEqual([
      'Home',
      'OrganizationProvisioning',
    ]);
  }, 15000);

  test('a duplicate-slot organization lands on OrganizationProvisioning and fails closed without crashing', async () => {
    const duplicateSlotMarker = markerFor(
      freshSetup.orgId,
      'm',
      freshSetup.orgName,
    );
    const firstProjectId = await freshSetup.client.createProject({
      name: 'Monitoramento',
      projectDescription: duplicateSlotMarker,
    });
    await freshSetup.client.createProject({
      name: 'Monitoramento (duplicado)',
      projectDescription: duplicateSlotMarker,
    });
    await freshSetup.renderNavigationAsync({activeProjectId: firstProjectId});

    expect(
      await screen.findByText(
        'Something is wrong with this Organization. Contact support.',
      ),
    ).toBeOnTheScreen();
    expect(
      screen.queryByTestId('ORG.provisioning-retry-btn'),
    ).not.toBeOnTheScreen();
  });

  test('a ready organization with the m slot active lands on Home', async () => {
    await orgSetup.renderNavigation();

    expect(await screen.findByTestId('MAIN.map-screen')).toBeOnTheScreen();
  });

  test('a ready organization corrects an unrelated active id to the m slot (SPEC 1.3)', async () => {
    // A standalone/debug switch left a non-organization project active.
    const unrelatedProjectId = await orgSetup.client.createProject({
      name: 'Unrelated',
    });
    await orgSetup.renderNavigation({activeProjectId: unrelatedProjectId});

    expect(await screen.findByTestId('MAIN.map-screen')).toBeOnTheScreen();
    // The active-correction effect repoints the active id at the primary
    // organization's Monitoramento slot before Home uses it — visible in the
    // Home header title (the drawer also lists the active project's marker).
    const headerTitle = await screen.findByTestId('HOME.header-title');
    expect(headerTitle).toHaveTextContent('Monitoramento');
    expect(screen.queryByText('Unrelated')).not.toBeOnTheScreen();
  });

  test('a degraded active organization is not silently switched to the ready one (F1)', async () => {
    // Review round 2 F1: org B is ready while the ACTIVE organization (A)
    // holds only its m slot — a leave or a remote removal degraded it. The
    // buggy effect silently rewrote the active project to B's m slot
    // (data-loss-adjacent: the user would operate another organization
    // with no notice). The fix keeps the active id on A's slot and routes
    // to the recovery surface (OrganizationProvisioning) through the same
    // mechanism OrganizationDegradationGate uses.
    const readyOrgId = 'fedcba9876543210';
    await freshSetup.client.createProject({
      name: 'Monitoramento',
      projectDescription: markerFor(readyOrgId, 'm', 'Ready Org'),
    });
    await freshSetup.client.createProject({
      name: 'Alertas',
      projectDescription: markerFor(readyOrgId, 'a', 'Ready Org'),
    });
    const degradedMProjectId = await freshSetup.client.createProject({
      name: 'Monitoramento',
      projectDescription: markerFor(freshSetup.orgId, 'm', freshSetup.orgName),
    });
    await freshSetup.renderNavigationAsync({
      activeProjectId: degradedMProjectId,
    });

    // The recovery surface renders — NOT Home operating the ready org.
    expect(
      await screen.findByText('Setting up your Organization…'),
    ).toBeOnTheScreen();
    expect(
      mockNavigation.getRootState().routes.map(route => route.name),
    ).toEqual(['OrganizationProvisioning']);
    expect(screen.queryByTestId('MAIN.map-screen')).not.toBeOnTheScreen();
    // NO silent switch: the persisted active id is still the degraded
    // organization's slot, not the ready organization's.
    expect(freshSetup.activeProjectId).toBe(degradedMProjectId);
  }, 15000);

  test('leaving the active slot while another organization is ready never repoints the active id at it (F6)', async () => {
    // F6: the leave clears the active id, and the slot it left stops being
    // reconstructed at all (only `joined` rows contribute slots) — so the
    // active id is claimed by NO organization and the legacy SPEC 1.3
    // correction used to repoint it at the ready organization's m slot.
    // On the next start that ready slot makes the device look healthy and
    // Home operates the OTHER organization with no notice.
    const readyOrgId = 'fedcba9876543210';
    const readyMProjectId = await freshSetup.client.createProject({
      name: 'Monitoramento',
      projectDescription: markerFor(readyOrgId, 'm', 'Ready Org'),
    });
    const readyAProjectId = await freshSetup.client.createProject({
      name: 'Alertas',
      projectDescription: markerFor(readyOrgId, 'a', 'Ready Org'),
    });
    const activeMProjectId = await freshSetup.client.createProject({
      name: 'Monitoramento',
      projectDescription: markerFor(freshSetup.orgId, 'm', freshSetup.orgName),
    });
    await freshSetup.client.createProject({
      name: 'Alertas',
      projectDescription: markerFor(freshSetup.orgId, 'a', freshSetup.orgName),
    });
    await freshSetup.renderNavigationAsync({
      activeProjectId: activeMProjectId,
    });

    expect(await screen.findByTestId('MAIN.map-screen')).toBeOnTheScreen();
    const navigation = mockNavigation;
    await act(async () =>
      navigation.navigate('LeaveProject', {memberType: 'participant'}),
    );
    await fireEvent.press(await screen.findByText('Yes, Leave'));

    await waitFor(async () => {
      const joined = (await freshSetup.manager.listProjects()).filter(
        project => project.status === 'joined',
      );
      expect(joined).toHaveLength(3);
    });
    expect(
      await screen.findByText('Setting up your Organization…'),
    ).toBeOnTheScreen();
    // Let the post-leave project refresh settle: the buggy correction fires
    // from an effect on the refreshed organization list.
    await act(async () => {
      await freshSetup.manager.listProjects();
    });

    expect(navigation.getRootState().routes.map(route => route.name)).toEqual([
      'OrganizationProvisioning',
    ]);
    expect(screen.queryByTestId('MAIN.map-screen')).not.toBeOnTheScreen();
    // NO silent switch: the active id is not repointed at EITHER slot of the
    // other organization. It stays on the left slot's id, exactly as the
    // single-organization leave already leaves it (the gate's reset unmounts
    // LeaveProject before its mutation callback clears it) — stale, but
    // fail-closed on the recovery surface instead of operating org B.
    expect(freshSetup.activeProjectId).not.toBe(readyMProjectId);
    expect(freshSetup.activeProjectId).not.toBe(readyAProjectId);
  }, 20000);
});
