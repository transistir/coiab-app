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
import {DrawerMenu} from './DrawerMenu';

/**
 * `DrawerMenu` is not a navigation route — `react-native-drawer-layout`
 * renders it in `src/frontend/Navigation/Tab/index.tsx`, and its
 * open/closed state is component-local `useState` from `useOpenDrawer()`,
 * so `withRealNavigator`'s `initialState` can never open it (see the plan's
 * "Route facts" section). This story instead seeds real backend state with
 * `withFlowState`, then wraps `DrawerMenu` in `ActiveProjectProvider`
 * itself using the resolved `activeProjectId` — mirroring exactly what
 * `RootStackNavigator` does once a project is active (see
 * `src/frontend/Navigation/Stack/index.tsx`).
 *
 * The story mounts its own `Drawer` with `open` hard-coded, sidestepping the
 * unreachable local state while preserving the library's production layout.
 * It reuses `getDrawerWidth` so captures track the real drawer width instead
 * of duplicating its arithmetic. The drawer children are a deliberate filler
 * for `Tab.Navigator`, not the real tab content.
 *
 * `withNavigation` alone doesn't provide `ActiveProjectProvider` (see that
 * decorator's own docblock), and `fullApp` wouldn't either: `AppProviders`
 * mounts every other app context up front, but `ActiveProjectProvider` is
 * only mounted inside `RootStackNavigator`, conditionally on
 * `activeProjectId` being set. `DrawerMenu` reads `useActiveProject()`
 * (that provider), plus `useNavigationFromRoot()`, `useManyProjects()`,
 * `useProjectRoleAndDetails()`, `useStorageReadingQuery()`, and
 * `useEarlyAccessState()` — all satisfied here, the last three by
 * `AppProviders`/global context, `useManyProjects` by the ambient
 * `ComapeoCoreProvider`, and navigation by `withNavigation`.
 *
 * Readiness marker: reuses the existing `MENU.main-action-button` testID on
 * `DrawerMenu`'s always-rendered footer button, so no app-source change was
 * needed.
 */
function DrawerMenuStory() {
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
  title: 'Menu/DrawerMenu',
  component: DrawerMenuStory,
  decorators: [withFlowState, withNavigation],
} satisfies Meta<typeof DrawerMenuStory>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The drawer menu rendered against a real seeded onboarded project. */
export const Default: Story = {
  name: '01 Default',
  parameters: {
    flow: {
      state: {
        ...FLOW_STATES.onboardedWithData,
        draftObservation: 'none',
      },
    },
  },
};
