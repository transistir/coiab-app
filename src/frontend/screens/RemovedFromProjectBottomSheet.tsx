import {BottomSheetWrapper} from '../sharedComponents/BottomSheetWrapper';
import {StyleSheet, View} from 'react-native';
import {SecondaryButton} from '../sharedComponents/Buttons';
import {defineMessages, useIntl} from 'react-intl';
import {NativeRootNavigationProps} from '../sharedTypes/navigation';
import {HeaderText} from '../sharedComponents/Text/HeaderText';
import {BLACK} from '../lib/styles';
import {
  useLeaveProject,
  useManyProjects,
  useOwnRoleInProject,
  useProjectSettings,
} from '@comapeo/core-react';
import {useActiveProject} from '../contexts/ActiveProjectContext';
import {useActiveProjectIdActions} from '../contexts/ActiveProjectIdStoreContext';
import {useOrganizations} from '../hooks/organization/useOrganizations';
import {LoadingIndicator} from '../sharedComponents/LoadingIndicator';
import {ColorCard} from '../sharedComponents/ColorCard';
import {DEFAULT_PROJECT_COLOR} from '../constants';

const m = defineMessages({
  close: {
    id: '$1screens.RemovedFromProjectBottomSheet.close',
    defaultMessage: 'Close',
  },
  title: {
    id: '$1screens.RemovedFromProjectBottomSheet.title',
    defaultMessage: 'THIS DEVICE REMOVED FROM…',
  },
  reasonLabel: {
    id: '$1screens.RemovedFromProjectBottomSheet.reasonLabel',
    defaultMessage: 'Reason: {reason}',
  },
});

export const RemovedFromProjectBottomSheet = ({
  navigation,
}: NativeRootNavigationProps<'RemovedFromProjectBottomSheet'>) => {
  const {formatMessage} = useIntl();
  const {projectId} = useActiveProject();
  const {
    data: {reason},
  } = useOwnRoleInProject({projectId});
  const {
    data: {name, projectColor},
  } = useProjectSettings({projectId});
  const {data: projects} = useManyProjects();
  const organizations = useOrganizations();
  const {setActiveProjectId, clearActiveProjectId} =
    useActiveProjectIdActions();
  const leaveProject = useLeaveProject();

  return (
    <BottomSheetWrapper>
      <View style={styles.container}>
        <HeaderText variant="header6" style={styles.titleText}>
          {formatMessage(m.title)}
        </HeaderText>

        <ColorCard backgroundColor={projectColor || DEFAULT_PROJECT_COLOR}>
          <View style={{padding: 20, gap: 20}}>
            <HeaderText variant="header2" style={styles.projectName}>
              {name}
            </HeaderText>
            {reason && (
              <HeaderText variant="header5">
                {formatMessage(m.reasonLabel, {reason})}
              </HeaderText>
            )}
          </View>
        </ColorCard>

        <View style={styles.buttonContainer}>
          {leaveProject.status === 'pending' ? (
            <LoadingIndicator style={{margin: 20}} />
          ) : (
            <SecondaryButton
              fullSize
              onPress={() => {
                leaveProject.mutate(
                  {projectId},
                  {
                    onSuccess: () => {
                      // SPEC 3.8/3.10: leaving a project never materializes
                      // a standalone (unnamed) project — for ANY project, a
                      // leftover one would resurrect the `solo` role and
                      // the Collaborate product entry (SPEC 3.11). An org
                      // project degrades to `incomplete` by switching to
                      // the surviving slot, or hands off to the startup
                      // gate with no active project at all.
                      let noProjectRemains = false;
                      const leftOrg = organizations.find(
                        org =>
                          org.slots.m === projectId ||
                          org.slots.a === projectId,
                      );
                      if (leftOrg) {
                        const survivingSlot =
                          leftOrg.slots.m === projectId
                            ? leftOrg.slots.a
                            : leftOrg.slots.m;
                        if (survivingSlot) {
                          setActiveProjectId(survivingSlot);
                        } else {
                          noProjectRemains = true;
                        }
                      } else {
                        const remainingProject = projects.find(
                          proj => proj.projectId !== projectId,
                        );
                        if (remainingProject) {
                          setActiveProjectId(remainingProject.projectId);
                        } else {
                          noProjectRemains = true;
                        }
                      }
                      if (noProjectRemains) {
                        clearActiveProjectId();
                        // SPEC 10.1: with no project left, the startup
                        // gate's organization fork is the correct landing —
                        // navigate there explicitly so a cleared active id
                        // never drops the user on IntroToCoMapeo.
                        navigation.reset({
                          index: 0,
                          routes: [{name: 'Success'}],
                        });
                      } else {
                        navigation.popToTop();
                      }
                    },
                  },
                );
              }}
              text={formatMessage(m.close)}
            />
          )}
        </View>
      </View>
    </BottomSheetWrapper>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  titleText: {
    textTransform: 'uppercase',
    color: BLACK,
  },
  projectName: {
    color: BLACK,
  },
  buttonContainer: {
    paddingTop: 18,
    alignItems: 'center',
  },
});
