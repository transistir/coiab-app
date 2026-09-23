import React from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
} from 'react-native';
import {useIntl, defineMessages} from 'react-intl';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import IonIcon from '@react-native-vector-icons/ionicons';
import Octicons from '@react-native-vector-icons/octicons';
import MaterialIcon from '@react-native-vector-icons/material-icons';

import {useNavigationFromRoot} from '../hooks/useNavigationWithTypes.ts';
import Exchange from '../images/Exchange.svg';
import {BodyText} from '../sharedComponents/Text/BodyText.tsx';
import {useProjectRoleAndDetails} from '../hooks/useProjectRoleAndDetails.ts';
import {
  COMAPEO_BLUE,
  LIGHT_ORANGE,
  NEW_DARK_GREY,
  WHITE,
} from '../lib/styles.ts';
import {useActiveProject} from '../contexts/ActiveProjectContext.tsx';
import {MenuLowStorageAlert} from '../sharedComponents/Storage/MenuLowStorageAlert.tsx';
import {useStorageReadingQuery} from '../hooks/useStorageReadingQuery.ts';
import {ColorCard} from '../sharedComponents/ColorCard.tsx';
import {HeaderText} from '../sharedComponents/Text/HeaderText.tsx';
import {PrimaryButton} from '../sharedComponents/Buttons.tsx';
import {isLowStorage, calcUsedPercentage} from '../lib/storage.ts';
import {useEarlyAccessState} from '../contexts/EarlyAccessContext';
import {useCoiabOrganizationsState} from '../contexts/CoiabOrganizationsStoreContext';
import {derivarProjectIdAtivo} from '../lib/organization/coiabOrganizations';
import {OrganizationAreaAccesses} from './OrganizationAreaAccesses.tsx';
import {displayDescription} from '../lib/organization/marker';

