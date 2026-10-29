import * as React from 'react';
import {Image, StyleSheet, TouchableOpacity, View} from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';

import {COIAB_BEIGE} from '../../lib/styles';

type OnboardingCompactHeaderProps = {
  onBack?: () => void;
  backLabel?: string;
  backTestID?: string;
};

/**
 * Compact onboarding header (Figma `2708:3381`): the back action on the left
 * and the "EKANÃDYBY" wordmark (76x33) centered. The wordmark is the bundled
 * image — League Spartan Bold is not in the bundle, so the asset carries the
 * type. Safe-area inset is applied once by the screen container, never here.
 */
export const OnboardingCompactHeader = ({
  onBack,
  backLabel,
  backTestID,
}: OnboardingCompactHeaderProps) => {
  return (
    <View style={styles.header}>
      {onBack ? (
        <TouchableOpacity
          testID={backTestID}
          accessibilityRole="button"
          accessibilityLabel={backLabel}
          onPress={onBack}
          style={styles.backButton}
          hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color={COIAB_BEIGE} />
        </TouchableOpacity>
      ) : (
        <View style={styles.backButton} />
      )}
      <Image
        source={require('../../images/ekanadyby-wordmark.png')}
        style={styles.logo}
        resizeMode="contain"
        accessibilityLabel="Ekanadyby"
      />
      <View style={styles.backButton} />
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 16,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 76,
    height: 33,
  },
});
