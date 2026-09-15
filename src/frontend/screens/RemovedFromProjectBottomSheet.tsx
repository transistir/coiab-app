import {BottomSheetWrapper} from '../sharedComponents/BottomSheetWrapper';
import {StyleSheet, View} from 'react-native';
import {SecondaryButton} from '../sharedComponents/Buttons';
import {defineMessages, useIntl} from 'react-intl';
import {NativeRootNavigationProps} from '../sharedTypes/navigation';
import {HeaderText} from '../sharedComponents/Text/HeaderText';
import {BLACK} from '../lib/styles';
import {
  useLeaveProject,
  useOwnRoleInProject,
  useProjectSettings,
} from '@comapeo/core-react';
import {useActiveProject} from '../contexts/ActiveProjectContext';
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
                // Fase 11b: no project switching. Leaving the slot the device
                // was removed from degrades the organization — the engine's
                // revalidation (the slot listener's own change → revalidate)
                // publishes the loss and the navigator's gate owns the
                // landing on the provisioning surface; this screen never
                // writes the active id (the surviving slot is never
                // repointed — A §5.2, mixed-pair defect).
                leaveProject.mutate(
                  {projectId},
                  {
                    onSuccess: () => {
                      navigation.reset({
                        index: 0,
                        routes: [{name: 'OrganizationProvisioning'}],
                      });
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
