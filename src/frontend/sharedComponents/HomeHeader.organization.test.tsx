import * as React from 'react';
import {render, screen} from '@testing-library/react-native';
import type {BottomTabHeaderProps} from '@react-navigation/bottom-tabs';
import type {MapeoManager} from '@comapeo/core';
import type {ComapeoCoreClientApi} from '@comapeo/ipc';

import {createManager, setUpIPC} from '../../../tests/integration/helpers/core';
import {createAppProvidersWrapper} from '../../../tests/integration/helpers/react';
import {ActiveProjectProvider} from '../contexts/ActiveProjectContext';
import {COIAB_ORGANIZATIONS_STORAGE_KEY} from '../contexts/CoiabOrganizationsStoreContext';
import {MMKVStoreInitializer} from '../hooks/persistedState/createPersistedState';
import {parseEstadoOrganizacoes} from '../lib/organization/coiabOrganizations';
import {
  organizationDocument,
  readyOrganization,
} from '../lib/organization/fixtures';
import {sleep} from '../lib/sleep';

import {HomeHeader} from './HomeHeader';

jest.mock('../hooks/useStorageReadingQuery', () => ({
  __esModule: true,
  useStorageReadingQuery: () => ({
    data: {
      freeBytes: 32 * 1024 * 1024 * 1024,
      totalBytes: 64 * 1024 * 1024 * 1024,
    },
  }),
}));

const baseHeader: Pick<
  BottomTabHeaderProps,
  'navigation' | 'route' | 'options' | 'layout'
> = {
  navigation: {} as BottomTabHeaderProps['navigation'],
  route: {
    key: 'home',
    name: 'HomeHeaderRoute',
  } as BottomTabHeaderProps['route'],
  options: {} as BottomTabHeaderProps['options'],
  layout: {width: 320, height: 60},
};

describe('HomeHeader identidade exibida (navigator + AppProviders)', () => {
  let manager: MapeoManager;
  let client: ComapeoCoreClientApi;
  let onTeardown: Array<() => unknown> = [];
  let projectId: string;

  beforeEach(async () => {
    onTeardown = [];

    const setup = await createManager({name: 'test', deviceType: 'mobile'});
    manager = setup.manager;
    await setup.fastifyController.start();
    onTeardown.push(() => setup.fastifyController.stop());

    const ipc = setUpIPC({manager});
    client = ipc.client;
    onTeardown.push(ipc.stop);

    projectId = await client.createProject({name: 'Projeto Monitorado'});
  });

  afterEach(async () => {
    for (const fn of onTeardown) await fn();
    MMKVStoreInitializer.removeItem(COIAB_ORGANIZATIONS_STORAGE_KEY);
  });

  const renderHeader = async () => {
    const appProviders = createAppProvidersWrapper({
      mapeoApi: client,
      activeProjectId: projectId,
    });
    onTeardown.push(appProviders.teardown);

    const utils = await render(
      <React.Suspense fallback={null}>
        <ActiveProjectProvider activeProjectId={projectId}>
          <HomeHeader
            {...baseHeader}
            backgroundColor="#fff"
            showBottomBorder
            onPress={() => {}}
          />
        </ActiveProjectProvider>
      </React.Suspense>,
      {wrapper: appProviders.wrapper},
    );

    // The tree must be unmounted before the IPC is stopped, otherwise every
    // subscription tears down against a closed client.
    onTeardown.unshift(async () => {
      await utils.unmount();
      await sleep(0);
    });

    return utils;
  };

  it('mostra o nome da organização quando o projeto ativo é o derivado', async () => {
    // The active organization is deliberately the SECOND one: a lookup by
    // index/first element would show 'Organização A' and pass unnoticed.
    // SPEC A §4.2 regra 5: the header names the organization only when the
    // project the app IS operating is the one derived from the persisted
    // document — org B's Alertas slot (the selected area) holds exactly the
    // active projectId; the other slots keep fixture ids that exist in no
    // core, which must not matter.
    const documento = organizationDocument();
    const organizacaoB = documento.organizacoes[1];
    if (!organizacaoB) throw new Error('fixture: organization B missing');
    organizacaoB.materializacao.alertas.projectId = projectId;

    MMKVStoreInitializer.setItem(
      COIAB_ORGANIZATIONS_STORAGE_KEY,
      JSON.stringify({
        state: {...documento, ativa: {organizacaoId: 'B', area: 'alertas'}},
        version: 1,
      }),
    );

    await renderHeader();

    expect(await screen.findByTestId('HOME.header-title')).toHaveTextContent(
      'Organização B',
    );
  });

  it('não nomeia a organização quando o projeto ativo é outro projeto', async () => {
    // RED case (SPEC A §4.2 regra 5): an untracked switch of the active
    // project — AllProjects, LeaveProject, a create/accept repointing the id
    // — leaves the persisted document untouched, so the derived projectId
    // (org A's Monitoramento slot, a real second project) is NOT the project
    // being operated. The header falls back to the project name; naming the
    // organization here would lie about which organization the app runs.
    const outroProjectId = await client.createProject({
      name: 'Projeto Alternativo',
    });
    const documento = organizationDocument();
    const organizacaoA = documento.organizacoes[0];
    if (!organizacaoA) throw new Error('fixture: organization A missing');
    organizacaoA.materializacao.monitoramento.projectId = outroProjectId;

    MMKVStoreInitializer.setItem(
      COIAB_ORGANIZATIONS_STORAGE_KEY,
      JSON.stringify({
        state: {
          ...documento,
          ativa: {organizacaoId: 'A', area: 'monitoramento'},
        },
        version: 1,
      }),
    );

    await renderHeader();

    expect(await screen.findByTestId('HOME.header-title')).toHaveTextContent(
      'Projeto Monitorado',
    );
  });

  it('não nomeia a organização cuja confirmação está pendente', async () => {
    // Parser-valid (org 'pronta' + confirmacaoPendente) but not acknowledged:
    // `derivarProjectIdAtivo` refuses it (SPEC A §4.2 regra 9 — `ativa` is
    // born only in the single write of the "Abrir organização" tap, and a
    // pending confirmation is not an operated organization). Asserting the
    // document parses keeps a failed hydration from making this pass without
    // exercising the gate (an unreadable document leaves no organization).
    const documento = {
      ...organizationDocument(),
      organizacoes: [
        {...readyOrganization('A'), confirmacaoPendente: true},
        readyOrganization('B'),
      ],
      ativa: {organizacaoId: 'A', area: 'monitoramento'} as const,
    };
    expect(parseEstadoOrganizacoes(documento)).not.toBeNull();

    MMKVStoreInitializer.setItem(
      COIAB_ORGANIZATIONS_STORAGE_KEY,
      JSON.stringify({state: documento, version: 1}),
    );

    await renderHeader();

    expect(await screen.findByTestId('HOME.header-title')).toHaveTextContent(
      'Projeto Monitorado',
    );
  });

  it('sem organização ativa mantém o nome do projeto', async () => {
    await renderHeader();

    expect(await screen.findByTestId('HOME.header-title')).toHaveTextContent(
      'Projeto Monitorado',
    );
  });
});
