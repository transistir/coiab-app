import * as React from 'react';
import {StyleSheet, View} from 'react-native';

import NotebookPenIcon from '../../images/NotebookPen.svg';
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
};

const ICON_HEIGHT = 24;
// O círculo do mapa é maior que os ícones vizinhos (Figma `2668:4449`).
const MAP_CIRCLE_HEIGHT = 40;

const BARRAS = [
  // Um traço por módulo da organização (doc/proposta-rotas-coiab.md).
  {modulo: 'monitoramento', cor: COIAB_ORANGE},
  {modulo: 'cadeias', cor: COIAB_GREEN},
  {modulo: 'censo', cor: COIAB_OCRE},
  {modulo: 'alertas', cor: COIAB_RED},
] as const;

/**
 * Organização (ex-Entroncamento): o logo "bars" do Figson `2122:6281` — 4
 * traços empilhados, um por módulo da organização. É a aba principal e, por
 * decisão de campo, não leva rótulo visível (ver TabBar).
 */
export const TabIconOrganizacao = ({active}: TabIconProps) => (
  <View style={styles.bars}>
    {BARRAS.map(({modulo, cor}) => (
      <View
        key={modulo}
        style={[styles.bar, {backgroundColor: active ? cor : MEDIUM_GREY}]}
      />
    ))}
  </View>
);

/** Mapa: mapa dobrado dentro do círculo destacado (Figma `2668:4449`, aba 3). */
export const TabIconMapa = ({active}: TabIconProps) => (
  <TabIconMapaDobrado
    color={active ? COIAB_ORANGE : MEDIUM_GREY}
    height={MAP_CIRCLE_HEIGHT}
    width={MAP_CIRCLE_HEIGHT}
  />
);

/** Notificações: sino (traço do Figma `2668:4449`, aba 4). */
export const TabIconNotificacoes = ({active}: TabIconProps) => (
  <TabIconSino
    color={active ? COIAB_ORANGE : MEDIUM_GREY}
    height={ICON_HEIGHT}
    width={ICON_HEIGHT}
  />
);

/** Paneiro: caderneta (ícone de observações já existente no app). */
export const TabIconPaneiro = ({active}: TabIconProps) => (
  <NotebookPenIcon
    color={active ? COIAB_ORANGE : MEDIUM_GREY}
    height={ICON_HEIGHT}
  />
);

const styles = StyleSheet.create({
  bars: {
    height: ICON_HEIGHT,
    justifyContent: 'space-between',
  },
  bar: {
    width: 22,
    height: 3,
    borderRadius: 1.5,
  },
});
