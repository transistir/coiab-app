import * as React from 'react';
import {StyleSheet, View} from 'react-native';
import {defineMessages, useIntl} from 'react-intl';

import {BodyText} from '../sharedComponents/Text/BodyText';
import {NativeHomeTabsNavigationProps} from '../sharedTypes/navigation';

const m = defineMessages({
  emBreve: {
    id: 'screens.Filtros.emBreve',
    defaultMessage: 'Filtros (em breve)',
    description: 'Placeholder note on the global filters tab',
  },
});

/**
 * COIAB (#32 PR A): placeholder da aba Filtros — o filtro global por
 * categorias/camadas chega com o #30; por ora só o aviso.
 */
export const Filtros: React.FC<
  NativeHomeTabsNavigationProps<'Filtros'>
> = () => {
  const {formatMessage} = useIntl();

  return (
    <View style={styles.container} testID="FILTROS.scrn">
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
