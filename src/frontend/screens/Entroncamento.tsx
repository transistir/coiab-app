import * as React from 'react';
import {StyleSheet, View} from 'react-native';
import {defineMessages, useIntl} from 'react-intl';

import {HeaderText} from '../sharedComponents/Text/HeaderText';
import {BodyText} from '../sharedComponents/Text/BodyText';
import {COIAB_ORANGE} from '../lib/styles';
import {useOrganizacaoAtiva} from '../hooks/useOrganizacaoAtiva';
import {NativeHomeTabsNavigationProps} from '../sharedTypes/navigation';

const m = defineMessages({
  ola: {
    id: 'screens.Entroncamento.ola',
    defaultMessage: 'Olá',
    description: 'Greeting on the Entroncamento hub screen',
  },
  modulosEmBreve: {
    id: 'screens.Entroncamento.modulosEmBreve',
    defaultMessage: '4 módulos em breve',
    description: 'Placeholder note about upcoming organization modules',
  },
});

/**
 * COIAB (#32 PR A): placeholder da aba Entroncamento — o hub de módulos da
 * organização chega no PR B (cartões de módulo); por ora só a saudação com a
 * organização ativa e o aviso de módulos pendentes.
 */
export const Entroncamento: React.FC<
  NativeHomeTabsNavigationProps<'Entroncamento'>
> = () => {
  const {formatMessage} = useIntl();
  const organizacaoAtiva = useOrganizacaoAtiva();

  return (
    <View style={styles.container} testID="ENTRONCAMENTO.scrn">
      <HeaderText variant="header2" testID="ENTRONCAMENTO.saudacao">
        {organizacaoAtiva
          ? `${formatMessage(m.ola)}, ${organizacaoAtiva.nome}`
          : formatMessage(m.ola)}
      </HeaderText>
      <BodyText variant="smallMeta" style={styles.emBreve}>
        {formatMessage(m.modulosEmBreve)}
      </BodyText>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
    padding: 20,
    gap: 10,
  },
  emBreve: {
    color: COIAB_ORANGE,
  },
});
