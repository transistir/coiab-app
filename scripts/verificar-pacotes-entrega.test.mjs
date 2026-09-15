/**
 * Testes do gate de entrega `scripts/verificar-pacotes-entrega.mjs` (Decisão
 * A/A3): uma build de entrega (APP_VARIANT production | preRelease) NÃO pode
 * levar os pacotes interinos — SPEC B `:313` — e deve falhar em
 * `eas-build-post-install`. Dev e RC (`development`, `releaseCandidate`) são
 * descartáveis e passam.
 *
 * Como o gerador de manifestos (gerar-manifestos-pacotes.test.mjs), o script
 * roda como processo node filho em raízes temporárias com um manifesto
 * sintético — os bytes reais do repositório NÃO são tocados.
 */

import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {afterAll, describe, expect, jest, test} from '@jest/globals';

jest.setTimeout(30_000);

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(SCRIPTS_DIR, '..');
const VERIFICADOR_REL = path.join('scripts', 'verificar-pacotes-entrega.mjs');

const MANIFESTO_REL = path.join(
  'src',
  'frontend',
  'lib',
  'organization',
  'manifestos.generated.json',
);

/** @type {string[]} */
const raizesCriadas = [];

/** Raiz temporária com o verificador copiado e o manifesto sintético fixado. */
function novaRaiz(manifesto) {
  const raiz = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'verificar-pacotes-teste-')),
  );
  raizesCriadas.push(raiz);
  fs.mkdirSync(path.join(raiz, 'scripts'), {recursive: true});
  fs.copyFileSync(
    path.join(PROJECT_ROOT, VERIFICADOR_REL),
    path.join(raiz, VERIFICADOR_REL),
  );
  fs.mkdirSync(path.join(raiz, path.dirname(MANIFESTO_REL)), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(raiz, MANIFESTO_REL),
    JSON.stringify(manifesto, null, 2),
  );
  return raiz;
}

/** Roda o verificador copiado com a variante dada; nunca lança. */
function executarVerificador(raiz, variante) {
  try {
    return {
      codigo: 0,
      saida: execFileSync(process.execPath, [path.join(raiz, VERIFICADOR_REL)], {
        cwd: raiz,
        encoding: 'utf8',
        env: {...process.env, APP_VARIANT: variante},
      }),
    };
  } catch (error) {
    return {
      codigo: error.status ?? 1,
      saida: `${String(error.stdout ?? '')}${String(error.stderr ?? '')}`,
    };
  }
}

const MANIFESTO_INTERINO = {
  '//': 'teste',
  monitoramento: {
    ref: {versao: '0.0.0-interino', hash: 'a'.repeat(64)},
    conteudo: {metadata: {version: '0.0.0-interino'}},
  },
  alertas: {
    ref: {versao: '0.0.0-interino', hash: 'b'.repeat(64)},
    conteudo: {metadata: {version: '0.0.0-interino'}},
  },
};

const MANIFESTO_APROVADO = {
  '//': 'teste',
  monitoramento: {
    ref: {versao: '1.0.0', hash: 'c'.repeat(64)},
    conteudo: {metadata: {version: '1.0.0'}},
  },
  alertas: {
    ref: {versao: '1.0.0', hash: 'd'.repeat(64)},
    conteudo: {metadata: {version: '1.0.0'}},
  },
};

afterAll(() => {
  for (const raiz of raizesCriadas) {
    fs.rmSync(raiz, {recursive: true, force: true});
  }
});

describe('verificar-pacotes-entrega', () => {
  test('production + interino → imprime as duas áreas e sai 1', () => {
    const {codigo, saida} = executarVerificador(
      novaRaiz(MANIFESTO_INTERINO),
      'production',
    );
    expect(codigo).toBe(1);
    expect(saida).toContain('monitoramento');
    expect(saida).toContain('alertas');
    expect(saida).toContain('0.0.0-interino');
  });

  test('releaseCandidate + interino → sai 0 (RC é variante descartável)', () => {
    const {codigo} = executarVerificador(
      novaRaiz(MANIFESTO_INTERINO),
      'releaseCandidate',
    );
    expect(codigo).toBe(0);
  });

  test('production + aprovado → sai 0', () => {
    const {codigo} = executarVerificador(
      novaRaiz(MANIFESTO_APROVADO),
      'production',
    );
    expect(codigo).toBe(0);
  });
});
