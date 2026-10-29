import type {NavigationContainerRef} from '@react-navigation/native';
import type {AppStackParamsList} from '../../sharedTypes/navigation';

// The engine's async publications (zustand → navigation resets) must run
// under React's act scheduler; RNTL toggles the flag only around its own
// calls, and this test's transitions arrive in core callbacks outside them.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

/**
 * The listener inputs are the only thing mocked in this suite: the navigation
 * stack, the startup gate and the profile store stay REAL. Both stores are
 * external snapshots so a test can publish a pending invite / map share at an
 * exact step of the flow, including a "late arrival" that lands together with
 * the Continuar tap.
 */
type InviteSnapshot = {
  inviteId: string;
  state: string;
  projectDescription?: string;
  projectName?: string;
  roleName?: string;
  invitorDeviceId?: string;
  receivedAt?: number;
  sendStats?: boolean;
  projectColor?: string;
};

type MapShareSnapshot = {shareId: string; status: string};

const mockInvites: {
  value: ReadonlyArray<InviteSnapshot>;
  listeners: Set<() => void>;
} = {value: [], listeners: new Set()};

const mockMapShares: {
  value: ReadonlyArray<MapShareSnapshot>;
  listeners: Set<() => void>;
} = {value: [], listeners: new Set()};

function mockSubscribeInvites(listener: () => void) {
  mockInvites.listeners.add(listener);
  return () => {
    mockInvites.listeners.delete(listener);
  };
}

function mockSubscribeMapShares(listener: () => void) {
  mockMapShares.listeners.add(listener);
  return () => {
    mockMapShares.listeners.delete(listener);
  };
}

function mockSingleInvite(inviteId: string) {
  return (
    mockInvites.value.find(invite => invite.inviteId === inviteId) ?? {
      inviteId,
      state: 'pending',
      projectName: 'Projeto de teste',
      roleName: 'Coordinator',
      sendStats: false,
    }
  );
}

jest.mock('@comapeo/core-react', () => {
  const actual = jest.requireActual('@comapeo/core-react');
  const React = require('react');
  return {
    ...actual,
    useManyInvites: () => ({
      data: React.useSyncExternalStore(
        mockSubscribeInvites,
        () => mockInvites.value,
      ),
    }),
    useManyReceivedMapShares: () =>
      React.useSyncExternalStore(
        mockSubscribeMapShares,
        () => mockMapShares.value,
      ),
    // The invite sheet mounts only after the listener proves it is alive
    // (case 5); this keeps the real screen renderable without core rows.
    useSingleInvite: ({inviteId}: {inviteId: string}) => ({
      data: mockSingleInvite(inviteId),
    }),
  };
});

import {act, fireEvent, screen, waitFor} from '@testing-library/react-native';

// The full navigator module graph pulls in the app screens (MapScreen
// included) even though the empty-document branch never mounts them — the
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
    MapView: Stub,
    Camera: Stub,
    MarkerView: Stub,
    UserLocation: Stub,
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

