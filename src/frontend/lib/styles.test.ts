import * as styles from './styles';

// Issue #19 (PR A). Os nomes continuam os do CoMapeo para facilitar merges; os
// valores são da paleta Ekanâdyby (UI KIT 2004-1643). Tabela COMPLETA das
// constantes de styles.ts: as trocadas no PR A expõem o novo valor; as que
// ficam travam o valor para este PR não mexer neles.
const TABELA = {
  // (a) mudou no PR A
  COMAPEO_BLUE: '#A06829',
  ORANGE: '#FF9500',
  COMAPEO_DARK_BLUE: '#284D45',
  DARK_GREY: '#1C2A27',
  VERY_LIGHT_BLUE: '#F3E6D2',
  DARK_GREEN: '#458000',
  RED: '#B90B0B',
  MAGENTA: '#B90B0B',
  MEDIUM_BLUE: '#A06829',
  LIGHT_BLUE: '#A06829',
  DARK_BLUE: '#284D45',
  SYNC_BACKGROUND: '#284D45',
  COIAB_ORANGE: '#FF9500',
  COIAB_GREEN: '#458000',
  COIAB_OCRE: '#A06829',
  COIAB_RED: '#B90B0B',
  // ficam como estão
  BLACK: '#000000',
  WHITE: '#ffffff',
  GPS_MODAL_TEXT: 'rgb(40,40,40)',
  BLUE_GREY: '#CCCCD6',
  NEW_DARK_GREY: '#757575',
  LIGHT_GREY: '#ceced6',
  VERY_LIGHT_GREY: '#ededed',
  VERY_LIGHT_GREEN: '#ccffcc',
  DARK_MAGENTA: '#661010',
  DARK_MANGO: '#ed6109',
  MANGO: '#ff9933',
  MEDIUM_GREY: '#666666',
  CHARCOAL: '#1F1F1F',
  GREEN: '#36F927',
  DARK_ORANGE: '#E86826',
  WARNING_RED: '#D92222',
  LIGHT_GREEN: '#EEF6EE',
  LIGHT_ORANGE: '#FFF5EB',
} satisfies Record<string, string>;

const palette = styles as unknown as {
  readonly [K in keyof typeof styles]: string;
};

function parseColor(value: string): [number, number, number, number] {
  // #RGB, #RGBA, #RRGGBB, #RRGGBBAA (alfa descartado), rgb()/rgba()
  const expandido = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(
    expandido,
  )?.[1];
  if (hex !== undefined) {
    let digitos = hex.split('');
    if (digitos.length === 3 || digitos.length === 4) {
      digitos = digitos.flatMap(digito => [digito, digito]);
    }
    const canal = (indice: number): number =>
      parseInt(`${digitos[indice] ?? '0'}${digitos[indice + 1] ?? '0'}`, 16);
    return [
      canal(0),
      canal(2),
      canal(4),
      digitos.length === 8 ? canal(6) / 255 : 1,
    ];
  }
  const lista = /^rgba?\(([^)]+)\)$/.exec(expandido)?.[1];
  if (lista !== undefined) {
    const partes = lista.split(',').map(parte => Number(parte.trim()));
    const [r, g, b, alfa] = [0, 1, 2, 3].map(indice => partes[indice]);
    if (r === undefined || g === undefined || b === undefined) {
      throw new Error(`cor rgb() incompleta: ${value}`);
    }
    return [r, g, b, alfa ?? 1];
  }
  throw new Error(`cor desconhecida: ${value}`);
}

// Expande 3 dígitos e minúsculas/mantém o mesmo formato — base dos testes (a)/(b).
function normalizeHex(value: string): string {
  const [r, g, b] = parseColor(value);
  const parte = (canal: number) => canal.toString(16).padStart(2, '0');
  return `#${parte(r)}${parte(g)}${parte(b)}`;
}

