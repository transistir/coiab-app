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
import {
  derivarProjectIdAtivo,
  parseEstadoOrganizacoes,
} from '../lib/organization/coiabOrganizations';
import {
  organizationDocument,
  readyOrganization,
} from '../lib/organization/fixtures';
import {
  CHARCOAL,
  COIAB_ORANGE,
  COIAB_RED,
  DARK_GREY,
  WHITE,
} from '../lib/styles';
import {sleep} from '../lib/sleep';

import {HomeHeader} from './HomeHeader';

let mockFreeBytes = 32 * 1024 * 1024 * 1024;
jest.mock('../hooks/useStorageReadingQuery', () => ({
  __esModule: true,
  useStorageReadingQuery: () => ({
    data: {
      freeBytes: mockFreeBytes,
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
    mockFreeBytes = 32 * 1024 * 1024 * 1024;
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

    // T4: a faixa inferior acompanha a área escolhida; a de território não.
    const area = screen.getByTestId('HOME.header-area');
    expect(area).toHaveTextContent('Alertas');
    expect(area).toHaveStyle({color: WHITE});
    expect(screen.getByTestId('HOME.header-faixa-area')).toHaveStyle({
      backgroundColor: COIAB_RED,
    });
    expect(screen.getByTestId('HOME.header-faixa-territorio')).toHaveStyle({
      backgroundColor: DARK_GREY,
    });
  });

  it('território e Monitoramento Territorial em faixas empilhadas', async () => {
    const documento = organizationDocument();
    const organizacaoA = documento.organizacoes[0];
    if (!organizacaoA) throw new Error('fixture: organization A missing');
    organizacaoA.materializacao.monitoramento.projectId = projectId;

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

    const titulo = await screen.findByTestId('HOME.header-title');
    expect(titulo).toHaveTextContent('Organização A');
    expect(titulo).toHaveStyle({color: WHITE});
    expect(screen.getByTestId('HOME.header-faixa-territorio')).toHaveStyle({
      backgroundColor: DARK_GREY,
    });

    const area = screen.getByTestId('HOME.header-area');
    expect(area).toHaveTextContent('Monitoramento Territorial');
    expect(area).toHaveStyle({color: CHARCOAL});
    expect(screen.getByTestId('HOME.header-faixa-area')).toHaveStyle({
      backgroundColor: COIAB_ORANGE,
    });
  });

  it('bloco é um nó a11y com rótulo composto', async () => {
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

    const bloco = await screen.findByLabelText('Organização B, Alertas');
    expect(bloco.props.testID).toBe('HOME.header-bloco');
    expect(bloco.props.accessible).toBe(true);
  });

  it('nome longo da organização não espreme o botão de trilha (#32)', async () => {
    // Layout invariant, not a measurement: the test renderer runs no layout
    // engine, so no width is computed here and none is faked. An overflowing
    // row gives way on the title's side: the pill shrinks and its text stays
    // on one line with a tail ellipsis, while the container holding
    // headerRight never shrinks. No width cap is needed for that, and one
    // would cut the name short whenever headerRight renders nothing (the
    // Paneiro download button with nothing to download). That the track
    // button really stays whole next to a long name can only be measured on
    // an emulator or device.
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

    // Low storage, so the badge wrapper exists and its no-shrink rule can be
    // pinned in the same row.
    mockFreeBytes = 100 * 1024 * 1024;
    await renderHeader(() => <View testID="header-right-stub" />);

    const titulo = await screen.findByTestId('HOME.header-title');
    expect(titulo).toHaveTextContent(nomeLongo);
    expect(titulo.props.numberOfLines).toBe(1);
    expect(titulo.props.maxFontSizeMultiplier).toBe(1.3);
    expect(screen.getByTestId('HOME.header-title-box')).not.toHaveStyle({
      maxWidth: expect.anything(),
    });
    expect(screen.getByTestId('HOME.header-title-box')).toHaveStyle({
      flexShrink: 1,
    });
    const area = screen.getByTestId('HOME.header-area');
    expect(area.props.numberOfLines).toBe(1);
    expect(area.props.ellipsizeMode).toBe('tail');
    expect(screen.getByTestId('HOME.header-bloco')).toHaveStyle({
      flexShrink: 1,
    });
    const badge = screen.getByTestId('low-storage-badge');
    expect(badge.parent).not.toBeNull();
    expect(badge.parent!).toHaveStyle({flexShrink: 0});
    const direita = screen.getByTestId('HOME.header-right');
    expect(direita).toHaveStyle({flexShrink: 0});
    expect(within(direita).getByTestId('header-right-stub')).toBeOnTheScreen();
  });

  it('nome longo usa a linha inteira quando não há botão à direita (#32)', async () => {
    // Counterpart of the case above, for tabs with no headerRight (e.g.
    // Notificações): nothing sits to the right of the pill, so it takes the
    // whole row — no width cap may cut a long name short beside an empty
    // row, and no empty headerRight container is mounted whose paddingLeft
    // would still take room. The name still stays on one line; as above, a
    // layout rule is pinned, not a measured width.
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
      maxWidth: expect.anything(),
    });
    expect(screen.getByTestId('HOME.header-area').props.numberOfLines).toBe(1);
    expect(screen.getByTestId('HOME.header-bloco')).not.toHaveStyle({
      maxWidth: expect.anything(),
    });
    expect(screen.queryByTestId('HOME.header-right')).toBeNull();
  });

  it('headerRight que devolve null não monta o container (#32)', async () => {
    // The case above omits headerRight, so it cannot tell an absent option
    // from one that returns nothing: the container follows what
    // headerRight(...) returns. An element that renders null (Paneiro's
    // download button with nothing to download) still mounts it.
    await renderHeader(() => null);
    expect(await screen.findByTestId('HOME.header-title')).toBeOnTheScreen();
    expect(screen.queryByTestId('HOME.header-right')).toBeNull();
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
    expect(screen.queryByTestId('HOME.header-area')).toBeNull();
  });

  it('não nomeia a organização cuja confirmação está pendente', async () => {
    // Parser-valid (org 'pronta' + confirmacaoPendente) but not acknowledged:
    // `derivarProjectIdAtivo` refuses it (SPEC A §4.2 regra 9 — `ativa` is
    // born only in the single write of the "Abrir organização" tap, and a
    // pending confirmation is not an operated organization). The monitoramento
    // slot points at the OPEN projectId, so the derived id would match but for
    // the flag; the positive control below proves the document differs only by
    // `confirmacaoPendente`. Asserting the document parses keeps a failed
    // hydration from making this pass without exercising the gate (an
    // unreadable document leaves no organization).
    const a = readyOrganization('A');
    a.materializacao.monitoramento.projectId = projectId;
    const documento = {
      ...organizationDocument(),
      organizacoes: [{...a, confirmacaoPendente: true}, readyOrganization('B')],
      ativa: {organizacaoId: 'A', area: 'monitoramento'} as const,
    };
    expect(parseEstadoOrganizacoes(documento)).not.toBeNull();
    expect(
      derivarProjectIdAtivo({
        ...documento,
        organizacoes: [
          {...a, confirmacaoPendente: false},
          readyOrganization('B'),
        ],
      }),
    ).toBe(projectId);

    MMKVStoreInitializer.setItem(
      COIAB_ORGANIZATIONS_STORAGE_KEY,
      JSON.stringify({state: documento, version: 1}),
    );

    await renderHeader();

    expect(await screen.findByTestId('HOME.header-title')).toHaveTextContent(
      'Projeto Monitorado',
    );
    expect(screen.queryByTestId('HOME.header-area')).toBeNull();
  });

  it('sem organização ativa mantém o nome do projeto', async () => {
    await renderHeader();

    expect(await screen.findByTestId('HOME.header-title')).toHaveTextContent(
      'Projeto Monitorado',
    );
    expect(screen.getByTestId('HOME.header-pilula')).toBeOnTheScreen();
    expect(screen.queryByTestId('HOME.header-bloco')).toBeNull();
  });
});
