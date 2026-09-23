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

const m = defineMessages({
  deviceReady: {
    id: '$1screens.DeviceNaming.Success.deviceReady',
    defaultMessage: '{deviceName} is ready!',
  },
  // SPEC B :99-100: the decision descriptors are NEW (the old DeviceNaming
  // Success ids inverted the hierarchy or changed meaning) and live under
  // the OrganizationSetup namespace — the state this screen forwards to.
  noOrganizationBody: {
    id: '$1screens.OrganizationSetup.noOrganizationBody',
    // SPEC A :142 (§4.4 glossary).
    defaultMessage: 'Your device is not yet part of an Organization',
  },
  noOrganizationGuidance: {
    id: '$1screens.OrganizationSetup.noOrganizationGuidance',
    // SPEC B :53.
    defaultMessage:
      'Create an Organization or wait for an invitation to join an existing one.',
  },
  createOrganization: {
    id: '$1screens.OrganizationSetup.createOrganization',
    // SPEC B :53 — the PRIMARY action, not the legacy join-first order.
    defaultMessage: 'Create Organization',
  },
  waitInviteButton: {
    id: '$1screens.OrganizationSetup.waitInviteButton',
    // SPEC B :53 — the SECONDARY action.
    defaultMessage: 'Wait for an invitation',
  },
});
export const Success = ({
  navigation,
}: NativeStackScreenProps<OnboardingParamsList, 'Success'>) => {
  const {formatMessage: t} = useIntl();
  const {data: deviceInfo} = useOwnDeviceInfo();
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
          <BodyText style={styles.bodyText}>{t(m.noOrganizationBody)}</BodyText>
          <BodyText style={styles.bodyText}>
            {t(m.noOrganizationGuidance)}
          </BodyText>
        </View>
      </View>

      <View style={styles.actions}>
        <PrimaryButton
          testID="ONBOARDING.create-org-btn"
          fullSize
          text={t(m.createOrganization)}
          iconPosition="left"
          renderIcon={({size}) => (
            <ProjectCoordinatorIcon
              width={size}
              height={size}
              color={WHITE}
              fill={WHITE}
            />
          )}
          onPress={() => {
            navigation.navigate('CreateOrganization');
          }}
        />
        <SecondaryButton
          testID="ONBOARDING.join-org-btn"
          fullSize
          text={t(m.waitInviteButton)}
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
