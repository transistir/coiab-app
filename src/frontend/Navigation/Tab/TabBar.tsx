import {BottomTabBarProps} from '@react-navigation/bottom-tabs';
import * as React from 'react';
import {StyleSheet, TouchableOpacity, View} from 'react-native';
import {MessageDescriptor, defineMessages, useIntl} from 'react-intl';
import TracksIcon from '../../images/Tracks.svg';
import {COIAB_ORANGE, MEDIUM_GREY} from '../../lib/styles';
import {BodyText} from '../../sharedComponents/Text/BodyText';
import {useTracking} from '../../hooks/useTracking';
import {useTrackTimer} from '../../hooks/useTrackTimer.ts';
import {
  TabIconEntroncamento,
  TabIconFiltros,
  TabIconMapa,
  TabIconNotificacoes,
  TabIconPaneiro,
  type TabIconProps,
} from './TabBarIcons';

const HIT_SLOP = 20;

const m = defineMessages({
  entroncamento: {
    id: 'Navigation.Tab.Entroncamento',
    defaultMessage: 'Entroncamento',
    description: 'Label of the Entroncamento (organization hub) tab',
  },
  filtros: {
    id: 'Navigation.Tab.Filtros',
    defaultMessage: 'Filtros',
    description: 'Label of the global filters tab',
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
  route:
    'Entroncamento' | 'Filtros' | 'Map' | 'Notificacoes' | 'ObservationsList';
  testID: string;
  accessibilityLabel: string;
  label: MessageDescriptor;
  icon: React.FC<TabIconProps>;
};

// COIAB (#32 PR A): a barra global de 5 abas do Figma `2668:4449`. A Camera
// deixou de ser aba (a rota segue registrada — o acesso à câmera vive no fluxo
// de criação de observação); o botão de trilha GPS é ação, não aba, e segue
// aqui para a gravação de trilha não perder sua entrada.
const TABS: TabConfig[] = [
  {
    route: 'Entroncamento',
    testID: 'tabBarButtonEntroncamento',
    accessibilityLabel: 'Go to entroncamento.',
    label: m.entroncamento,
    icon: TabIconEntroncamento,
  },
  {
    route: 'Filtros',
    testID: 'tabBarButtonFiltros',
    accessibilityLabel: 'Go to filters.',
    label: m.filtros,
    icon: TabIconFiltros,
  },
  {
    route: 'Map',
    testID: 'tabBarButtonMap',
    accessibilityLabel: 'Go to map.',
    label: m.mapa,
    icon: TabIconMapa,
  },
  {
    route: 'Notificacoes',
    testID: 'tabBarButtonNotificacoes',
    accessibilityLabel: 'Go to notifications.',
    label: m.notificacoes,
    icon: TabIconNotificacoes,
  },
  {
    route: 'ObservationsList',
    testID: 'tabBarButtonPaneiro',
    accessibilityLabel: 'Go to paneiro.',
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
      accessibilityLabel={config.accessibilityLabel}
      accessibilityRole="tab"
      accessibilityState={{selected: isSelected}}
      hitSlop={HIT_SLOP}
      style={styles.buttonStyle}
      onPress={onPress}>
      <Icon active={isSelected} />
      <BodyText
        variant="tinyMeta"
        style={{
          marginTop: 2,
          color: isSelected ? COIAB_ORANGE : MEDIUM_GREY,
        }}>
        {formatMessage(config.label)}
      </BodyText>
    </TouchableOpacity>
  );
}
export const TabBar = ({navigation, state}: BottomTabBarProps) => {
  const currentIndex = state.index;
  const currentTab = state.routes[currentIndex];

  const mapaSelecionado = !!(
    currentTab?.name === 'Map' &&
    currentTab?.params &&
    !(
      'trackingOpen' in currentTab.params &&
      currentTab.params.trackingOpen === true
    )
  );
  const trilhaSelecionada = !!(
    currentTab?.name === 'Map' &&
    currentTab?.params &&
    'trackingOpen' in currentTab.params &&
    currentTab.params.trackingOpen === true
  );

  return (
    <View style={styles.container}>
      {TABS.map(config => (
        <TabButton
          key={config.route}
          config={config}
          isSelected={
            config.route === 'Map'
              ? mapaSelecionado
              : currentTab?.name === config.route
          }
          onPress={() => navigation.navigate(config.route)}
        />
      ))}

      <TouchableOpacity
        hitSlop={HIT_SLOP}
        testID="tabBarButtonTracking"
        accessibilityLabel="Go to tracking."
        style={styles.trackContainer}
        onPress={() => navigation.navigate('Map', {trackingOpen: true})}>
        <TrackButtonContent isSelected={trilhaSelecionada} />
      </TouchableOpacity>
    </View>
  );
};

const TrackButtonContent = ({isSelected}: {isSelected: boolean}) => {
  const {isTracking} = useTracking();
  const timer = useTrackTimer();
  return (
    <>
      {isTracking && (
        <View style={styles.runtimeWrapper}>
          <View style={styles.indicator} />
          <BodyText variant="tinyMeta" style={styles.timer}>
            {timer}
          </BodyText>
        </View>
      )}
      <TracksIcon color={isSelected ? COIAB_ORANGE : MEDIUM_GREY} height={25} />
    </>
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
  runtimeWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  indicator: {
    marginRight: 5,
    height: 10,
    width: 10,
    borderRadius: 99,
    backgroundColor: '#59A553',
  },
  timer: {
    marginLeft: 5,
  },
  trackContainer: {
    flex: 1,
    alignItems: 'center',
  },
});
