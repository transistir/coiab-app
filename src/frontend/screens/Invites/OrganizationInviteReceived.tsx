import {BottomSheetWrapper} from '../../sharedComponents/BottomSheetWrapper';
import {StyleSheet, View} from 'react-native';
import {PrimaryButton, SecondaryButton} from '../../sharedComponents/Buttons';
import {defineMessages, useIntl} from 'react-intl';
import {NativeRootNavigationProps} from '../../sharedTypes/navigation';
import {useManyInvites, useRejectInvite} from '@comapeo/core-react';
import {useEffect, useRef} from 'react';
import {HeaderText} from '../../sharedComponents/Text/HeaderText';
import {BodyText} from '../../sharedComponents/Text/BodyText';
import {LoadingIndicator} from '../../sharedComponents/LoadingIndicator';
import * as Sentry from '@sentry/react-native';
import {BLACK, NEW_DARK_GREY, VERY_LIGHT_GREY} from '../../lib/styles';
import {useTracking} from '../../hooks/useTracking';
import CollaborateIcon from '../../images/ProjectParticipant.svg';
import Ionicons from '@react-native-vector-icons/ionicons';
import {
  bundleForInvite,
  groupPendingInvites,
} from '../../lib/organization/bundle';
import {SLOTS} from '../../lib/organization/marker';
import {useOrganizations} from '../../hooks/organization/useOrganizations';
import {useAcceptOrganizationBundle} from '../../hooks/organization/useAcceptOrganizationBundle';

const m = defineMessages({
  joinOrganization: {
    id: '$1screens.OrganizationInviteReceived.joinOrganization',
    defaultMessage: 'Join Organization',
  },
  decline: {
    id: '$1screens.OrganizationInviteReceived.decline',
    defaultMessage: 'Decline',
  },
  invitedToJoin: {
    id: '$1screens.OrganizationInviteReceived.invitedToJoin',
    defaultMessage: "You've been invited to...",
  },
  joinAsRole: {
    id: '$1screens.OrganizationInviteReceived.joinAsRole',
    defaultMessage: 'Join as a {role}?',
  },
  coordinatorRole: {
    id: '$1screens.OrganizationInviteReceived.coordinatorRole',
    defaultMessage: 'coordinator',
  },
  participantRole: {
    id: '$1screens.OrganizationInviteReceived.participantRole',
    defaultMessage: 'participant',
  },
  preparing: {
    id: '$1screens.OrganizationInviteReceived.preparing',
    defaultMessage: 'Preparing invitation…',
  },
  incompleteDefinitive: {
    id: '$1screens.OrganizationInviteReceived.incompleteDefinitive',
    defaultMessage:
      'This invitation is incomplete. Ask the sender to invite you again.',
  },
  close: {
    id: '$1screens.OrganizationInviteReceived.close',
    defaultMessage: 'Close',
  },
  organizationName: {
    id: '$1screens.OrganizationInviteReceived.organizationName',
    defaultMessage: 'Organization',
  },
});

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * SPEC 7.3/7.4/8.1: the single Organization invite surface — the bundle is
 * grouped from all pending invites (SPEC 6.5/8.5) and shown as one decision
 * ("Entrar na organização"), never one invite per project. Incomplete
 * bundles distinguish transient ("Preparing invitation…") from definitive
 * (the missing slot can never arrive) — unless every slot is covered, a
 * locally-held slot counting as present, in which case the Join decision
 * stays reachable even on a definitive bundle (join-side recovery).
 */
