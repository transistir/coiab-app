import {type ComapeoCoreClientApi} from '@comapeo/ipc';
import {getLocales} from 'expo-localization';
import {Component, type ComponentPropsWithoutRef, type ReactNode} from 'react';

import {createActiveProjectIdStore} from '../../../src/frontend/contexts/ActiveProjectIdStoreContext';
import {AppProviders} from '../../../src/frontend/contexts/AppProviders';
import {createCoordinateFormatStore} from '../../../src/frontend/contexts/CoordinateFormatStoreContext';
import type {
  createLocalDiscoveryController,
  LocalDiscoveryState,
} from '../../../src/frontend/contexts/LocalDiscoveryContext';
import {
  createLocaleStore,
  LocaleContext,
  LocaleStore,
} from '../../../src/frontend/contexts/LocaleStoreContext';
import {createManualEntryCoordinateFormatStore} from '../../../src/frontend/contexts/ManualEntryCoordinateFormatStoreContext';
import {createDraftObservationStore} from '../../../src/frontend/contexts/PersistedStores/DraftObservationStore';
import {createSecurityStore} from '../../../src/frontend/contexts/SecurityStoreContext';
import {createTrackStore} from '../../../src/frontend/contexts/TrackStoreContext';
import {AppUsageData} from '../../../src/frontend/metrics/AppUsageData';
import {DeviceDiagnostics} from '../../../src/frontend/metrics/DeviceDiagnosticMetrics';
import {IntlProvider} from '../../../src/frontend/contexts/IntlContext';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {createSavedLocationStore} from '../../../src/frontend/contexts/SavedLocationContext';
import {createLowStorageBannerStore} from '../../../src/frontend/contexts/LowStorageBannerContext';
import {createEarlyAccessStore} from '../../../src/frontend/contexts/EarlyAccessContext';
import {createAppUsageStatsStore} from '../../../src/frontend/contexts/AppUsageStatsContext';
import {createUnitSystemStore} from '../../../src/frontend/contexts/UnitSystemStoreContext';
import {createQADeviceNameStore} from '../../../src/frontend/contexts/QADeviceNameStoreContext';
import {createOrganizationInviteIdentityStore} from '../../../src/frontend/contexts/OrganizationInviteIdentityStoreContext';
import {
  COIAB_USER_PROFILE_STORAGE_KEY,
  createUserProfileStore,
  type UserProfileState,
} from '../../../src/frontend/contexts/UserProfileStoreContext';
import {MMKVStoreInitializer} from '../../../src/frontend/hooks/persistedState/createPersistedState';
import {ETHNIC_GROUPS} from '../../../src/frontend/lib/ethnicGroups';

/**
 * The profile every harness starts with (#128). A complete profile keeps the
 * empty-document startup branch on `Success`, which is what the suites that
 * mount the real navigator and assert the create/join fork expect — before
 * the profile gate, that branch had no prerequisite at all. Pass
 * `userProfile: null` (or a partial `UserProfileState`) in a test that needs
 * the onboarding flow instead.
 */
export const COMPLETE_USER_PROFILE: UserProfileState = {
  ethnicGroupId: ETHNIC_GROUPS[0]!.id,
  village: 'Aldeia de teste',
};

/**
 * How a harness seeds the profile before mounting:
 * - a `UserProfileState` writes exactly that value;
 * - `null` clears the key (empty onboarding profile);
 * - `'keep'` touches nothing, so a remount on the same MMKV proves the
 *   persisted profile is what hydrates the new store (mid-flow restart).
 */
export type UserProfileSeed = UserProfileState | null | 'keep';

/**
 * Writes the profile through the same persisted store production hydrates,
 * before `AppProviders` creates its singleton (its state initializer reads
 * MMKV at mount). `null` clears the key, so one test's profile cannot leak
 * into the next through the durable storage. `'keep'` is the restart case:
 * the key is read back by the new store, never rewritten by the harness.
 */
function seedUserProfile(profile: UserProfileSeed) {
  if (profile === 'keep') return;
  MMKVStoreInitializer.removeItem(COIAB_USER_PROFILE_STORAGE_KEY);
  if (!profile) return;
  const store = createUserProfileStore({persist: true});
  if (profile.ethnicGroupId !== null) {
    store.actions.setEthnicGroup(profile.ethnicGroupId);
  }
  if (profile.village !== null) {
    store.actions.setVillage(profile.village);
  }
}

const DEFAULT_LOCAL_DISCOVERY_STATE: LocalDiscoveryState = {
  status: 'started',
  ssid: 'CoMapeo Test Wi-Fi',
  wifiStatus: 'on',
  wifiConnection: 'connected',
  wifiLinkSpeed: 1234,
};

const DISCONNECTED_LOCAL_DISCOVERY_STATE: LocalDiscoveryState = {
  status: 'started',
  ssid: null,
  wifiStatus: 'off',
  wifiConnection: 'disconnected',
  wifiLinkSpeed: null,
};

jest.mock('expo/fetch', () => ({
  fetch: globalThis.fetch,
}));

export function createMinimalWrapper({
  queryClient: providedQueryClient,
}: {queryClient?: QueryClient} = {}) {
  const localeStore = createLocaleStore({persist: false});
  const queryClient =
    providedQueryClient ??
    new QueryClient({
      defaultOptions: {
        queries: {gcTime: Infinity},
        mutations: {gcTime: Infinity},
      },
    });

  return ({children}: {children: ReactNode}) => {
    return (
      <QueryClientProvider client={queryClient}>
        <LocaleContext value={localeStore}>
          <IntlProvider>{children}</IntlProvider>
        </LocaleContext>
      </QueryClientProvider>
    );
  };
}

