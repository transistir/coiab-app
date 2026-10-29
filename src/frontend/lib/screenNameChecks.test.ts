import {EDITING_SCREEN_NAMES, INVITE_SCREEN_NAME} from '../constants';
import {isEditingScreen, isInviteScreen} from './screenNameChecks';

describe('isEditingScreen', () => {
  it('should return true for editing screen names', () => {
    for (const screen of EDITING_SCREEN_NAMES) {
      expect(isEditingScreen(screen as string)).toBe(true);
    }
  });

  it('blocks interruptions on the onboarding profile screens (#128)', () => {
    // Both screens hold unsaved onboarding state: an invite/map-share
    // interruption or a deep link must wait until the profile flow is done.
    expect(isEditingScreen('EthnicGroupSelection')).toBe(true);
    expect(isEditingScreen('VillageEntry')).toBe(true);
  });

  it('should return false for non-editing screen names', () => {
    expect(isEditingScreen('Home')).toBe(false);
    expect(isEditingScreen('Settings')).toBe(false);
    expect(isEditingScreen('Profile')).toBe(false);
  });

  it('should return false for an empty string', () => {
    expect(isEditingScreen('')).toBe(false);
  });

  it('should return false for a completely unrelated screen name', () => {
    expect(isEditingScreen('RandomScreen')).toBe(false);
  });
});

describe('isInviteScreen', () => {
  it('returns true for invite screen names', () => {
    for (const screenName of INVITE_SCREEN_NAME) {
      expect(isInviteScreen(screenName as string)).toBe(true);
    }
  });

  it('returns false for non-invite screen names', () => {
    expect(isInviteScreen('Home')).toBe(false);
    expect(isInviteScreen('Settings')).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isInviteScreen('')).toBe(false);
  });
});
