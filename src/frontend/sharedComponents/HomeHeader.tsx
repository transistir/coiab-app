import React from 'react';
import {View, StyleSheet} from 'react-native';
import {BottomTabHeaderProps} from '@react-navigation/bottom-tabs';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useIntl} from 'react-intl';

import {HeaderText} from './Text/HeaderText';
import {BLUE_GREY} from '../lib/styles';
import {VISUAL_AREA, VISUAL_TERRITORIO} from '../lib/organization/areaVisual';
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
  const {formatMessage} = useIntl();
  const {projectId} = useActiveProject();
  const projectDetails = useProjectRoleAndDetails(projectId);
  // A organização ativa só nomeia o header quando o app a está operando
  // (SPEC A §4.2 regra 5) — a derivação inteira vive em useOrganizacaoAtiva.
  const organizacaoAtiva = useOrganizacaoAtiva();
  const {data} = useStorageReadingQuery();
  const isLow = isLowStorage(data.freeBytes);
  const insets = useSafeAreaInsets();
  const headerRight = options.headerRight?.({canGoBack: false});

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
        {organizacaoAtiva ? (
          <View testID="HOME.header-title-box" style={styles.titleBoxBloco}>
            <View
              testID="HOME.header-bloco"
              accessible
              accessibilityLabel={`${organizacaoAtiva.organizacao.nome}, ${formatMessage(
                VISUAL_AREA[organizacaoAtiva.area].rotulo,
              )}`}
              style={styles.bloco}>
              <View
                testID="HOME.header-faixa-territorio"
                style={[
                  styles.faixa,
                  {backgroundColor: VISUAL_TERRITORIO.fundo},
                ]}>
                <HeaderText
                  testID="HOME.header-title"
                  variant="header6"
                  style={{flexShrink: 1, color: VISUAL_TERRITORIO.texto}}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  maxFontSizeMultiplier={1.3}>
                  {organizacaoAtiva.organizacao.nome}
                </HeaderText>
              </View>
              <View
                testID="HOME.header-faixa-area"
                style={[
                  styles.faixa,
                  {backgroundColor: VISUAL_AREA[organizacaoAtiva.area].fundo},
                ]}>
                <HeaderText
                  testID="HOME.header-area"
                  variant="header6"
                  style={{
                    flexShrink: 1,
                    color: VISUAL_AREA[organizacaoAtiva.area].texto,
                  }}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  maxFontSizeMultiplier={1.3}>
                  {formatMessage(VISUAL_AREA[organizacaoAtiva.area].rotulo)}
                </HeaderText>
              </View>
            </View>
            {isLow && (
              <View style={styles.badge}>
                <ExclamationBadge testID="low-storage-badge" />
              </View>
            )}
          </View>
        ) : (
          <View
            testID="HOME.header-title-box"
            style={[
              styles.titleBox,
              {backgroundColor: projectDetails.projectColor},
            ]}>
            <View testID="HOME.header-pilula">
              <HeaderText
                testID="HOME.header-title"
                variant="header4"
                style={styles.text}
                numberOfLines={1}
                ellipsizeMode="tail">
                {projectDetails.projectHeader}
              </HeaderText>
            </View>
            {isLow && (
              <View style={styles.badge}>
                <ExclamationBadge testID="low-storage-badge" />
              </View>
            )}
          </View>
        )}
        {headerRight ? (
          <View testID="HOME.header-right" style={styles.headerRight}>
            {headerRight}
          </View>
        ) : null}
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
  titleBoxBloco: {
    flexShrink: 1,
  },
  bloco: {
    borderRadius: 6,
    overflow: 'hidden',
    borderWidth: 0.5,
    borderColor: BLUE_GREY,
    flexShrink: 1,
  },
  faixa: {
    paddingVertical: 2,
    paddingHorizontal: 8,
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    flexShrink: 0,
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
