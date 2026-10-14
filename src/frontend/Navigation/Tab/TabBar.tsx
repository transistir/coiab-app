import {BottomTabBarProps} from '@react-navigation/bottom-tabs';
import * as React from 'react';
import {StyleSheet, TouchableOpacity, View} from 'react-native';
import {MessageDescriptor, defineMessages, useIntl} from 'react-intl';
import {COIAB_ORANGE, DARK_BLUE, MEDIUM_GREY} from '../../lib/styles';
import {BodyText} from '../../sharedComponents/Text/BodyText';
import {
  TabIconMapa,
  TabIconNotificacoes,
  TabIconOrganizacao,
  TabIconPaneiro,
  type TabIconProps,
} from './TabBarIcons';

const HIT_SLOP = 20;
// Bolinha teal sob o ícone marca a aba ativa (Figma footer-menu `2122:6281`).
const ACTIVE_DOT_SIZE = 8;

const m = defineMessages({
  organizacao: {
    id: 'Navigation.Tab.Organizacao',
    defaultMessage: 'Organização',
    description:
      'Accessibility label of the organization hub tab (the main tab renders no visible text)',
  },
  mapa: {
    id: 'Navigation.Tab.Mapa',
    defaultMessage: 'Map',
    description: 'Label of the map tab',
  },
  notificacoes: {
    id: 'Navigation.Tab.Notificacoes',
    defaultMessage: 'Notificações',
    description: 'Label of the notifications tab',
  },
  paneiro: {
    id: 'Navigation.Tab.Paneiro',
    defaultMessage: 'Paneiro',
    description: 'Label of the paneiro (community observations) tab',
  },
});

type TabConfig = {
  /** ID de rota no navigator (Map e ObservationsList preservados do CoMapeo). */
  route: 'Entroncamento' | 'Map' | 'Notificacoes' | 'ObservationsList';
  testID: string;
  accessibilityLabel: MessageDescriptor;
  /**
   * Rótulo visível da aba. A aba principal (Organização) não tem rótulo
   * — é só o logo + bolinha teal de ativa (decisão de campo + Figma).
   */
  label?: MessageDescriptor;
  icon: React.FC<TabIconProps>;
};

// COIAB (#32 feedback): barra de 4 abas — Organização (hub organizacional,
// cujo conteúdo é a tela da organização, sem rótulo visível), Map,
// Notificações e Paneiro. A rota Camera segue registrada sem botão na barra
// (acesso via fluxo de criação de observação); a aba Filtros e o botão de
// trilha saíram da barra (a trilha fica acessível dentro do mapa).
const TABS: TabConfig[] = [
  {
    route: 'Entroncamento',
    testID: 'tabBarButtonOrganizacao',
    accessibilityLabel: m.organizacao,
    icon: TabIconOrganizacao,
  },
  {
    route: 'Map',
    testID: 'tabBarButtonMap',
    accessibilityLabel: m.mapa,
    label: m.mapa,
    icon: TabIconMapa,
  },
  {
    route: 'Notificacoes',
    testID: 'tabBarButtonNotificacoes',
    accessibilityLabel: m.notificacoes,
    label: m.notificacoes,
    icon: TabIconNotificacoes,
  },
  {
    route: 'ObservationsList',
    testID: 'tabBarButtonPaneiro',
    accessibilityLabel: m.paneiro,
    label: m.paneiro,
    icon: TabIconPaneiro,
  },
];

function TabButton({
  config,
  isSelected,
  onPress,
}: {
  config: TabConfig;
  isSelected: boolean;
  onPress: () => void;
}) {
  const {formatMessage} = useIntl();
  const Icon = config.icon;

  return (
    <TouchableOpacity
      testID={config.testID}
      accessibilityLabel={formatMessage(config.accessibilityLabel)}
      accessibilityRole="tab"
      accessibilityState={{selected: isSelected}}
      hitSlop={HIT_SLOP}
      style={styles.buttonStyle}
      onPress={onPress}>
      <Icon active={isSelected} />
      {config.label ? (
        <BodyText
          variant="tinyMeta"
          numberOfLines={1}
          ellipsizeMode="tail"
          style={{
            marginTop: 2,
            color: isSelected ? COIAB_ORANGE : MEDIUM_GREY,
            textAlign: 'center',
          }}>
          {formatMessage(config.label)}
        </BodyText>
      ) : (
        // Aba principal sem rótulo: a bolinha teal sob o ícone marca a ativa.
        <View
          testID={isSelected ? 'tabBarActiveDotOrganizacao' : undefined}
          style={[
            styles.activeDot,
            {backgroundColor: isSelected ? DARK_BLUE : 'transparent'},
          ]}
        />
      )}
    </TouchableOpacity>
  );
}

export const TabBar = ({navigation, state}: BottomTabBarProps) => {
  const currentIndex = state.index;
  const currentTab = state.routes[currentIndex];

  return (
    <View style={styles.container}>
      {TABS.map(config => (
        <TabButton
          key={config.route}
          config={config}
          isSelected={currentTab?.name === config.route}
          onPress={() => navigation.navigate(config.route)}
        />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
  },
  buttonStyle: {
    marginTop: 10,
    marginBottom: 10,
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  activeDot: {
    marginTop: 4,
    width: ACTIVE_DOT_SIZE,
    height: ACTIVE_DOT_SIZE,
    borderRadius: ACTIVE_DOT_SIZE / 2,
  },
});
