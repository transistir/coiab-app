/**
 * Full-screen fixtures for Exchange states that the real `Sync` route cannot
 * be forced into on CI. Wi-Fi radio status, peer discovery, sync progress and
 * archive settings come from live hooks and `FlowStateSpec` has no discovery
 * axis; see `Flows/Exchange`'s `MainScreen` doc comment for the route-level
 * limitation. The Storybook-only override seam fixtures those presentation
 * values while still rendering the shipping screen against a seeded project.
 * The shipping app never passes the override prop.
 */
import type {SyncState} from '@comapeo/core-react';
import type {Meta, StoryObj} from '@storybook/react-native';

import {withFlowState} from '../../../../.rnstorybook/decorators/withFlowState';
import {withNavigation} from '../../../../.rnstorybook/decorators/withNavigation';
import {FLOW_STATES} from '../../../../.rnstorybook/utils/flowState';
import {ActiveProjectProvider} from '../../contexts/ActiveProjectContext';
import {useActiveProjectId} from '../../contexts/ActiveProjectIdStoreContext';
import {NavigatorScreenOptions} from '../../Navigation/Stack';
import {
  ExchangeScreenContent,
  type ExchangeScreenContentOverrides,
} from './ExchangeScreenContent';

type ExchangeScreenStoryProps = {
  syncState: SyncState;
  overrides: ExchangeScreenContentOverrides;
};

function createSyncState({
  connectedPeersCount,
  syncingPeersCount,
  isSyncEnabled,
}: {
  connectedPeersCount: number;
  syncingPeersCount: number;
  isSyncEnabled: boolean;
}): SyncState {
  const remoteDeviceSyncState: SyncState['remoteDeviceSyncState'] = {};

  for (let index = 0; index < connectedPeersCount; index += 1) {
    remoteDeviceSyncState[`storybook-peer-${index + 1}`] = {
      initial: {isSyncEnabled: true, want: 0, wanted: 0},
      data: {
        isSyncEnabled: index < syncingPeersCount,
        want: 0,
        wanted: 0,
      },
    };
  }

  return {
    initial: {isSyncEnabled: true},
    data: {isSyncEnabled},
    remoteDeviceSyncState,
  };
}

function ExchangeScreenStory({syncState, overrides}: ExchangeScreenStoryProps) {
  const activeProjectId = useActiveProjectId();
  if (!activeProjectId) return null;

  return (
    <ActiveProjectProvider activeProjectId={activeProjectId}>
      <ExchangeScreenContent syncState={syncState} overrides={overrides} />
    </ActiveProjectProvider>
  );
}

const meta = {
  title: 'Exchange/Screen',
  component: ExchangeScreenStory,
  decorators: [withFlowState, withNavigation],
  parameters: {
    flow: {
      state: {
        ...FLOW_STATES.onboardedWithData,
        draftObservation: 'none',
      },
    },
    navigation: {
      options: {...NavigatorScreenOptions, headerTitle: 'Exchange'},
    },
  },
} satisfies Meta<typeof ExchangeScreenStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoDevicesFound: Story = {
  name: '01 No Devices Found',
  args: {
    syncState: createSyncState({
      connectedPeersCount: 0,
      syncingPeersCount: 0,
      isSyncEnabled: false,
    }),
    overrides: {
      ssid: 'Storybook Network',
      progress: null,
      isArchiveDevice: false,
      remoteArchiveConnected: false,
    },
  },
};

export const DevicesFoundPreviews: Story = {
  name: '02 Devices Found (Previews Only)',
  args: {
    syncState: createSyncState({
      connectedPeersCount: 2,
      syncingPeersCount: 0,
      isSyncEnabled: false,
    }),
    overrides: {
      ssid: 'Storybook Network',
      progress: null,
      isArchiveDevice: false,
      remoteArchiveConnected: false,
    },
  },
};

export const DevicesFoundEverything: Story = {
  name: '03 Devices Found (Exchange Everything)',
  args: {
    syncState: createSyncState({
      connectedPeersCount: 2,
      syncingPeersCount: 0,
      isSyncEnabled: false,
    }),
    overrides: {
      ssid: 'Storybook Network',
      progress: null,
      isArchiveDevice: true,
      remoteArchiveConnected: false,
    },
  },
};

export const Syncing: Story = {
  name: '04 Syncing',
  args: {
    syncState: createSyncState({
      connectedPeersCount: 2,
      syncingPeersCount: 2,
      isSyncEnabled: true,
    }),
    overrides: {
      ssid: 'Storybook Network',
      progress: 0.45,
      isArchiveDevice: false,
      remoteArchiveConnected: false,
    },
  },
};

export const WifiDisconnected: Story = {
  name: '05 Wifi Disconnected',
  args: {
    syncState: createSyncState({
      connectedPeersCount: 0,
      syncingPeersCount: 0,
      isSyncEnabled: false,
    }),
    overrides: {
      ssid: null,
      progress: null,
      isArchiveDevice: false,
      remoteArchiveConnected: false,
    },
  },
};
