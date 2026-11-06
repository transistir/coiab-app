import type {MemberApi} from '@comapeo/core';

import {MEMBER_ROLE_ID} from '../../sharedTypes';

// TODO: Ideally this is handled in @comapeo/core (https://github.com/digidem/comapeo-core/issues/1031)
export type ArchiveServerMemberInfo = MemberApi.MemberInfo & {
  deviceType: 'selfHostedServer';
  selfHostedServerDetails: NonNullable<
    MemberApi.MemberInfo['selfHostedServerDetails']
  >;
};

// TODO: Ideally this is handled in @comapeo/core (https://github.com/digidem/comapeo-core/issues/1031)
export function isActiveArchiveServerMember(
  member: MemberApi.MemberInfo,
): member is ArchiveServerMemberInfo & MemberApi.ActiveMemberInfo {
  if (member.deviceType !== 'selfHostedServer') return false;
  if (!member.selfHostedServerDetails) return false;
  if (member.role.roleId !== MEMBER_ROLE_ID) return false;
  return true;
}

/** The minimal Core project read used to reconcile a removal checkpoint. */
export type ArquivoRemotoProjetoComMembros = {
  $member: {
    getMany(options: {includeLeft: boolean}): Promise<MemberApi.MemberInfo[]>;
  };
};

/**
 * Whether Core still has an active archive server for the project. This is the
 * SAME read `useActiveArchiveServer` exposes to the UI; it is kept outside the
 * React hook so the journal executor can reconcile a durable `removendo` slot
 * at boot without rendering a component.
 */
export async function consultarArquivoRemotoAtivo(
  getProject: (projectId: string) => Promise<ArquivoRemotoProjetoComMembros>,
  projectId: string,
): Promise<boolean> {
  const projeto = await getProject(projectId);
  const membros = await projeto.$member.getMany({includeLeft: false});
  return membros.some(isActiveArchiveServerMember);
}
