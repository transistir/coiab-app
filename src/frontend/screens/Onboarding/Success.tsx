import * as React from 'react';
import {StyleSheet, View} from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';

import DeviceIcon from '../../images/Device.svg';
import ProjectParticipantIcon from '../../images/ProjectParticipant.svg';
import ProjectCoordinatorIcon from '../../images/ProjectCoordinator.svg';
import {NativeStackScreenProps} from '@react-navigation/native-stack';
import {defineMessages, useIntl} from 'react-intl';
import {OnboardingParamsList} from '../../sharedTypes/navigation';
import {HeaderText} from '../../sharedComponents/Text/HeaderText';
import {BodyText} from '../../sharedComponents/Text/BodyText';
import {PrimaryButton, SecondaryButton} from '../../sharedComponents/Buttons';
import {WHITE, DARK_GREEN, COMAPEO_BLUE} from '../../lib/styles';
import {useOwnDeviceInfo} from '@comapeo/core-react';
import {useUserProfileActions} from '../../contexts/UserProfileStoreContext';

const m = defineMessages({
  deviceReady: {
    id: '$1screens.DeviceNaming.Success.deviceReady',
    defaultMessage: '{deviceName} is ready!',
  },
  // #129: the onboarding fork after the profile steps is the coordinator
  // question — creating a Territory is no longer offered directly.
  roleQuestion: {
    id: '$1screens.OrganizationSetup.roleQuestion',
    defaultMessage: 'Are you a coordinator?',
  },
  roleCoordinatorButton: {
    id: '$1screens.OrganizationSetup.roleCoordinatorButton',
    defaultMessage: 'Yes, I am a coordinator',
  },
  roleParticipantButton: {
    id: '$1screens.OrganizationSetup.roleParticipantButton',
    defaultMessage: 'No, I am a participant',
  },
});
export const Success = ({
  navigation,
}: NativeStackScreenProps<OnboardingParamsList, 'Success'>) => {
  const {formatMessage: t} = useIntl();
  const {data: deviceInfo} = useOwnDeviceInfo();
  const {setCoordinationRole} = useUserProfileActions();
  const deviceName = deviceInfo.name || '';

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <View style={styles.mainCard}>
          <View style={styles.titleSection}>
            <View style={styles.iconContainer}>
              <DeviceIcon width={40} height={60} />
              <View style={styles.checkmarkCircle}>
                <Ionicons name="checkmark" color={WHITE} size={18} />
              </View>
            </View>
            <HeaderText variant="header2" style={styles.headerText}>
              {t(m.deviceReady, {deviceName})}
            </HeaderText>
          </View>
          <BodyText style={styles.bodyText}>{t(m.roleQuestion)}</BodyText>
        </View>
      </View>

      <View style={styles.actions}>
        <PrimaryButton
          testID="ONBOARDING.role-coordinator-btn"
          fullSize
          text={t(m.roleCoordinatorButton)}
          iconPosition="left"
          renderIcon={({size, color}) => (
            <ProjectCoordinatorIcon
              width={size}
              height={size}
              color={color}
              fill={color}
            />
          )}
          onPress={() => {
            setCoordinationRole('coordinator');
            navigation.navigate('CreateOrganization');
          }}
        />
        <SecondaryButton
          testID="ONBOARDING.role-participant-btn"
          fullSize
          text={t(m.roleParticipantButton)}
          iconPosition="left"
          renderIcon={({size}) => (
            <ProjectParticipantIcon
              width={size}
              height={size}
              color={COMAPEO_BLUE}
              fill={COMAPEO_BLUE}
            />
          )}
          onPress={() => {
            setCoordinationRole('participant');
            navigation.navigate('JoinOrganizationIntro');
          }}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'column',
    justifyContent: 'space-between',
  },
  content: {
    paddingHorizontal: 20,
  },
  mainCard: {
    paddingVertical: 65,
    paddingHorizontal: 20,
    gap: 20,
  },
  titleSection: {
    alignItems: 'center',
    gap: 10,
  },
  iconContainer: {
    width: 60,
    height: 70,
    alignItems: 'center',
  },
  checkmarkCircle: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: DARK_GREEN,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerText: {
    marginTop: 10,
    textAlign: 'center',
  },
  bodyText: {
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  actions: {
    alignItems: 'center',
    paddingVertical: 20,
    gap: 10,
  },
});