// The positive control asserts the ROUTE the map-share listener pushes; the
// sheet's body needs a real received-share row in core, which this suite does
// not create. Only the screen body is stubbed — the route and the listener
// stay real.
jest.mock('../../screens/BackgroundMaps/MapReceivedBottomSheet.tsx', () => ({
  MapReceivedBottomSheet: () => null,
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

import {MMKVStoreInitializer} from '../../hooks/persistedState/createPersistedState';
import {COIAB_ORGANIZATIONS_STORAGE_KEY} from '../../contexts/CoiabOrganizationsStoreContext';
import {
  COIAB_USER_PROFILE_STORAGE_KEY,
  type UserProfileState,
} from '../../contexts/UserProfileStoreContext';
import {markerFor} from '../../lib/organization/marker';
import {
  semearDocumentoPronta,
  setupIntegrationTest,
  setupIntegrationTestWithoutProject,
} from '../../../../tests/integration/helpers/setupIntegrationTest';

const ETNIA = 'Tunayana';
const ORG_ID = '0123456789abcdef';

// One share id reused by every case below, so the four onboarding cases and
// the positive control provably talk about the SAME pending share.
const PENDING_MAP_SHARE: MapShareSnapshot = {
  shareId: 'share-pendente',
  status: 'pending',
};

function plainInvite(inviteId: string): InviteSnapshot {
  return {
    inviteId,
    state: 'pending',
    projectName: 'Projeto de teste',
    roleName: 'Coordinator',
    receivedAt: 1,
    sendStats: false,
  };
}

function markerInvite(inviteId: string): InviteSnapshot {
  return {
    ...plainInvite(inviteId),
    projectDescription: markerFor(ORG_ID, 'm', 'Org de teste'),
  };
}

function setMockInvites(invites: ReadonlyArray<InviteSnapshot>) {
  mockInvites.value = invites;
  for (const listener of mockInvites.listeners) listener();
}

function setMockMapShares(shares: ReadonlyArray<MapShareSnapshot>) {
  mockMapShares.value = shares;
  for (const listener of mockMapShares.listeners) listener();
}

/**
 * A received map share cannot reach the screen while the profile is
 * incomplete: the onboarding routes are in `EDITING_SCREEN_NAMES` (the
 * listener refuses them) and `MapReceivedBottomSheet` is an app screen not
 * registered in the empty-document tree. Every "blocked" case asserts both
 * the absence of the route and the screen the user is still on.
 */
function destinoDoShareNaPilha(): boolean {
  return nomesDasRotas().includes('MapReceivedBottomSheet');
}

function nomesDasRotas(): string[] {
  return mockNavigation.getRootState().routes.map(route => route.name);
}

function perfilPersistido(): UserProfileState | null {
  const cru = MMKVStoreInitializer.getItem(COIAB_USER_PROFILE_STORAGE_KEY);
  if (typeof cru !== 'string') return null;
  return JSON.parse(cru).state as UserProfileState;
}

async function escolherEtnia() {
  // Etnia é texto livre: digitar um valor do dataset também exercita o
  // autocomplete, sem depender do toque numa sugestão.
  await fireEvent.changeText(
    await screen.findByTestId('ONBOARDING.ethnic-group-inp'),
    ETNIA,
  );
  await fireEvent.press(
    screen.getByTestId('ONBOARDING.ethnic-group-continue-btn'),
  );
  await screen.findByTestId('ONBOARDING.village-inp');
}

async function preencherAldeia(nome = 'Aldeia de teste') {
  await fireEvent.changeText(
    screen.getByTestId('ONBOARDING.village-inp'),
    nome,
  );
  await fireEvent.press(screen.getByTestId('ONBOARDING.village-continue-btn'));
  await screen.findByText('test is ready!');
}

/**
 * T7 (#128): the profile flow on the REAL navigator. The empty document with
 * an incomplete profile must open EthnicGroupSelection; while the flow runs,
 * the real PendingInvitesListener and PendingMapSharesListener sit in the
 * navigator layout and must stay silent. Only the join fork after Success
 * proves the listeners are alive (case 5).
 */
describe('perfil de onboarding no navigator real (#128)', () => {
  const freshSetup = setupIntegrationTestWithoutProject();

  beforeEach(() => {
    mockInvites.value = [];
    mockInvites.listeners.clear();
    mockMapShares.value = [];
    mockMapShares.listeners.clear();
    MMKVStoreInitializer.removeItem(COIAB_USER_PROFILE_STORAGE_KEY);
    MMKVStoreInitializer.removeItem(COIAB_ORGANIZATIONS_STORAGE_KEY);
  });

  afterEach(() => {
    MMKVStoreInitializer.removeItem(COIAB_USER_PROFILE_STORAGE_KEY);
    MMKVStoreInitializer.removeItem(COIAB_ORGANIZATIONS_STORAGE_KEY);
  });

  test('caso 1: cold start sem perfil percorre etnia → aldeia → Success', async () => {
    await freshSetup.renderNavigationAsync({userProfile: null});

    // Cold start: the empty document plus the incomplete profile opens the
    // profile flow instead of the create/join fork.
    expect(
      await screen.findByText('What is your ethnicity?'),
    ).toBeOnTheScreen();
    expect(nomesDasRotas()).toEqual(['EthnicGroupSelection']);

    await escolherEtnia();
    expect(nomesDasRotas()).toEqual(['EthnicGroupSelection', 'VillageEntry']);
    expect(screen.getByText('What is your village?')).toBeOnTheScreen();

    await preencherAldeia('Aldeia do caso 1');
    // VillageEntry resets the stack: Success is the only route left.
    expect(nomesDasRotas()).toEqual(['Success']);
    expect(perfilPersistido()).toEqual({
      ethnicity: ETNIA,
      village: 'Aldeia do caso 1',
    });
  }, 30000);

  test('caso 2: voltar da aldeia para a etnia mantém a seleção', async () => {
    await freshSetup.renderNavigationAsync({userProfile: null});
    await escolherEtnia();

    await fireEvent.press(screen.getByTestId('ONBOARDING.village-back-btn'));

    expect(
      await screen.findByText('What is your ethnicity?'),
    ).toBeOnTheScreen();
    expect(nomesDasRotas()).toEqual(['EthnicGroupSelection']);
    // The typed ethnicity survives the pop: the screen comes back with the
    // text already filled in, and Continuar is enabled again.
    expect(screen.getByTestId('ONBOARDING.ethnic-group-inp').props.value).toBe(
      ETNIA,
    );
    expect(
      screen.getByTestId('ONBOARDING.ethnic-group-continue-btn'),
    ).toBeEnabled();
    expect(perfilPersistido()?.ethnicity).toBe(ETNIA);
  }, 30000);

  test('caso 3: reinício no meio hidrata a etnia do MMKV e conclui o fluxo', async () => {
    const desmontar = await freshSetup.renderNavigationAsync({
      userProfile: null,
    });
    await escolherEtnia();
    await fireEvent.changeText(
      screen.getByTestId('ONBOARDING.village-inp'),
      'Aldeia interrompida',
    );

    // Restart: a NEW store over the SAME MMKV (the jest MMKV survives the
    // unmount like the device storage survives a process restart). The
    // harness must not rewrite the profile for this remount.
    await desmontar();
    expect(perfilPersistido()).toEqual({
      ethnicity: ETNIA,
      village: null,
    });

    await freshSetup.renderNavigationAsync({userProfile: 'keep'});

    // Incomplete profile (village still null) → back on the ethnic screen,
    // with the persisted text already applied.
    expect(
      await screen.findByText('What is your ethnicity?'),
    ).toBeOnTheScreen();
    expect(nomesDasRotas()).toEqual(['EthnicGroupSelection']);
    expect(screen.getByTestId('ONBOARDING.ethnic-group-inp').props.value).toBe(
      ETNIA,
    );

    await fireEvent.press(
      screen.getByTestId('ONBOARDING.ethnic-group-continue-btn'),
    );
    await screen.findByTestId('ONBOARDING.village-inp');
    await preencherAldeia('Aldeia retomada');

    expect(nomesDasRotas()).toEqual(['Success']);
    expect(perfilPersistido()).toEqual({
      ethnicity: ETNIA,
      village: 'Aldeia retomada',
    });
  }, 30000);

  test('caso 4a: convite pendente desde a montagem não interrompe o perfil', async () => {
    setMockInvites([markerInvite('invite-cold-start')]);

    await freshSetup.renderNavigationAsync({userProfile: null});

    expect(
      await screen.findByText('What is your ethnicity?'),
    ).toBeOnTheScreen();
    expect(nomesDasRotas()).toEqual(['EthnicGroupSelection']);
    expect(nomesDasRotas()).not.toContain('OrganizationInviteReceived');
    expect(nomesDasRotas()).not.toContain('InviteReceived');

    // Positive control: the SAME marker invite still routes once the profile
    // hands off to the join fork. Without it the blocked assertions above
    // would also pass with a listener that never fires at all.
    await escolherEtnia();
    await preencherAldeia('Aldeia do caso 4a');
    expect(nomesDasRotas()).toEqual(['Success']);

    await fireEvent.press(screen.getByTestId('ONBOARDING.join-org-btn'));
    await waitFor(() =>
      expect(nomesDasRotas()).toEqual([
        'Success',
        'JoinOrganizationIntro',
        'OrganizationInviteReceived',
      ]),
    );
  }, 30000);

  test('caso 4b: convite que chega atrasado em cada passo não interrompe o perfil', async () => {
    await freshSetup.renderNavigationAsync({userProfile: null});
    expect(
      await screen.findByText('What is your ethnicity?'),
    ).toBeOnTheScreen();

    // Arrives while the user is choosing the ethnicity.
    await act(async () => setMockInvites([plainInvite('invite-na-etnia')]));
    expect(nomesDasRotas()).toEqual(['EthnicGroupSelection']);

    await escolherEtnia();

    // Arrives while the user types the village.
    await act(async () => setMockInvites([markerInvite('invite-na-aldeia')]));
    expect(nomesDasRotas()).toEqual(['EthnicGroupSelection', 'VillageEntry']);

    await preencherAldeia('Aldeia do caso 4b');

    // Arrives while Success is on screen.
    await act(async () => setMockInvites([plainInvite('invite-no-success')]));
    expect(nomesDasRotas()).toEqual(['Success']);

    expect(nomesDasRotas()).not.toContain('InviteReceived');
    expect(nomesDasRotas()).not.toContain('OrganizationInviteReceived');

    // Positive control: a marker invite pending on Success stays held (Success
    // is a profile screen) and routes as soon as the join fork is on screen —
    // proving the gates exercised above are scoped, not a dead listener.
    await act(async () => setMockInvites([markerInvite('invite-no-join')]));
    expect(nomesDasRotas()).toEqual(['Success']);

    await fireEvent.press(screen.getByTestId('ONBOARDING.join-org-btn'));
    await waitFor(() =>
      expect(nomesDasRotas()).toEqual([
        'Success',
        'JoinOrganizationIntro',
        'OrganizationInviteReceived',
      ]),
    );
  }, 30000);

  test('caso 5: Success retém o convite e JoinOrganizationIntro o libera (listener vivo)', async () => {
    await freshSetup.renderNavigationAsync({userProfile: null});
    await escolherEtnia();
    await preencherAldeia('Aldeia do caso 5');
    expect(nomesDasRotas()).toEqual(['Success']);

    // Success is a gated screen: the invite stays pending there.
    await act(async () => setMockInvites([plainInvite('invite-vivo')]));
    expect(nomesDasRotas()).toEqual(['Success']);

    // Leaving the profile flow for the join fork is NOT a gated screen: the
    // same listener must now navigate, proving the gate is scoped and the
    // listener was never disabled.
    await fireEvent.press(screen.getByTestId('ONBOARDING.join-org-btn'));
    await waitFor(() =>
      expect(nomesDasRotas()).toEqual([
        'Success',
        'JoinOrganizationIntro',
        'InviteReceived',
      ]),
    );
  }, 30000);

  // --- Map shares: two cases per profile screen, both with a NON-EMPTY list.
  // They prove the share destination never enters the stack while the profile
  // is incomplete. The positive control after this describe proves the same
  // share does navigate once the profile is done and app screens exist.

  test('caso 6a: share de mapa pendente desde a montagem não interrompe a etnia', async () => {
    setMockMapShares([PENDING_MAP_SHARE]);

    await freshSetup.renderNavigationAsync({userProfile: null});

    expect(
      await screen.findByText('What is your ethnicity?'),
    ).toBeOnTheScreen();
    expect(nomesDasRotas()).toEqual(['EthnicGroupSelection']);
    expect(destinoDoShareNaPilha()).toBe(false);
  }, 30000);

  test('caso 6b: share que chega atrasado enquanto a etnia é escolhida não navega', async () => {
    await freshSetup.renderNavigationAsync({userProfile: null});
    expect(
      await screen.findByText('What is your ethnicity?'),
    ).toBeOnTheScreen();

    await act(async () => setMockMapShares([PENDING_MAP_SHARE]));

    expect(nomesDasRotas()).toEqual(['EthnicGroupSelection']);
    expect(destinoDoShareNaPilha()).toBe(false);
  }, 30000);

  test('caso 6c: share pendente desde a montagem não interrompe a aldeia', async () => {
    setMockMapShares([PENDING_MAP_SHARE]);

    await freshSetup.renderNavigationAsync({userProfile: null});
    await escolherEtnia();

    expect(nomesDasRotas()).toEqual(['EthnicGroupSelection', 'VillageEntry']);
    expect(screen.getByText('What is your village?')).toBeOnTheScreen();
    expect(destinoDoShareNaPilha()).toBe(false);
  }, 30000);

  test('caso 6d: share que chega atrasado enquanto a aldeia é digitada não navega', async () => {
    await freshSetup.renderNavigationAsync({userProfile: null});
    await escolherEtnia();
    await fireEvent.changeText(
      screen.getByTestId('ONBOARDING.village-inp'),
      'Aldeia com share',
    );

    await act(async () => setMockMapShares([PENDING_MAP_SHARE]));

    expect(nomesDasRotas()).toEqual(['EthnicGroupSelection', 'VillageEntry']);
    expect(screen.getByText('What is your village?')).toBeOnTheScreen();
    expect(destinoDoShareNaPilha()).toBe(false);
  }, 30000);
});

/**
 * Positive control for the four cases above: with the profile saved and a
 * ready organization seeded (so the app screens, including
 * MapReceivedBottomSheet, are registered), the SAME pending share navigates.
 * Without it, the blocked cases would also pass with a dead listener.
 */
describe('share de mapa pendente com o perfil concluído (controle positivo)', () => {
  const orgSetup = setupIntegrationTest();

  beforeEach(() => {
    mockMapShares.value = [];
    mockMapShares.listeners.clear();
    MMKVStoreInitializer.removeItem(COIAB_ORGANIZATIONS_STORAGE_KEY);
  });

  afterEach(() => {
    MMKVStoreInitializer.removeItem(COIAB_ORGANIZATIONS_STORAGE_KEY);
  });

  test('o mesmo share pendente navega para MapReceivedBottomSheet', async () => {
    semearDocumentoPronta(
      orgSetup.projectId,
      orgSetup.alertasProjectId,
      orgSetup.orgId,
      orgSetup.orgName,
    );

    // Default harness profile is complete; the document decides Home.
    await orgSetup.renderNavigation();
    expect(await screen.findByTestId('ENTRONCAMENTO.scrn')).toBeOnTheScreen();
    expect(nomesDasRotas()).toEqual(['Home']);

    await act(async () => setMockMapShares([PENDING_MAP_SHARE]));

    await waitFor(() =>
      expect(nomesDasRotas()).toEqual(['Home', 'MapReceivedBottomSheet']),
    );
  }, 30000);
});
