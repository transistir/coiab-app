import * as React from 'react';
import {StyleSheet, View} from 'react-native';
import {CommonActions} from '@react-navigation/native';
import {defineMessages, useIntl} from 'react-intl';
import {NativeRootNavigationProps} from '../../sharedTypes/navigation';
import {
  DestructiveButton,
  SecondaryButton,
} from '../../sharedComponents/Buttons';
import {HeaderText} from '../../sharedComponents/Text/HeaderText';
import {BodyText} from '../../sharedComponents/Text/BodyText';
import {BLUE_GREY} from '../../lib/styles';
import MaterialDesignIcons from '@react-native-vector-icons/material-design-icons';
import {useLeaveProject, useManyProjects} from '@comapeo/core-react';
import {useActiveProject} from '../../contexts/ActiveProjectContext';
import {useProjectSettings} from '../../hooks/server/projects';
import {useActiveProjectIdActions} from '../../contexts/ActiveProjectIdStoreContext';
import {useOrganizations} from '../../hooks/organization/useOrganizations';
import * as Sentry from '@sentry/react-native';
import {LoadingIndicator} from '../../sharedComponents/LoadingIndicator';
import {toError} from '../../utils/errors';

const m = defineMessages({
  leaveProjectTitle: {
    id: '$1screens.LeaveProject.leaveProjTitle',
    defaultMessage: 'Leave this project?',
  },
  leaveProjectDescriptionCoordinator: {
    id: 'screens.LeaveProject.leaveProjectDescriptionCoordinator',
    defaultMessage:
      'This device will no longer be able to view, contribute to, or adjust the project {projectName}.',
  },
  leaveProjectDescriptionParticipant: {
    id: 'screens.LeaveProject.leaveProjectDescriptionParticipant',
    defaultMessage:
      'This device will no longer be able to view or contribute to the project {projectName}.',
  },
  yesLeave: {
    id: '$1screens.LeaveProject.yesLeave',
    defaultMessage: 'Yes, Leave',
  },
  cancel: {
    id: '$1screens.LeaveProject.cancel',
    defaultMessage: 'Cancel',
  },
});

export const LeaveProject = ({
  route,
  navigation,
}: NativeRootNavigationProps<'LeaveProject'>) => {
  const {formatMessage} = useIntl();
  const {projectId} = useActiveProject();
  const {data: projectSettings} = useProjectSettings();
  const leaveProject = useLeaveProject();
  const {setActiveProjectId, clearActiveProjectId} =
    useActiveProjectIdActions();
  const {data: projects} = useManyProjects();
  const organizations = useOrganizations();

  const isCoordinator = route.params.memberType === 'coordinator';

  function handleLeaveProject() {
    leaveProject.mutate(
      {projectId},
      {
        onSuccess: () => {
          try {
            // SPEC 3.8/3.10: leaving never materializes a standalone
            // (unnamed) project — an org project degrades to `incomplete`
            // by switching to the surviving slot, or hands off to the
            // startup gate with no active project at all; a non-org
            // project switches to any remaining project, else clears.
            let noProjectRemains = false;
            const leftOrg = organizations.find(
              org => org.slots.m === projectId || org.slots.a === projectId,
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
              const remainingProject = projects?.find(
                proj => proj.projectId !== projectId,
              );
              if (remainingProject) {
                setActiveProjectId(remainingProject.projectId);
              } else {
                noProjectRemains = true;
              }
            }
            // Reset (rather than replace) so that no screen with queries
            // scoped to the left project stays mounted — refetching them
            // errors because leaving closes the project's data stores.
            if (noProjectRemains) {
              clearActiveProjectId();
              // SPEC 10.1: with no project left, the startup gate's
              // organization fork is the correct landing — navigate there
              // explicitly so a cleared active id never drops the user on
              // IntroToCoMapeo.
              navigation.dispatch(
                CommonActions.reset({index: 0, routes: [{name: 'Success'}]}),
              );
            } else {
              navigation.dispatch(
                CommonActions.reset({
                  index: 1,
                  routes: [
                    {name: 'Home'},
                    {
                      name: 'LeftProjectConfirmation',
                      params: {projectName: projectSettings.name ?? ''},
                    },
                  ],
                }),
              );
            }
          } catch (err) {
            Sentry.captureException(err);
            navigation.replace('ErrorBottomSheet', {
              error: toError(err, 'Error updating active project'),
            });
          }
        },
        onError: err => {
          Sentry.captureException(err);
          navigation.replace('ErrorBottomSheet', {error: err});
        },
      },
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <View style={styles.deviceInfo}>
          <MaterialDesignIcons name="export" size={60} color={BLUE_GREY} />
          <HeaderText variant="header2" style={styles.title}>
            {formatMessage(m.leaveProjectTitle)}
          </HeaderText>
          <BodyText style={styles.description}>
            {formatMessage(
              isCoordinator
                ? m.leaveProjectDescriptionCoordinator
                : m.leaveProjectDescriptionParticipant,
              {projectName: projectSettings.name ?? ''},
            )}
          </BodyText>
        </View>
      </View>

      <View style={styles.buttons}>
        {leaveProject.status === 'pending' ? (
          <LoadingIndicator style={{marginVertical: 20}} />
        ) : (
          <>
            <DestructiveButton
              fullSize
              onPress={handleLeaveProject}
              text={formatMessage(m.yesLeave)}
              renderIcon={({color, size}) => (
                <MaterialDesignIcons name="export" size={size} color={color} />
              )}
            />
            <SecondaryButton
              fullSize
              onPress={() => navigation.goBack()}
              text={formatMessage(m.cancel)}
            />
          </>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'space-between',
  },
  content: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
  },
  deviceInfo: {
    gap: 20,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  title: {
    textAlign: 'center',
  },
  description: {
    textAlign: 'center',
  },
  buttons: {
    alignItems: 'center',
    gap: 12,
    paddingBottom: 20,
  },
});
