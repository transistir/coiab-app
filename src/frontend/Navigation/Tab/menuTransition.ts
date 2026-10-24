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
 * O navigator entrega `current.progress` = 0 para a aba focada, 1 para uma
 * aba à direita e -1 para uma aba à esquerda. O Menu é a primeira aba, então
 * na prática só vê 0 (focado) e 1 (outra aba focada). Mapeamos ambos os
 * extremos não focados para fora da tela à esquerda: ao voltar para o Menu a
 * cena entra da esquerda (-largura -> 0) e, ao sair, desliza para a esquerda.
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
