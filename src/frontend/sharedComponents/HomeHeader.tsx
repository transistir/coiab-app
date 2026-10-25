import React from 'react';
import {View, StyleSheet} from 'react-native';
import {BottomTabHeaderProps} from '@react-navigation/bottom-tabs';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {HeaderText} from './Text/HeaderText';
import {BLUE_GREY} from '../lib/styles';
import {useProjectRoleAndDetails} from '../hooks/useProjectRoleAndDetails';
import {useActiveProject} from '../contexts/ActiveProjectContext';
import {useOrganizacaoAtiva} from '../hooks/useOrganizacaoAtiva';
import {isLowStorage} from '../lib/storage';
import {useStorageReadingQuery} from '../hooks/useStorageReadingQuery';
import {ExclamationBadge} from './Storage/ExclamationBadge';

type HomeHeaderProps = BottomTabHeaderProps & {
  backgroundColor: string;
  showBottomBorder: boolean;
};

export function HomeHeader({
  backgroundColor,
  showBottomBorder,
  options,
}: HomeHeaderProps) {
  const {projectId} = useActiveProject();
  const projectDetails = useProjectRoleAndDetails(projectId);
  // A organização ativa só nomeia o header quando o app a está operando
  // (SPEC A §4.2 regra 5) — a derivação inteira vive em useOrganizacaoAtiva.
  const organizacaoAtiva = useOrganizacaoAtiva();
  const {data} = useStorageReadingQuery();
  const isLow = isLowStorage(data.freeBytes);
  const insets = useSafeAreaInsets();

  return (
    <View
      testID="HOME.header-container"
      style={[
        styles.container,
        {
          backgroundColor,
          borderBottomWidth: showBottomBorder ? 1 : 0,
          borderBottomColor: showBottomBorder ? BLUE_GREY : 'transparent',
          paddingTop: insets.top,
        },
      ]}>
      <View style={styles.headerRow}>
        <View
          testID="HOME.header-title-box"
          style={[
            styles.titleBox,
            {backgroundColor: projectDetails.projectColor},
          ]}>
          <HeaderText
            testID="HOME.header-title"
            variant="header4"
            style={styles.text}
            numberOfLines={1}
            ellipsizeMode="tail">
            {organizacaoAtiva?.nome ?? projectDetails.projectHeader}
          </HeaderText>
          {isLow && (
            <View style={{position: 'absolute', top: -2, right: -2}}>
              <ExclamationBadge testID="low-storage-badge" />
            </View>
          )}
        </View>
        <View testID="HOME.header-right" style={styles.headerRight}>
          {options.headerRight?.({canGoBack: false})}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 10,
  },
  headerRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  titleBox: {
    height: 40,
    borderRadius: 6,
    borderWidth: 0.5,
    borderColor: BLUE_GREY,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 10,
    paddingRight: 10,
    flexShrink: 1,
  },
  // A pílula encolhe (flexShrink 1 + reticências) e o headerRight nunca (flexShrink 0): o botão mantém a largura com qualquer título.
  headerRight: {
    paddingLeft: 10,
    flexShrink: 0,
  },
  text: {
    flexShrink: 1,
  },
});
