import {render, waitFor} from '@testing-library/react-native';
import {useManyInvites} from '@comapeo/core-react';

import {
  PendingInvitesListener,
  selectPendingInviteRoute,
} from './PendingInvitesListener';
import {markerFor} from '../lib/organization/marker';
import {useOrganizations} from '../hooks/organization/useOrganizations';
import {
  criarEstadoInicialOrganizacoes,
  type EstadoOrganizacoes,
} from '../lib/organization/coiabOrganizations';
import {readyOrganization} from '../lib/organization/fixtures';
import {useCoiabOrganizationsState} from '../contexts/CoiabOrganizationsStoreContext';
import type {InviteLike} from '../lib/organization/bundle';

jest.mock('@comapeo/core-react', () => ({
  useManyInvites: jest.fn(),
}));

jest.mock('../hooks/organization/useOrganizations', () => ({
  useOrganizations: jest.fn(),
}));

jest.mock('../contexts/CoiabOrganizationsStoreContext', () => ({
  useCoiabOrganizationsState: jest.fn(),
}));

const useManyInvitesMock = useManyInvites as jest.Mock;
const useOrganizationsMock = useOrganizations as jest.Mock;
const useCoiabOrganizationsStateMock = useCoiabOrganizationsState as jest.Mock;

const ORG_ID = 'a1b2c3d4e5f60718';

/**
 * Document fixtures classified by `classificarDocumento` exactly like the
 * startup gate classifies them: one organization in each preparation stage.
 */
const PREPARANDO_DOCUMENT: EstadoOrganizacoes = {
  versao: 1,
  organizacoes: [{...readyOrganization(ORG_ID), estado: 'preparando'}],
  ativa: null,
};

const CONFIRMACAO_DOCUMENT: EstadoOrganizacoes = {
  versao: 1,
  organizacoes: [{...readyOrganization(ORG_ID), confirmacaoPendente: true}],
  ativa: null,
};

const PRONTA_DOCUMENT: EstadoOrganizacoes = {
  versao: 1,
  organizacoes: [readyOrganization(ORG_ID)],
  ativa: null,
};

function makeInvite(overrides?: Partial<InviteLike>): InviteLike {
  return {
    inviteId: 'invite-1',
    projectDescription: undefined,
    invitorDeviceId: 'invitor-1',
    roleName: 'Coordinator',
    receivedAt: 1,
    state: 'pending',
    ...overrides,
  };
}

const MARKER_DESCRIPTION = markerFor(ORG_ID, 'm', 'Org Um');

