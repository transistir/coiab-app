import * as React from 'react';
import {Alert, StyleSheet, View} from 'react-native';
import {defineMessages, useIntl} from 'react-intl';
import {NativeStackScreenProps} from '@react-navigation/native-stack';
import {useManyInvites} from '@comapeo/core-react';

import {HeaderText} from '../../sharedComponents/Text/HeaderText';
import {BodyText} from '../../sharedComponents/Text/BodyText';
import {LoadingIndicator} from '../../sharedComponents/LoadingIndicator';
import {
  DestructiveButton,
  SecondaryButton,
} from '../../sharedComponents/Buttons';
import {AppStackParamsList} from '../../sharedTypes/navigation';
import {useOrganizations} from '../../hooks/organization/useOrganizations';
import {useCreateOrganization} from '../../hooks/organization/useCreateOrganization';
import {useDiscardIncompleteOrganization} from '../../hooks/organization/useDiscardIncompleteOrganization';
import {groupPendingInvites} from '../../lib/organization/bundle';
import {SLOTS, SLOT_PROJECT_NAMES} from '../../lib/organization/marker';
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
  discardSetup: {
    id: '$1screens.OrganizationProvisioning.discardSetup',
    defaultMessage: 'Discard and start over',
  },
  discardConfirmTitle: {
    id: '$1screens.OrganizationProvisioning.discardConfirmTitle',
    defaultMessage: 'Discard this Organization setup?',
  },
  discardConfirmBody: {
    id: '$1screens.OrganizationProvisioning.discardConfirmBody',
    defaultMessage:
      'The projects created on this device for this setup will be removed. Projects shared with other devices are not affected.',
  },
  cancel: {
    id: '$1screens.OrganizationProvisioning.cancel',
    defaultMessage: 'Cancel',
  },
  discardFailed: {
    id: '$1screens.OrganizationProvisioning.discardFailed',
    defaultMessage:
      'Something went wrong while discarding this setup. It was not fully removed — you can try again.',
  },
  skippedShared: {
    id: '$1screens.OrganizationProvisioning.skippedShared',
    defaultMessage:
      '{projectName} is shared with other devices, so it was kept.',
  },
  skippedNotCreatedHere: {
    id: '$1screens.OrganizationProvisioning.skippedNotCreatedHere',
    defaultMessage:
      '{projectName} was not created on this device, so it was kept.',
  },
  skippedStale: {
    id: '$1screens.OrganizationProvisioning.skippedStale',
    defaultMessage:
      '{projectName} changed while it was being discarded, so it was kept.',
  },
});

/** Why each kept project is still on the device, per skip reason. */
const SKIP_MESSAGES = {
  'not-created-here': m.skippedNotCreatedHere,
  'shared-with-other-devices': m.skippedShared,
  'no-longer-incomplete': m.skippedStale,
} as const;

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
 *
 * A setup the user may never complete (the invitor is gone, the invite
 * expired, no name to resume under) must not be a permanent creation
 * lockout behind the fail-closed create, so the screen also offers to
 * DISCARD the half-built organization behind a destructive confirm and
 * start over. The discard fan-out only removes the projects this device
 * provably created and still holds alone; anything it refuses is reported
 * per project (with the reason), and the screen stays here to say so — as
 * it does when the discard itself fails.
 */
export const OrganizationProvisioning = ({
  navigation,
}: NativeStackScreenProps<AppStackParamsList, 'OrganizationProvisioning'>) => {
  const {formatMessage: t} = useIntl();
  const organizations = useOrganizations();
  const {start, status} = useCreateOrganization();
  const {
    discard,
    reset: resetDiscard,
    status: discardStatus,
    result: discardResult,
  } = useDiscardIncompleteOrganization();

  const isReady = organizations.some(org => org.state === 'ready');
  const isInvalid = organizations.some(org => org.state === 'invalid');
  const isCreating = status === 'creating';
  const isDiscarding = discardStatus === 'discarding';

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
  // flow then has to route around, so the buttons stay hidden while the
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

  // A settled discard either freed the device (`ok` — everything removed, so
  // the start-over fork owns the next decision, like the startup gate's
  // `none` state) or refused to remove something: then the setup is still
  // here, the lines below say which projects were kept and why, and the
  // result stays published so those lines remain on screen. A failure stays
  // too, with its error line. Neither resets the hook — the user can retry.
  React.useEffect(() => {
    if (discardStatus !== 'success') return;
    if (discardResult?.ok) {
      navigation.reset({index: 0, routes: [{name: 'Success'}]});
      resetDiscard();
    }
  }, [discardStatus, discardResult, resetDiscard, navigation]);

  const canDiscard =
    incompleteOrganization !== undefined &&
    !isCreating &&
    !isDiscarding &&
    !missingSlotCoveredByInvite;

  return (
    <View style={styles.container}>
      <LoadingIndicator size="large" />
      <HeaderText variant="header2" style={styles.title}>
        {t(m.settingUp)}
      </HeaderText>
      {isInvalid && (
        <BodyText style={styles.errorText}>{t(m.invalid)}</BodyText>
      )}
      {discardStatus === 'error' && (
        <BodyText style={styles.errorText}>{t(m.discardFailed)}</BodyText>
      )}
      {discardStatus === 'success' &&
        discardResult?.skipped.map(entry => (
          <BodyText key={entry.projectId} style={styles.errorText}>
            {t(SKIP_MESSAGES[entry.reason], {
              projectName: SLOT_PROJECT_NAMES[entry.slot],
            })}
          </BodyText>
        ))}
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
      {canDiscard && (
        <DestructiveButton
          testID="ORG.provisioning-discard-btn"
          fullSize
          text={t(m.discardSetup)}
          onPress={() => {
            if (incompleteOrganization === undefined) return;
            Alert.alert(t(m.discardConfirmTitle), t(m.discardConfirmBody), [
              {style: 'cancel', text: t(m.cancel)},
              {
                style: 'destructive',
                text: t(m.discardSetup),
                onPress: () => {
                  discard(incompleteOrganization.organizationId);
                },
              },
            ]);
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
