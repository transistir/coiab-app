import type {InitialState} from '@react-navigation/native';
import type {Meta, StoryObj} from '@storybook/react-native';
import {withRealNavigator} from '../../../.rnstorybook/decorators/withRealNavigator';
import {FLOW_STATES} from '../../../.rnstorybook/utils/flowState';

/**
 * The real navigator renders the journey; this placeholder only satisfies
 * Storybook's component requirement.
 */
const NoStoryComponent = () => null;

const meta = {
  title: 'Flows/Settings',
  component: NoStoryComponent,
  decorators: [withRealNavigator],
} satisfies Meta<typeof NoStoryComponent>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * An onboarded device with an active project and no in-progress
 * observation draft. None of the Settings screens read draft-observation
 * state, but an explicit `'none'` keeps the seeded state deterministic
 * regardless of what a prior story in the merged manifest left behind.
 */
const onboardedNoDraft = {
  ...FLOW_STATES.onboardedWithData,
  draftObservation: 'none' as const,
};

const homeMapState: InitialState = {
  routes: [
    {
      name: 'Home',
      state: {
        routes: [{name: 'Map'}],
        index: 0,
      },
    },
  ],
  index: 0,
};

/**
 * The Settings home screen's real registered route name is `AppSettings`
 * (see `src/frontend/Navigation/Stack/AppScreens.tsx`); `RootStackParamsList`
 * also declares an unused `Settings` key that is never registered as a
 * screen and is not navigable.
 */
const settingsState: InitialState = {
  routes: [homeMapState.routes[0]!, {name: 'AppSettings'}],
  index: 1,
};

const deviceNameDisplayState: InitialState = {
  routes: [...settingsState.routes, {name: 'DeviceNameDisplay'}],
  index: 2,
};

const deviceNameEditState: InitialState = {
  routes: [...deviceNameDisplayState.routes, {name: 'DeviceNameEdit'}],
  index: 3,
};

const languageState: InitialState = {
  routes: [...settingsState.routes, {name: 'LanguageSettings'}],
  index: 2,
};

const coordinateFormatState: InitialState = {
  routes: [...settingsState.routes, {name: 'CoordinateFormat'}],
  index: 2,
};

const unitSystemState: InitialState = {
  routes: [...settingsState.routes, {name: 'UnitSystemSettings'}],
  index: 2,
};

const securityState: InitialState = {
  routes: [...settingsState.routes, {name: 'Security'}],
  index: 2,
};

const appPasscodeState: InitialState = {
  routes: [...securityState.routes, {name: 'AppPasscode'}],
  index: 3,
};

const setPasscodeState: InitialState = {
  routes: [...appPasscodeState.routes, {name: 'SetPasscode'}],
  index: 4,
};

/**
 * `ObscurePasscode`'s rendered content (see the screen source) does not
 * branch on whether a passcode is actually set — only the Security screen's
 * tap handler does, gating navigation to this route on `passcodeSet`. This
 * story pushes the route directly, so it doesn't need a seeded passcode.
 */
const obscurePasscodeState: InitialState = {
  routes: [...securityState.routes, {name: 'ObscurePasscode'}],
  index: 3,
};

const earlyAccessState: InitialState = {
  routes: [...settingsState.routes, {name: 'EarlyAccess'}],
  index: 2,
};

const dataAndPrivacyState: InitialState = {
  routes: [...settingsState.routes, {name: 'DataAndPrivacy'}],
  index: 2,
};

const privacyPolicyState: InitialState = {
  routes: [...dataAndPrivacyState.routes, {name: 'SettingsPrivacyPolicy'}],
  index: 3,
};

const aboutState: InitialState = {
  routes: [...settingsState.routes, {name: 'AboutSettings'}],
  index: 2,
};

/**
 * The full settings journey, starting at the map. `CreateTestData` is
 * skipped throughout this flow: it's gated behind
 * `EXPO_PUBLIC_FEATURE_TEST_DATA_UI` and only exists for local dev seeding,
 * not a screen QA needs to review.
 */
