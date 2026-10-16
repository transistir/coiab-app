import {BottomTabBarProps} from '@react-navigation/bottom-tabs';
import * as React from 'react';
import {StyleSheet, TouchableOpacity, View} from 'react-native';

import {
  TabIconConfiguracoes,
  TabIconMapa,
  TabIconMenu,
  TabIconNotificacoes,
  TabIconPaneiro,
  type TabIconProps,
} from './TabBarIcons';

const HIT_SLOP = 20;

/**
 * COIAB (#32 fase 3): a barra global de 5 itens do Figma `footer-menu`, da
 * esquerda para a direita — Menu, Paneiro (funil), Map (central), Notificações
 * e Configurações. Sem rótulo de texto e sem ícone de perfil; o botão de
 * trilha/download não vive na barra (a trilha é ação DENTRO do mapa). O item
 * Configurações sai das abas e navega para a tela AppSettings na root stack.
 * Ver docs/navegacao-coiab.md.
 */
type TabTarget =
  | {kind: 'tab'; route: 'Menu' | 'Map' | 'Notificacoes' | 'ObservationsList'}
  // Configurações não é aba: navega para a tela de Settings na root stack.
  | {kind: 'root'; route: 'AppSettings'};

type TabConfig = {
  target: TabTarget;
  testID: string;
  accessibilityLabel: string;
  icon: React.FC<TabIconProps>;
};

const TABS: TabConfig[] = [
  {
    target: {kind: 'tab', route: 'Menu'},
    testID: 'tabBarButtonMenu',
    accessibilityLabel: 'Go to menu.',
    icon: TabIconMenu,
  },
  {
    target: {kind: 'tab', route: 'ObservationsList'},
    testID: 'tabBarButtonPaneiro',
    accessibilityLabel: 'Go to paneiro.',
    icon: TabIconPaneiro,
  },
  {
    target: {kind: 'tab', route: 'Map'},
    testID: 'tabBarButtonMap',
    accessibilityLabel: 'Go to map.',
    icon: TabIconMapa,
  },
  {
    target: {kind: 'tab', route: 'Notificacoes'},
    testID: 'tabBarButtonNotificacoes',
    accessibilityLabel: 'Go to notifications.',
    icon: TabIconNotificacoes,
  },
  {
    target: {kind: 'root', route: 'AppSettings'},
    testID: 'tabBarButtonConfiguracoes',
    accessibilityLabel: 'Go to settings.',
    icon: TabIconConfiguracoes,
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
  const Icon = config.icon;

  return (
    <TouchableOpacity
      testID={config.testID}
      accessibilityLabel={config.accessibilityLabel}
      accessibilityRole="tab"
      accessibilityState={{selected: isSelected}}
      hitSlop={HIT_SLOP}
      style={styles.buttonStyle}
      onPress={onPress}>
      <Icon active={isSelected} />
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
          key={config.testID}
          config={config}
          isSelected={
            config.target.kind === 'tab' &&
            currentTab?.name === config.target.route
          }
          onPress={() => {
            if (config.target.kind === 'tab') {
              navigation.navigate(config.target.route);
            } else {
              // Configurações: AppSettings vive na root stack (composite nav).
              navigation.getParent()?.navigate(config.target.route);
            }
          }}
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
  },
});
