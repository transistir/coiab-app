import {Animated, Dimensions} from 'react-native';

import {
  MENU_TRANSITION_SPEC,
  menuSceneInterpolator,
  menuSceneTranslateX,
} from './menuTransition';

const screenWidth = Dimensions.get('window').width;

function translateXAt(progress: number): number {
  const style = menuSceneInterpolator({
    current: {progress: new Animated.Value(progress)},
  });
  const transform = style.sceneStyle as unknown as {
    transform: Array<{translateX: {__getValue: () => number}}>;
  };
  return transform.transform[0]!.translateX.__getValue();
}

describe('menuTransition — slide-in rápido da esquerda (#121)', () => {
  describe('menuSceneTranslateX (curva pura)', () => {
    test('progresso 0 = totalmente fora da tela, à esquerda', () => {
      expect(menuSceneTranslateX(0, screenWidth)).toBe(-screenWidth);
    });

    test('progresso 1 = posição de repouso (translateX 0)', () => {
      expect(menuSceneTranslateX(1, screenWidth)).toBe(0);
    });

    test('progresso intermediário é linear e monotônico', () => {
      expect(menuSceneTranslateX(0.5, screenWidth)).toBe(-screenWidth / 2);
      expect(menuSceneTranslateX(0.25, screenWidth)).toBe(-screenWidth * 0.75);

      const samples = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1].map(progress =>
        menuSceneTranslateX(progress, screenWidth),
      );
      for (let i = 1; i < samples.length; i++) {
        expect(samples[i]!).toBeGreaterThan(samples[i - 1]!);
      }
    });

    test('clampa valores fora de [0, 1]', () => {
      expect(menuSceneTranslateX(-1, screenWidth)).toBe(-screenWidth);
      expect(menuSceneTranslateX(2, screenWidth)).toBe(0);
    });
  });

  describe('menuSceneInterpolator (adapter do navigator)', () => {
    // @react-navigation/bottom-tabs usa progress = 0 para a aba focada,
    // 1 para uma aba à direita e -1 para uma aba à esquerda. O Menu é a
    // primeira aba, então só precisa de 0 e 1 na prática.
    test('Menu focado (progress 0) fica em repouso', () => {
      expect(translateXAt(0)).toBe(0);
    });

    test('Menu não focado (progress 1) fica fora à esquerda', () => {
      expect(translateXAt(1)).toBe(-screenWidth);
    });

    test('progress -1 também mantém o Menu fora à esquerda', () => {
      expect(translateXAt(-1)).toBe(-screenWidth);
    });
  });

  describe('MENU_TRANSITION_SPEC', () => {
    test('é timing com duração rápida (<= 250ms)', () => {
      expect(MENU_TRANSITION_SPEC.animation).toBe('timing');

      if (MENU_TRANSITION_SPEC.animation !== 'timing') {
        throw new Error('esperava uma transitionSpec de timing');
      }

      expect(MENU_TRANSITION_SPEC.config.duration).toBeGreaterThan(0);
      expect(MENU_TRANSITION_SPEC.config.duration).toBeLessThanOrEqual(250);
      expect(MENU_TRANSITION_SPEC.config.easing).toBeDefined();
    });
  });
});
