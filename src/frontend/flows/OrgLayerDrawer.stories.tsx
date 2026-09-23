import type {Meta, StoryObj} from '@storybook/react-native';
import {useWindowDimensions, View} from 'react-native';
import {Drawer} from 'react-native-drawer-layout';
import {withFlowState} from '../../../.rnstorybook/decorators/withFlowState';
import {withNavigation} from '../../../.rnstorybook/decorators/withNavigation';
import {FLOW_STATES} from '../../../.rnstorybook/utils/flowState';
import {ActiveProjectProvider} from '../contexts/ActiveProjectContext';
import {useActiveProjectId} from '../contexts/ActiveProjectIdStoreContext';
import {VERY_LIGHT_GREY} from '../lib/styles';
import {getDrawerWidth} from '../Navigation/Tab';
import {DrawerMenu} from '../sharedComponents/DrawerMenu';

/**
 * The drawer's "Switch organization" entry (SPEC A §6.1), the way into the
 * selector `Flows/OrgLayer` captures open. The entry exists only with early
 * access on and two or more organizations, so its testID alone proves both
 * seeded axes reached the drawer.
 *
 * The drawer is not a navigation route, so this is a non-route flow story:
 * the same open `Drawer` shell as `Menu/DrawerMenu` (see that story for why
 * `withRealNavigator` cannot open it). It lives in its own file because
 * `Flows/OrgLayer`'s `withRealNavigator` renders the navigator instead of
 * the story, and story decorators add to the file's decorators rather than
 * replacing them.
 */
function OpenDrawerMenu() {
  const activeProjectId = useActiveProjectId();
  const drawerWidth = getDrawerWidth(useWindowDimensions().width);
  if (!activeProjectId) return null;

  return (
    <Drawer
      open
      onOpen={() => {}}
      onClose={() => {}}
      drawerType="slide"
      swipeEnabled={false}
      drawerStyle={{width: drawerWidth, maxWidth: drawerWidth}}
      renderDrawerContent={() => (
        <ActiveProjectProvider activeProjectId={activeProjectId}>
          <DrawerMenu closeMenu={() => {}} />
        </ActiveProjectProvider>
      )}>
      {/* Deliberately stands in for Tab.Navigator without mounting real tabs. */}
      <View style={{flex: 1, backgroundColor: VERY_LIGHT_GREY}} />
    </Drawer>
  );
}

const meta = {
  title: 'Flows/OrgLayerDrawer',
  component: OpenDrawerMenu,
  decorators: [withFlowState, withNavigation],
} satisfies Meta<typeof OpenDrawerMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The open drawer over two organizations, with the selector entry shown. */
export const SwitchOrganizationEntry: Story = {
  name: '01 Switch Organization Entry',
  parameters: {
    flow: {state: FLOW_STATES.twoOrganizationsEarlyAccess},
  },
};
