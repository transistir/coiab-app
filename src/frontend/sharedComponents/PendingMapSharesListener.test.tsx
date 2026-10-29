import {render, waitFor} from '@testing-library/react-native';
import {useManyReceivedMapShares} from '@comapeo/core-react';

import {PendingMapSharesListener} from './PendingMapSharesListener';

jest.mock('@comapeo/core-react', () => ({
  useManyReceivedMapShares: jest.fn(),
}));

const useManyReceivedMapSharesMock = useManyReceivedMapShares as jest.Mock;

function makeShare(overrides: {shareId?: string; status?: string} = {}): {
  shareId: string;
  status: string;
} {
  return {shareId: 'share-1', status: 'pending', ...overrides};
}

describe('PendingMapSharesListener', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useManyReceivedMapSharesMock.mockReturnValue([]);
  });

  // #128: both onboarding profile screens are in EDITING_SCREEN_NAMES, so a
  // share arriving mid-profile waits instead of replacing the screen.
  test.each(['EthnicGroupSelection', 'VillageEntry'])(
    'does not navigate while %s is open',
    async currentRouteName => {
      useManyReceivedMapSharesMock.mockReturnValue([makeShare()]);
      const navigateToMapShareScreen = jest.fn();

      await render(
        <PendingMapSharesListener
          currentRouteName={currentRouteName}
          navigateToMapShareScreen={navigateToMapShareScreen}
        />,
      );

      await waitFor(() => {
        expect(useManyReceivedMapSharesMock).toHaveBeenCalled();
      });
      expect(navigateToMapShareScreen).not.toHaveBeenCalled();
    },
  );

  test('navigates once the profile flow reaches the join fork', async () => {
    // Positive control: the gate is scoped to the profile screens, not a
    // global switch the listener never leaves.
    useManyReceivedMapSharesMock.mockReturnValue([makeShare()]);
    const navigateToMapShareScreen = jest.fn();

    render(
      <PendingMapSharesListener
        currentRouteName="JoinOrganizationIntro"
        navigateToMapShareScreen={navigateToMapShareScreen}
      />,
    );

    await waitFor(() => {
      expect(navigateToMapShareScreen).toHaveBeenCalledTimes(1);
    });
    expect(navigateToMapShareScreen).toHaveBeenCalledWith('share-1');
  });

  test('does nothing while a map share screen is open', async () => {
    useManyReceivedMapSharesMock.mockReturnValue([makeShare()]);
    const navigateToMapShareScreen = jest.fn();

    render(
      <PendingMapSharesListener
        currentRouteName="MapReceivedBottomSheet"
        navigateToMapShareScreen={navigateToMapShareScreen}
      />,
    );

    await waitFor(() => {
      expect(useManyReceivedMapSharesMock).toHaveBeenCalled();
    });
    expect(navigateToMapShareScreen).not.toHaveBeenCalled();
  });

  test('does nothing with no pending share', async () => {
    useManyReceivedMapSharesMock.mockReturnValue([
      makeShare({status: 'downloaded'}),
    ]);
    const navigateToMapShareScreen = jest.fn();

    render(
      <PendingMapSharesListener
        currentRouteName="JoinOrganizationIntro"
        navigateToMapShareScreen={navigateToMapShareScreen}
      />,
    );

    await waitFor(() => {
      expect(useManyReceivedMapSharesMock).toHaveBeenCalled();
    });
    expect(navigateToMapShareScreen).not.toHaveBeenCalled();
  });

  test('does nothing without a current route', async () => {
    useManyReceivedMapSharesMock.mockReturnValue([makeShare()]);
    const navigateToMapShareScreen = jest.fn();

    render(
      <PendingMapSharesListener
        currentRouteName={undefined}
        navigateToMapShareScreen={navigateToMapShareScreen}
      />,
    );

    await waitFor(() => {
      expect(useManyReceivedMapSharesMock).toHaveBeenCalled();
    });
    expect(navigateToMapShareScreen).not.toHaveBeenCalled();
  });
});