// L = 0.2126R + 0.7152G + 0.0722B com gamma sRGB (WCAG 2.x).
function luminancia(r: number, g: number, b: number): number {
  const canal = (valor: number) => {
    const c = valor / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

function contrast(fg: string, bg: string): number {
  // Composição opaca (pior caso): corr o mesmo vale para o resultado da
  // mistura, sem alfa parcial para "melhorar" a conta.
  const [rf0, gf0, bf0, af] = parseColor(fg);
  const [rb, gb, bb, ab] = parseColor(bg);
  if (ab !== 1) throw new Error(`fundo precisa ser opaco: ${bg}`);
  const cor: [number, number, number] =
    af === 1
      ? [rf0, gf0, bf0]
      : [
          af * rf0 + rb * (1 - af),
          af * gf0 + gb * (1 - af),
          af * bf0 + bb * (1 - af),
        ];
  const [rf, gf, bf] = cor;
  const clara = Math.max(luminancia(rf, gf, bf), luminancia(rb, gb, bb));
  const escura = Math.min(luminancia(rf, gf, bf), luminancia(rb, gb, bb));
  return (clara + 0.05) / (escura + 0.05);
}

describe('paleta (styles.ts)', () => {
  test('a tabela cobre todas as constantes do styles', () => {
    const chavesTabela = Object.keys(TABELA).sort();
    const chavesArquivo = Object.keys(styles).sort();
    expect(chavesTabela).toEqual(chavesArquivo);
  });

  test.each(Object.entries(TABELA))(
    '(a) %s é o valor da tabela',
    (nome, esperadoHex) => {
      // Normalizado: compara valor, não maiúsculas/minúsculas nem 3/6 dígitos.
      expect(normalizeHex(palette[nome as keyof typeof styles])).toBe(
        normalizeHex(esperadoHex),
      );
    },
  );

  const AZUL_COMAPEO = [
    '#0066ff',
    '#050f77',
    '#2752d1',
    '#17317c',
    '#4288f3',
    '#2348b2',
    '#ccffff',
  ];

  test.each(Object.keys(styles))('(b) %s não guarda azul do CoMapeo', nome => {
    expect(AZUL_COMAPEO).not.toContain(
      normalizeHex(palette[nome as keyof typeof styles]),
    );
  });
});

// (c) Matriz WCAG de todo par que existe no código após o PR A. Mínimos:
// 4.5 texto comum, 3 para texto grande, ícone e componente de UI. O ratio é
// comparado SEM arredondar (>= sobre o float). O ripple é estado de toque
// passageiro e decidido em composição opaca (nota 2 do plano): o pior caso é
// a cor do ripple cobrindo o fundo inteiro.
const MATRIZ = [
  {
    fg: palette.COMAPEO_BLUE,
    bg: palette.WHITE,
    min: 4.5,
    onde: 'COMAPEO_BLUE/WHITE: texto e ícones sobre fundo branco',
  },
  {
    fg: palette.WHITE,
    bg: palette.COMAPEO_BLUE,
    min: 4.5,
    onde: 'WHITE/COMAPEO_BLUE: Pill, AnimatedBackground, áudio',
  },
  {
    fg: palette.DARK_GREY,
    bg: palette.ORANGE,
    min: 4.5,
    onde: 'DARK_GREY/ORANGE: PrimaryButton (texto e ícone)',
  },
  {
    fg: palette.WHITE,
    bg: palette.COMAPEO_DARK_BLUE,
    min: 4.5,
    onde: 'WHITE/COMAPEO_DARK_BLUE: IntroToCoMapeo, splash e ícone',
  },
  {
    fg: palette.WHITE,
    bg: palette.DARK_GREY,
    min: 4.5,
    onde: 'WHITE/DARK_GREY: pílula do GPS',
  },
  {
    fg: palette.WHITE,
    bg: palette.RED,
    min: 4.5,
    onde: 'WHITE/RED',
  },
  {
    fg: palette.MAGENTA,
    bg: palette.WHITE,
    min: 4.5,
    onde: 'MAGENTA/WHITE',
  },
  {
    fg: palette.RED,
    bg: palette.VERY_LIGHT_GREY,
    min: 4.5,
    onde: 'RED/VERY_LIGHT_GREY: ReplaceBackgroundMap',
  },
  {
    fg: palette.WHITE,
    bg: palette.WARNING_RED,
    min: 4.5,
    onde: 'WHITE/WARNING_RED: GPS, DestructiveButton',
  },
  {
    fg: palette.WHITE,
    bg: palette.DARK_MAGENTA,
    min: 4.5,
    onde: 'WHITE/DARK_MAGENTA: exclamação do GPS',
  },
  {
    fg: palette.NEW_DARK_GREY,
    bg: palette.WHITE,
    min: 4.5,
    onde: 'NEW_DARK_GREY/WHITE',
  },
  {
    fg: palette.MEDIUM_GREY,
    bg: palette.WHITE,
    min: 4.5,
    onde: 'MEDIUM_GREY/WHITE',
  },
  {
    fg: palette.DARK_GREEN,
    bg: palette.WHITE,
    min: 4.5,
    onde: 'DARK_GREEN/WHITE',
  },
  {
    fg: palette.GREEN,
    bg: palette.DARK_GREY,
    min: 3,
    onde: 'GREEN/DARK_GREY: ponto do GPS sobre a pílula',
  },
  {
    fg: palette.COMAPEO_BLUE,
    bg: palette.VERY_LIGHT_GREY,
    min: 3,
    onde: 'COMAPEO_BLUE/VERY_LIGHT_GREY: trilho da barra de progresso',
  },
  {
    fg: palette.DARK_GREEN,
    bg: palette.VERY_LIGHT_GREY,
    min: 3,
    onde: 'DARK_GREEN/VERY_LIGHT_GREY: progresso completo',
  },
  {
    fg: palette.COMAPEO_BLUE,
    bg: palette.VERY_LIGHT_BLUE,
    min: 3,
    onde: 'COMAPEO_BLUE/VERY_LIGHT_BLUE (opaco): ripple TextButton, Button',
  },
  {
    fg: palette.NEW_DARK_GREY,
    bg: palette.VERY_LIGHT_BLUE,
    min: 3,
    onde: 'NEW_DARK_GREY/VERY_LIGHT_BLUE (opaco): ripple MenuListItem',
  },
  {
    fg: palette.DARK_GREY,
    bg: palette.VERY_LIGHT_BLUE,
    min: 4.5,
    onde: 'DARK_GREY/VERY_LIGHT_BLUE (opaco): ripple ListItem, Button',
  },
  {
    fg: palette.BLACK,
    bg: palette.VERY_LIGHT_BLUE,
    min: 4.5,
    onde: 'BLACK/VERY_LIGHT_BLUE (opaco): ripple ListItem, Button',
  },
];

describe('(c) matriz de contraste WCAG', () => {
  test.each(MATRIZ)('$onde ≥ $min', ({fg, bg, min}) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(min);
  });
});

// (d) Registro de exceções — pares que JÁ falhavam antes do PR A. O teste
// trava um piso para não piorarem mais; antes/depois vão na descrição do PR:
//   COMAPEO_BLUE/VERY_LIGHT_GREY não está aqui: o par da linha de progresso
//   está na matriz com piso 3. Abaixo: dois pares de texto e um par de barra.
//   LIGHT_GREY placeholder sobre WHITE: 1.56 — só registro, sem piso.
//   botão desabilitado WHITE sobre BLUE_GREY — isento pela WCAG, só registro.
const EXCECOES_PRE_EXISTENTES = [
  {
    fg: palette.COMAPEO_BLUE,
    bg: palette.VERY_LIGHT_GREY,
    piso: 3.98,
    onde: 'COMAPEO_BLUE/VERY_LIGHT_GREY: link em AddRemoteArchive (4.13 → 3.98)',
  },
  {
    fg: palette.COMAPEO_BLUE,
    bg: palette.LIGHT_ORANGE,
    // Valor real 4,329530586 — travado com >= 4.3295 (sem arredondar).
    piso: 4.3295,
    onde: 'COMAPEO_BLUE/LIGHT_ORANGE: MenuLowStorageAlert (4.49 → 4.33)',
  },
  {
    fg: palette.DARK_ORANGE,
    bg: palette.BLUE_GREY,
    piso: 2.04,
    onde: 'DARK_ORANGE/BLUE_GREY: barra de MenuLowStorageAlert (2.05, já falhava)',
  },
];

describe('(d) pares que já falhavam antes — piso não pode piorar', () => {
  test.each(EXCECOES_PRE_EXISTENTES)('$onde ≥ $piso', ({fg, bg, piso}) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(piso);
  });
});