const m = defineMessages({
  appSettings: {
    id: '$1Navigation.Menu.Settings',
    defaultMessage: 'CoMapeo Settings',
  },
  bgMap: {
    id: '$1Navigation.Menu.bgMap',
    defaultMessage: 'Background Map',
  },
  gatherObservations: {
    id: '$1Navigation.Menu.gatherObservations',
    defaultMessage: 'Gather Observations',
  },
  exchange: {
    id: '$1Navigation.Menu.exchange',
    defaultMessage: 'Exchange',
  },
  mappingOnOwn: {
    id: '$1Navigation.Menu.mappingOnOwn',
    defaultMessage: "You're mapping on your own.",
  },
  coordinator: {
    id: '$1Navigation.Menu.coordinator',
    defaultMessage: 'Coordinator',
  },
  participant: {
    id: '$1Navigation.Menu.participant',
    defaultMessage: 'Participant',
  },
  justYou: {
    id: '$1Navigation.Menu.justYou',
    defaultMessage: 'Just You',
  },
  earlyAccessOn: {
    id: '$1Navigation.Menu.earlyAccessOn',
    defaultMessage: 'Early Access ON',
  },
  earlyAccessTurnOff: {
    id: '$1Navigation.Menu.earlyAccessTurnOff',
    defaultMessage: 'Turn Off',
  },
  team: {
    id: '$1Navigation.Menu.team',
    defaultMessage: 'Team',
  },
  coordinatorTools: {
    id: '$1Navigation.Menu.coordinatorTools',
    defaultMessage: 'Coordinator Tools',
  },
  switchOrganization: {
    id: '$1Navigation.Menu.switchOrganization',
    defaultMessage: 'Switch organization',
    // SPEC A §6.1:201 — opens the modal Organizations selector (§7:226).
    // pt-BR ships the verbatim §6.1 string "Trocar de organização".
    description: 'Drawer menu entry that opens the organization selector',
  },
  // Same intl id + byte-identical defaultMessage as
  // CreateOrganization.tsx / Success.tsx (identical duplicates pass the
  // extraction gate); the drawer entry reuses the onboarding title.
  createOrganization: {
    id: '$1screens.OrganizationSetup.createOrganization',
    defaultMessage: 'Create Organization',
  },
});
export function DrawerMenu({closeMenu}: {closeMenu: () => void}) {
  const {formatMessage} = useIntl();
  const navigation = useNavigationFromRoot();

  const {projectId} = useActiveProject();
  const projectDetails = useProjectRoleAndDetails(projectId);
  const {role, projectColor, projectDescription, projectHeader} =
    projectDetails;
  // SPEC 3.9/15: a marker description displays as the organization name,
  // never the raw technical value.
  const displayableDescription = displayDescription(projectDescription);
  // The organization card replaces the legacy description only when a
  // usable organization derives from the document (SPEC A §4.2 rule 5);
  // solo/free projects keep their legacy line (retirement is Phase 9).
  const estadoOrganizacoes = useCoiabOrganizationsState();
  const semOrganizacaoOperavel =
    derivarProjectIdAtivo(estadoOrganizacoes) === null;
  const {data} = useStorageReadingQuery();
  const {freeBytes, totalBytes} = data;
  const isLow = isLowStorage(freeBytes);
  const percentUsed = calcUsedPercentage(freeBytes, totalBytes);

  const isEarly = useEarlyAccessState(s => s.isEarlyAccessEnabled);
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, {paddingTop: insets.top}]}>
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <View style={styles.topCardsContainer}>
          {isLow && (
            <MenuLowStorageAlert
              freeBytes={freeBytes}
              percentUsed={percentUsed}
            />
          )}
          {isEarly ? (
            <ColorCard backgroundColor={LIGHT_ORANGE}>
              <View style={styles.earlyAccessAlert}>
                <View style={styles.earlyAccessRow}>
                  <MaterialIcon name="flag" size={20} color={NEW_DARK_GREY} />
                  <HeaderText variant="header6" style={styles.earlyAccessLabel}>
                    {formatMessage(m.earlyAccessOn)}
                  </HeaderText>
                  <Pressable
                    onPress={() => navigation.navigate('EarlyAccess')}
                    hitSlop={{top: 12, bottom: 12, left: 12, right: 12}}>
                    <BodyText
                      variant="tinyMeta"
                      style={styles.earlyAccessTurnOff}>
                      {formatMessage(m.earlyAccessTurnOff)}
                    </BodyText>
                  </Pressable>
                </View>
              </View>
            </ColorCard>
          ) : null}
          <ColorCard backgroundColor={projectColor}>
            <View style={{padding: 20, gap: 12}}>
              <HeaderText variant="header2">{projectHeader}</HeaderText>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                }}>
                <MaterialIcon
                  color={NEW_DARK_GREY}
                  size={20}
                  name={
                    role === 'solo'
                      ? 'person'
                      : role === 'coordinator'
                        ? 'manage-accounts'
                        : 'people'
                  }
                />
                <BodyText style={{flex: 1, color: NEW_DARK_GREY}}>
                  {role === 'solo'
                    ? formatMessage(m.justYou)
                    : role === 'coordinator'
                      ? formatMessage(m.coordinator)
                      : formatMessage(m.participant)}
                </BodyText>
              </View>
              {semOrganizacaoOperavel ? (
                (role === 'solo' || displayableDescription) && (
                  <BodyText style={{color: NEW_DARK_GREY}}>
                    {role === 'solo'
                      ? formatMessage(m.mappingOnOwn)
                      : displayableDescription}
                  </BodyText>
                )
              ) : (
                <>
                  <OrganizationAreaAccesses closeMenu={closeMenu} />
                  {/* SPEC A §6.1:201/§8:247 — the selector entry exists
                      only with early access on AND two or more
                      organizations; with either false it does not exist
                      (no hidden or disabled control). */}
                  {isEarly && estadoOrganizacoes.organizacoes.length >= 2 && (
                    <TouchableOpacity
                      testID="MENU.trocar-organizacao"
                      style={styles.trocarOrganizacaoRow}
                      onPress={() => {
                        closeMenu();
                        navigation.navigate('Organizations');
                      }}
                      accessibilityLabel="Open the organization selector.">
                      <BodyText variant="medium">
                        {formatMessage(m.switchOrganization)}
                      </BodyText>
                    </TouchableOpacity>
                  )}
                  {/* SPEC Fase 6/Q3: the create entry exists only with
                      early access on AND an operating organization; with
                      either false it does not exist (no hidden or
                      disabled control). Q4: reuses the canonical
                      $1screens.OrganizationSetup.createOrganization id. */}
                  {isEarly && !semOrganizacaoOperavel && (
                    <TouchableOpacity
                      testID="MENU.criar-organizacao"
                      style={styles.trocarOrganizacaoRow}
                      onPress={() => {
                        closeMenu();
                        navigation.navigate('CreateOrganization');
                      }}
                      accessibilityLabel="Open the organization creation flow.">
                      <BodyText variant="medium">
                        {formatMessage(m.createOrganization)}
                      </BodyText>
                    </TouchableOpacity>
                  )}
                </>
              )}
            </View>
          </ColorCard>
        </View>

        <View style={styles.bottomItemsContainer}>
          {role !== 'solo' && (
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                navigation.navigate('YourTeam');
              }}
              accessibilityLabel="Go to your team screen.">
              <MaterialIcon color={NEW_DARK_GREY} size={20} name={'people'} />
              <BodyText variant="medium" style={{paddingLeft: 12}}>
                {formatMessage(m.team)}
              </BodyText>
            </TouchableOpacity>
          )}
          {role === 'coordinator' && (
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                navigation.navigate('ProjectSettings');
              }}
              accessibilityLabel="Go to project settings screen.">
              <MaterialIcon
                color={NEW_DARK_GREY}
                size={20}
                name={'manage-accounts'}
              />
              <BodyText variant="medium" style={{paddingLeft: 12}}>
                {formatMessage(m.coordinatorTools)}
              </BodyText>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              navigation.popTo('Home', {screen: 'Map'});
              closeMenu();
            }}
            accessibilityLabel="Go to map screen.">
            <Octicons name="plus-circle" size={20} color={NEW_DARK_GREY} />
            <BodyText variant="medium" style={{paddingLeft: 12}}>
              {formatMessage(m.gatherObservations)}
            </BodyText>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => navigation.navigate('BackgroundMaps')}
            accessibilityLabel="Go to background maps screen.">
            <MaterialIcon name="layers" size={20} color={NEW_DARK_GREY} />
            <BodyText variant="medium" style={{paddingLeft: 12}}>
              {formatMessage(m.bgMap)}
            </BodyText>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => navigation.navigate('AppSettings')}
            accessibilityLabel="Go to app settings screen.">
            <IonIcon name="settings-outline" size={20} color={NEW_DARK_GREY} />
            <BodyText variant="medium" style={{paddingLeft: 12}}>
              {formatMessage(m.appSettings)}
            </BodyText>
          </TouchableOpacity>
        </View>
      </ScrollView>
      <View style={{marginBottom: 20, marginHorizontal: 20}}>
        <PrimaryButton
          testID="MENU.main-action-button"
          style={{
            alignSelf: 'center',
            width: '100%',
            maxWidth: 280,
          }}
          onPress={() => {
            navigation.navigate('Sync');
          }}
          fullSize={false}
          text={formatMessage(m.exchange)}
          renderIcon={() => <Exchange color={WHITE} />}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: WHITE,
  },
  scrollContainer: {
    flexGrow: 1,
    padding: 20,
    flexDirection: 'column',
    justifyContent: 'space-between',
  },
  topCardsContainer: {
    gap: 12,
  },
  bottomItemsContainer: {
    gap: 20,
    paddingBottom: 20,
  },
  menuItem: {
    minHeight: 48,
    paddingHorizontal: 15,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  earlyAccessAlert: {
    padding: 15,
  },
  earlyAccessRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  earlyAccessLabel: {
    flex: 1,
  },
  earlyAccessTurnOff: {
    color: COMAPEO_BLUE,
  },
  trocarOrganizacaoRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
  },
});
