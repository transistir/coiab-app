import * as React from 'react';
import {StyleSheet, View} from 'react-native';
import {defineMessages, useIntl} from 'react-intl';
import {usePreventRemove} from '@react-navigation/native';

import {HeaderText} from '../../../sharedComponents/Text/HeaderText';
import {BodyText} from '../../../sharedComponents/Text/BodyText';
import {
  PrimaryButton,
  SecondaryButton,
} from '../../../sharedComponents/Buttons';
import {DeviceNameWithIcon} from '../../../sharedComponents/DeviceNameWithIcon';
import {RoleWithIcon} from '../../../sharedComponents/RoleWithIcon';
import SendingIcon from '../../../images/SendingIcon.svg';
import {NativeNavigationComponent} from '../../../sharedTypes/navigation';
import {usePrimaryOrganization} from '../../../hooks/organization/useOrganizations';
import {
  useInviteToOrganization,
  type SlotSendState,
} from '../../../hooks/organization/useInviteToOrganization';
import {SLOT_PROJECT_NAMES} from '../../../lib/organization/marker';
import {MEMBER_ROLE_ID} from '../../../sharedTypes';
import {useNavigationFromRoot} from '../../../hooks/useNavigationWithTypes';

const m = defineMessages({
  title: {
    id: '$1screens.YourTeam.ReviewOrganizationInvite.title',
    defaultMessage: 'Review Invitation',
  },
  youAreInviting: {
    id: '$1screens.YourTeam.ReviewOrganizationInvite.youAreInviting',
    defaultMessage: 'You are inviting:',
  },
  sendInvite: {
    id: '$1screens.YourTeam.ReviewOrganizationInvite.sendInvite',
    defaultMessage: 'Invite to Organization',
  },
  waiting: {
    id: '$1screens.YourTeam.ReviewOrganizationInvite.waiting',
    defaultMessage: 'Waiting for Device to Accept Invite',
  },
  timer: {
    id: '$1screens.YourTeam.ReviewOrganizationInvite.timer',
    defaultMessage: 'Invite sent {seconds}s ago',
  },
  noOrganization: {
    id: '$1screens.YourTeam.ReviewOrganizationInvite.noOrganization',
    defaultMessage: 'No Organization found',
  },
  goBack: {
    id: '$1screens.YourTeam.ReviewOrganizationInvite.goBack',
    defaultMessage: 'Go back',
  },
  retry: {
    id: '$1screens.YourTeam.ReviewOrganizationInvite.retry',
    defaultMessage: 'Invite Again',
  },
  couldNotReach: {
    id: '$1screens.YourTeam.ReviewOrganizationInvite.couldNotReach',
    defaultMessage: 'Could not reach {name} for {project}.',
  },
  genericError: {
    id: '$1screens.YourTeam.ReviewOrganizationInvite.genericError',
    defaultMessage: 'Something went wrong inviting {name} to {project}.',
  },
});

/**
 * A slot the receiver never definitively answered (SPEC 6.3): shown as a
 * per-project line so the sender sees which half of the organization is
 * missing, with a single recovery action (SPEC 6.5).
 */
type FailedSlot = {
  project: string;
  state: Extract<SlotSendState, 'timeout' | 'error'>;
};

/**
 * Sender side of the organization invite (SPEC 6): one user action fans out
 * to both projects of the primary organization (SPEC 8.6). If the device
 * holds no `ready` organization the screen fails closed (SPEC 8.4) instead
 * of inviting into an arbitrary project.
 *
 * SPEC 6.4: the two invites stay two independent operations. There is no
 * cancel in this spike — the waiting state cannot be aborted from here, and
 * the receiver-side bundle collapse keeps a resend idempotent instead.
 */
export const ReviewOrganizationInvite: NativeNavigationComponent<
  'ReviewOrganizationInvite'
