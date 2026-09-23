import * as React from 'react';
import {render, screen, userEvent} from '@testing-library/react-native';
import {IntlProvider} from 'react-intl';

import {CollaboratorInfo} from './CollaboratorInfo';
import {useOwnRoleInProject, useSingleMember} from '@comapeo/core-react';
import type {NativeRootNavigationProps} from '../../sharedTypes/navigation';
import {COORDINATOR_ROLE_ID, MEMBER_ROLE_ID} from '../../sharedTypes';

jest.mock('@comapeo/core-react', () => ({
  useOwnRoleInProject: jest.fn(),
  useSingleMember: jest.fn(),
}));

jest.mock('../../contexts/ActiveProjectContext', () => ({
  useActiveProject: () => ({projectId: 'project-1', projectApi: {}}),
}));

const useOwnRoleInProjectMock = useOwnRoleInProject as jest.Mock;
const useSingleMemberMock = useSingleMember as jest.Mock;

type CollaboratorInfoProps = NativeRootNavigationProps<'CollaboratorInfo'>;

const navigate = jest.fn();
const navigation = {navigate} as unknown as CollaboratorInfoProps['navigation'];

async function renderScreen({
  isOwnDevice,
  memberType,
  ownRoleId,
}: {
  isOwnDevice: boolean;
  memberType: 'coordinator' | 'participant';
  ownRoleId: string;
}) {
  useOwnRoleInProjectMock.mockReturnValue({data: {roleId: ownRoleId}});

  const route: CollaboratorInfoProps['route'] = {
    key: 'collaborator-info',
    name: 'CollaboratorInfo',
    params: {
      deviceId: 'device-1',
      isOwnDevice,
      memberType,
    },
  };

  return render(
    <IntlProvider locale="en" messages={{}}>
      <CollaboratorInfo route={route} navigation={navigation} />
    </IntlProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  useSingleMemberMock.mockReturnValue({
    data: {
      name: 'Tablet 1',
      joinedAt: '2026-09-01T00:00:00.000Z',
      deviceType: 'mobile',
    },
  });
});

describe('CollaboratorInfo', () => {
  test('does not offer or trigger a destructive action for the coordinator own device', async () => {
    await renderScreen({
      isOwnDevice: true,
      memberType: 'coordinator',
      ownRoleId: COORDINATOR_ROLE_ID,
    });

    const removeDeviceAction = screen.queryByText('Remove Device');
    if (removeDeviceAction) {
      await userEvent.press(removeDeviceAction);
    }

    expect(navigate).not.toHaveBeenCalledWith(
      'RemoveDevice',
      expect.anything(),
    );
    expect(removeDeviceAction).not.toBeOnTheScreen();
    expect(screen.queryByText('Leave Project')).not.toBeOnTheScreen();
  });

  test('keeps Remove Device for another device when the viewer is a coordinator', async () => {
    await renderScreen({
      isOwnDevice: false,
      memberType: 'participant',
      ownRoleId: COORDINATOR_ROLE_ID,
    });

    await userEvent.press(screen.getByText('Remove Device'));

    expect(navigate).toHaveBeenCalledWith('RemoveDevice', {
      deviceId: 'device-1',
      deviceName: 'Tablet 1',
    });
  });

  test('does not offer a destructive action for a participant own device', async () => {
    await renderScreen({
      isOwnDevice: true,
      memberType: 'participant',
      ownRoleId: MEMBER_ROLE_ID,
    });

    expect(screen.queryByText('Remove Device')).not.toBeOnTheScreen();
    expect(screen.queryByText('Leave Project')).not.toBeOnTheScreen();
    expect(navigate).not.toHaveBeenCalled();
  });
});
