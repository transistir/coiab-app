import type {InitialState} from '@react-navigation/native';
import type {Meta, StoryObj} from '@storybook/react-native';
import {withRealNavigator} from '../../../.rnstorybook/decorators/withRealNavigator';
import {FLOW_STATES} from '../../../.rnstorybook/utils/flowState';

/**
 * Organization-layer screens (SPEC-46): the fail-closed provisioning state,
 * the org invite surfaces, and the sender review screen. The real navigator
 * renders each route over a seeded Organization (flow state axis in
 * `.rnstorybook/utils/flowState.ts`).
 *
 * Not coverable here: the invite sheet's *complete bundle* Join card and the
 * preparing state — both derive from live pending invites, and the shared
 * backend cannot hold a pending invite without a second device to send it.
 * The sheet is therefore captured in its no-bundle (definitive/close) state,
 * which is the state a real device sees whenever the invites are gone.
 */
const NoStoryComponent = () => null;

const meta = {
  title: 'Flows/OrgLayer',
  component: NoStoryComponent,
  decorators: [withRealNavigator],
} satisfies Meta<typeof NoStoryComponent>;

export default meta;
type Story = StoryObj<typeof meta>;

const provisioningState: InitialState = {
  routes: [{name: 'OrganizationProvisioning'}],
  index: 0,
};

const inviteReceivedState: InitialState = {
  routes: [
    {
      name: 'OrganizationInviteReceived',
      // No matching pending invite exists in the shared backend, so the
      // sheet renders its definitive "ask the sender again" state.
      params: {organizationId: 'ffffffffffffffff', inviteId: 'absent'},
    },
  ],
  index: 0,
};

const reviewInviteState: InitialState = {
  routes: [
    {
      name: 'ReviewOrganizationInvite',
      params: {
        role: 'participant',
        deviceId: 'storybook-device',
        deviceType: 'mobile',
        name: 'Field Device',
      },
    },
  ],
  index: 0,
};

const homeState: InitialState = {
  routes: [{name: 'Home'}],
  index: 0,
};

/** The fail-closed screen shown while the Organization is incomplete. */
export const OrganizationProvisioning: Story = {
  name: '01 Organization Provisioning',
  parameters: {
    flow: {state: FLOW_STATES.orgProvisioning, initialState: provisioningState},
  },
};

/** The org invite sheet with no resolvable bundle (definitive state). */
export const OrganizationInviteReceived: Story = {
  name: '02 Organization Invite Received (no bundle)',
  parameters: {
    flow: {
      state: FLOW_STATES.namedNoProject,
      initialState: inviteReceivedState,
    },
  },
};

/** The single-action org invite sender over a ready Organization. */
export const ReviewOrganizationInvite: Story = {
  name: '03 Review Organization Invite',
  parameters: {
    flow: {
      state: FLOW_STATES.namedWithOrganization,
      initialState: reviewInviteState,
    },
  },
};

/** Home with a ready Organization's Monitoramento project active. */
export const HomeWithOrganization: Story = {
  name: '04 Home With Organization',
  parameters: {
    flow: {state: FLOW_STATES.namedWithOrganization, initialState: homeState},
  },
};
