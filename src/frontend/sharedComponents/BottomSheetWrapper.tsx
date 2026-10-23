import * as React from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import Animated, {SlideInDown, SlideOutDown} from 'react-native-reanimated';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {WHITE} from '../lib/styles';
import {useNavigation} from '@react-navigation/native';
import {usePreventAndroidBackButton} from '../hooks/usePreventAndroidBackButton';

/**
 *
 * @description A wrapper component that should be used for bottom sheets. It will handle the animation and prevent the back button from closing the bottom sheet.
 *
 * When pushing a bottom sheet ontop of another bottom sheet use `navigation.replace`, to close the original bottom sheet first. A `replace` (like a `reset`) removes the sheet immediately, without the exit animation.
 *
 * Pressing the scrim (the area outside the sheet content) closes the sheet with
 * `navigation.goBack()` only when the sheet opts in with `dismissable`. Dismissal
 * is opt-in because some sheets must not be abandoned by a stray tap (e.g. a
 * pending operation whose only exit is a programmatic navigation).
 *
 * The Android back button is governed by `closeOnBackButtonPress` alone:
 * leaving it unset blocks hardware back (the upstream default), while
 * `closeOnBackButtonPress` lets the navigator handle it. `dismissable` only
 * controls the scrim and the iOS accessibility escape — it never changes the
 * back-button behavior. Hardware back is also inert while the sheet animates
 * out, so a second press cannot race the exit.
 */
export const BottomSheetWrapper = ({
  children,
  closeOnBackButtonPress,
  dismissable = false,
}: {
  children: React.ReactNode;
  closeOnBackButtonPress?: boolean;
  dismissable?: boolean;
}) => {
  return (
    <AnimateBottomSheetContainer
      dismissable={dismissable}
      preventBackButtonPress={!closeOnBackButtonPress}>
      {children}
    </AnimateBottomSheetContainer>
  );
};

const AnimateBottomSheetContainer = ({
  children,
  dismissable,
  preventBackButtonPress,
}: {
  children: React.ReactNode;
  dismissable: boolean;
  preventBackButtonPress: boolean;
}) => {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  const [displayContent, setDisplayContent] = React.useState(true);

  // Back is also blocked while the sheet animates out, same as the scrim:
  // `displayContent` goes false before the exit window ends.
  usePreventAndroidBackButton(preventBackButtonPress || !displayContent);

  // This effect is used to prevent the bottom sheet from being removed before
  // the animation is complete. RESET and REPLACE are the exception and pass
  // through untouched (every other removing action is still delayed):
  // preventing and re-dispatching them races unmount and can swallow the
  // navigation entirely (e.g. the post-accept reset that leaves an invite
  // sheet). They skip the exit animation.
  React.useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', e => {
      const actionType = e.data.action.type;
      if (actionType === 'RESET' || actionType === 'REPLACE') return;

      e.preventDefault();
      setDisplayContent(false);
      setTimeout(() => {
        navigation.dispatch(e.data.action);
      }, 140);
    });

    return () => {
      unsubscribe();
    };
  }, [navigation]);

  return (
    <View
      accessibilityViewIsModal
      onAccessibilityEscape={
        dismissable && displayContent ? () => navigation.goBack() : undefined
      }
      style={{
        flex: 1,
        justifyContent: 'flex-end',
        backgroundColor: 'rgba(0, 0, 0, 0.1)',
      }}>
      {/* The scrim is a sibling BELOW the sheet (rendered first): a touch on
          the sheet content never reaches it — only the exposed area closes
          the sheet. */}
      <Pressable
        testID="SHEET.backdrop"
        style={StyleSheet.absoluteFill}
        accessible={false}
        importantForAccessibility="no"
        onPress={
          dismissable && displayContent ? () => navigation.goBack() : undefined
        }
      />
      {displayContent && (
        <Animated.View
          style={{
            backgroundColor: WHITE,
            paddingHorizontal: 20,
            paddingTop: 40,
            paddingBottom: 20 + insets.bottom,
            borderTopLeftRadius: 10,
            borderTopRightRadius: 10,
            flexShrink: 1,
          }}
          entering={SlideInDown.duration(150)}
          exiting={SlideOutDown.duration(150)}>
          {children}
        </Animated.View>
      )}
    </View>
  );
};
