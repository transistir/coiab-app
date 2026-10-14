import * as React from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  createBottomTabNavigator,
  type BottomTabHeaderProps,
} from '@react-navigation/bottom-tabs';
import {CameraScreen} from '../../screens/CameraScreen';
import {Entroncamento} from '../../screens/Entroncamento';
import {MapScreen} from '../../screens/MapScreen';
import {Notificacoes} from '../../screens/Notificacoes';
import {ObservationsList} from '../../screens/ObservationsList';
import {
  HomeTabsParamsList,
  NativeRootNavigationProps,
} from '../../sharedTypes/navigation';
import {HomeHeader} from '../../sharedComponents/HomeHeader';
import {TabBar} from './TabBar';
import {FullScreenCenteredLoader} from '../../sharedComponents/FullScreenCenteredLoader';
import {COIAB_ORANGE, NEW_DARK_GREY, WHITE} from '../../lib/styles';
import {Drawer} from 'react-native-drawer-layout';
import {DrawerMenu} from '../../sharedComponents/DrawerMenu';
import {useOpenDrawer} from '../../hooks/useOpenDrawer';
import {ProjectRemovalListener} from '../../sharedComponents/ProjectRemovalListener';
import {DownloadIcon} from '../../sharedComponents/icons';
import TracksIcon from '../../images/Tracks.svg';
import {useTracking} from '../../hooks/useTracking';
import {useTrackTimer} from '../../hooks/useTrackTimer.ts';
import {BodyText} from '../../sharedComponents/Text/BodyText';
import {useObservations} from '../../hooks/server/observations';
import {useTracks} from '../../hooks/server/track';
import {useAuthContext} from '../../contexts/AuthContext';
import {OrganizationRepairBanner} from '../../sharedComponents/OrganizationRepairBanner';

const Tab = createBottomTabNavigator<HomeTabsParamsList>();

// These mirror react-native-drawer-layout's own defaults, so the drawer keeps
// exactly the size it had before. The gap leaves a strip of screen uncovered
// beside the open drawer so it can be tapped to dismiss — the library calls it
// APPROX_APP_BAR_HEIGHT.
const DRAWER_EDGE_GAP = 56;
// 360 is the Material Design 3 standard drawer width:
// https://m3.material.io/components/navigation-drawer/specs
const MAX_DRAWER_WIDTH = 360;

export function getDrawerWidth(windowWidth: number) {
  return Math.max(Math.min(windowWidth - DRAWER_EDGE_GAP, MAX_DRAWER_WIDTH), 0);
}

// Header sólido (fundo branco) das abas de conteúdo — mesmo HomeHeader com o
// botão que abre o drawer, para a gaveta seguir acessível de qualquer aba.
const headerSolido =
  (onPress: () => void) =>
  (props: BottomTabHeaderProps): React.ReactElement => (
    <React.Suspense fallback={null}>
      <HomeHeader
        {...props}
        backgroundColor={WHITE}
        showBottomBorder={true}
        onPress={onPress}
      />
    </React.Suspense>
  );

