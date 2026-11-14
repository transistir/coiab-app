// The shared navigator setup (native stubs, core/IPC lifecycle, render helper)
// lives in homeTabsHarness.tsx; it registers its `jest.mock`s on import, so it
// stays the first import. The second half of this suite is index.menu.test.tsx.
import {useHomeTabsHarness} from './homeTabsHarness';

// `jest.mock` is file-scoped, so both tracking hooks delegate to the real
// implementation by default: the navigator suite keeps running the real
// track store, and only the TrackMapButton describe pins their return values.
jest.mock('../../hooks/useTracking', () => {
  const actual = jest.requireActual<typeof import('../../hooks/useTracking')>(
    '../../hooks/useTracking',
  );
  return {...actual, useTracking: jest.fn(actual.useTracking)};
});
jest.mock('../../hooks/useTrackTimer', () => {
  const actual = jest.requireActual<typeof import('../../hooks/useTrackTimer')>(
    '../../hooks/useTrackTimer',
  );
  return {...actual, useTrackTimer: jest.fn(actual.useTrackTimer)};
});

// The global SVG mock (src/frontend/__mocks__/svg.tsx) forwards only
// `testID`. As in ErrorBottomSheet.test.tsx, the track icon becomes a named
// host component instead, which keeps every prop (`color` included) visible.
jest.mock('../../images/Tracks.svg', () => 'TracksIcon');

import {StyleSheet} from 'react-native';
import {
  render,
  screen,
  userEvent,
  waitFor,
  within,
} from '@testing-library/react-native';

import {COIAB_ORANGE, DARK_GREY, NEW_DARK_GREY, WHITE} from '../../lib/styles';
import {useTracking} from '../../hooks/useTracking';
import {useTrackTimer} from '../../hooks/useTrackTimer';
import {TrackMapButton} from './index';

describe('TrackMapButton — estado de gravação (#32)', () => {
  const realUseTracking = jest.mocked(useTracking).getMockImplementation()!;
  const realUseTrackTimer = jest.mocked(useTrackTimer).getMockImplementation()!;

  beforeEach(() => {
    jest
      .mocked(useTracking)
      .mockReturnValue({isTracking: false} as ReturnType<typeof useTracking>);
    jest.mocked(useTrackTimer).mockReturnValue('00:01:23');
  });

  afterEach(() => {
    // Devolve os hooks reais ao suite do navigator.
    jest.mocked(useTracking).mockImplementation(realUseTracking);
    jest.mocked(useTrackTimer).mockImplementation(realUseTrackTimer);
  });

  test('parado: sem cronômetro, sem indicador verde e ícone cinza', async () => {
    await render(<TrackMapButton onPress={jest.fn()} />);

    expect(screen.getByLabelText('Track recording')).toBeTruthy();
    // O rótulo é o mesmo nos dois estados: é o valor acessível que diz ao
    // leitor de tela se há gravação (e, gravando, o tempo decorrido).
    expect(screen.getByTestId('mapTrackButton')).toHaveAccessibilityValue({
      text: 'Not recording',
    });
    // O hook do cronômetro devolve um valor, mas parado ele não aparece.
    expect(screen.queryByText('00:01:23')).toBeNull();
    expect(screen.queryByTestId('mapTrackButton.indicator')).toBeNull();
    expect(screen.getByTestId('mapTrackButton.icon').props.color).toBe(
      NEW_DARK_GREY,
    );
  });

  test('gravando: cronômetro, indicador verde e ícone laranja', async () => {
    jest
      .mocked(useTracking)
      .mockReturnValue({isTracking: true} as ReturnType<typeof useTracking>);

    await render(<TrackMapButton onPress={jest.fn()} />);

    expect(screen.getByLabelText('Track recording')).toBeTruthy();
    expect(screen.getByTestId('mapTrackButton')).toHaveAccessibilityValue({
      text: 'Recording, 00:01:23',
    });
    expect(screen.getByText('00:01:23')).toBeTruthy();
    expect(screen.getByTestId('mapTrackButton.indicator')).toBeTruthy();
    expect(
      StyleSheet.flatten(
        screen.getByTestId('mapTrackButton.indicator').props.style,
      ).backgroundColor,
    ).toBe('#59A553');
    expect(screen.getByTestId('mapTrackButton.icon').props.color).toBe(
      COIAB_ORANGE,
    );
  });
});

