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
  // SPEC B :100: the waiting title changed meaning ("Join an Organization"
  // → Aguardar convite), so the descriptor is new and lives under the
  // OrganizationSetup namespace.
  title: {
    id: '$1screens.OrganizationSetup.waitInviteTitle',
    // SPEC B :60 (also A :143 §4.4 glossary).
    defaultMessage: 'Wait for an invitation',
  },
  body: {
    id: '$1screens.OrganizationSetup.waitInviteBody',
    // SPEC B :60 — verbatim.
    defaultMessage:
      'Ask a person responsible for the Organization to invite this device.',
  },
  back: {
    id: '$1screens.OrganizationSetup.backButton',
    // SPEC A :209 / B :60 — the waiting screen offers a Back button.
    defaultMessage: 'Back',
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

  function handleBackPress() {
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
          testID="ORG.join-intro-back-btn"
          fullSize
          text={t(m.back)}
          onPress={handleBackPress}
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
