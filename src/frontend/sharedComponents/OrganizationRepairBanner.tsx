import * as React from 'react';
import {StyleSheet, TouchableOpacity} from 'react-native';
import {defineMessages, useIntl} from 'react-intl';
import MaterialDesignIcons from '@react-native-vector-icons/material-design-icons';

import {BodyText} from './Text/BodyText';
import {BLUE_GREY, DARK_GREY, VERY_LIGHT_GREY} from '../lib/styles';
import {useOrganizations} from '../hooks/organization/useOrganizations';

const m = defineMessages({
  needsAttention: {
    id: '$1sharedComponents.OrganizationRepairBanner.needsAttention',
    defaultMessage: 'An Organization on this device needs attention',
  },
});

/**
 * SPEC 10.1 in a MIXED state: with one Organization ready and another
 * incomplete or invalid, the startup gate lands on Home — and the degraded
 * one would have no surface at all. This is its entry point: the repair
 * screen stays one tap away instead of being reachable only while nothing
 * else works.
 */
export function OrganizationRepairBanner({onPress}: {onPress: () => void}) {
  const {formatMessage} = useIntl();
  const organizations = useOrganizations();

  if (organizations.every(org => org.state === 'ready')) return null;

  return (
    <TouchableOpacity
      testID="HOME.org-repair-btn"
      style={styles.banner}
      accessibilityRole="button"
      onPress={onPress}>
      <MaterialDesignIcons
        name="alert-circle-outline"
        size={20}
        color={DARK_GREY}
      />
      <BodyText style={styles.text}>{formatMessage(m.needsAttention)}</BodyText>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    backgroundColor: VERY_LIGHT_GREY,
    borderBottomWidth: 1,
    borderBottomColor: BLUE_GREY,
  },
  text: {
    flexShrink: 1,
    color: DARK_GREY,
  },
});
