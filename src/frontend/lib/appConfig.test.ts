import * as fs from 'fs';

// Issue #19 (PR A, passo 4). O app.json define o fundo do splash e do ícone
// adaptativo e cita as PNGs de assets. O teste decodifica só o IHDR (cabeça)
// manualmente: dimensões, bit depth e colorType. Pixels de alfa/conteúdo
// são verificados por script descartável na mesma sessão (limitação
// registrada no PR); pngjs NÃO é dependência do projeto e não instalamos.

import {COMAPEO_DARK_BLUE} from './styles';

function campoDe(objeto: unknown, chave: string): unknown {
  if (objeto === null || typeof objeto !== 'object' || !(chave in objeto)) {
    throw new Error(`app.json sem "${chave}"`);
  }
  return (objeto as Record<string, unknown>)[chave];
}

// IHDR: assinatura PNG (8 bytes) + tamanho do primeiro chunk + "IHDR"
// (12 bytes prefixo) + width:16-20, height:20-24, bitDepth:24, colorType:25.
function ihdrDe(caminho: string): {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
} {
  const bytes = fs.readFileSync(caminho);
  if (bytes.subarray(0, 8).toString('latin1') !== '\x89PNG\r\n\x1a\n') {
    throw new Error(`não é PNG: ${caminho}`);
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    bitDepth: bytes.readUInt8(24),
    colorType: bytes.readUInt8(25),
  };
}

function tamanhoCabecalho(caminho: string): {
  size: [number, number];
  bitDepth: number;
  colorType: number;
} {
  const ihdr = ihdrDe(caminho);
  return {
    size: [ihdr.width, ihdr.height],
    bitDepth: ihdr.bitDepth,
    colorType: ihdr.colorType,
  };
}

// O splash vive no plugins: ["expo-splash-screen", {…}] — não é chave de expo.
function opcoesSplashScreen(expo: unknown): unknown {
  const plugins = campoDe(expo, 'plugins');
  if (!Array.isArray(plugins)) {
    throw new Error('app.json sem "plugins" em expo');
  }
  const entrada = plugins.find(
    item => Array.isArray(item) && item[0] === 'expo-splash-screen',
  );
  const opcoes = entrada === undefined ? undefined : entrada[1];
  if (opcoes === null || typeof opcoes !== 'object') {
    throw new Error('expo-splash-screen sem opções no app.json');
  }
  return opcoes;
}
describe('appConfig de ícone e splash (PR A #19, passo 4)', () => {
  test('splash e ícone adaptativo usam COMAPEO_DARK_BLUE e a frente independente', () => {
    const expo = campoDe(
      JSON.parse(fs.readFileSync('app.json', 'utf8')),
      'expo',
    );
    const splash = opcoesSplashScreen(expo);
    const android = campoDe(expo, 'android');
    const adaptiveIcon = campoDe(android, 'adaptiveIcon');

    expect(campoDe(splash, 'backgroundColor')).toBe(COMAPEO_DARK_BLUE);
    expect(campoDe(adaptiveIcon, 'backgroundColor')).toBe(COMAPEO_DARK_BLUE);
    expect(campoDe(adaptiveIcon, 'foregroundImage')).toBe(
      './assets/adaptive-icon.png',
    );
  });

  test('icon.png e adaptive-icon.png são 1024×1024 RGBA; splash tem largura ≥ 1200', () => {
    expect(tamanhoCabecalho('./assets/icon.png')).toEqual({
      size: [1024, 1024],
      bitDepth: 8,
      colorType: 6,
    });

    expect(tamanhoCabecalho('./assets/adaptive-icon.png')).toEqual({
      size: [1024, 1024],
      bitDepth: 8,
      colorType: 6,
    });

    expect(ihdrDe('./assets/splash.png').width).toBeGreaterThanOrEqual(1200);
    expect(ihdrDe('./assets/splash.png').colorType).toBe(6);
  });

  test('todo asset citado no app.json existe', () => {
    const expo = campoDe(
      JSON.parse(fs.readFileSync('app.json', 'utf8')),
      'expo',
    );
    const splash = opcoesSplashScreen(expo);
    const android = campoDe(expo, 'android');
    const adaptiveIcon = campoDe(android, 'adaptiveIcon');
    const citados: unknown[] = [
      campoDe(expo, 'icon'),
      campoDe(splash, 'image'),
      campoDe(adaptiveIcon, 'foregroundImage'),
    ];

    const ausentes = citados.filter(arquivo => !fs.existsSync(String(arquivo)));
    expect(ausentes).toEqual([]);
  });
});
