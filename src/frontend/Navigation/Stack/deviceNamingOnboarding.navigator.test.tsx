import type {NavigationContainerRef} from '@react-navigation/native';
import type {AppStackParamsList} from '../../sharedTypes/navigation';

// Same reason as perfilOnboarding.navigator.test.tsx: the async publications
// this test waits on (the device-name mutation's `onSuccess`, the navigation
// reset) must run under React's act scheduler.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let mockNavigation: NavigationContainerRef<AppStackParamsList>;
jest.mock('../../../../tests/integration/helpers/navigation', () => {
  const {AppNavigator} = require('../../AppNavigator');
  return {
    MockedAppNavigator: () => {
      return (
        <AppNavigator
          navigationIntegration={{
            registerNavigationContainer: (ref: {
              current: NavigationContainerRef<AppStackParamsList>;
            }) => {
              mockNavigation = ref.current;
            },
          }}
        />
      );
    },
  };
});

import {fireEvent, screen} from '@testing-library/react-native';

// The full navigator module graph pulls in the app screens (MapScreen
// included) even though this suite never leaves the empty-document branch —
// stubbed exactly like perfilOnboarding.navigator.test.tsx does.
jest.mock('@maplibre/maplibre-react-native', () => {
  const React = require('react');
  const {View} = require('react-native');
  const Stub = (
    props: {children?: React.ReactNode} & Record<string, unknown>,
  ) => {
    const {children, ...rest} = props || {};
    return React.createElement(View, rest, children);
  };

  const LineJoin = {Round: 'round', Bevel: 'bevel', Miter: 'miter'};
  const LineCap = {Round: 'round', Butt: 'butt', Square: 'square'};

  return {
    __esModule: true,
    default: {
      MapView: Stub,
      Camera: Stub,
      UserLocation: Stub,
      ShapeSource: Stub,
      LineLayer: Stub,
      setAccessToken: jest.fn(),
      setTelemetryEnabled: jest.fn(),
    },
    MapView: Stub,
    Camera: Stub,
    MarkerView: Stub,
    UserLocation: Stub,
    LineJoin,
    LineCap,
  };
});

jest.mock('react-native-scale-bar', () => 'ScaleBar');

jest.mock('../../hooks/server/maps', () => ({
  useMapStyleJsonUrl: () => ({data: undefined}),
}));

jest.mock('../../hooks/useCurrentTime', () => ({
  useCurrentTime: () => new Date(),
}));

jest.mock('../../hooks/useStorageReadingQuery', () => {
  const LOW = 500 * 1024 * 1024;
  return {
    __esModule: true,
    LOW_THRESHOLD_BYTES: LOW,
    useStorageReadingQuery: () => ({
      data: {freeBytes: 64 * 1024 * 1024 * 1024, totalBytes: Infinity},
    }),
    isLowStorage: (free: number | null, threshold: number = LOW) =>
      (free ?? Infinity) <= threshold,
  };
});

jest.mock('../../hooks/server/presets', () => ({
  usePresetsQuery: () => ({data: []}),
}));

import {setupIntegrationTestWithoutProject} from '../../../../tests/integration/helpers/setupIntegrationTest';
import {deviceDiagnostics} from '../../metrics/deviceDiagnostics';

function nomesDasRotas(): string[] {
  return mockNavigation.getRootState()!.routes.map(route => route.name);
}

/**
 * B1 (#128 regression): a device with no name and an incomplete profile must
 * continue onto the ethnic-group flow after saving the device name, not jump
 * straight to Success — the create/join fork past Success turns `documento`
 * away from `nenhum`, so the profile step would never come back.
 */
describe('nomear o dispositivo com perfil incompleto (#128)', () => {
  // Empty name in the seeded device info represents the cold start before
  // DeviceNaming has ever run (routing treats a falsy name as "no name").
  const setup = setupIntegrationTestWithoutProject({
    deviceInfo: {name: '', deviceType: 'mobile'},
  });

  test('ao salvar o nome, o fluxo segue para EthnicGroupSelection (não Success)', async () => {
    const setEnabledSpy = jest.spyOn(deviceDiagnostics, 'setEnabled');

    await setup.renderNavigationAsync({userProfile: null});

    // Cold start: no device name routes to the intro, before the profile
    // fork is even reachable.
    expect(
      await screen.findByTestId('ONBOARDING.navigate-to-privacy-policy-btn'),
    ).toBeOnTheScreen();
    expect(nomesDasRotas()).toEqual(['IntroToCoMapeo']);

    await fireEvent.press(
      screen.getByTestId('ONBOARDING.navigate-to-privacy-policy-btn'),
    );
    await fireEvent.press(await screen.findByText('Next'));

    await fireEvent.changeText(
      await screen.findByTestId('ONBOARDING.device-name-inp'),
      'Dispositivo de teste',
    );
    await fireEvent.press(screen.getByTestId('ONBOARDING.add-name-btn'));

    expect(
      await screen.findByText('What is your ethnicity?'),
    ).toBeOnTheScreen();
    expect(nomesDasRotas()).toEqual(['EthnicGroupSelection']);

    // #P1 privacy: an opted-out diagnostics preference (jest.setup.js's
    // default `getDiagnosticsEnabled` mock) must be applied to the
    // long-lived collector on save, since navigation.reset doesn't restart
    // the app to pick it up on its own (see App.tsx's launch-time apply).
    expect(setEnabledSpy).toHaveBeenCalledWith(false);
  }, 30000);
});
