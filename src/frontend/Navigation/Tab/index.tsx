import * as React from 'react';
import {StyleSheet, TouchableOpacity, View} from 'react-native';
import {
  createBottomTabNavigator,
  type BottomTabBarProps,
  type BottomTabHeaderProps,
  type BottomTabNavigationOptions,
} from '@react-navigation/bottom-tabs';
import {useNavigation} from '@react-navigation/native';
import {CameraScreen} from '../../screens/CameraScreen';
import {MenuScreen} from '../../screens/MenuScreen';
import {MapScreen} from '../../screens/MapScreen';
import {Notificacoes} from '../../screens/Notificacoes';
import {ObservationsList} from '../../screens/ObservationsList';
import {
  HomeTabsParamsList,
  NativeHomeTabsNavigationProps,
  NativeRootNavigationProps,
} from '../../sharedTypes/navigation';
import {HomeHeader} from '../../sharedComponents/HomeHeader';
import {TabBar} from './TabBar';
import {FullScreenCenteredLoader} from '../../sharedComponents/FullScreenCenteredLoader';
import {COIAB_ORANGE, NEW_DARK_GREY, WHITE} from '../../lib/styles';
import {ProjectRemovalListener} from '../../sharedComponents/ProjectRemovalListener';
import {DownloadIcon} from '../../sharedComponents/icons';
import TracksIcon from '../../images/Tracks.svg';
import {useTracking} from '../../hooks/useTracking';
import {useTrackTimer} from '../../hooks/useTrackTimer';
import {BodyText} from '../../sharedComponents/Text/BodyText';
import {useObservations} from '../../hooks/server/observations';
import {useTracks} from '../../hooks/server/track';
import {useAuthContext} from '../../contexts/AuthContext';
import {OrganizationRepairBanner} from '../../sharedComponents/OrganizationRepairBanner';
import {MENU_TRANSITION_SPEC, menuSceneInterpolator} from './menuTransition';

const Tab = createBottomTabNavigator<HomeTabsParamsList>();

// Header sólido (fundo branco) das abas de conteúdo — sem botão de menu
// (#118): o menu vive na página de Menu, aberta pelo 1º item da tab bar.
const headerSolido = (props: BottomTabHeaderProps): React.ReactElement => (
  <React.Suspense fallback={null}>
    <HomeHeader {...props} backgroundColor={WHITE} showBottomBorder={true} />
  </React.Suspense>
);

// Everything the navigator reads from its props or a screen's `options` lives
// at module level: `options`, `header`, `headerRight` and `screenLayout` keep
// the same identity across HomeTabs renders, so a re-render of the navigator
// never hands the header a new function. The header-right buttons read their
// navigation from the header's own NavigationProvider (see `useNavigation`
// below) instead of closing over HomeTabs' props.
const headerTransparente = (
  props: BottomTabHeaderProps,
): React.ReactElement => (
  <React.Suspense fallback={null}>
    <HomeHeader
      {...props}
      backgroundColor="transparent"
      showBottomBorder={false}
    />
  </React.Suspense>
);

const renderTabBar = (props: BottomTabBarProps) => <TabBar {...props} />;

const screenLayout = ({children}: {children: React.ReactNode}) => (
  <React.Suspense fallback={<FullScreenCenteredLoader />}>
    {children}
  </React.Suspense>
);

const TAB_SCREEN_OPTIONS: BottomTabNavigationOptions = {
  tabBarShowLabel: false,
  headerTransparent: true,
  header: headerTransparente,
};

// The buttons read suspense queries; their own boundary keeps a pending query
// from suspending the whole HomeHeader (title, safe-area padding) with it.
const renderObservationsHeaderRight = () => (
  <React.Suspense fallback={null}>
    <DownloadObservationsHeaderRight />
  </React.Suspense>
);

const renderMapHeaderRight = () => <MapTrackHeaderRight />;

const MENU_OPTIONS: BottomTabNavigationOptions = {
  headerShown: false,
  // Slide-in rápido da esquerda (#121): espelha o push do
  // AppSettings (que entra da direita). Só o Menu declara essa
  // animação — as demais abas seguem sem slide horizontal.
  animation: 'shift',
  sceneStyleInterpolator: menuSceneInterpolator,
  transitionSpec: MENU_TRANSITION_SPEC,
};

