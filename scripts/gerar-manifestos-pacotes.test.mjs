/**
 * Testes do determinismo de `scripts/gerar-manifestos-pacotes.mjs` (B-v4 P1):
 * o Writer do comapeocat carimba `buildDateValue: Date.now()` no metadata.json,
 * então reconstruir as fixtures a cada `npm start` mudava o `ref.hash` do
 * `manifestos.generated.json` versionado. Sem pacotes reais
 * (`--monitoramento`/`--alertas`), o gerador deve PULAR quando o arquivo já
 * existe; `--regenerar` força a sobrescrita.
 *
 * O gerador roda como processo node filho (`execFileSync`) sobre uma raiz de
 * projeto temporária (cópia do script + `lib/manifesto-pacote.mjs`), de modo
 * que o `src/frontend/lib/organization/manifestos.generated.json` real nunca é
 * tocado pelos testes. `node_modules` é um symlink para o do repositório, de
 * onde `comapeocat`/`yauzl-promise` resolvem.
 */

import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {afterAll, describe, expect, jest, test} from '@jest/globals';
import {Writer} from 'comapeocat/writer.js';

jest.setTimeout(120_000);

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(SCRIPTS_DIR, '..');
const GERADOR_REL = path.join('scripts', 'gerar-manifestos-pacotes.mjs');
const LIB_REL = path.join('scripts', 'lib', 'manifesto-pacote.mjs');
const SAIDA_REL = path.join(
  'src',
  'frontend',
  'lib',
  'organization',
  'manifestos.generated.json',
);
const MENSAGEM_PULO =
  'manifestos.generated.json já existe, pulando (use --regenerar para forçar)';

/** @type {string[]} */
const raizesCriadas = [];

/** Cria uma raiz de projeto temporária com o gerador e a lib copiados. */
function novaRaiz() {
  const raiz = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'gerador-manifestos-teste-')),
  );
  raizesCriadas.push(raiz);
  fs.symlinkSync(
    path.join(PROJECT_ROOT, 'node_modules'),
    path.join(raiz, 'node_modules'),
    'dir',
  );
  fs.mkdirSync(path.join(raiz, 'scripts', 'lib'), {recursive: true});
  fs.copyFileSync(
    path.join(PROJECT_ROOT, GERADOR_REL),
    path.join(raiz, GERADOR_REL),
  );
  fs.copyFileSync(path.join(PROJECT_ROOT, LIB_REL), path.join(raiz, LIB_REL));
  fs.mkdirSync(path.join(raiz, path.dirname(SAIDA_REL)), {recursive: true});
  return raiz;
}

/** Executa o gerador copiado na raiz temporária e devolve o stdout. */
function executarGerador(raiz, args = []) {
  return execFileSync(process.execPath, [path.join(raiz, GERADOR_REL), ...args], {
    cwd: raiz,
    encoding: 'utf8',
  });
}

function caminhoSaida(raiz) {
  return path.join(raiz, SAIDA_REL);
}

function lerManifestos(raiz) {
  return JSON.parse(fs.readFileSync(caminhoSaida(raiz), 'utf8'));
}

/** Constrói um `.comapeocat` real (bytes de zip) com o Writer do comapeocat. */
async function construirPacoteReal(versao) {
  const writer = new Writer();
  writer.addCategory('cat-real', {
    name: 'Categoria Real',
    appliesTo: ['observation'],
    tags: {origem: 'pacote-real'},
  });
  writer.addCategory('trilha-real', {
    name: 'Trilha Real',
    appliesTo: ['track'],
    tags: {origem: 'pacote-real-trilha'},
  });
  writer.setCategorySelection({
    observation: ['cat-real'],
    track: ['trilha-real'],
  });
  writer.setMetadata({name: 'Pacote Real', version: versao});
  writer.finish();
  /** @type {Uint8Array[]} */
  const pedacos = [];
  for await (const pedaco of writer.outputStream) {
    pedacos.push(new Uint8Array(pedaco));
  }
  const bytes = new Uint8Array(
    pedacos.reduce((acc, pedaco) => acc + pedaco.length, 0),
  );
  let offset = 0;
  for (const pedaco of pedacos) {
    bytes.set(pedaco, offset);
    offset += pedaco.length;
  }
  return bytes;
}

