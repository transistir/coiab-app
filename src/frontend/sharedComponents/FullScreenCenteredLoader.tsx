import * as React from 'react';
import {View, StyleSheet} from 'react-native';
import {LoadingIndicator} from './LoadingIndicator';
import {HeaderText} from './Text/HeaderText';

/**
 * SPEC A §6.2 row 1 ("Registro/core carregando"): the loading window carries
 * its canonical copy ("Carregando organização…") through `label`; without
 * one this stays the bare spinner every Suspense boundary already shows.
 */
export const FullScreenCenteredLoader = ({label}: {label?: string}) => (
  <View style={styles.root}>
    <LoadingIndicator />
    {label ? (
      <HeaderText variant="header4" style={styles.label}>
        {label}
      </HeaderText>
    ) : null}
  </View>
);

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  label: {
    textAlign: 'center',
    marginTop: 12,
  },
});