export const HomeTabs = ({navigation}: NativeRootNavigationProps<'Home'>) => {
  const [drawerOpen, setDrawerOpen] = useOpenDrawer();
  const drawerWidth = getDrawerWidth(useWindowDimensions().width);

  // Header sólido (fundo branco) das abas de conteúdo — ver headerSolido.
  const headerSolid = headerSolido(() => setDrawerOpen(val => !val));

  return (
    <>
      <ProjectRemovalListener />
      <React.Suspense fallback={null}>
        <OrganizationRepairBanner
          onPress={() => navigation.navigate('OrganizationProvisioning')}
        />
      </React.Suspense>
      <Drawer
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
        }}
        onOpen={() => {
          setDrawerOpen(true);
        }}
        drawerType="slide"
        swipeEnabled={false}
        // The library's `maxWidth: '100%'` resolves to 0 if the panel lays out
        // while an ancestor is momentarily zero-width — which a suspense
        // hide/reveal on project switch does, blanking the drawer until restart
        // (#1613). `width` matches so the library's drawerWidth stays in sync.
        drawerStyle={{width: drawerWidth, maxWidth: drawerWidth}}
        renderDrawerContent={() => (
          <DrawerMenu
            closeMenu={() => {
              setDrawerOpen(false);
            }}
          />
        )}>
        <Tab.Navigator
          tabBar={props => <TabBar {...props} />}
          screenOptions={{
            tabBarShowLabel: false,
            headerTransparent: true,
            header: props => (
              <React.Suspense fallback={null}>
                <HomeHeader
                  {...props}
                  onPress={() => setDrawerOpen(val => !val)}
                  backgroundColor="transparent"
                  showBottomBorder={false}
                />
              </React.Suspense>
            ),
          }}
          initialRouteName={'Entroncamento'}
          screenLayout={({children}) => (
            <React.Suspense fallback={<FullScreenCenteredLoader />}>
              {children}
            </React.Suspense>
          )}
          backBehavior="initialRoute">
          {/* COIAB (#32 feedback): barra de 4 abas — Organização (inicial,
              pós-login, cujo conteúdo é a tela da organização), Map,
              Notificações e Paneiro. A rota Camera segue registrada sem botão
              na barra (o acesso à câmera vive no fluxo de criação de
              observação). A aba Filtros foi removida (decisão de campo). */}
          <Tab.Screen
            name="Entroncamento"
            component={Entroncamento}
            options={{header: headerSolid}}
          />
          <Tab.Screen
            name="Map"
            component={MapScreen}
            options={({navigation: tabNav}) => ({
              headerRight: () => (
                <TrackMapButton
                  onPress={() => tabNav.navigate('Map', {trackingOpen: true})}
                />
              ),
            })}
          />
          <Tab.Screen
            name="Notificacoes"
            component={Notificacoes}
            options={{header: headerSolid}}
          />
          <Tab.Screen
            name="ObservationsList"
            component={ObservationsList}
            options={{
              headerTransparent: false,
              headerRight: () => (
                <DownloadObservationsButton
                  onPress={() => navigation.navigate('ExportObservations')}
                />
              ),
              header: headerSolid,
            }}
          />
          <Tab.Screen name="Camera" component={CameraScreen} />
        </Tab.Navigator>
      </Drawer>
    </>
  );
};

export function TrackMapButton({onPress}: {onPress: () => void}) {
  const {isTracking} = useTracking();
  const timer = useTrackTimer();

  return (
    <TouchableOpacity
      testID="mapTrackButton"
      accessibilityLabel="Track recording"
      hitSlop={20}
      style={styles.trackMapButton}
      onPress={onPress}>
      {isTracking && (
        <View style={styles.trackRuntimeWrapper}>
          <View style={styles.trackIndicator} />
          <BodyText variant="tinyMeta">{timer}</BodyText>
        </View>
      )}
      <TracksIcon
        color={isTracking ? COIAB_ORANGE : NEW_DARK_GREY}
        height={22}
      />
    </TouchableOpacity>
  );
}

function useShowDownloadIcon() {
  const {data: observations} = useObservations();
  const {data: tracks} = useTracks();
  const {authState} = useAuthContext();

  return (
    (observations.length > 0 || tracks.length > 0) && authState !== 'obscured'
  );
}

function DownloadObservationsButton({onPress}: {onPress: () => void}) {
  const shouldShow = useShowDownloadIcon();

  if (!shouldShow) {
    return null;
  }

  return (
    <TouchableOpacity
      style={{
        marginRight: 20,
      }}
      accessibilityLabel="Download Observations"
      onPress={onPress}>
      <DownloadIcon size={30} color={NEW_DARK_GREY} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  trackMapButton: {
    marginRight: 10,
    backgroundColor: WHITE,
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  trackRuntimeWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 6,
  },
  trackIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#59A553',
    marginRight: 4,
  },
});
