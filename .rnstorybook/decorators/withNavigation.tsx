import * as React from 'react';
import type {Decorator} from '@storybook/react-native';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';

/**
 * Navigation decorator - wraps a single screen component in NavigationContainer
 * + NativeStack.Navigator + NativeStack.Screen.
 *
 * Provides useNavigation(), useRoute(), useFocusEffect() context.
 * Accepts initial route params via story parameters.
 *
 * IMPORTANT: This bypasses RootStackNavigator entirely (no auth checks,
 * no device name checks, no ActiveProjectProvider). Screens that depend
 * on ActiveProjectProvider should use the fullApp decorator instead.
 */
export const withNavigation: Decorator = (Story, context) => {
  const Stack = createNativeStackNavigator();
  const params = context.parameters?.navigation?.params;
  const options = context.parameters?.navigation?.options ?? {
    headerShown: false,
  };

  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen
          name="StoryScreen"
          component={Story}
          initialParams={params}
          options={options}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
};
