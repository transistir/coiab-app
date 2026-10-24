import type {Meta, StoryObj} from '@storybook/react-native';
import {View} from 'react-native';
import {withFlowState} from '../../../.rnstorybook/decorators/withFlowState';
import {withNavigation} from '../../../.rnstorybook/decorators/withNavigation';
import {FLOW_STATES} from '../../../.rnstorybook/utils/flowState';
import {ActiveProjectProvider} from '../contexts/ActiveProjectContext';
import {useActiveProjectId} from '../contexts/ActiveProjectIdStoreContext';
import {DrawerMenu} from './DrawerMenu';

/**
 * `DrawerMenu` is the content of the Menu page — the first tab's route
 * (`MenuScreen`, since #118 removed the drawer). It reads
 * `useActiveProject()`, which throws without its wrapping
 * `ActiveProjectProvider` (see `contexts/ActiveProjectContext.tsx`), so this
 * story seeds real backend state with `withFlowState` and then wraps
 * `DrawerMenu` in `ActiveProjectProvider` itself using the resolved
 * `activeProjectId` — mirroring exactly what `RootStackNavigator` does once
 * a project is active (see `src/frontend/Navigation/Stack/index.tsx`).
 *
 * `withNavigation` alone doesn't provide `ActiveProjectProvider` (see that
 * decorator's own docblock), and `fullApp` wouldn't either: `AppProviders`
 * mounts every other app context up front, but `ActiveProjectProvider` is
 * only mounted inside `RootStackNavigator`, conditionally on
 * `activeProjectId` being set. `DrawerMenu` also reads
 * `useNavigationFromRoot()`, `useManyProjects()`,
 * `useProjectRoleAndDetails()`, `useStorageReadingQuery()`, and
 * `useEarlyAccessState()` — all satisfied here, the last three by
 * `AppProviders`/global context, `useManyProjects` by the ambient
 * `ComapeoCoreProvider`, and navigation by `withNavigation`.
 *
 * Readiness markers (capture manifest): "01 Default" waits on
 * `MENU.main-action-button`, the footer's always-rendered button;
 * "02 With Organizations" waits on `MENU.trocar-organizacao`, the entry
 * that story exists to show. No app-source change was needed.
 */
function DrawerMenuStory() {
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
  title: 'Menu/DrawerMenu',
  component: DrawerMenuStory,
  decorators: [withFlowState, withNavigation],
} satisfies Meta<typeof DrawerMenuStory>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The menu page content rendered against a real seeded onboarded project. */
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

/**
 * Two ready organizations with early access off: the "Trocar de
 * organização" entry is visible on the organization count alone, the way
 * production shows it.
 */
export const WithOrganizations: Story = {
  name: '02 With Organizations',
  parameters: {
    flow: {state: FLOW_STATES.twoOrganizations},
  },
};