describe('selectPendingInviteRoute', () => {
  test('a marker invite routes to the Organization invite screen', () => {
    expect(
      selectPendingInviteRoute(
        [
          makeInvite({
            inviteId: 'invite-marker',
            projectDescription: MARKER_DESCRIPTION,
          }),
        ],
        'Home',
        [],
      ),
    ).toStrictEqual({
      type: 'organization',
      organizationId: ORG_ID,
      inviteId: 'invite-marker',
    });
  });

  test('a plain invite routes to the legacy invite screen', () => {
    expect(
      selectPendingInviteRoute(
        [makeInvite({inviteId: 'invite-plain'})],
        'Home',
        [],
      ),
    ).toStrictEqual({type: 'plain', inviteId: 'invite-plain'});
  });

  test('a marker invite wins even when a plain invite arrived first', () => {
    const route = selectPendingInviteRoute(
      [
        makeInvite({inviteId: 'invite-plain', receivedAt: 1}),
        makeInvite({
          inviteId: 'invite-marker',
          projectDescription: MARKER_DESCRIPTION,
          receivedAt: 2,
        }),
      ],
      'Home',
      [],
    );
    expect(route).toStrictEqual({
      type: 'organization',
      organizationId: ORG_ID,
      inviteId: 'invite-marker',
    });
  });

  test('a reserved-but-unparseable description is not treated as a marker invite', () => {
    expect(
      selectPendingInviteRoute(
        [
          makeInvite({
            inviteId: 'invite-corrupted',
            projectDescription: 'coiab-org:v9:not-an-id',
          }),
        ],
        'Home',
        [],
      ),
    ).toStrictEqual({type: 'plain', inviteId: 'invite-corrupted'});
  });

  test('does nothing while an invite screen is open', () => {
    expect(
      selectPendingInviteRoute(
        [makeInvite({projectDescription: MARKER_DESCRIPTION})],
        'InviteReceived',
        [],
      ),
    ).toBeUndefined();
  });

  test('does nothing while an editing screen is open', () => {
    expect(
      selectPendingInviteRoute([makeInvite()], 'ObservationEdit', []),
    ).toBeUndefined();
  });

  test('does nothing with no pending invites', () => {
    expect(
      selectPendingInviteRoute([makeInvite({state: 'joined'})], 'Home', []),
    ).toBeUndefined();
  });

  test('does nothing without a current route', () => {
    expect(
      selectPendingInviteRoute([makeInvite()], undefined, []),
    ).toBeUndefined();
  });

  test('does not route to the invite screen when the organization is already fully local', () => {
    // The reject-but-completed repair (Bug 46): the earlier accept DID join
    // every slot, so the still-pending invites need no decision — navigating
    // here loops dismiss ↔ navigate forever (the freeze).
    expect(
      selectPendingInviteRoute(
        [
          makeInvite({
            inviteId: 'invite-marker',
            projectDescription: MARKER_DESCRIPTION,
          }),
        ],
        'Home',
        [{organizationId: ORG_ID, state: 'ready'}],
      ),
    ).toBeUndefined();
  });

  test('still routes to the invite screen while the local organization is incomplete', () => {
    // A half-joined org is exactly the case the invite sheet completes.
    expect(
      selectPendingInviteRoute(
        [
          makeInvite({
            inviteId: 'invite-marker',
            projectDescription: MARKER_DESCRIPTION,
          }),
        ],
        'Home',
        [{organizationId: ORG_ID, state: 'incomplete'}],
      ),
    ).toStrictEqual({
      type: 'organization',
      organizationId: ORG_ID,
      inviteId: 'invite-marker',
    });
  });

  test('a ready local organization only suppresses its own invites', () => {
    // Another organization's pending invite must still reach its surface.
    const OTHER_ORG_ID = 'ffffffffffffffff';
    expect(
      selectPendingInviteRoute(
        [
          makeInvite({
            inviteId: 'invite-other',
            projectDescription: markerFor(OTHER_ORG_ID, 'a', 'Outra'),
          }),
        ],
        'Home',
        [{organizationId: ORG_ID, state: 'ready'}],
      ),
    ).toStrictEqual({
      type: 'organization',
      organizationId: OTHER_ORG_ID,
      inviteId: 'invite-other',
    });
  });

  test('a plain invite still routes when a ready organization suppresses the marker invite', () => {
    expect(
      selectPendingInviteRoute(
        [
          makeInvite({
            inviteId: 'invite-marker',
            projectDescription: MARKER_DESCRIPTION,
          }),
          makeInvite({inviteId: 'invite-plain'}),
        ],
        'Home',
        [{organizationId: ORG_ID, state: 'ready'}],
      ),
    ).toStrictEqual({type: 'plain', inviteId: 'invite-plain'});
  });
});

