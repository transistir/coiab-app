import * as React from 'react';
import {render, waitFor} from '@testing-library/react-native';
import {useManyInvites} from '@comapeo/core-react';
import {useLinkingURL} from 'expo-linking';

import {DeepLinkListener} from './DeepLinkListener';
import {useCoiabOrganizationsState} from '../../contexts/CoiabOrganizationsStoreContext';
import {
  criarEstadoInicialOrganizacoes,
  type EstadoOrganizacoes,
} from '../../lib/organization/coiabOrganizations';
import {readyOrganization} from '../../lib/organization/fixtures';

const mockNavigation = {navigate: jest.fn()};
const useLinkingURLMock = useLinkingURL as jest.Mock;
const useManyInvitesMock = useManyInvites as jest.Mock;
const useCoiabOrganizationsStateMock = useCoiabOrganizationsState as jest.Mock;
// `expo-linking`'s `parse` reads `Constants.linkingUri` at call time; the jest
// environment leaves it undefined and the read crashes. Declaring the Bare
// execution environment makes `hasCustomScheme()` short-circuit true, which
// is exactly what the app build (a bare React Native app) has.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {executionEnvironment: 'bare'},
  ExecutionEnvironment: {Bare: 'bare'},
}));

jest.mock('expo-linking', () => ({
  ...jest.requireActual('expo-linking'),
  useLinkingURL: jest.fn(),
}));

jest.mock('@comapeo/core-react', () => ({
  useManyInvites: jest.fn(),
}));

jest.mock('../../hooks/useNavigationWithTypes', () => ({
  useNavigationFromRoot: () => mockNavigation,
}));

jest.mock('../../contexts/CoiabOrganizationsStoreContext', () => ({
  useCoiabOrganizationsState: jest.fn(),
}));

const ORG_ID = 'a1b2c3d4e5f60718';

/**
 * Document fixtures classified by `classificarDocumento` exactly like the
 * PendingInvitesListener tests classify them: one organization in each
 * preparation stage.
 */
const PREPARANDO_DOCUMENT: EstadoOrganizacoes = {
  versao: 1,
  organizacoes: [{...readyOrganization(ORG_ID), estado: 'preparando'}],
  ativa: null,
};

const PRONTA_DOCUMENT: EstadoOrganizacoes = {
  versao: 1,
  organizacoes: [readyOrganization(ORG_ID)],
  ativa: null,
};

describe('DeepLinkListener', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // The empty document classifies as 'nenhum': every pre-existing behavior
    // (no gate at all) runs with routing unlocked, unchanged.
    useCoiabOrganizationsStateMock.mockReturnValue(
      criarEstadoInicialOrganizacoes(),
    );
    useManyInvitesMock.mockReturnValue({data: []});
  });

  test('navigates a plain deep-linked invite to the legacy sheet', async () => {
    // Baseline: with no organization document the deep link keeps routing
    // exactly as it does today.
    useLinkingURLMock.mockReturnValue('ekanadyby://invite/invite-plain');
    useManyInvitesMock.mockReturnValue({
      data: [{inviteId: 'invite-plain', state: 'pending'}],
    });

    render(<DeepLinkListener currentRouteName="Home" />);

    await waitFor(() => {
      expect(mockNavigation.navigate).toHaveBeenCalledWith('InviteReceived', {
        inviteId: 'invite-plain',
      });
    });
  });

  test('does not navigate a deep-linked invite while the document is preparando', async () => {
    // SPEC B §5.5 (spec-criar-organizacao.md :227): while a creation is
    // alive the provisioning surface owns the flow — a deep-linked invite
    // must not pull the user out of it mid-preparation. The invite stays
    // pending and untouched; routing resumes once the document leaves the
    // preparation state.
    useCoiabOrganizationsStateMock.mockReturnValue(PREPARANDO_DOCUMENT);
    useLinkingURLMock.mockReturnValue('ekanadyby://invite/invite-plain');
    useManyInvitesMock.mockReturnValue({
      data: [{inviteId: 'invite-plain', state: 'pending'}],
    });

    render(<DeepLinkListener currentRouteName="Home" />);

    await waitFor(() => {
      expect(useManyInvitesMock).toHaveBeenCalled();
    });
    expect(mockNavigation.navigate).not.toHaveBeenCalled();
  });

  test('routes again once the operation settles (pronta)', async () => {
    // The gate must be a suspension, not a kill switch: a pending invite
    // whose delivery was held during preparation flows as soon as the
    // document leaves it. The document is rendered LIVE in 'preparando'
    // first — a latch bug (routing permanently disabled by any render in
    // preparation) would never navigate after the rerender — and the
    // 'pronta' rerender must route in that very commit.
    useCoiabOrganizationsStateMock.mockReturnValue(PREPARANDO_DOCUMENT);
    useLinkingURLMock.mockReturnValue('ekanadyby://invite/invite-plain');
    useManyInvitesMock.mockReturnValue({
      data: [{inviteId: 'invite-plain', state: 'pending'}],
    });

    const {rerender} = await render(
      <DeepLinkListener currentRouteName="Home" />,
    );

    await waitFor(() => {
      expect(useManyInvitesMock).toHaveBeenCalled();
    });
    expect(mockNavigation.navigate).not.toHaveBeenCalled();

    useCoiabOrganizationsStateMock.mockReturnValue(PRONTA_DOCUMENT);
    await rerender(<DeepLinkListener currentRouteName="Home" />);

    await waitFor(() => {
      expect(mockNavigation.navigate).toHaveBeenCalledWith('InviteReceived', {
        inviteId: 'invite-plain',
      });
    });
  });
});