describe('HomeTabs — barra de 5 abas (#32)', () => {
  const h = useHomeTabsHarness();
  const renderHomeTabs = () => h.renderHomeTabs();

  test('a tab bar mostra exatamente 5 itens (menu, paneiro, map, notificações, configurações), sem rótulo de texto, Menu ativo por padrão', async () => {
    await renderHomeTabs();

    // Os cinco itens da barra do Figma `footer-menu`, na ordem
    // esquerda→direita. Paneiro usa a rota ObservationsList (funil ≠ filtro);
    // Configurações navega para AppSettings na root stack (não é aba).
    const tabButtons = [
      'tabBarButtonMenu',
      'tabBarButtonPaneiro',
      'tabBarButtonMap',
      'tabBarButtonNotificacoes',
      'tabBarButtonConfiguracoes',
    ];
    for (const testID of tabButtons) {
      expect(await screen.findByTestId(testID)).toBeTruthy();
    }
    // A Camera deixou de ser aba (só o botão some; a rota continua).
    expect(screen.queryByTestId('tabBarButtonCamera')).toBeNull();
    // Itens que saíram no v3: perfil nunca existiu; a trilha/download não
    // vive na barra (a trilha é ação DENTRO do mapa); Filtros deixou de ser
    // aba (o funil agora é o Paneiro).
    expect(screen.queryByTestId('tabBarButtonTracking')).toBeNull();
    expect(screen.queryByTestId('tabBarButtonFiltros')).toBeNull();
    expect(screen.queryByTestId('tabBarButtonEntroncamento')).toBeNull();

    // Sem rótulo de texto na barra (ícones apenas, como no Figma).
    expect(screen.queryByText('Menu')).toBeNull();
    expect(screen.queryByText('Paneiro')).toBeNull();
    expect(screen.queryByText('Filtros')).toBeNull();
    expect(screen.queryByText('Entroncamento')).toBeNull();

    // Menu é a rota inicial pós-login e renderiza a página de menu (o
    // conteúdo que o CoMapeo mostrava na drawer do header).
    expect(h.navigation.getCurrentRoute()?.name).toBe('Menu');
    expect(await screen.findByTestId('MENU.scrn')).toBeTruthy();
    // Continuidade de testes de navigator (#32): a Home pós-login carrega o
    // testID ENTRONCAMENTO.scrn.
    expect(screen.getByTestId('ENTRONCAMENTO.scrn')).toBeTruthy();
  });

  test('o botão funil (paneiro) navega para a ObservationsList', async () => {
    await renderHomeTabs();
    const user = userEvent.setup();

    await user.press(await screen.findByTestId('tabBarButtonPaneiro'));

    expect(h.navigation.getCurrentRoute()?.name).toBe('ObservationsList');
    // Sem observações no projeto novo, a lista existente cai na view vazia.
    expect(await screen.findByTestId('observationsEmptyView')).toBeTruthy();
  });

  test('o botão engrenagem navega para a tela de configurações (AppSettings)', async () => {
    await renderHomeTabs();
    const user = userEvent.setup();

    await user.press(await screen.findByTestId('tabBarButtonConfiguracoes'));

    await waitFor(() =>
      expect(h.navigation.getCurrentRoute()?.name).toBe('AppSettings'),
    );
    expect(await screen.findByTestId('STUB.app-settings')).toBeTruthy();
  });

  test('o botão menu abre a página de menu (conteúdo da drawer atual)', async () => {
    await renderHomeTabs();
    const user = userEvent.setup();

    // Sai da Home para o mapa e volta pelo botão de menu.
    await user.press(await screen.findByTestId('tabBarButtonMap'));
    expect(await screen.findByTestId('MAIN.map-screen')).toBeTruthy();

    await user.press(await screen.findByTestId('tabBarButtonMenu'));

    expect(h.navigation.getCurrentRoute()?.name).toBe('Menu');
    // A página de menu mostra o conteúdo do menu: o botão de ação (Exchange)
    // e o cartão da organização, que vivem no DrawerMenu reaproveitado.
    expect(
      within(screen.getByTestId('MENU.scrn')).getByTestId(
        'MENU.main-action-button',
      ),
    ).toBeTruthy();
  });

  test('a página de Menu usa o fundo do tema (#118)', async () => {
    await renderHomeTabs();

    // O container da Home pós-login (ENTRONCAMENTO.scrn) carrega o fundo
    // do tema em volta do conteúdo do menu.
    const menu = await screen.findByTestId('ENTRONCAMENTO.scrn');
    expect(menu.props.style).toEqual(
      expect.objectContaining({backgroundColor: DARK_GREY}),
    );
  });

  test('a página de Menu não tem header nenhum (headerShown: false)', async () => {
    await renderHomeTabs();
    const user = userEvent.setup();

    // Menu é a superfície inicial e não tem header algum: o DrawerMenu aplica
    // `insets.top` no topo do conteúdo. Sem HomeHeader não existe o antigo
    // chip transparente de organização flutuando sobre a saudação.
    await screen.findByTestId('MENU.scrn');
    expect(screen.queryByTestId('HOME.header-container')).toBeNull();
    expect(screen.queryByTestId('HOME.header')).toBeNull();
    expect(screen.queryByTestId('HOME.header-title')).toBeNull();

    // Escopo: as abas de conteúdo continuam com o header sólido.
    await user.press(await screen.findByTestId('tabBarButtonPaneiro'));
    const paneiroHeader = await screen.findByTestId('HOME.header-container');
    expect(StyleSheet.flatten(paneiroHeader.props.style)).toEqual(
      expect.objectContaining({
        backgroundColor: WHITE,
        borderBottomWidth: 1,
      }),
    );
    expect(await screen.findByTestId('HOME.header-title')).toBeTruthy();

    // Map mantém o header transparente (mapa sob a status bar).
    await user.press(await screen.findByTestId('tabBarButtonMap'));
    const mapHeader = await screen.findByTestId('HOME.header-container');
    expect(StyleSheet.flatten(mapHeader.props.style)).toEqual(
      expect.objectContaining({
        backgroundColor: 'transparent',
        borderBottomWidth: 0,
      }),
    );
  });

  test('a aba Menu anima com slide-in rápido da esquerda (#121)', async () => {
    await renderHomeTabs();
    await screen.findByTestId('tabBarButtonMenu');

    const menuOptions = h.navigation.getCurrentOptions();
    expect(menuOptions).toEqual(
      expect.objectContaining({
        headerShown: false,
        animation: 'shift',
        sceneStyleInterpolator: expect.any(Function),
        transitionSpec: expect.objectContaining({animation: 'timing'}),
      }),
    );

    // As demais abas mantêm o comportamento atual: nenhum slide horizontal.
    const user = userEvent.setup();
    await user.press(await screen.findByTestId('tabBarButtonPaneiro'));
    await waitFor(() =>
      expect(h.navigation.getCurrentRoute()?.name).toBe('ObservationsList'),
    );

    const paneiroOptions = h.navigation.getCurrentOptions() as
      Record<string, unknown> | undefined;
    expect(paneiroOptions?.animation).not.toBe('shift');
    expect(paneiroOptions?.sceneStyleInterpolator).toBeUndefined();
    expect(paneiroOptions?.transitionSpec).toBeUndefined();
  });

  test('Notificações usa fundo do tema e texto branco (#118)', async () => {
    await renderHomeTabs();
    const user = userEvent.setup();

    await user.press(await screen.findByTestId('tabBarButtonNotificacoes'));

    const notificacoes = await screen.findByTestId('NOTIFICACOES.scrn');
    expect(notificacoes.props.style).toEqual(
      expect.objectContaining({backgroundColor: DARK_GREY}),
    );
    expect(screen.getByText('Notificações (em breve)').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({color: WHITE})]),
    );
  });

  test('a aba Map renderiza a MapScreen existente', async () => {
    await renderHomeTabs();
    const user = userEvent.setup();

    await user.press(await screen.findByTestId('tabBarButtonMap'));

    expect(await screen.findByTestId('MAIN.map-screen')).toBeTruthy();
  });

  test('o botão de trilha fica acessível dentro do mapa', async () => {
    await renderHomeTabs();
    const user = userEvent.setup();

    await user.press(await screen.findByTestId('tabBarButtonMap'));

    // Pelo testID primeiro (o ponto de RED do critério de aceite); o rótulo
    // de acessibilidade aponta para o mesmo elemento.
    const trackBtn = await screen.findByTestId('mapTrackButton');
    expect(trackBtn).toBeTruthy();
    expect(await screen.findByLabelText('Track recording')).toBe(trackBtn);

    await user.press(trackBtn);
    expect(await screen.findByText('Ready to record new track?')).toBeTruthy();
  });

  test('o botão de trilha só aparece na aba Map (#32)', async () => {
    await renderHomeTabs();
    const user = userEvent.setup();

    // O Map é aberto primeiro: a cena dele continua montada (inativa) ao
    // trocar de aba, então a ausência nas demais abas não é trivial.
    await user.press(await screen.findByTestId('tabBarButtonMap'));
    expect(await screen.findByLabelText('Track recording')).toBeTruthy();

    for (const [tabButton, conteudo] of [
      ['tabBarButtonPaneiro', 'observationsEmptyView'],
      ['tabBarButtonNotificacoes', 'NOTIFICACOES.scrn'],
      ['tabBarButtonMenu', 'MENU.scrn'],
    ] as const) {
      await user.press(await screen.findByTestId(tabButton));
      expect(await screen.findByTestId(conteudo)).toBeTruthy();
      await waitFor(() =>
        expect(screen.queryByLabelText('Track recording')).toBeNull(),
      );
      expect(screen.queryByTestId('mapTrackButton')).toBeNull();
    }
  });

  test('nenhuma aba tem botão de abrir menu (#118)', async () => {
    await renderHomeTabs();
    const user = userEvent.setup();

    // Header sólido (Paneiro, Notificações) e transparente (Map): nenhum
    // header home mostra mais o hambúrguer que abria a drawer. O Menu não tem
    // header algum (headerShown:false), então fica fora deste loop.
    for (const testID of [
      'tabBarButtonPaneiro',
      'tabBarButtonMap',
      'tabBarButtonNotificacoes',
    ]) {
      await user.press(await screen.findByTestId(testID));
      expect(await screen.findByTestId('HOME.header-title')).toBeTruthy();
      expect(screen.queryByLabelText('Open Menu')).toBeNull();
      expect(screen.queryByTestId('HOME.header-button')).toBeNull();
    }

    // O loop só termina na aba Notificações: nenhum teste sai de outra aba
    // e volta ao Menu pela tab bar. A rota inicial (`Menu`) tem de ser
    // alcançável de qualquer aba — sem drawer, é o único caminho de volta.
    await user.press(await screen.findByTestId('tabBarButtonMenu'));
    expect(h.navigation.getCurrentRoute()?.name).toBe('Menu');
    expect(await screen.findByTestId('MENU.scrn')).toBeTruthy();
  });
});
