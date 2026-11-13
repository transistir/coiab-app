import {useHomeTabsHarness} from './homeTabsHarness';

import {StackActions} from '@react-navigation/native';
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
  // Último do suite por um motivo real: o navigate encaixado da câmera
  // (rota de aba via navigation ref) deixa o PreventRemoveProvider do
  // react-navigation com remoção pendente no worker sob jest, e o PRÓXIMO
  // mount do navigator fica pêndulo para sempre (nenhuma aba renderiza).
  // Cobertura da câmera intacta; o efeito morre junto com o worker.
  test('a criação de observação continua acessível e a rota Camera não sumiu', async () => {
    await h.renderHomeTabs();
    const user = userEvent.setup();

    // Fluxo atual de criação: o "+" do mapa continua navegando.
    await user.press(await screen.findByTestId('tabBarButtonMap'));
    await user.press(await screen.findByTestId('MAIN.add-observation-btn'));
    expect(await screen.findByTestId('STUB.category-chooser')).toBeTruthy();

    // A rota Camera segue registrada e montável dentro das home tabs.
    // Volta ao Home existente como o app faz (ObservationCreateSaveButton):
    // `navigate('Home')` com o seletor no topo empilharia um SEGUNDO Home
    // (react-navigation 7 só reaproveita a rota se ela for a atual).
    act(() => {
      h.navigation.dispatch(StackActions.popTo('Home', {screen: 'Camera'}));
    });
    await waitFor(() =>
      expect(h.navigation.getCurrentRoute()?.name).toBe('Camera'),
    );
    expect(
      (h.navigation.getRootState()?.routes ?? []).map(r => r.name),
    ).toEqual(['Home']);
    expect(await screen.findByTestId('MAIN.camera-scrn')).toBeTruthy();
    expect(screen.queryByTestId('MENU.conteudo')).toBeNull();
  });
});
