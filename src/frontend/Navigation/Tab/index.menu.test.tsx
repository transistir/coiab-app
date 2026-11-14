import {useHomeTabsHarness} from './homeTabsHarness';

import {act, screen, userEvent, waitFor} from '@testing-library/react-native';

// Second half of the HomeTabs navigator suite (see index.test.tsx): the
// split keeps each jest worker's navigator footprint small.
describe('HomeTabs — menu, download e câmera (#32)', () => {
  const h = useHomeTabsHarness();

  test('o conteúdo do menu monta uma única vez (#118)', async () => {
    await h.renderHomeTabs();
    const user = userEvent.setup();

    // No código antigo isso abria a gaveta; no novo não existe o botão de
    // menu em nenhum header — o conteúdo só é alcançado pela tab Menu.
    await user.press(await screen.findByTestId('tabBarButtonMenu'));

    // A página de Menu é a única superfície com o conteúdo (cartão,
    // itens e botão Exchange) — sem a cópia da drawer do CoMapeo.
    const copias = await screen.findAllByTestId('MENU.main-action-button', {
      includeHiddenElements: true,
    });
    expect(copias).toHaveLength(1);
  });

  test('o download do Paneiro segue funcionando sem o drawer (#118)', async () => {
    // Proteção contra regressão do headerRight durante a reescrita do
    // HomeHeader: passa antes e depois, sem RED (registrado no PR).
    await h.renderHomeTabs();
    const user = userEvent.setup();

    await user.press(await screen.findByTestId('tabBarButtonPaneiro'));
    // Sem observação nem trilha, o botão de download não existe.
    expect(screen.queryByLabelText('Download Observations')).toBeNull();
  });
  test('o download do Paneiro leva ao ExportObservations com observação (#118)', async () => {
    // Proteção contra regressão (sem RED): observação real criada na sessão
    // do core ANTES do render — a query do useObservations resolve com ela.
    const projectApi = await h.client.getProject(h.projectId);
    await projectApi.observation.create({
      schemaName: 'observation',
      lat: 12,
      lon: 34,
      attachments: [],
      tags: {},
    });
    await h.renderHomeTabs();
    const user = userEvent.setup();

    await user.press(await screen.findByTestId('tabBarButtonPaneiro'));

    const download = await screen.findByLabelText('Download Observations');
    await user.press(download);

    expect(h.navigation.getCurrentRoute()?.name).toBe('ExportObservations');
  });
  // O `act` do navigate abaixo PRECISA de await: no RNTL 14 o `act` é sempre
  // assíncrono e, sem await, o escopo de act do React nunca fecha. Com o
  // escopo aberto nenhum render() ou unmount() posterior do arquivo comita
  // (era esse o "próximo mount pêndulo, nenhuma aba renderiza" antes
  // atribuído ao PreventRemoveProvider) e o unmount do teardown não desmonta
  // a árvore, que sobrevive ao fechamento do cliente IPC e estoura
  // `ClientClosed` (no cleanup do ClientApiProvider) em outro arquivo do
  // mesmo worker.
  test('a criação de observação continua acessível e a rota Camera não sumiu', async () => {
    await h.renderHomeTabs();
    const user = userEvent.setup();

    // Fluxo atual de criação: o "+" do mapa continua navegando.
    await user.press(await screen.findByTestId('tabBarButtonMap'));
    await user.press(await screen.findByTestId('MAIN.add-observation-btn'));
    expect(await screen.findByTestId('STUB.category-chooser')).toBeTruthy();

    // `Camera` vive na stack do Home (HomeTabsParamsList), não no tab
    // navigator. No react-navigation 7, `navigate` sem `pop` empilha outro
    // Home; `pop: true` reusa o existente e aplica o seletor aninhado.
    await act(() => {
      h.navigation.navigate('Home', {screen: 'Camera'}, {pop: true});
    });
    await waitFor(() =>
      expect(h.navigation.getCurrentRoute()?.name).toBe('Camera'),
    );
    // A câmera não tem atalho na navbar por decisão de produto (owner): o
    // acesso vive no fluxo de criação, coberto acima. O que este teste
    // protege depois do merge é que a rota `Camera` continua registrada e
    // alcançável — o `getCurrentRoute()` acima só retorna 'Camera' se a
    // screen existir no navigator. `CameraScreen` monta `CameraView` apenas
    // com `useIsFocused()` verdadeiro, e a navegação programática do
    // harness não emite foco para essa cena.
  });
});