const OBSERVATIONS_LIST_OPTIONS: BottomTabNavigationOptions = {
  headerTransparent: false,
  headerRight: renderObservationsHeaderRight,
  header: headerSolido,
};

const MAP_OPTIONS: BottomTabNavigationOptions = {
  headerRight: renderMapHeaderRight,
};

const NOTIFICACOES_OPTIONS: BottomTabNavigationOptions = {
  header: headerSolido,
};

export const HomeTabs = ({navigation}: NativeRootNavigationProps<'Home'>) => {
  return (
    <>
      <ProjectRemovalListener />
      <React.Suspense fallback={null}>
        <OrganizationRepairBanner
          onPress={() => navigation.navigate('OrganizationProvisioning')}
        />
      </React.Suspense>
      <Tab.Navigator
        tabBar={renderTabBar}
        screenOptions={TAB_SCREEN_OPTIONS}
        initialRouteName={'Menu'}
        screenLayout={screenLayout}
        backBehavior="initialRoute">
        {/* COIAB (#32 fase 3): barra de 5 itens do Figma `footer-menu` —
              Menu (inicial pós-login; mostra o conteúdo do menu como
              página), Paneiro=ObservationsList (funil), Map (central),
              Notificações e Configurações. Configurações não é aba: o botão
              navega para AppSettings na root stack (ver TabBar). A rota Camera
              segue registrada sem botão na barra (o acesso à câmera vive no
              fluxo de criação de observação). Ver docs/navegacao-coiab.md. */}
        {/* The Menu page is the initial surface and has NO header at all
            (`headerShown: false`): the DrawerMenu content owns the top safe
            area via `insets.top`. No organisation chip may appear on this
            surface — it duplicated the organisation name already shown in
            the greeting. Only Map keeps the transparent navigator header
            (map under the status bar); content tabs use `headerSolido`. */}
        <Tab.Screen
          name="Menu"
          component={MenuScreen}
          options={MENU_OPTIONS}
        />
        <Tab.Screen
          name="ObservationsList"
          component={ObservationsList}
          options={OBSERVATIONS_LIST_OPTIONS}
        />
        <Tab.Screen name="Map" component={MapScreen} options={MAP_OPTIONS} />
        <Tab.Screen
          name="Notificacoes"
          component={Notificacoes}
          options={NOTIFICACOES_OPTIONS}
        />
        <Tab.Screen name="Camera" component={CameraScreen} />
      </Tab.Navigator>
    </>
  );
};

// The header renders inside the tab route's NavigationProvider
// (@react-navigation/elements Screen), so `useNavigation` here is the tab's
// navigation; actions the tab navigator cannot handle bubble to the root stack.
type HomeTabsNavigation<T extends keyof HomeTabsParamsList> =
  NativeHomeTabsNavigationProps<T>['navigation'];

function MapTrackHeaderRight() {
  const navigation = useNavigation<HomeTabsNavigation<'Map'>>();
  const onPress = React.useCallback(
    () => navigation.navigate('Map', {trackingOpen: true}),
    [navigation],
  );
  return <TrackMapButton onPress={onPress} />;
}

function DownloadObservationsHeaderRight() {
  const navigation = useNavigation<HomeTabsNavigation<'ObservationsList'>>();
  const onPress = React.useCallback(
    () => navigation.navigate('ExportObservations'),
    [navigation],
  );
  return <DownloadObservationsButton onPress={onPress} />;
}

export function TrackMapButton({onPress}: {onPress: () => void}) {
  const {isTracking} = useTracking();
  const timer = useTrackTimer();

  return (
    <TouchableOpacity
      testID="mapTrackButton"
      accessibilityLabel="Track recording"
      // Rótulo fixo nos dois estados (#32): o leitor de tela distingue
      // parado/gravando (e ouve o tempo decorrido) pelo valor acessível.
      accessibilityValue={{
        text: isTracking ? `Recording, ${timer}` : 'Not recording',
      }}
      hitSlop={20}
      style={styles.trackMapButton}
      onPress={onPress}>
      {isTracking && (
        <View style={styles.trackRuntimeWrapper}>
          <View
            testID="mapTrackButton.indicator"
            style={styles.trackIndicator}
          />
          <BodyText variant="tinyMeta">{timer}</BodyText>
        </View>
      )}
      <TracksIcon
        testID="mapTrackButton.icon"
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
