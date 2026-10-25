import * as React from 'react';
import {View} from 'react-native';
import {render, screen, within} from '@testing-library/react-native';
import type {BottomTabHeaderProps} from '@react-navigation/bottom-tabs';
import type {MapeoManager} from '@comapeo/core';
import type {ComapeoCoreClientApi} from '@comapeo/ipc';

import {createManager, setUpIPC} from '../../../tests/integration/helpers/core';
import {createAppProvidersWrapper} from '../../../tests/integration/helpers/react';
import {executarEmOrdem} from '../../../tests/integration/helpers/setupIntegrationTest';
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
  let coreTeardown: Array<() => unknown> = [];
  let projectId: string;

  beforeEach(async () => {
    onTeardown = [];
    coreTeardown = [];

    const setup = await createManager({name: 'test', deviceType: 'mobile'});
    manager = setup.manager;
    await setup.fastifyController.start();

    const ipc = setUpIPC({manager});
    client = ipc.client;
    coreTeardown.push(ipc.stop);
    coreTeardown.push(() => setup.fastifyController.stop());

    projectId = await client.createProject({name: 'Projeto Monitorado'});
  });

  afterEach(async () => {
    // Tree and providers first: their teardown clears the QueryClient, so
    // in-flight queries are cancelled before `ipc.stop` drains the RPCs and
    // closes the channel.
    await executarEmOrdem([
      ...onTeardown,
      ...coreTeardown,
      () => MMKVStoreInitializer.removeItem(COIAB_ORGANIZATIONS_STORAGE_KEY),
    ]);
  }, 15_000);

  const renderHeader = async (
    headerRight?: BottomTabHeaderProps['options']['headerRight'],
  ) => {
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
            options={{...baseHeader.options, headerRight}}
            backgroundColor="#fff"
            showBottomBorder
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

  it('nome longo da organização não espreme o botão de trilha (#32)', async () => {
    // Layout invariant, not a measurement: the test renderer runs no layout
    // engine, so no width is computed here and none is faked. What is pinned
    // are the rules that make an overflowing row give way on the title's
    // side — the pill is capped at 70% of the row and its text stays on one
    // line with a tail ellipsis, while the container holding headerRight
    // never shrinks. That the track button really stays whole next to a long
    // name can only be measured on an emulator or device.
    const nomeLongo =
      'Organização dos Povos Indígenas do Alto Rio Negro e Associação das Comunidades Tradicionais do Médio Solimões';
    const documento = organizationDocument();
    const organizacaoB = documento.organizacoes[1];
    if (!organizacaoB) throw new Error('fixture: organization B missing');
    organizacaoB.nome = nomeLongo;
    organizacaoB.materializacao.alertas.projectId = projectId;

    MMKVStoreInitializer.setItem(
      COIAB_ORGANIZATIONS_STORAGE_KEY,
      JSON.stringify({
        state: {...documento, ativa: {organizacaoId: 'B', area: 'alertas'}},
        version: 1,
      }),
    );

    await renderHeader(() => <View testID="header-right-stub" />);

    const titulo = await screen.findByTestId('HOME.header-title');
    expect(titulo).toHaveTextContent(nomeLongo);
    expect(titulo.props.numberOfLines).toBe(1);
    expect(screen.getByTestId('HOME.header-title-box')).toHaveStyle({
      maxWidth: '70%',
    });
    const direita = screen.getByTestId('HOME.header-right');
    expect(direita).toHaveStyle({flexShrink: 0});
    expect(within(direita).getByTestId('header-right-stub')).toBeOnTheScreen();
  });

  it('nome longo usa a linha inteira quando não há botão à direita (#32)', async () => {
    // Counterpart of the case above, for tabs with no headerRight (e.g.
    // Notificações): nothing sits to the right of the pill, so the 70% cap
    // must not apply — it would cut a long name short beside an empty row.
    // The name still stays on one line; as above, a layout rule is pinned,
    // not a measured width.
    const nomeLongo =
      'Organização dos Povos Indígenas do Alto Rio Negro e Associação das Comunidades Tradicionais do Médio Solimões';
    const documento = organizationDocument();
    const organizacaoB = documento.organizacoes[1];
    if (!organizacaoB) throw new Error('fixture: organization B missing');
    organizacaoB.nome = nomeLongo;
    organizacaoB.materializacao.alertas.projectId = projectId;

    MMKVStoreInitializer.setItem(
      COIAB_ORGANIZATIONS_STORAGE_KEY,
      JSON.stringify({
        state: {...documento, ativa: {organizacaoId: 'B', area: 'alertas'}},
        version: 1,
      }),
    );

    await renderHeader();

    const titulo = await screen.findByTestId('HOME.header-title');
    expect(titulo).toHaveTextContent(nomeLongo);
    expect(titulo.props.numberOfLines).toBe(1);
    expect(screen.getByTestId('HOME.header-title-box')).not.toHaveStyle({
      maxWidth: '70%',
    });
  });

  it('não nomeia a organização quando o projeto ativo é outro projeto', async () => {
    // RED case (SPEC A §4.2 regra 5): an untracked switch of the active
    // project — LeaveProject, a create/accept repointing the id
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
