import * as React from 'react';
import {StyleSheet, View} from 'react-native';

import NotebookPenIcon from '../../images/NotebookPen.svg';
import TabIconFunil from '../../images/TabIconFunil.svg';
import TabIconMapaDobrado from '../../images/TabIconMapaDobrado.svg';
import TabIconSino from '../../images/TabIconSino.svg';
import {
  COIAB_GREEN,
  COIAB_OCRE,
  COIAB_ORANGE,
  COIAB_RED,
  MEDIUM_GREY,
} from '../../lib/styles';

export type TabIconProps = {
  /** Aba ativa: laranja COIAB; inativa: cinza (padrão da tab anterior). */
  active: boolean;
  /**
   * Badge de pendência (#32): pontinho verde sob a aba — infra pronta, sem
   * uso ainda (chega com as notificações/filtros reais).
   */
  showDot?: boolean;
};

const ICON_HEIGHT = 24;
// O círculo do mapa é maior que os ícones vizinhos (Figma `2668:4449`).
const MAP_CIRCLE_HEIGHT = 40;
const DOT_SIZE = 8;

const BARRAS = [
  // Um traço por módulo da organização (doc/proposta-rotas-coiab.md).
  {modulo: 'monitoramento', cor: COIAB_ORANGE},
  {modulo: 'cadeias', cor: COIAB_GREEN},
  {modulo: 'censo', cor: COIAB_OCRE},
  {modulo: 'alertas', cor: COIAB_RED},
] as const;

function IconWithDot({
  showDot,
  children,
}: React.PropsWithChildren<{showDot?: boolean}>) {
  if (!showDot) return <>{children}</>;
  return (
    <View style={styles.iconColumn}>
      {children}
      <View style={styles.dot} testID="tabBadgeDot" />
    </View>
  );
}

/** Entroncamento: 4 traços empilhados, um por módulo da organização. */
export const TabIconEntroncamento = ({active, showDot}: TabIconProps) => (
  <IconWithDot showDot={showDot}>
    <View style={styles.bars}>
      {BARRAS.map(({modulo, cor}) => (
        <View
          key={modulo}
          style={[styles.bar, {backgroundColor: active ? cor : MEDIUM_GREY}]}
        />
      ))}
    </View>
  </IconWithDot>
);

/** Filtros: funil (traço do Figma `2668:4449`, aba 2). */
export const TabIconFiltros = ({active, showDot}: TabIconProps) => (
  <IconWithDot showDot={showDot}>
    <TabIconFunil
      color={active ? COIAB_ORANGE : MEDIUM_GREY}
      height={ICON_HEIGHT}
      width={(ICON_HEIGHT * 20) / 22}
    />
  </IconWithDot>
);

/** Mapa: mapa dobrado dentro do círculo destacado (Figma `2668:4449`, aba 3). */
export const TabIconMapa = ({active, showDot}: TabIconProps) => (
  <IconWithDot showDot={showDot}>
    <TabIconMapaDobrado
      color={active ? COIAB_ORANGE : MEDIUM_GREY}
      height={MAP_CIRCLE_HEIGHT}
      width={MAP_CIRCLE_HEIGHT}
    />
  </IconWithDot>
);

/** Notificações: sino (traço do Figma `2668:4449`, aba 4). */
export const TabIconNotificacoes = ({active, showDot}: TabIconProps) => (
  <IconWithDot showDot={showDot}>
    <TabIconSino
      color={active ? COIAB_ORANGE : MEDIUM_GREY}
      height={ICON_HEIGHT}
      width={ICON_HEIGHT}
    />
  </IconWithDot>
);

/** Paneiro: caderneta (ícone de observações já existente no app). */
export const TabIconPaneiro = ({active, showDot}: TabIconProps) => (
  <IconWithDot showDot={showDot}>
    <NotebookPenIcon
      color={active ? COIAB_ORANGE : MEDIUM_GREY}
      height={ICON_HEIGHT}
    />
  </IconWithDot>
);

const styles = StyleSheet.create({
  iconColumn: {
    alignItems: 'center',
  },
  bars: {
    height: ICON_HEIGHT,
    justifyContent: 'space-between',
  },
  bar: {
    width: 22,
    height: 3,
    borderRadius: 1.5,
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    backgroundColor: COIAB_GREEN,
    marginTop: 2,
  },
});
