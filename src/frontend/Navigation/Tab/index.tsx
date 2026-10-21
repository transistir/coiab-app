import * as React from 'react';
import {TouchableOpacity} from 'react-native';
import {
  createBottomTabNavigator,
  type BottomTabHeaderProps,
} from '@react-navigation/bottom-tabs';
import {CameraScreen} from '../../screens/CameraScreen';
import {MenuScreen} from '../../screens/MenuScreen';
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
import {ProjectRemovalListener} from '../../sharedComponents/ProjectRemovalListener';
import {DownloadIcon} from '../../sharedComponents/icons';
import {useObservations} from '../../hooks/server/observations';
import {useTracks} from '../../hooks/server/track';
import {useAuthContext} from '../../contexts/AuthContext';
import {OrganizationRepairBanner} from '../../sharedComponents/OrganizationRepairBanner';

const Tab = createBottomTabNavigator<HomeTabsParamsList>();

// Header sólido (fundo branco) das abas de conteúdo — sem botão de menu
// (#118): o menu vive na página de Menu, aberta pelo 1º item da tab bar.
const headerSolido = (props: BottomTabHeaderProps): React.ReactElement => (
  <React.Suspense fallback={null}>
    <HomeHeader {...props} backgroundColor={WHITE} showBottomBorder={true} />
  </React.Suspense>
);

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
        tabBar={props => <TabBar {...props} />}
        screenOptions={{
          tabBarShowLabel: false,
          headerTransparent: true,
          header: props => (
            <React.Suspense fallback={null}>
              <HomeHeader
                {...props}
                backgroundColor="transparent"
                showBottomBorder={false}
              />
            </React.Suspense>
          ),
        }}
        initialRouteName={'Menu'}
        screenLayout={({children}) => (
          <React.Suspense fallback={<FullScreenCenteredLoader />}>
            {children}
          </React.Suspense>
        )}
        backBehavior="initialRoute">
        {/* COIAB (#32 fase 3): barra de 5 itens do Figma `footer-menu` —
              Menu (inicial pós-login; mostra o conteúdo do menu como
              página), Paneiro=ObservationsList (funil), Map (central),
              Notificações e Configurações. Configurações não é aba: o botão
              navega para AppSettings na root stack (ver TabBar). A rota Camera
              segue registrada sem botão na barra (o acesso à câmera vive no
              fluxo de criação de observação). Ver docs/navegacao-coiab.md. */}
        <Tab.Screen
          name="Menu"
          component={MenuScreen}
          options={{header: headerSolido}}
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
            header: headerSolido,
          }}
        />
        <Tab.Screen name="Map" component={MapScreen} />
        <Tab.Screen
          name="Notificacoes"
          component={Notificacoes}
          options={{header: headerSolido}}
        />
        <Tab.Screen name="Camera" component={CameraScreen} />
      </Tab.Navigator>
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
