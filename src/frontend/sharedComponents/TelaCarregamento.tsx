import * as React from 'react';
import {StatusBar, StyleSheet, View} from 'react-native';

import {LoadingIndicator} from './LoadingIndicator';
import {HeaderText} from './Text/HeaderText';
import {DARK_GREY, WHITE} from '../lib/styles';

/**
 * Issue #118 (Fase C, ciclo 4): a tela de carregamento no tema escuro do
 * Figma — fundo DARK_GREY, spinner e rótulo em branco. O override do owner
 * veta qualquer imagem: só fundo + spinner + rótulo textual.
 *
 * A barra de status vai para 'light-content' via o StatusBar ESTÁTICO (não o
 * componente `<StatusBar barStyle=...>`): no iOS com
 * UIViewControllerBasedStatusBarAppearance a prop é ignorada, e no Android o
 * unmount devolveria a 'default' em vez do 'dark-content' anterior.
 */
export const TelaCarregamento = ({label}: {label?: string}) => {
  React.useEffect(() => {
    StatusBar.setBarStyle('light-content');
    return () => {
      StatusBar.setBarStyle('dark-content');
    };
  }, []);

  return (
    <View style={styles.root} testID="CARREGAMENTO.scrn">
      <LoadingIndicator color={WHITE} />
      {label ? (
        <HeaderText variant="header4" style={styles.label}>
          {label}
        </HeaderText>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: DARK_GREY,
  },
  label: {
    color: WHITE,
    textAlign: 'center',
    marginTop: 12,
  },
});
