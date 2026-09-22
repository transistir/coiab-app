import * as React from 'react';
import {useLinkingURL} from 'expo-linking';
import {useManyInvites} from '@comapeo/core-react';
import {parseInviteUrl} from '../../lib/deepLinkConfig';
import {useNavigationFromRoot} from '../../hooks/useNavigationWithTypes';
import {isInviteScreen, isEditingScreen} from '../../lib/screenNameChecks';
import {classificarDocumento} from '../../lib/organization/coiabOrganizations';
import {parseMarker} from '../../lib/organization/marker';
import {resolveDeepLinkInviteTarget} from '../../lib/organization/deepLinkTarget';
import {useCoiabOrganizationsState} from '../../contexts/CoiabOrganizationsStoreContext';

export const DeepLinkListener = ({
  currentRouteName,
}: {
  currentRouteName: string | undefined;
}) => {
  const navigation = useNavigationFromRoot();
  const url = useLinkingURL();
  const pendingInviteId = url ? parseInviteUrl(url) : null;
  // Suspends like the other invite consumers (PendingInvitesListener).
  const {data: invites} = useManyInvites();
  // SPEC B §5.5 (spec-criar-organizacao.md :227): while a creation is alive
  // the provisioning surface owns the flow — same twin gate as the
  // PendingInvitesListener. A deep-linked invite stays pending and routes
  // again once the document leaves 'preparando' ('confirmacao', 'pronta'
  // and 'nenhum' all route). The listener never rejects or alters it.
  const documento = classificarDocumento(useCoiabOrganizationsState());

  React.useEffect(() => {
    if (!pendingInviteId || !currentRouteName) return;
    if (documento === 'preparando') return;
    if (isInviteScreen(currentRouteName)) return;
    if (isEditingScreen(currentRouteName)) return;
    // An invite id the list does not (yet) know resolves to nothing: routing
    // it to the legacy surface before a marker on it is readable would open
    // the wrong sheet for an Organization invite — the effect reruns when
    // the invite list updates.
    const target = resolveDeepLinkInviteTarget(invites, pendingInviteId);
    if (target === undefined) return;
    if (target === 'legacy') {
      navigation.navigate('InviteReceived', {inviteId: pendingInviteId});
      return;
    }
    const invite = invites.find(invite => invite.inviteId === pendingInviteId);
    const marker = parseMarker(invite?.projectDescription ?? '');
    if (!marker) return;
    navigation.navigate('OrganizationInviteReceived', {
      organizationId: marker.organizationId,
      inviteId: pendingInviteId,
    });
  }, [documento, pendingInviteId, currentRouteName, navigation, invites]);

  return null;
};
