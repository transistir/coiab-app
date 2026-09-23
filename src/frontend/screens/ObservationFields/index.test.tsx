import path from 'path';
import {screen, userEvent, fireEvent} from '@testing-library/react-native';
import {
  setupIntegrationTest,
  semearDocumentoPronta,
} from '../../../../tests/integration/helpers/setupIntegrationTest';
import {MMKVStoreInitializer} from '../../hooks/persistedState/createPersistedState';

const DEFAULT_CONFIG_PATH = path.join(
  __dirname,
  '../../../../tests/assets/comapeo-categories-devtest.comapeocat',
);

/** The fields the seeding needs from a `setupIntegrationTest()` handle. */
type OrganizationSeedSetup = {
  readonly projectId: string;
  readonly alertasProjectId: string;
  readonly orgId: string;
  readonly orgName: string;
};

/**
 * Organization-first startup (SPEC 10.1): the persisted document, not the
 * core's project list, decides the initial route. Registers a beforeEach
 * that seeds the ready organization document with the CURRENT test
 * manager's ids, so the device opens Home. Without this seed the suite is
 * RED by design: the device lands on the Success fork ("test is ready!")
 * and never mounts Home.
 *
 * The hook also clears the persisted work stores ('@MapeoDraftStore',
 * 'MapeoTrack'): these suites NAVIGATE, so an earlier test can leave a
 * draft/tracking origin in the mock MMKV (it persists per file, like real
 * MMKV). That leftover is genuine work in progress from a DEAD manager —
 * the activation engine's pending-work guard then fails every following
 * startup onto the recovery surface (proven by the probe: seeding alone
 * left tests 2+ RED; clearing the draft alongside the seed turned them
 * GREEN). These suites assert ordinary navigation, not work recovery.
 */
function seedOrganizationBeforeEach(
  integrationSetup: OrganizationSeedSetup,
): void {
  beforeEach(() => {
    MMKVStoreInitializer.removeItem('@MapeoDraftStore');
    MMKVStoreInitializer.removeItem('MapeoTrack');
    semearDocumentoPronta(
      integrationSetup.projectId,
      integrationSetup.alertasProjectId,
      integrationSetup.orgId,
      integrationSetup.orgName,
    );
  });
}

