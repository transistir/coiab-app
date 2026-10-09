import * as fs from 'fs';
import * as path from 'path';

// Issue #19 (PR A, passo 3). Nomes das constantes continuam os do CoMapeo,
// mas nenhum ARQUIVO pode carregar um azul fixo do CoMapeo — são os azuis
// que o CoMapeo hoje traz em SVGs e configs. Lista igual à do (b) de
// styles.test.ts: os hex de 3 dígitos são formas curtas dos 6 dígitos.
// O app.json entra na varredura com o passo 4 (it.todo abaixo).
// Lookup estático de string: Record<..., true> (regra ts-set-map).
const AZUL_COMAPEO: Record<string, true> = {
  '#0066ff': true,
  '#050f77': true,
  '#2752d1': true,
  '#17317c': true,
  '#4288f3': true,
  '#2348b2': true,
  '#ccffff': true,
};

const RAIZES = ['src', '.rnstorybook'];
const CANDIDATO =
  /#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})\b|rgba?\([^)]+\)/gi;

// #RGB/#RGBA/#RRGGBB/#RRGGBBAA (alfa descartado) e rgb()/rgba() → #rrggbb.
function paraHex6(cor: string): string | null {
  const alvo = cor.trim().toLowerCase();
  const hexMatch = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(
    alvo,
  );
  if (hexMatch !== null && hexMatch[1] !== undefined) {
    let digitos = hexMatch[1].split('');
    if (digitos.length === 3 || digitos.length === 4) {
      digitos = digitos.flatMap(digito => [digito, digito]);
    }
    const canal = (indice: number): string => {
      const par = `${digitos[indice] ?? '0'}${digitos[indice + 1] ?? '0'}`;
      return par;
    };
    return `#${canal(0) + canal(2) + canal(4)}`;
  }
  const lista = /^rgba?\(([0-9]{1,3}(\.[0-9]+)?)\s*,/.exec(alvo);
  if (lista === null || lista[1] === undefined) return null;
  const canais = alvo
    .replace(/^rgba?\(|\)$/g, '')
    .split(',')
    .map(parte => Number(parte.trim()));
  const hex = (valor: number | undefined): string =>
    Math.max(0, Math.min(255, Math.round(valor ?? 0)))
      .toString(16)
      .padStart(2, '0');
  return `#${hex(canais[0]) + hex(canais[1]) + hex(canais[2])}`;
}

function coletarArquivos(diretorio: string, achados: string[]): void {
  if (!fs.existsSync(diretorio)) return;
  for (const entrada of fs.readdirSync(diretorio, {withFileTypes: true})) {
    const caminho = path.join(diretorio, entrada.name);
    if (entrada.isDirectory()) {
      coletarArquivos(caminho, achados);
      continue;
    }
    if (!/\.(ts|tsx|svg)$/.test(entrada.name)) continue;
    // Varredura viva não conta testes: os próprios testes citam a lista.
    if (/\.test\.tsx?$/.test(entrada.name)) continue;
    const texto = fs.readFileSync(caminho, 'utf8');
    texto.split('\n').forEach((linha, indice) => {
      for (const bruto of linha.match(CANDIDATO) ?? []) {
        const hex = paraHex6(bruto);
        if (hex !== null && AZUL_COMAPEO[hex] === true) {
          achados.push(`${caminho}:${indice + 1}: ${bruto}`);
        }
      }
    });
  }
}

describe('azuis fixos em arquivos (PR A #19, passo 3)', () => {
  test('nenhum arquivo em src/ e .rnstorybook/ guarda azul do CoMapeo', () => {
    const achados: string[] = [];
    for (const raiz of RAIZES) coletarArquivos(raiz, achados);
    expect(achados).toEqual([]);
  });

  // Passo 4 do PR A integra app.json na mesma varredura azul-por-linha.
  test('app.json não carrega azul do CoMapeo', () => {
    const achados: string[] = [];
    fs.readFileSync('app.json', 'utf8')
      .split('\n')
      .forEach((linha, indice) => {
        for (const bruto of linha.match(CANDIDATO) ?? []) {
          const hex = paraHex6(bruto);
          if (hex !== null && AZUL_COMAPEO[hex] === true) {
            achados.push(`app.json:${indice + 1}: ${bruto}`);
          }
        }
      });
    expect(achados).toEqual([]);
  });
});
