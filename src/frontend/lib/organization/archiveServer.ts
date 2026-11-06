import type {MemberApi} from '@comapeo/core';

import {MEMBER_ROLE_ID} from '../../sharedTypes';
import {
  type IdentidadeArquivoRemoto,
  normalizarBaseUrl,
} from './identidadeArquivo';

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

/**
 * Whether a Core member IS the archive server named by an identity (#142 10ª
 * rodada). The device id is authoritative when both sides know it; otherwise
 * the normalized self-hosted base URL is compared, because the journal may
 * only know the URL (`addServerPeer` returns `void`). An identity with no
 * usable field never matches — a removal must be specific, not "any active
 * archive server".
 */
export function archiveServerMatchesIdentity(
  member: MemberApi.MemberInfo,
  identidade: IdentidadeArquivoRemoto,
): boolean {
  const deviceId = identidade.deviceId?.trim();
  if (deviceId) return member.deviceId === deviceId;
  const baseUrl = identidade.baseUrl;
  const doMembro = member.selfHostedServerDetails?.baseUrl;
  if (!baseUrl || !doMembro) return false;
  return normalizarBaseUrl(doMembro) === normalizarBaseUrl(baseUrl);
}

/** The minimal Core project read used to reconcile a removal checkpoint. */
export type ArquivoRemotoProjetoComMembros = {
  $member: {
    getMany(options: {includeLeft: boolean}): Promise<MemberApi.MemberInfo[]>;
  };
};

/**
 * Whether Core still has the archive server named by `identidade` for the
 * project. This is the SAME read `useActiveArchiveServer` exposes to the UI;
 * it is kept outside the React hook so the journal executor can reconcile a
 * durable `removendo` slot at boot without rendering a component.
 *
 * #142 10ª rodada: the query is scoped to the identity being removed, never
 * "is ANY archive server active". With A and B both applied, removing A must
 * not be reported as still present just because B is active.
 */
export async function consultarArquivoRemotoAtivo(
  getProject: (projectId: string) => Promise<ArquivoRemotoProjetoComMembros>,
  projectId: string,
  identidade: IdentidadeArquivoRemoto,
): Promise<boolean> {
  const projeto = await getProject(projectId);
  const membros = await projeto.$member.getMany({includeLeft: false});
  return membros.some(
    membro =>
      isActiveArchiveServerMember(membro) &&
      archiveServerMatchesIdentity(membro, identidade),
  );
}
