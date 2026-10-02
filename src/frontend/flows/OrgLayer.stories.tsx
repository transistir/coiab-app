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
 *
 * Also not coverable: the Organizations selector's opening state ("Opening
 * organization…") and its failed-switch explanation. Both are the screen's
 * own component state, set only by tapping a row, and the capture pipeline
 * selects stories and waits — it never taps. The opening state is also
 * transient: it lasts only as long as the switch's calls into the backend.
 *
 * The recovery state — "Could not open your organization", with the active
 * organization's name and the switch/create exits — is seeded through the
 * `organizations` axis's `unopenable` fault: the persisted document links the
 * active organization's Alertas to a project the backend never had (or
 * selects an organization the document does not hold), and the production
 * engine refuses to open it. What is not coverable is the cold start itself:
 * the root engine boots once, before any story, so the stories reach the same
 * `recovery` publication through its public API (`revalidate()` over an open
 * organization, `activate()` otherwise) and render no boot-time side effect
 * such as the degraded-boot report. They leave that engine in recovery, so
 * they run last in a capture (see `flowStateCleanup.test.tsx`). A blocked
 * role is deliberately not used: it cannot be undone in the shared backend.
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

/** Where the drawer's "Switch organization" entry leaves the stack. */
const organizationSelectorState: InitialState = {
  routes: [{name: 'Home'}, {name: 'Organizations'}],
  index: 1,
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

/**
 * The organization selector over Home: two ready organizations, the active
 * one listed first and marked current although it sorts second by name.
 */
export const OrganizationSelector: Story = {
  name: '05 Organization Selector',
  parameters: {
    flow: {
      state: FLOW_STATES.twoOrganizationsEarlyAccess,
      initialState: organizationSelectorState,
    },
  },
};

/** Where the drawer's "Create organization" entry leaves the stack. */
const createSecondOrganizationState: InitialState = {
  routes: [{name: 'Home'}, {name: 'CreateOrganization'}],
  index: 1,
};

/**
 * Where creating leaves the stack: CreateOrganization replaces itself with
 * OrganizationProvisioning once the new organization is in preparation.
 */
const secondOrganizationProvisioningState: InitialState = {
  routes: [{name: 'Home'}, {name: 'OrganizationProvisioning'}],
  index: 1,
};

/**
 * CreateOrganization over one ready organization renders its form: an
 * operating organization no longer diverts creation.
 */
export const CreateSecondOrganization: Story = {
  name: '06 Create Second Organization',
  parameters: {
    flow: {
      state: FLOW_STATES.oneOrganizationEarlyAccess,
      initialState: createSecondOrganizationState,
    },
  },
};

/**
 * OrganizationProvisioning for the second organization, not the open one.
 *
 * Seeded as A ready and active with B `preparando` on Alertas, rather than
 * both ready with B's confirmation pending: the startup gate opens A as it
 * would on a real device mid-creation (the engine does not resume a
 * non-active organization in preparation), and the seed never writes a
 * pending confirmation. The `preparando` panel shows area rows, not the
 * name, so B is told apart by its rows — Monitoramento done, Alertas in
 * progress. Falling back to A, the first organization, would show a ready
 * organization and no rows at all.
 */
export const SecondOrganizationProvisioning: Story = {
  name: '07 Second Organization Provisioning',
  parameters: {
    flow: {
      state: FLOW_STATES.secondOrganizationPreparing,
      initialState: secondOrganizationProvisioningState,
    },
  },
};

/**
 * The recovery surface over the only organization: its name and "Try
 * again". Early access is off, so neither the switch nor the create exit.
 */
export const OrganizationUnavailable: Story = {
  name: '08 Organization Unavailable',
  parameters: {
    flow: {
      state: FLOW_STATES.oneOrganizationUnavailable,
      initialState: provisioningState,
    },
  },
};

/**
 * The recovery surface over B, the active one of two organizations: B's
 * name, "Try again", and both exits — switch and create.
 */
export const OrganizationUnavailableTwoOrganizations: Story = {
  name: '09 Organization Unavailable (two organizations)',
  parameters: {
    flow: {
      state: FLOW_STATES.twoOrganizationsUnavailable,
      initialState: provisioningState,
    },
  },
};

/**
 * The recovery surface for a selection naming no organization in the
 * document: no name to preserve and nothing derived, so "Try again" is the
 * only action.
 */
export const OrganizationUnavailableOrphanedSelection: Story = {
  name: '10 Organization Unavailable (orphaned selection)',
  parameters: {
    flow: {
      state: FLOW_STATES.orphanedOrganizationSelection,
      initialState: provisioningState,
    },
  },
};