afterAll(() => {
  for (const raiz of raizesCriadas) {
    fs.rmSync(raiz, {recursive: true, force: true});
  }
});

describe('gerar-manifestos-pacotes: determinismo do arquivo gerado', () => {
  test('caso a: sem args e arquivo AUSENTE, gera normalmente (fallback para fixtures)', () => {
    const raiz = novaRaiz();
    const stdout = executarGerador(raiz);
    expect(stdout).not.toContain('pulando');
    const manifestos = lerManifestos(raiz);
    expect(manifestos.monitoramento.ref.versao).toBe('1.0.0');
    expect(manifestos.alertas.ref.versao).toBe('1.0.0');
    expect(manifestos.alertas.conteudo.categorias.map(c => c.id)).toEqual([
      'alerta-fogo',
      'alerta-rio',
    ]);
  });

  test('caso b: sem args e arquivo PRESENTE, pula sem tocar no arquivo (2 execuções seguidas)', () => {
    const raiz = novaRaiz();
    executarGerador(raiz); // execução 1: arquivo ausente → gera
    const saida = caminhoSaida(raiz);
    const bytes1 = fs.readFileSync(saida);
    const mtime1 = fs.statSync(saida).mtimeMs;

    const stdout2 = executarGerador(raiz); // execução 2: arquivo presente → deve pular
    const bytes2 = fs.readFileSync(saida);
    const mtime2 = fs.statSync(saida).mtimeMs;

    expect(stdout2).toContain(MENSAGEM_PULO);
    // O conteúdo NÃO muda byte-a-byte (o `ref.hash` fica estável)...
    expect(bytes2.equals(bytes1)).toBe(true);
    // ...e o mtime também não (o arquivo não foi reescrito).
    expect(mtime2).toBe(mtime1);
  });

  test('caso c: --monitoramento/--alertas com pacotes reais SEMPRE regenera', async () => {
    const raiz = novaRaiz();
    const bytesPacote = await construirPacoteReal('2.0.0');
    fs.writeFileSync(path.join(raiz, 'mon.comapeocat'), bytesPacote);
    fs.writeFileSync(path.join(raiz, 'ale.comapeocat'), bytesPacote);
    // Arquivo já presente (sentinela): com pacotes reais não pode pular.
    fs.writeFileSync(caminhoSaida(raiz), '{"sentinela": true}\n');

    const stdout = executarGerador(raiz, [
      '--monitoramento',
      'mon.comapeocat',
      '--alertas',
      'ale.comapeocat',
    ]);
    expect(stdout).not.toContain('pulando');
    const manifestos = lerManifestos(raiz);
    expect(manifestos.sentinela).toBeUndefined();
    expect(manifestos.monitoramento.ref.versao).toBe('2.0.0');
    expect(manifestos.alertas.ref.versao).toBe('2.0.0');
    expect(manifestos.monitoramento.ref.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('caso d: --regenerar explícito força regeneração sem args', () => {
    const raiz = novaRaiz();
    fs.writeFileSync(caminhoSaida(raiz), '{"sentinela": true}\n');

    const stdout = executarGerador(raiz, ['--regenerar']);
    expect(stdout).not.toContain('pulando');
    const manifestos = lerManifestos(raiz);
    expect(manifestos.sentinela).toBeUndefined();
    expect(manifestos.monitoramento.ref.versao).toBe('1.0.0');
    expect(manifestos.alertas.ref.versao).toBe('1.0.0');
  });

  test('argumento desconhecido continua sendo rejeitado', () => {
    const raiz = novaRaiz();
    /** @type {any} */
    let erro;
    try {
      executarGerador(raiz, ['--desconhecido']);
    } catch (e) {
      erro = e;
    }
    expect(erro).toBeDefined();
    expect(String(erro.stderr)).toContain('Argumento desconhecido');
  });
});
