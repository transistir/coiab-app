import {Dimensions, Easing} from 'react-native';
import type {BottomTabNavigationOptions} from '@react-navigation/bottom-tabs';

type SceneStyleInterpolator = NonNullable<
  BottomTabNavigationOptions['sceneStyleInterpolator']
>;
type SceneInterpolationProps = Parameters<SceneStyleInterpolator>[0];
type SceneInterpolatedStyle = ReturnType<SceneStyleInterpolator>;
type TransitionSpec = NonNullable<BottomTabNavigationOptions['transitionSpec']>;

/**
 * 180ms é rápido o bastante para espelhar o push do AppSettings sem parecer
 * que a tela "flutua" — fica dentro da faixa pedida (<= 250ms).
 */
export const MENU_TRANSITION_SPEC: TransitionSpec = {
  animation: 'timing',
  config: {
    duration: 180,
    easing: Easing.out(Easing.cubic),
  },
};

/**
 * Curva pura do slide: `progress` é o quanto da entrada já aconteceu.
 * 0 = totalmente fora da tela, à esquerda (-screenWidth);
 * 1 = posição de repouso (translateX 0). Linear de propósito — a suavização
 * vem do easing da `transitionSpec`.
 */
export function menuSceneTranslateX(
  progress: number,
  screenWidth: number,
): number {
  const clamped = Math.min(1, Math.max(0, progress));
  // Evita `-0` no repouso: `toBe(0)` e comparações exatas esperam 0.
  return clamped === 1 ? 0 : -screenWidth * (1 - clamped);
}

/**
 * Adapter para o `sceneStyleInterpolator` do @react-navigation/bottom-tabs.
 *
 * Em bottom-tabs 7.16.1 a cena desfocada recebe
 * `progress = index >= state.index ? 1 : -1` (`BottomTabView`:
 * `toValue = index === state.index ? 0 : index >= state.index ? 1 : -1`).
 * O Menu é a primeira aba (index 0), então enquanto qualquer outra aba está
 * focada seu progress é sempre -1 — nunca +1. Na prática ele só vê 0 (focado)
 * e -1 (desfocado).
 *
 * O mapeamento é simétrico: `[-1, 0, 1] -> [-w, 0, -w]`. Os dois extremos
 * caem fora da tela à esquerda, então a cena entra da esquerda (-w -> 0) ao
 * focar e sai para a esquerda (0 -> -w) ao desfocar. Não estreitar o
 * `inputRange` para `[0, 1]`: com -1 o `interpolate` extrapola para +w e o
 * Menu passaria a entrar pela direita. O teste do adapter com -1 guarda isso.
 *
 * Só o Menu declara interpolator, então nenhuma outra cena se desloca.
 */
export function menuSceneInterpolator({
  current,
}: SceneInterpolationProps): SceneInterpolatedStyle {
  const screenWidth = Dimensions.get('window').width;

  return {
    sceneStyle: {
      transform: [
        {
          translateX: current.progress.interpolate({
            inputRange: [-1, 0, 1],
            outputRange: [
              menuSceneTranslateX(0, screenWidth),
              menuSceneTranslateX(1, screenWidth),
              menuSceneTranslateX(0, screenWidth),
            ],
          }),
        },
      ],
    },
  };
}
