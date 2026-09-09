import * as React from 'react';
import {StyleSheet, View} from 'react-native';
import {defineMessages, useIntl} from 'react-intl';
import {NativeStackScreenProps} from '@react-navigation/native-stack';

import ProjectParticipantIcon from '../../images/ProjectParticipant.svg';
import {HeaderText} from '../../sharedComponents/Text/HeaderText';
import {BodyText} from '../../sharedComponents/Text/BodyText';
import {PrimaryButton} from '../../sharedComponents/Buttons';
import {DARK_ORANGE} from '../../lib/styles';
import {AppStackParamsList} from '../../sharedTypes/navigation';

const m = defineMessages({
  title: {
    id: '$1screens.Onboarding.JoinOrganizationIntro.title',
    defaultMessage: 'Join an Organization',
  },
  body: {
    id: '$1screens.Onboarding.JoinOrganizationIntro.body',
    defaultMessage:
      'Ask a coordinator of an existing Organization to invite this device. When the invitation arrives it will appear on this screen.',
  },
  ok: {
    id: '$1screens.Onboarding.JoinOrganizationIntro.ok',
    defaultMessage: 'OK',
  },
});

/**
 * Waiting state for an incoming Organization invite (SPEC E6). No actions
 * here create or join anything — when an invite bundle arrives, the invite
 * listener navigates (P5).
 */
export const JoinOrganizationIntro = ({
  navigation,
}: NativeStackScreenProps<AppStackParamsList, 'JoinOrganizationIntro'>) => {
  const {formatMessage: t} = useIntl();

  function handleOkPress() {
    if (navigation.canGoBack()) {
      navigation.goBack();
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <ProjectParticipantIcon width={80} height={60} color={DARK_ORANGE} />
        <HeaderText variant="header2" style={styles.title}>
          {t(m.title)}
        </HeaderText>
        <BodyText style={styles.body}>{t(m.body)}</BodyText>
      </View>
      <View style={styles.actions}>
        <PrimaryButton
          testID="ORG.join-intro-ok-btn"
          fullSize
          text={t(m.ok)}
          onPress={handleOkPress}
        />
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
    alignItems: 'center',
    gap: 20,
  },
  title: {
    textAlign: 'center',
  },
  body: {
    textAlign: 'center',
  },
  actions: {
    alignItems: 'center',
    paddingVertical: 20,
  },
});