export const Walkthrough: Story = {
  parameters: {
    flow: {state: onboardedNoDraft},
  },
};

/** The Settings home screen, reached from the map. */
export const SettingsHome: Story = {
  name: '01 Settings Home',
  parameters: {
    flow: {state: onboardedNoDraft, initialState: settingsState},
  },
};

/** The device name display screen, reached from the Settings home row. */
export const DeviceNameDisplay: Story = {
  name: '02 Device Name Display',
  parameters: {
    flow: {state: onboardedNoDraft, initialState: deviceNameDisplayState},
  },
};

/** The device name edit form, reached from its edit icon. */
export const DeviceNameEdit: Story = {
  name: '03 Device Name Edit',
  parameters: {
    flow: {state: onboardedNoDraft, initialState: deviceNameEditState},
  },
};

/** The language picker, listing the current language and all alternatives. */
export const Language: Story = {
  name: '04 Language',
  parameters: {
    flow: {state: onboardedNoDraft, initialState: languageState},
  },
};

/**
 * The coordinate format picker with live-formatted examples.
 *
 * Not byte-stable across runs: the examples are formatted from
 * `useLastKnownLocation`, falling back to a hardcoded `EXAMPLE_LOCATION`
 * only when no fix is available — so a runner with a GPS fix and one
 * without produce different frames. Compare this frame by eye, not by size.
 */
export const CoordinateFormat: Story = {
  name: '05 Coordinate Format',
  parameters: {
    flow: {state: onboardedNoDraft, initialState: coordinateFormatState},
  },
};

/** The unit system picker (metric/imperial). */
export const UnitSystem: Story = {
  name: '06 Unit System',
  parameters: {
    flow: {state: onboardedNoDraft, initialState: unitSystemState},
  },
};

/**
 * The Security menu in its default state: no passcode set yet, so Obscure
 * Passcode shows as unavailable.
 */
export const Security: Story = {
  name: '07 Security',
  parameters: {
    flow: {state: onboardedNoDraft, initialState: securityState},
  },
};

/** The App Passcode explainer, reached from Security when no passcode is set. */
export const AppPasscode: Story = {
  name: '08 App Passcode',
  parameters: {
    flow: {state: onboardedNoDraft, initialState: appPasscodeState},
  },
};

/** The first step of setting a new passcode. */
export const SetPasscode: Story = {
  name: '09 Set Passcode',
  parameters: {
    flow: {state: onboardedNoDraft, initialState: setPasscodeState},
  },
};

/** The Obscure Passcode explainer and toggle, in its default (off) state. */
export const ObscurePasscode: Story = {
  name: '10 Obscure Passcode',
  parameters: {
    flow: {state: onboardedNoDraft, initialState: obscurePasscodeState},
  },
};

/** The Early Access toggle, in its default (off) state. */
export const EarlyAccess: Story = {
  name: '11 Early Access',
  parameters: {
    flow: {state: onboardedNoDraft, initialState: earlyAccessState},
  },
};

/** The Data & Privacy screen, including diagnostics and app-usage toggles. */
export const DataAndPrivacy: Story = {
  name: '12 Data And Privacy',
  parameters: {
    flow: {state: onboardedNoDraft, initialState: dataAndPrivacyState},
  },
};

/** The privacy-policy screen reached from Data & Privacy's Learn More link. */
export const PrivacyPolicy: Story = {
  name: '13 Privacy Policy',
  parameters: {
    flow: {state: onboardedNoDraft, initialState: privacyPolicyState},
  },
};

/**
 * The About CoMapeo screen with device/build info and app links.
 *
 * Not byte-stable across runs: the version, build number, Android build id
 * and phone model come from native device-info modules, so they differ
 * between emulator images and between app builds. Compare this frame by
 * eye, not by size.
 */
export const About: Story = {
  name: '14 About',
  parameters: {
    flow: {state: onboardedNoDraft, initialState: aboutState},
  },
};
