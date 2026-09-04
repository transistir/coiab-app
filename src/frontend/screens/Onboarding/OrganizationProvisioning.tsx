import * as React from 'react';
import {StyleSheet, View} from 'react-native';
import {defineMessages, useIntl} from 'react-intl';
import {NativeStackScreenProps} from '@react-navigation/native-stack';
import {useManyInvites} from '@comapeo/core-react';

import {HeaderText} from '../../sharedComponents/Text/HeaderText';
import {BodyText} from '../../sharedComponents/Text/BodyText';
import {LoadingIndicator} from '../../sharedComponents/LoadingIndicator';
import {SecondaryButton} from '../../sharedComponents/Buttons';
import {AppStackParamsList} from '../../sharedTypes/navigation';
import {useOrganizations} from '../../hooks/organization/useOrganizations';
import {useCreateOrganization} from '../../hooks/organization/useCreateOrganization';
import {groupPendingInvites} from '../../lib/organization/bundle';
import {SLOTS} from '../../lib/organization/marker';
import type {ReconstructedOrganization} from '../../lib/organization/reconstruct';

const m = defineMessages({
  settingUp: {
    id: '$1screens.OrganizationProvisioning.settingUp',
    defaultMessage: 'Setting up your Organization…',
  },
  invalid: {
    id: '$1screens.OrganizationProvisioning.invalid',
    defaultMessage:
      'Something is wrong with this Organization. Contact support.',
  },
  finishSetup: {
    id: '$1screens.OrganizationProvisioning.finishSetup',
    defaultMessage: 'Finish setting up',
  },
});

/**
 * Transient fail-closed screen (SPEC 10.1): rendered while the device holds
 * an Organization that is not `ready` yet. It auto-advances to Home when the
 * Organization becomes `ready`, and stays (surfacing the error) when it is
 * `invalid`.
 *
 * An `incomplete` organization with a recoverable name offers to finish the
 * interrupted provisioning (SPEC 5 / E7 create-side): the fan-out is
 * idempotent — it creates only the missing slot, under the reconstructed
 * organization id, so a restart mid-create never bricks the device. Without
 * a name no marker can be minted, so the screen stays passive (fail-closed;
 * manual repair is out of scope). The offer is also suppressed while a
 * pending invite covers a missing slot — the invite sheet completes the
 * organization instead (join-side recovery).
 */
export const OrganizationProvisioning = ({
  navigation,
}: NativeStackScreenProps<AppStackParamsList, 'OrganizationProvisioning'>) => {
  const {formatMessage: t} = useIntl();
  const organizations = useOrganizations();
  const {start, status} = useCreateOrganization();

  const isReady = organizations.some(org => org.state === 'ready');
  const isInvalid = organizations.some(org => org.state === 'invalid');
  const isCreating = status === 'creating';

  const incompleteOrganization = organizations.find(
    (org): org is Extract<ReconstructedOrganization, {state: 'incomplete'}> =>
      org.state === 'incomplete',
  );
  const retryOrganization =
    incompleteOrganization?.organizationName !== undefined &&
    incompleteOrganization.organizationName.length > 0
      ? {
          organizationId: incompleteOrganization.organizationId,
          organizationName: incompleteOrganization.organizationName,
        }
      : undefined;

  // Join-side recovery: when a pending invite covers one of the
  // organization's missing slots, the invite sheet completes the org —
  // fabricating the slot here would create a private project the invite
  // flow then has to route around, so the button stays hidden while the
  // invite is the expected completion path.
  const {data: invites} = useManyInvites();
  const {bundles} = groupPendingInvites(invites);
  const missingSlotCoveredByInvite =
    incompleteOrganization !== undefined &&
    bundles.some(
      bundle =>
        bundle.organizationId === incompleteOrganization.organizationId &&
        SLOTS.some(
          slot =>
            incompleteOrganization.slots[slot] === undefined &&
            bundle.invites[slot] !== undefined,
        ),
    );

  React.useEffect(() => {
    if (isReady) {
      navigation.reset({index: 0, routes: [{name: 'Home'}]});
    }
  }, [isReady, navigation]);

  return (
    <View style={styles.container}>
      <LoadingIndicator size="large" />
      <HeaderText variant="header2" style={styles.title}>
        {t(m.settingUp)}
      </HeaderText>
      {isInvalid && (
        <BodyText style={styles.errorText}>{t(m.invalid)}</BodyText>
      )}
      {retryOrganization && !isCreating && !missingSlotCoveredByInvite && (
        <SecondaryButton
          testID="ORG.provisioning-retry-btn"
          fullSize
          text={t(m.finishSetup)}
          onPress={() => {
            start(
              retryOrganization.organizationName,
              retryOrganization.organizationId,
            );
          }}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    gap: 20,
  },
  title: {
    textAlign: 'center',
  },
  errorText: {
    textAlign: 'center',
  },
});
