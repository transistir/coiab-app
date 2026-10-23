import {useFocusEffect} from '@react-navigation/native';
import {useCallback} from 'react';
import {BackHandler} from 'react-native';

export const usePreventAndroidBackButton = (enabled = true) => {
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;

      const onBackPress = () => true;

      const subscription = BackHandler.addEventListener(
        'hardwareBackPress',
        onBackPress,
      );

      return () => subscription.remove();
    }, [enabled]),
  );
};