export const OrganizationInviteReceived = ({
  route,
  navigation,
}: NativeRootNavigationProps<'OrganizationInviteReceived'>) => {
  const {formatMessage} = useIntl();
  const {organizationId, inviteId} = route.params;

  const {data: invites} = useManyInvites();
  const {bundles} = groupPendingInvites(invites);

  // The navigated invite is the bundle's entry point; when it was superseded
  // by a duplicate (removed from the pending set), any bundle for the same
  // organization is the same invitation.
  const bundle =
    bundleForInvite(bundles, inviteId) ??
    bundles.find(b => b.organizationId === organizationId);

  // P5 O3: no project-level cancel listener here — a cancellation must flow
  // through the grouped bundle state (a canceled slot turns the bundle
  // definitive-incomplete, or the bundle disappears entirely), never through
  // the legacy InviteCanceled sheet.

  const acceptBundle = useAcceptOrganizationBundle();
  const rejectInvite = useRejectInvite();
  const {isTracking} = useTracking();

  // Join-side recovery: a mid-accept failure can leave one slot joined
  // locally while the other invite is still pending. The bundle then
  // classifies `incomplete-definitive` even though the device already holds
  // half the organization, but the accept path fully supports this partial
  // bundle (the locally-present slot is skipped, identity enforced by the
  // hook) — so a locally-held slot counts as covered and the Join decision
  // stays reachable instead of dead-ending on "ask the sender again".
  const organizations = useOrganizations();
  const localOrg = organizations.find(
    org => org.organizationId === bundle?.organizationId,
  );
  const slotsCovered =
    bundle !== undefined &&
    SLOTS.every(
      slot =>
        localOrg?.slots[slot] !== undefined ||
        bundle.invites[slot] !== undefined,
    );

  // Role display comes from the bundle as before; the organization name
  // falls back to the locally-reconstructed org (the sender's marker name
  // may be absent on a partial bundle).
  const organizationDisplayName = bundle
    ? bundle.organizationName || localOrg?.organizationName
    : undefined;

  const translatedRole =
    bundle?.roleName === 'Coordinator'
      ? formatMessage(m.coordinatorRole)
      : formatMessage(m.participantRole);

  const busy =
    acceptBundle.status === 'accepting' || rejectInvite.status === 'pending';

  // A bundle that vanishes (every invite left pending — canceled, or joined
  // through THIS screen's accept) has nothing left to decide: leave the
  // sheet. While an accept or decline is in flight the screen's own
  // navigation wins — a vanish-triggered goBack() here would race the
  // confirmation/error navigation the action is about to perform.
  const hadBundle = useRef(false);
  useEffect(() => {
    if (bundle) {
      hadBundle.current = true;
      return;
    }
    if (!hadBundle.current) return;
    if (busy || acceptBundle.status === 'success') return;
    navigation.goBack();
  }, [bundle, busy, acceptBundle.status, navigation]);

  async function accept() {
    if (!bundle) return;
    if (isTracking) {
      navigation.navigate('TrackRecordingActive');
      return;
    }

    const result = await acceptBundle.start(bundle);
    if (!result) return;

    if (!result.ok) {
      const error = toError(result.error);
      Sentry.captureException(error);
      navigation.replace('ErrorBottomSheet', {error});
      return;
    }

    // SPEC 8.6: land on the Monitoramento slot of the organization — this
    // accept's own result first, then the id the hook activated.
    const projectId =
      result.accepted.find(({slot}) => slot === 'm')?.projectId ??
      result.activeProjectId ??
      result.accepted.find(({slot}) => slot === 'a')?.projectId;
    if (projectId === undefined) {
      navigation.goBack();
      return;
    }

    const projectName =
      organizationDisplayName || formatMessage(m.organizationName);

    // Accepting while still in onboarding (the org fork's waiting screen is
    // JoinOrganizationIntro) simply replaces the waiting screen with the
    // confirmation — the gate decides the landing (SPEC 10.1/E6).
    const isInOnboarding = navigation
      .getState()
      .routes.find(
        route =>
          route.name === 'JoinProjectIntro' ||
          route.name === 'JoinOrganizationIntro',
      );
    if (isInOnboarding) {
      navigation.replace('InviteSuccessfullyAccepted', {
        projectName,
        projectId,
      });
      return;
    }

    // otherwise reset the navigation so that the stale project is no longer showing.
    navigation.reset({
      index: 1,
      routes: [
        {name: 'Home'},
        {name: 'InviteSuccessfullyAccepted', params: {projectName, projectId}},
      ],
    });
  }

  async function decline() {
    if (!bundle) {
      navigation.goBack();
      return;
    }

    // P5 O5: reject EVERY still-pending invite of the group — the slot
    // representatives AND their duplicates. `mutateAsync` resolving is the
    // practical completion signal for this spike: core settles each invite's
    // state machine asynchronously, and the resulting re-group of the
    // non-pending invites is what closes the surface, so terminal invite
    // states are deliberately not awaited here.
    const groupInviteIds = new Set(bundle.allInviteIds);
    const results = await Promise.allSettled(
      invites
        .filter(
          invite =>
            groupInviteIds.has(invite.inviteId) && invite.state === 'pending',
        )
        .map(invite => rejectInvite.mutateAsync({inviteId: invite.inviteId})),
    );
    const firstRejection = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (firstRejection) {
      const error = toError(firstRejection.reason);
      Sentry.captureException(error);
      navigation.replace('ErrorBottomSheet', {error});
      return;
    }

    navigation.goBack();
  }

  return (
    <BottomSheetWrapper>
      <View style={styles.container}>
        {!bundle ||
        (!slotsCovered && bundle.completeness !== 'incomplete-transient') ? (
          <>
            <BodyText variant="smallMeta" style={styles.errorText}>
              {formatMessage(m.incompleteDefinitive)}
            </BodyText>
            <View style={styles.buttonContainer}>
              {busy ? (
                <LoadingIndicator style={{marginVertical: 20}} />
              ) : (
                <SecondaryButton
                  fullSize
                  testID="ORG.invite-close-btn"
                  onPress={() => navigation.goBack()}
                  text={formatMessage(m.close)}
                  renderIcon={({color, size}) => (
                    <Ionicons
                      color={color}
                      size={size}
                      name="close-circle-outline"
                    />
                  )}
                />
              )}
            </View>
          </>
        ) : !slotsCovered ? (
          <>
            <BodyText variant="smallMeta" style={styles.preparingText}>
              {formatMessage(m.preparing)}
            </BodyText>
            <LoadingIndicator style={{marginVertical: 20}} />
          </>
        ) : (
          <>
            <BodyText variant="tinyMeta" style={styles.invitedLabel}>
              {formatMessage(m.invitedToJoin)}
            </BodyText>

            <View style={styles.cardContainer}>
              <HeaderText variant="header2" style={styles.projectName}>
                {bundle.organizationName || formatMessage(m.organizationName)}
              </HeaderText>
              <BodyText variant="smallMeta" style={styles.rolePrompt}>
                {formatMessage(m.joinAsRole, {role: translatedRole})}
              </BodyText>
            </View>

            <View style={styles.buttonContainer}>
              {busy ? (
                <LoadingIndicator style={{marginVertical: 20}} />
              ) : (
                <>
                  <PrimaryButton
                    fullSize
                    testID="ORG.invite-join-btn"
                    onPress={accept}
                    text={formatMessage(m.joinOrganization)}
                    renderIcon={({color}) => <CollaborateIcon color={color} />}
                  />
                  <SecondaryButton
                    fullSize
                    testID="ORG.invite-decline-btn"
                    onPress={decline}
                    text={formatMessage(m.decline)}
                    renderIcon={({color, size}) => (
                      <Ionicons
                        color={color}
                        size={size}
                        name="close-circle-outline"
                      />
                    )}
                  />
                </>
              )}
            </View>
          </>
        )}
      </View>
    </BottomSheetWrapper>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  invitedLabel: {
    textTransform: 'uppercase',
    fontWeight: '500',
    alignSelf: 'stretch',
    color: BLACK,
  },
  cardContainer: {
    backgroundColor: '#fff5eb',
    borderColor: VERY_LIGHT_GREY,
    borderWidth: 1,
    borderRadius: 6,
    padding: 20,
    gap: 20,
    alignSelf: 'stretch',
    width: '100%',
    justifyContent: 'center',
    alignItems: 'flex-start',
    elevation: 1,
  },
  projectName: {
    lineHeight: 28,
    color: BLACK,
  },
  rolePrompt: {
    lineHeight: 14,
    color: NEW_DARK_GREY,
  },
  buttonContainer: {
    paddingTop: 18,
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  preparingText: {
    color: NEW_DARK_GREY,
    alignSelf: 'center',
  },
  errorText: {
    color: NEW_DARK_GREY,
    alignSelf: 'stretch',
  },
});
