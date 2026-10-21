import type {Meta, StoryObj} from '@storybook/react-native';
import {View} from 'react-native';
import {withFlowState} from '../../../.rnstorybook/decorators/withFlowState';
import {withNavigation} from '../../../.rnstorybook/decorators/withNavigation';
import {FLOW_STATES} from '../../../.rnstorybook/utils/flowState';
import {ActiveProjectProvider} from '../contexts/ActiveProjectContext';
import {useActiveProjectId} from '../contexts/ActiveProjectIdStoreContext';
import {DrawerMenu} from '../sharedComponents/DrawerMenu';

/**
 * The menu page's "Switch organization" entry (SPEC A §6.1), the way into
 * the selector `Flows/OrgLayer` captures open. The entry exists only with
 * early access on and two or more organizations, so its testID alone proves
 * both seeded axes reached the menu page.
 *
 * This is a non-route flow story: the menu page content (`DrawerMenu` since
 * #118 removed the drawer) wrapped in its own `ActiveProjectProvider` the
 * same way `Menu/DrawerMenu` does — see that story for why the provider is
 * mounted manually. Since #118 the content is route content under
 * `Home`/`Menu`, so a `withRealNavigator` story with `initialState` seeded
 * to `Home`/`Menu` would reach it too; these stories capture the menu
 * content in isolation with `withFlowState` instead. It lives in its own
 * file because `Flows/OrgLayer`'s `withRealNavigator` renders the navigator
 * instead of the story, and story decorators add to the file's decorators
 * rather than replacing them.
 */
function OpenDrawerMenu() {
  const activeProjectId = useActiveProjectId();
  if (!activeProjectId) return null;

  return (
    <View style={{flex: 1}}>
      <ActiveProjectProvider activeProjectId={activeProjectId}>
        <DrawerMenu closeMenu={() => {}} />
      </ActiveProjectProvider>
    </View>
  );
}

const meta = {
  title: 'Flows/OrgLayerDrawer',
  component: OpenDrawerMenu,
  decorators: [withFlowState, withNavigation],
} satisfies Meta<typeof OpenDrawerMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The menu page over two organizations, with the selector entry shown. */
export const SwitchOrganizationEntry: Story = {
  name: '01 Switch Organization Entry',
  parameters: {
    flow: {state: FLOW_STATES.twoOrganizationsEarlyAccess},
  },
};

/**
 * The menu page over a single ready organization: no selector entry, but
 * the create entry exists — the way to a second organization.
 */
export const CreateOrganizationEntry: Story = {
  name: '02 Create Organization Entry',
  parameters: {
    flow: {state: FLOW_STATES.oneOrganizationEarlyAccess},
  },
};
