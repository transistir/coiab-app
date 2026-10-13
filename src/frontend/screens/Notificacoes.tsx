import * as React from 'react';
import {StyleSheet, View} from 'react-native';
import {defineMessages, useIntl} from 'react-intl';

import {BodyText} from '../sharedComponents/Text/BodyText';
import {NativeHomeTabsNavigationProps} from '../sharedTypes/navigation';

const m = defineMessages({
  emBreve: {
    id: 'screens.Notificacoes.emBreve',
    defaultMessage: 'Notificações (em breve)',
    description: 'Placeholder note on the notifications tab',
  },
});

/**
 * COIAB (#32 PR A): placeholder da aba Notificações — a lista real chega com
 * o pipeline de notificações (#49, pós-MVP); por ora só o aviso.
 */
export const Notificacoes: React.FC<
  NativeHomeTabsNavigationProps<'Notificacoes'>
> = () => {
  const {formatMessage} = useIntl();

  return (
    <View style={styles.container} testID="NOTIFICACOES.scrn">
      <BodyText variant="smallMeta">{formatMessage(m.emBreve)}</BodyText>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
    padding: 20,
  },
});
