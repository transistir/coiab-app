import {VISUAL_AREA, VISUAL_TERRITORIO} from './areaVisual';
import {CHARCOAL, COIAB_ORANGE, COIAB_RED, DARK_GREY, WHITE} from '../styles';

/**
 * WCAG 2.x relative luminance for an sRGB hex colour (#rrggbb).
 * https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 */
function luminanciaRelativa(hex: string): number {
  const valor = hex.replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(valor)) {
    throw new Error(`Cor não é um hex sRGB de 6 dígitos: ${hex}`);
  }
  const canais = [0, 2, 4].map(offset => {
    const canal = parseInt(valor.slice(offset, offset + 2), 16) / 255;
    return canal <= 0.03928
      ? canal / 12.92
      : Math.pow((canal + 0.055) / 1.055, 2.4);
  });
  const [r = 0, g = 0, b = 0] = canais;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio: (L1 + 0.05) / (L2 + 0.05), lighter first. */
function razaoDeContraste(fundo: string, texto: string): number {
  const l1 = luminanciaRelativa(fundo);
  const l2 = luminanciaRelativa(texto);
  const claro = Math.max(l1, l2);
  const escuro = Math.min(l1, l2);
  return (claro + 0.05) / (escuro + 0.05);
}

describe('areaVisual', () => {
  it('T1: cada área tem fundo, texto e rótulo do card', () => {
    expect(VISUAL_AREA.monitoramento).toEqual({
      fundo: COIAB_ORANGE,
      texto: CHARCOAL,
      rotulo: expect.objectContaining({
        id: '$1sharedComponents.OrganizationAreaAccesses.cardMonitoramento',
      }),
    });
    expect(VISUAL_AREA.alertas).toEqual({
      fundo: COIAB_RED,
      texto: WHITE,
      rotulo: expect.objectContaining({
        id: '$1sharedComponents.OrganizationAreaAccesses.cardAlertas',
      }),
    });
    expect(VISUAL_TERRITORIO).toEqual({fundo: DARK_GREY, texto: WHITE});
  });

  it('T2: todo par texto/fundo tem contraste >= 4.5:1', () => {
    const pares = [
      ...Object.entries(VISUAL_AREA).map(([area, visual]) => ({
        nome: area,
        fundo: visual.fundo,
        texto: visual.texto,
      })),
      {
        nome: 'territorio',
        fundo: VISUAL_TERRITORIO.fundo,
        texto: VISUAL_TERRITORIO.texto,
      },
    ];

    for (const {nome, fundo, texto} of pares) {
      expect({nome, razao: razaoDeContraste(fundo, texto)}).toEqual({
        nome,
        razao: expect.any(Number),
      });
      expect(razaoDeContraste(fundo, texto)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
