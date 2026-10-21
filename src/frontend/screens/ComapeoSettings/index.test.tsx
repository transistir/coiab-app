import {screen, userEvent} from '@testing-library/react-native';
import {
  setupIntegrationTest,
  semearDocumentoPronta,
} from '../../../../tests/integration/helpers/setupIntegrationTest';

describe('CoiabApp Settings Screen', () => {
  const integrationSetup = setupIntegrationTest();

  test('abre CoiabApp Settings pela aba Configurações (a entrada "CoiabApp Settings" saiu do Menu)', async () => {
    // Organization-first startup (SPEC 10.1): the persisted document, not the
    // core's project list, decides the initial route. Seed the ready
    // organization (ids of the CURRENT test manager) so this device opens
    // Home. Without this seed the suite is RED by design: the device lands
    // on the Success fork ("test is ready!") and never renders a header.
    semearDocumentoPronta(
      integrationSetup.projectId,
      integrationSetup.alertasProjectId,
      integrationSetup.orgId,
      integrationSetup.orgName,
    );
    const user = userEvent.setup();
    await integrationSetup.renderNavigation({
      activeProjectId: integrationSetup.projectId,
    });

    // A página de Menu não tem mais a entrada legada "CoiabApp Settings"
    // (remodelagem Entroncamento); o caminho é a engrenagem da tab bar.
    const settingsTab = await screen.findByTestId('tabBarButtonConfiguracoes');
    await expect(settingsTab).toBeVisible();
    await user.press(settingsTab);

    await expect(await screen.findByText('test')).toBeVisible();
    expect(screen.queryByText('NOT HERE')).toBeNull();
  });
});