export function createAppProvidersWrapper({
  mapeoApi,
  isOnline = true,
  activeProjectId,
  qaDeviceName,
  userProfile = COMPLETE_USER_PROFILE,
}: {
  mapeoApi: ComapeoCoreClientApi;
  isOnline?: boolean;
  activeProjectId?: string;
  qaDeviceName?: string;
  /**
   * `null` starts the app with the empty onboarding profile; `'keep'` mounts
   * over whatever MMKV already holds (restart mid-flow).
   */
  userProfile?: UserProfileSeed;
}) {
  seedUserProfile(userProfile);

  const queryClient = new QueryClient({
    // Disable garbage collection, so that no "collect garbage" timers are
    // started, which would otherwise leave an open handle, giving a Jest
    // warning. See [this tip in the Tanstack Query docs][0] and [this cache
    // example scenario][1].
    // [0]: https://tanstack.com/query/latest/docs/framework/react/guides/testing#set-gctime-to-infinity-with-jest
    // [1]: https://tanstack.com/query/latest/docs/framework/react/guides/caching
    defaultOptions: {
      queries: {gcTime: Infinity},
      mutations: {gcTime: Infinity},
    },
  });

  const persistedLocaleStore = createLocaleStore({
    persist: true,
  });

  const appDiagnosticMetrics = new AppUsageData({
    getLocaleInfo: () => {
      const systemLocales = getLocales();
      const {languageTag} = persistedLocaleStore.instance.getState();

      return {
        appLanguageTag: languageTag,
        deviceLanguageTag: systemLocales[0]!.languageTag,
      };
    },
  });

  const deviceDiagnosticMetrics = new DeviceDiagnostics();

  const localDiscoveryController: ReturnType<
    typeof createLocalDiscoveryController
  > = {
    subscribe: jest.fn(() => jest.fn()),
    getSnapshot: () => ({
      ...(isOnline
        ? DEFAULT_LOCAL_DISCOVERY_STATE
        : DISCONNECTED_LOCAL_DISCOVERY_STATE),
    }),
    start: jest.fn(),
    stop: jest.fn(),
  };

  const persistedDraftObservationStore = createDraftObservationStore({
    persist: true,
  });

  const persistedTrackStore = createTrackStore({
    persist: true,
  });

  const persistedSecurityStore = createSecurityStore({
    persist: false,
  });

  const persistedCoordinateFormatStore = createCoordinateFormatStore({
    persist: true,
  });

  const persistedManualEntryCoordinateFormatStore =
    createManualEntryCoordinateFormatStore({
      persist: true,
    });

  const persistedActiveProjectIdStore = createActiveProjectIdStore();

  const organizationInviteIdentityStore = createOrganizationInviteIdentityStore(
    {persist: false},
  );

  const persistedSavedLocationStore = createSavedLocationStore({
    persist: false,
  });

  const persistedEarlyAccessStore = createEarlyAccessStore({persist: false});

  const unitSystemStore = createUnitSystemStore({persist: false});

  const qaDeviceNameStore = createQADeviceNameStore({persist: false});
  if (qaDeviceName) {
    qaDeviceNameStore.actions.setQADeviceName(qaDeviceName);
  }

  const lowStorageBannerStore = createLowStorageBannerStore();

  const appUsagePromptStore = createAppUsageStatsStore({
    persist: false,
    appUsageMetricsOptIn: () => {},
    appUsageMetricsOptOut: () => {},
  });

  const mockMapServerApi = {
    getBaseUrl: jest.fn(() =>
      Promise.resolve(new URL('http://127.0.0.1:9999')),
    ),
  };

  if (activeProjectId) {
    persistedActiveProjectIdStore.instance.setState({
      projectId: activeProjectId,
    });
  }

  // One client for the whole tree, as in production: `ComapeoCoreProvider`
  // installs no `QueryClientProvider`, so every `useQuery` reads the client
  // the outer wrapper provides, while AppProviders' `queryClient` prop only
  // reaches the map-shares store. Two instances would leave the real cache
  // out of `teardown()`'s reach.
  const OuterWrapper = createMinimalWrapper({queryClient});
  const wrapper = ({children}: {children: ReactNode}) => {
    return (
      <OuterWrapper>
        <AppProviders
          queryClient={queryClient}
          mapeoApi={mapeoApi}
          mapServerApi={mockMapServerApi}
          localDiscoveryController={localDiscoveryController}
          activeProjectIdStore={persistedActiveProjectIdStore}
          organizationInviteIdentityStore={organizationInviteIdentityStore}
          persistedDrafObservationStore={persistedDraftObservationStore}
          securityStore={persistedSecurityStore}
          manualEntryCoordinateFormatStore={
            persistedManualEntryCoordinateFormatStore
          }
          coordinateFormatStore={persistedCoordinateFormatStore}
          savedLocationStore={persistedSavedLocationStore}
          trackStore={persistedTrackStore}
          lowStorageBannerStore={lowStorageBannerStore}
          appUsageStatsStore={appUsagePromptStore}
          earlyAccessStore={persistedEarlyAccessStore}
          unitSystemStore={unitSystemStore}
          qaDeviceNameStore={qaDeviceNameStore}>
          {children}
        </AppProviders>
      </OuterWrapper>
    );
  };

  const teardown = () => {
    // Destroys every query (in-flight fetches are cancelled silently) and
    // drops the mutations, so no query outlives the test and refetches
    // against a closing IPC channel.
    queryClient.clear();
    localDiscoveryController.stop();
    appDiagnosticMetrics.setEnabled(false);
    deviceDiagnosticMetrics.setEnabled(false);
  };

  return {
    wrapper,
    teardown,
    queryClient,
    activeProjectIdStore: persistedActiveProjectIdStore,
  };
}