> = ({route, navigation}) => {
  const {formatMessage: t} = useIntl();
  const {role, deviceId, deviceType, name} = route.params;
  const organization = usePrimaryOrganization();
  const {progress, busy, start, retryFailed} = useInviteToOrganization();

  const readyOrganization =
    organization?.state === 'ready' ? organization : undefined;

  const {monitoramento, alertas} = progress;
  const bothAccepted = monitoramento === 'accepted' && alertas === 'accepted';
  const anyRejected = monitoramento === 'rejected' || alertas === 'rejected';

  const failedSlots: FailedSlot[] = [];
  if (monitoramento === 'timeout' || monitoramento === 'error') {
    failedSlots.push({project: SLOT_PROJECT_NAMES.m, state: monitoramento});
  }
  if (alertas === 'timeout' || alertas === 'error') {
    failedSlots.push({project: SLOT_PROJECT_NAMES.a, state: alertas});
  }

  const allIdle = monitoramento === 'idle' && alertas === 'idle' && !busy;

  // SPEC 6.4: the waiting surface cannot be dismissed — the fan-out keeps
  // running in the background. `usePreventRemove` blocks both the iOS swipe
  // gesture and the Android back button while the invites are unresolved.
  // Terminal progress is excluded so the `replace` below still lands.
  const inWaiting =
    readyOrganization !== undefined &&
    !allIdle &&
    !bothAccepted &&
    !anyRejected &&
    failedSlots.length === 0;
  usePreventRemove(inWaiting, () => {});

  React.useEffect(() => {
    if (bothAccepted) {
      navigation.replace('InviteAccepted', {name, isOrganization: true});
    }
  }, [bothAccepted, navigation, name]);

  React.useEffect(() => {
    if (anyRejected) {
      navigation.replace('InviteDeclined', {
        ...route.params,
        isOrganization: true,
      });
    }
  }, [anyRejected, navigation, route.params]);

  function sendInvite() {
    if (!readyOrganization) return;
    start({
      slots: readyOrganization.slots,
      deviceId,
      roleId: role,
    });
  }

  if (!readyOrganization) {
    return (
      <View style={styles.container}>
        <HeaderText variant="header4" style={styles.centered}>
          {t(m.noOrganization)}
        </HeaderText>
        <SecondaryButton
          testID="ORG.no-org-back-btn"
          fullSize
          text={t(m.goBack)}
          onPress={() => {
            navigation.goBack();
          }}
        />
      </View>
    );
  }

  // SPEC 6.3: the normal path shows the same waiting surface as a project
  // invite; per-project lines appear only when a slot went unanswered.
  if (failedSlots.length > 0 && !anyRejected && !bothAccepted) {
    return (
      <View style={styles.container}>
        {failedSlots.map(failedSlot => (
          <BodyText key={failedSlot.project} style={styles.centered}>
            {failedSlot.state === 'timeout'
              ? t(m.couldNotReach, {name, project: failedSlot.project})
              : t(m.genericError, {name, project: failedSlot.project})}
          </BodyText>
        ))}
        <PrimaryButton
          testID="ORG.retry-invite-btn"
          fullSize
          text={t(m.retry)}
          onPress={() => {
            retryFailed();
          }}
        />
        <SecondaryButton
          testID="ORG.retry-go-back-btn"
          fullSize
          text={t(m.goBack)}
          onPress={() => {
            navigation.goBack();
          }}
        />
      </View>
    );
  }

  if (allIdle) {
    return (
      <View style={styles.container}>
        <View style={styles.review}>
          <HeaderText variant="header4">{t(m.youAreInviting)}</HeaderText>
          <DeviceNameWithIcon
            name={name}
            deviceId={deviceId}
            deviceType={deviceType}
            style={styles.device}
          />
          <RoleWithIcon
            style={styles.device}
            role={role === MEMBER_ROLE_ID ? 'participant' : 'coordinator'}
          />
        </View>
        <PrimaryButton
          testID="ORG.send-invite-btn"
          fullSize
          text={t(m.sendInvite)}
          onPress={sendInvite}
        />
      </View>
    );
  }

  return <Waiting />;
};

ReviewOrganizationInvite.navTitle = m.title;

/**
 * Mirrors the legacy `WaitingForInviteAccept` surface minus the cancel
 * action — org-scope invites cannot be canceled in this spike (SPEC 6.4),
 * and backgrounding no longer aborts the send.
 */
function Waiting() {
  const {formatMessage: t} = useIntl();
  const navigation = useNavigationFromRoot();

  React.useLayoutEffect(() => {
    navigation.setOptions({headerShown: false});
  }, [navigation]);

  const [time, setTime] = React.useState(0);

  React.useEffect(() => {
    const interval = setInterval(() => setTime(prev => prev + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <View style={styles.waitingContainer}>
      <SendingIcon />
      <HeaderText variant="header4" style={styles.centered}>
        {t(m.waiting)}
      </HeaderText>
      <BodyText style={styles.timer}>{t(m.timer, {seconds: time})}</BodyText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingTop: 80,
    flex: 1,
  },
  review: {
    width: '100%',
    alignItems: 'center',
  },
  device: {
    marginTop: 20,
  },
  centered: {
    textAlign: 'center',
  },
  timer: {
    marginTop: 20,
  },
  waitingContainer: {
    padding: 20,
    paddingTop: 80,
    alignItems: 'center',
  },
});
