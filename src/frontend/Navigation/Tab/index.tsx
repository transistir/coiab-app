import * as React from 'react';
import {TouchableOpacity, useWindowDimensions} from 'react-native';
import {
  createBottomTabNavigator,
  type BottomTabHeaderProps,
} from '@react-navigation/bottom-tabs';
import {CameraScreen} from '../../screens/CameraScreen';
import {Entroncamento} from '../../screens/Entroncamento';
import {Filtros} from '../../screens/Filtros';
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
import {NEW_DARK_GREY, WHITE} from '../../lib/styles';
import {Drawer} from 'react-native-drawer-layout';
import {DrawerMenu} from '../../sharedComponents/DrawerMenu';
import {useOpenDrawer} from '../../hooks/useOpenDrawer';
import {ProjectRemovalListener} from '../../sharedComponents/ProjectRemovalListener';
import {DownloadIcon} from '../../sharedComponents/icons';
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
          {/* COIAB (#32 PR A): barra de 5 abas — Entroncamento (inicial,
              pós-login), Filtros, Map, Notificações e Paneiro. A rota Camera
              segue registrada sem botão na barra (o acesso à câmera vive no
              fluxo de criação de observação). */}
          <Tab.Screen
            name="Entroncamento"
            component={Entroncamento}
            options={{header: headerSolid}}
          />
          <Tab.Screen
            name="Filtros"
            component={Filtros}
            options={{header: headerSolid}}
          />
          <Tab.Screen name="Map" component={MapScreen} />
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
