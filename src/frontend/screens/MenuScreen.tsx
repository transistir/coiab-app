import * as React from 'react';
import {View, StyleSheet} from 'react-native';

import {DARK_GREY} from '../lib/styles';
import {DrawerMenu} from '../sharedComponents/DrawerMenu';
import {NativeHomeTabsNavigationProps} from '../sharedTypes/navigation';

/**
 * COIAB (#32 fase 3): a página de Menu da organização, aberta pelo 1º botão
 * da tab bar (ícone "bars"/dashboard do Figma `footer-menu`). A remodelagem
 * chegou: o conteúdo é agora a "Página Entroncamento" do Figma Kutary App
 * V2 (`2668:4539`) — saudação "Olá, Parente" + projeto corrente, os dois
 * cards clicáveis (Monitoramento Territorial/Alertas) e a lista
 * trocar/convidar/criar. A gaveta (drawer) do header não existe mais — ver
 * `docs/navegacao-coiab.md`.
 *
 * #118: a página usa o fundo do tema (DARK_GREY) — o DrawerMenu cobre o
 * container inteiro, mas o fundo do container também é escuro para não
 * vazar branco em cantos/overlays.
 *
 * O container carrega o testID `ENTRONCAMENTO.scrn` por continuidade: é a
 * Home pós-login (rota inicial das abas) que os testes de navigator do #32
 * localizam. `MENU.scrn` identifica a página de menu propriamente dita.
 */
export const MenuScreen: React.FC<
  NativeHomeTabsNavigationProps<'Menu'>
> = () => {
  return (
    <View style={styles.container} testID="ENTRONCAMENTO.scrn">
      <View style={styles.inner} testID="MENU.scrn">
        {/* Sem gaveta para fechar quando o menu é uma página: closeMenu é
            no-op; as entradas que navegam para outras telas seguem iguais. */}
        <DrawerMenu closeMenu={() => {}} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DARK_GREY,
  },
  inner: {
    flex: 1,
  },
});
