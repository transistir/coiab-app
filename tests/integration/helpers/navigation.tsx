import {AppNavigator} from '../../../src/frontend/AppNavigator';

type MockedAppNavigatorProps = {
  permissionAsked?: boolean;
};

export const MockedAppNavigator = (_props: MockedAppNavigatorProps = {}) => {
  return <AppNavigator navigationIntegration={undefined} />;
};