describe('Observation Fields', () => {
  describe('TextArea field', () => {
    const integrationSetup = setupIntegrationTest();
    seedOrganizationBeforeEach(integrationSetup);

    async function navigateToTextField(
      user: ReturnType<typeof userEvent.setup>,
    ) {
      const project = await integrationSetup.manager.getProject(
        integrationSetup.projectId,
      );
      await project.$importCategories({filePath: DEFAULT_CONFIG_PATH});

      await integrationSetup.renderNavigation({
        activeProjectId: integrationSetup.projectId,
      });

      // I/O-bound waits under load (the JoinProjectIntro /
      // index.navigator.test.tsx precedent, same class as 'correct back
      // button behaviour' below): measured live — Home held an
      // ActivityIndicator past the 1000 ms default while the organization
      // gate and project queries resolved, failing this helper's findBy.
      await user.press(
        await screen.findByTestId('MAIN.add-observation-btn', undefined, {
          timeout: 15_000,
        }),
      );
      // category set in assets folder has a category "Comprehensive Test" with all fields
      await user.press(
        await screen.findByText('Comprehensive Test', undefined, {
          timeout: 15_000,
        }),
      );
      await user.press(await screen.findByText('Details'));
    }
    test('expects text value to change on screen, and remain when navigated back', async () => {
      const user = userEvent.setup();
      await navigateToTextField(user);
      const textInput = await screen.findByTestId('OBS.text-inp');
      await fireEvent.changeText(textInput, 'hello');
      expect(textInput).toHaveDisplayValue('hello');

      await user.press(await screen.findByTestId('MAIN.header-back-btn'));
      await user.press(await screen.findByText('Details'));

      expect(await screen.findByTestId('OBS.text-inp')).toHaveDisplayValue(
        'hello',
      );
    }, 30_000);

    test('renders empty when tagValue is undefined/null', async () => {
      const user = userEvent.setup();
      await navigateToTextField(user);
      const textInput = await screen.findByTestId('OBS.text-inp');
      // Deliberately passing a non-string to test how the field handles bad input.
      await fireEvent.changeText(textInput, null as unknown as string);

      expect(textInput).toHaveDisplayValue('');
    }, 30_000);

    test('renders empty when tagValue is not a string', async () => {
      const user = userEvent.setup();
      await navigateToTextField(user);
      const textInput = await screen.findByTestId('OBS.text-inp');
      // Deliberately passing a non-string to test how the field handles bad input.
      await fireEvent.changeText(textInput, {foo: 'bar'} as unknown as string);

      expect(textInput).toHaveDisplayValue('');
    }, 30_000);

    test('calls updateTag with empty string when cleared', async () => {
      const user = userEvent.setup();
      await navigateToTextField(user);
      const textInput = await screen.findByTestId('OBS.text-inp');
      await fireEvent.changeText(textInput, 'some text');
      expect(textInput).toHaveDisplayValue('some text');
      await fireEvent.changeText(textInput, '');

      expect(textInput).toHaveDisplayValue('');
    }, 30_000);
  });

  describe('Number Fields', () => {
    const integrationSetup = setupIntegrationTest();
    seedOrganizationBeforeEach(integrationSetup);

    async function navigateToTextField(
      user: ReturnType<typeof userEvent.setup>,
    ) {
      const project = await integrationSetup.manager.getProject(
        integrationSetup.projectId,
      );
      await project.$importCategories({filePath: DEFAULT_CONFIG_PATH});

      await integrationSetup.renderNavigation({
        activeProjectId: integrationSetup.projectId,
      });

      // Same I/O-bound waits as the TextArea helper (organization gate +
      // categories query): the 1000 ms default is insufficient under load.
      await user.press(
        await screen.findByTestId('MAIN.add-observation-btn', undefined, {
          timeout: 15_000,
        }),
      );
      // category set in assets folder has a category "Comprehensive Test" with all fields
      await user.press(
        await screen.findByText('Comprehensive Test', undefined, {
          timeout: 15_000,
        }),
      );
      await user.press(await screen.findByText('Details'));
      await user.press(await screen.findByText('Next'));
    }

    test('expects number value to change on screen, and remain when navigated back', async () => {
      const user = userEvent.setup();
      await navigateToTextField(user);
      const numberInput = await screen.findByTestId('OBS.number-inp');
      await fireEvent.changeText(numberInput, '1.23');
      expect(numberInput).toHaveDisplayValue('1.23');

      await user.press(await screen.findByTestId('MAIN.header-back-btn'));
      await user.press(await screen.findByTestId('MAIN.header-back-btn'));
      await user.press(await screen.findByText('Details'));
      await user.press(await screen.findByText('Next'));

      expect(await screen.findByTestId('OBS.number-inp')).toHaveDisplayValue(
        '1.23',
      );
    }, 30_000);

    test('sanitizes numbers properly', async () => {
      const user = userEvent.setup();
      await navigateToTextField(user);
      const numberInput = await screen.findByTestId('OBS.number-inp');
      await fireEvent.changeText(numberInput, '-');
      expect(numberInput).toHaveDisplayValue('-');
      await fireEvent.changeText(numberInput, '-08');
      expect(numberInput).toHaveDisplayValue('-8');
      await fireEvent.changeText(numberInput, '1.2.34');
      expect(numberInput).toHaveDisplayValue('1.234');
      await fireEvent.changeText(numberInput, '-0');
      expect(numberInput).toHaveDisplayValue('-0');

      //should save -0 as 0
      await user.press(await screen.findByTestId('MAIN.header-back-btn'));
      await user.press(await screen.findByTestId('MAIN.header-back-btn'));
      await user.press(await screen.findByText('Details'));
      await user.press(await screen.findByText('Next'));

      expect(await screen.findByTestId('OBS.number-inp')).toHaveDisplayValue(
        '0',
      );
    }, 30_000);
  });

  describe('Select one', () => {
    const integrationSetup = setupIntegrationTest();
    seedOrganizationBeforeEach(integrationSetup);

    async function navigateToSelectOne(
      user: ReturnType<typeof userEvent.setup>,
    ) {
      const project = await integrationSetup.manager.getProject(
        integrationSetup.projectId,
      );
      await project.$importCategories({filePath: DEFAULT_CONFIG_PATH});

      await integrationSetup.renderNavigation({
        activeProjectId: integrationSetup.projectId,
      });

      // Same I/O-bound waits as the TextArea helper (organization gate +
      // categories query): the 1000 ms default is insufficient under load.
      await user.press(
        await screen.findByTestId('MAIN.add-observation-btn', undefined, {
          timeout: 15_000,
        }),
      );
      // category set in assets folder has a category "Comprehensive Test" with all fields
      await user.press(
        await screen.findByText('Comprehensive Test', undefined, {
          timeout: 15_000,
        }),
      );
      await user.press(await screen.findByText('Details'));
      await user.press(await screen.findByText('Next'));
      await user.press(await screen.findByText('Next'));
    }

    test('expects select one to be visible and is able to select', async () => {
      const user = userEvent.setup();
      await navigateToSelectOne(user);
      const optionExpected = await screen.findByText('Expected');
      await user.press(optionExpected);
      const inputExpected = await screen.findByTestId(
        'OBS.select-one-inp-Expected',
      );
      expect(inputExpected).toBeChecked();
      const inputUnusual = await screen.findByTestId(
        'OBS.select-one-inp-Unusual',
      );
      expect(inputUnusual).not.toBeChecked();
      const optionUnusual = await screen.findByText('Unusual');
      await user.press(optionUnusual);
      expect(inputExpected).not.toBeChecked();
      expect(inputUnusual).toBeChecked();
    }, 30_000);
  });

  describe('Select Multiple', () => {
    const integrationSetup = setupIntegrationTest();
    seedOrganizationBeforeEach(integrationSetup);

    async function navigateToSelectMultiple(
      user: ReturnType<typeof userEvent.setup>,
    ) {
      const project = await integrationSetup.manager.getProject(
        integrationSetup.projectId,
      );
      await project.$importCategories({filePath: DEFAULT_CONFIG_PATH});

      await integrationSetup.renderNavigation({
        activeProjectId: integrationSetup.projectId,
      });

      // Same I/O-bound waits as the TextArea helper (organization gate +
      // categories query): the 1000 ms default is insufficient under load.
      await user.press(
        await screen.findByTestId('MAIN.add-observation-btn', undefined, {
          timeout: 15_000,
        }),
      );
      // category set in assets folder has a category "Comprehensive Test" with all fields
      await user.press(
        await screen.findByText('Comprehensive Test', undefined, {
          timeout: 15_000,
        }),
      );
      await user.press(await screen.findByText('Details'));
      await user.press(await screen.findByText('Next'));
      await user.press(await screen.findByText('Next'));
      await user.press(await screen.findByText('Next'));
    }

    test('expects select one to be visible and is able to select', async () => {
      const user = userEvent.setup();
      await navigateToSelectMultiple(user);
      const optionHistory = await screen.findByText('History');

      await user.press(optionHistory);
      const inputHistory = await screen.findByTestId(
        'OBS.select-multiple-inp-History',
      );
      const inputMythology = await screen.findByTestId(
        'OBS.select-multiple-inp-Mythology',
      );
      expect(inputHistory).toBeSelected();
      expect(inputMythology).not.toBeSelected();

      const optionMythology = await screen.findByText('Mythology');
      await user.press(optionMythology);

      //expect both to still be selected
      expect(inputHistory).toBeSelected();
      expect(inputMythology).toBeSelected();
    }, 30_000);
  });

  describe('navigates in and out of the observation fields', () => {
    const integrationSetup = setupIntegrationTest();
    seedOrganizationBeforeEach(integrationSetup);

    async function navigateToObservationDetails(
      user: ReturnType<typeof userEvent.setup>,
    ) {
      const project = await integrationSetup.manager.getProject(
        integrationSetup.projectId,
      );
      await project.$importCategories({filePath: DEFAULT_CONFIG_PATH});

      await integrationSetup.renderNavigation({
        activeProjectId: integrationSetup.projectId,
      });

      // I/O-bound waits under load (the JoinProjectIntro /
      // index.navigator.test.tsx precedent): the create-observation button
      // renders once Home clears the organization gate (persisted document
      // + project queries), and 'Comprehensive Test' renders only after
      // the categories query refetches the core after the import. The
      // 1000 ms defaults broke this case under 3-worker load.
      await user.press(
        await screen.findByTestId('MAIN.add-observation-btn', undefined, {
          timeout: 15_000,
        }),
      );
      // category set in assets folder has a category "Comprehensive Test" with all fields
      await user.press(
        await screen.findByText('Comprehensive Test', undefined, {
          timeout: 15_000,
        }),
      );
      await user.press(await screen.findByText('Details'));
    }

    // Real I/O on this test's budget: the beforeEach boots a real core
    // (manager + IPC + fastify + two project creations), the body imports
    // the .comapeocat from disk and walks four navigation round-trips —
    // measured 4154 ms under 3-worker load against jest's default 5000 ms
    // test timeout (the JoinProjectIntro precedent). The budget only
    // bounds the wait: an element that never renders still fails the test.
    test('correct back button behaviour', async () => {
      const user = userEvent.setup();
      await navigateToObservationDetails(user);
      // first details screen
      expect(await screen.findByText('Field test details')).toBeVisible();
      const backHeaderButton = await screen.findByTestId(
        'MAIN.header-back-btn',
      );
      await user.press(backHeaderButton);
      //should go back to observation create screen
      const createObservationScreen =
        await screen.findByTestId('OBS.create-obs');
      expect(createObservationScreen).toBeOnTheScreen();

      //second detail screen
      const detailsButton = await screen.findByText('Details');
      await user.press(detailsButton);
      await user.press(await screen.findByText('Next'));
      expect(await screen.findByText('Measurement Value')).toBeVisible();

      //should go back to first detail screen
      await user.press(await screen.findByTestId('MAIN.header-back-btn'));
      expect(await screen.findByText('Field test details')).toBeVisible();

      //third detail screen
      await user.press(await screen.findByText('Next'));
      await user.press(await screen.findByText('Next'));
      expect(await screen.findByText('Conditions')).toBeVisible();

      //should go back to second detail screen
      await user.press(await screen.findByTestId('MAIN.header-back-btn'));
      expect(await screen.findByText('Measurement Value')).toBeVisible();

      //4th detail screen
      await user.press(await screen.findByText('Next'));
      await user.press(await screen.findByText('Next'));
      expect(await screen.findByText('Cultural activity')).toBeVisible();

      //should go back to 3rd detal
      await user.press(await screen.findByTestId('MAIN.header-back-btn'));
      expect(await screen.findByText('Conditions')).toBeVisible();

      //go back to 4th detail screen
      await user.press(await screen.findByText('Next'));
      const doneButton = await screen.findByText('Done');
      expect(doneButton).toBeVisible();

      //should navigate back to create observation screen when done clicked
      await user.press(doneButton);
      expect(await screen.findByTestId('OBS.create-obs')).toBeVisible();
    }, 30_000);
  });
});