describe('PendingInvitesListener', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useOrganizationsMock.mockReturnValue([]);
    // The empty document classifies as 'nenhum': every pre-existing test
    // runs with routing unlocked, unchanged.
    useCoiabOrganizationsStateMock.mockReturnValue(
      criarEstadoInicialOrganizacoes(),
    );
  });

  test('navigates to the Organization invite screen for a marker invite', async () => {
    useManyInvitesMock.mockReturnValue({
      data: [
        makeInvite({
          inviteId: 'invite-marker',
          projectDescription: MARKER_DESCRIPTION,
        }),
      ],
    });
    const navigateToOrgInviteScreen = jest.fn();
    const navigateToInviteScreen = jest.fn();

    render(
      <PendingInvitesListener
        currentRouteName="Home"
        navigateToInviteScreen={navigateToInviteScreen}
        navigateToOrgInviteScreen={navigateToOrgInviteScreen}
      />,
    );

    await waitFor(() => {
      expect(navigateToOrgInviteScreen).toHaveBeenCalledTimes(1);
    });
    expect(navigateToOrgInviteScreen).toHaveBeenCalledWith(
      ORG_ID,
      'invite-marker',
    );
    expect(navigateToInviteScreen).not.toHaveBeenCalled();
  });

  test('does not navigate for a marker invite whose organization is already fully local', async () => {
    // Bug 46 freeze: the accept completed in core (every slot local) but the
    // invites stayed pending — the listener must not re-open the dismissed
    // sheet.
    useManyInvitesMock.mockReturnValue({
      data: [
        makeInvite({
          inviteId: 'invite-marker',
          projectDescription: MARKER_DESCRIPTION,
        }),
      ],
    });
    useOrganizationsMock.mockReturnValue([
      {
        state: 'ready',
        organizationId: ORG_ID,
        organizationName: 'Org Um',
        slots: {m: 'project-m', a: 'project-a'},
      },
    ]);
    const navigateToOrgInviteScreen = jest.fn();
    const navigateToInviteScreen = jest.fn();

    render(
      <PendingInvitesListener
        currentRouteName="Home"
        navigateToInviteScreen={navigateToInviteScreen}
        navigateToOrgInviteScreen={navigateToOrgInviteScreen}
      />,
    );

    await waitFor(() => {
      expect(useOrganizationsMock).toHaveBeenCalled();
    });
    expect(navigateToOrgInviteScreen).not.toHaveBeenCalled();
    expect(navigateToInviteScreen).not.toHaveBeenCalled();
  });

  test('does not navigate while the organization document is preparando', async () => {
    // SPEC B §5.5: while the organization is being prepared the provisioning
    // screen owns the flow — a newly arrived invite must stay pending
    // instead of pulling the user out of it. The listener never rejects or
    // alters the invite; routing resumes once the document leaves the
    // preparation state ('confirmacao' / 'pronta' / 'nenhum' all route).
    useCoiabOrganizationsStateMock.mockReturnValue(PREPARANDO_DOCUMENT);
    useManyInvitesMock.mockReturnValue({
      data: [
        makeInvite({
          inviteId: 'invite-marker',
          projectDescription: MARKER_DESCRIPTION,
        }),
        makeInvite({inviteId: 'invite-plain'}),
      ],
    });
    const navigateToOrgInviteScreen = jest.fn();
    const navigateToInviteScreen = jest.fn();

    render(
      <PendingInvitesListener
        currentRouteName="Home"
        navigateToInviteScreen={navigateToInviteScreen}
        navigateToOrgInviteScreen={navigateToOrgInviteScreen}
      />,
    );

    await waitFor(() => {
      expect(useOrganizationsMock).toHaveBeenCalled();
    });
    expect(navigateToOrgInviteScreen).not.toHaveBeenCalled();
    expect(navigateToInviteScreen).not.toHaveBeenCalled();
  });

  test('still navigates while the document waits for confirmation', async () => {
    // 'confirmacao' is not 'preparando': the confirmation must still reach
    // the user, so routing stays live.
    useCoiabOrganizationsStateMock.mockReturnValue(CONFIRMACAO_DOCUMENT);
    useManyInvitesMock.mockReturnValue({
      data: [
        makeInvite({
          inviteId: 'invite-marker',
          projectDescription: MARKER_DESCRIPTION,
        }),
      ],
    });
    const navigateToOrgInviteScreen = jest.fn();
    const navigateToInviteScreen = jest.fn();

    render(
      <PendingInvitesListener
        currentRouteName="Home"
        navigateToInviteScreen={navigateToInviteScreen}
        navigateToOrgInviteScreen={navigateToOrgInviteScreen}
      />,
    );

    await waitFor(() => {
      expect(navigateToOrgInviteScreen).toHaveBeenCalledTimes(1);
    });
    expect(navigateToOrgInviteScreen).toHaveBeenCalledWith(
      ORG_ID,
      'invite-marker',
    );
    expect(navigateToInviteScreen).not.toHaveBeenCalled();
  });

  test('still navigates while the document is pronta', async () => {
    // 'pronta' is not 'preparando': the listener must not be switched off by
    // the lock. A plain invite routes; the marker invite for the ready ORG_ID
    // stays suppressed by the existing ready-organization rule.
    useCoiabOrganizationsStateMock.mockReturnValue(PRONTA_DOCUMENT);
    useManyInvitesMock.mockReturnValue({
      data: [makeInvite({inviteId: 'invite-plain'})],
    });
    const navigateToOrgInviteScreen = jest.fn();
    const navigateToInviteScreen = jest.fn();

    render(
      <PendingInvitesListener
        currentRouteName="Home"
        navigateToInviteScreen={navigateToInviteScreen}
        navigateToOrgInviteScreen={navigateToOrgInviteScreen}
      />,
    );

    await waitFor(() => {
      expect(navigateToInviteScreen).toHaveBeenCalledTimes(1);
    });
    expect(navigateToInviteScreen).toHaveBeenCalledWith('invite-plain');
    expect(navigateToOrgInviteScreen).not.toHaveBeenCalled();
  });
});
