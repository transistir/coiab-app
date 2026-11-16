import type {CoordinationRole} from '../../contexts/UserProfileStoreContext';

export type OnboardingProfileRoute =
  | 'EthnicGroupSelection'
  | 'CreateOrganization'
  | 'JoinOrganizationIntro'
  | 'Success';

/**
 * The empty-document fork (#128/#129), shared by the startup gate
 * (`getInitialRoute`) and the device-naming handover: an incomplete profile
 * reopens the ethnic-group flow; once it's complete, the coordination role
 * picks create/join, and an unanswered role lands on Success to ask it.
 */
export function onboardingRouteForIncompleteProfile(
  profileComplete: boolean,
  coordinationRole: CoordinationRole,
): OnboardingProfileRoute {
  if (!profileComplete) return 'EthnicGroupSelection';
  if (coordinationRole === 'coordinator') return 'CreateOrganization';
  if (coordinationRole === 'participant') return 'JoinOrganizationIntro';
  return 'Success';
}
