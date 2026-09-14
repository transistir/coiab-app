#!/usr/bin/env node
// @ts-check

import {mkdir, readFile, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {Writer} from 'comapeocat/writer.js';

import {extrairManifesto} from './lib/manifesto-pacote.mjs';

/**
 * AUTO-GENERATED manifestos dos pacotes `.comapeocat` embarcados (R1
 * bundling), no padrão do `scripts/build-translations.mjs`: script Node →
 * JSON gerado → import no RN (`src/frontend/lib/organization/pacotes.ts`).
 *
 * Uso:
 *   node ./scripts/gerar-manifestos-pacotes.mjs \
 *     [--monitoramento <arquivo.comapeocat> --alertas <arquivo.comapeocat>] \
 *     [--emitir-fixtures] [--regenerar]
 *
 * Quando os dois pacotes aprovados de #30 forem entregues, aponte
 * `--monitoramento`/`--alertas` para os arquivos reais (aí a geração SEMPRE
 * acontece). Os dois andam JUNTOS: informar só um seria misturar pacote real
 * com fixture de teste na área ausente, então a invocação parcial é recusada. Enquanto não chegam, o gerador constrói as FIXTURES canônicas de
 * teste (idênticas às de `pacotes.test.ts`) com o Writer real do comapeocat —
 * o JSON gerado é provisório e será regenerado a partir dos pacotes reais sem
 * mudança de formato. NB: o Writer carimba `buildDateValue: Date.now()` no
 * `metadata.json`, então o `ref.hash` de fixtures reconstruídas muda a cada
 * execução (o `conteudo` mapeado é estável); pacotes reais entregues como
 * arquivos fixos geram hash estável. `--emitir-fixtures` é a ponte: grava as
 * fixtures como ARQUIVOS fixos em `assets/categorias/<area>.comapeocat` e
 * gera o manifesto a partir dos bytes gravados — hash estável, e o sha256
 * do asset vira trava real entre o arquivo e o manifesto
 * (pacotesInstalados.test.ts). A flag é incompatível com caminhos reais:
 * misturar regeneraria o manifesto com bytes trocados. Por isso, SEM
 * pacotes reais, sem `--emitir-fixtures` e sem `--regenerar`, a geração é
 * PULADA quando `manifestos.generated.json` já existe — o arquivo
 * versionado permanece determinístico entre `npm start`s (fallback: se o
 * arquivo não existir, as fixtures são geradas normalmente).
 */

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUTPUT_FILE = path.join(
  PROJECT_ROOT,
  'src',
  'frontend',
  'lib',
  'organization',
  'manifestos.generated.json',
);

const AREAS = ['monitoramento', 'alertas'];

const SVG_ARVORE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#228B22"/></svg>';

// Fixtures canônicas — o mesmo conteúdo dos testes (pacotes.test.ts /
// materializar.test.ts) até a entrega dos pacotes aprovados de #30.
const FIXTURES = {
  monitoramento: {
    metadata: {name: 'Monitoramento COIAB', version: '1.0.0'},
    categorias: [
      {
        id: 'arvore',
        name: 'Árvore',
        appliesTo: /** @type {('observation' | 'track')[]} */ (['observation']),
        tags: {natural: 'tree'},
        fields: ['especie'],
        icon: 'arvore',
        color: '#228B22',
      },
      {
        id: 'rio',
        name: 'Rio',
        appliesTo: /** @type {('observation' | 'track')[]} */ (['track']),
        tags: {waterway: 'river'},
      },
    ],
    campos: [{id: 'especie', tagKey: 'especie', label: 'Espécie'}],
    icones: [{id: 'arvore', svg: SVG_ARVORE}],
    selecao: {observation: ['arvore'], track: ['rio']},
  },
  alertas: {
    metadata: {name: 'Alertas COIAB', version: '1.0.0'},
    categorias: [
      {
        id: 'alerta-fogo',
        name: 'Fogo',
        appliesTo: /** @type {('observation' | 'track')[]} */ (['observation']),
        tags: {alerta: 'fogo'},
      },
      {
        id: 'alerta-rio',
        name: 'Rio cheio',
        appliesTo: /** @type {('observation' | 'track')[]} */ (['track']),
        tags: {alerta: 'rio-cheio'},
      },
    ],
    selecao: {observation: ['alerta-fogo'], track: ['alerta-rio']},
  },
};

/** Constrói os bytes reais de um `.comapeocat` com o Writer do comapeocat. */
async function construirPacote(fixture) {
  const writer = new Writer();
  for (const icone of fixture.icones ?? []) {
    await writer.addIcon(icone.id, icone.svg);
  }
  for (const campo of fixture.campos ?? []) {
    writer.addField(campo.id, {
      type: 'text',
      tagKey: campo.tagKey,
      label: campo.label,
      appearance: 'singleline',
    });
  }
  for (const categoria of fixture.categorias) {
    writer.addCategory(categoria.id, {
      name: categoria.name,
      appliesTo: categoria.appliesTo,
      tags: categoria.tags,
      ...(categoria.fields ? {fields: categoria.fields} : {}),
      ...(categoria.icon ? {icon: categoria.icon} : {}),
      ...(categoria.color ? {color: categoria.color} : {}),
    });
  }
  writer.setCategorySelection(fixture.selecao);
  writer.setMetadata(fixture.metadata);
  writer.finish();
  /** @type {Uint8Array[]} */
  const pedacos = [];
  for await (const pedaco of writer.outputStream) {
    pedacos.push(new Uint8Array(pedaco));
  }
  const total = pedacos.reduce((acc, pedaco) => acc + pedaco.length, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const pedaco of pedacos) {
    bytes.set(pedaco, offset);
    offset += pedaco.length;
  }
  return bytes;
}

/** @param {string} caminho */
async function arquivoExiste(caminho) {
  try {
    await stat(caminho);
    return true;
  } catch {
    return false;
  }
}

/** `assets/categorias/` — destino dos pacotes `.comapeocat` embarcados. */
const DIRETORIO_ASSETS = path.join(PROJECT_ROOT, 'assets', 'categorias');

/**
 * Grava a fixture canônica de `area` como arquivo fixo em
 * `assets/categorias/<area>.comapeocat` e devolve os bytes RELIDOS do
 * arquivo: o manifesto passa a descrever exatamente os bytes versionados
 * (e não os bytes em memória), travando o par asset↔manifesto.
 */
async function emitirFixture(area) {
  const bytes = await construirPacote(FIXTURES[area]);
  await mkdir(DIRETORIO_ASSETS, {recursive: true});
  const destino = path.join(DIRETORIO_ASSETS, `${area}.comapeocat`);
  await writeFile(destino, bytes);
  return new Uint8Array(await readFile(destino));
}

/** @type {Record<string, string>} */
const caminhosPorArea = {};
let regenerar = false;
let emitirFixtures = false;
const argv = process.argv.slice(2);
for (let indice = 0; indice < argv.length; indice += 1) {
  const argumento = argv[indice] ?? '';
  if (argumento === '--regenerar') {
    regenerar = true;
    continue;
  }
  if (argumento === '--emitir-fixtures') {
    emitirFixtures = true;
    continue;
  }
  const area = AREAS.find(candidata => argumento === `--${candidata}`);
  if (!area) {
    throw new Error(
      `Argumento desconhecido: '${argumento}'. Uso: [--monitoramento <arquivo.comapeocat> --alertas <arquivo.comapeocat>] [--emitir-fixtures] [--regenerar]`,
    );
  }
  const caminho = argv[indice + 1];
  if (!caminho) {
    throw new Error(`--${area} exige o caminho de um arquivo .comapeocat`);
  }
  caminhosPorArea[area] = caminho;
  indice += 1;
}

// Invocação parcial é RECUSADA: com só um dos dois pacotes reais, a área
// ausente cairia no fallback de FIXTURE de teste e o manifesto publicado
// misturaria pacote de produção com conteúdo inventado. Ou os dois, ou nenhum.
const quantidadePacotesReais = AREAS.filter(
  area => caminhosPorArea[area] !== undefined,
).length;
if (quantidadePacotesReais === 1) {
  throw new Error(
    '--monitoramento e --alertas devem ser informados juntos (os dois pacotes reais) ou nenhum dos dois — invocação parcial geraria um manifesto misturando pacote real com fixture de teste',
  );
}

// --emitir-fixtures grava as fixtures INTERINAS em assets/categorias/ — não
// coexiste com pacotes reais de #30: ou se emitem as interinas, ou se usam
// os reais; misturar trocaria os bytes sob o manifesto já publicado.
if (emitirFixtures && quantidadePacotesReais > 0) {
  throw new Error(
    '--emitir-fixtures é incompatível com --monitoramento/--alertas: a flag emite as fixtures interinas em assets/categorias/, pacotes reais são informados por caminho',
  );
}

// Determinismo do arquivo versionado: sem pacotes reais, sem --emitir-fixtures
// e sem --regenerar, NÃO reconstruir as fixtures (o Writer carimba
// buildDateValue: Date.now() e o ref.hash mudaria a cada `npm start`).
// Pacote ausente → fallback normal.
const temPacotesReais = quantidadePacotesReais > 0;
if (
  !temPacotesReais &&
  !emitirFixtures &&
  !regenerar &&
  (await arquivoExiste(OUTPUT_FILE))
) {
  console.log(
    'manifestos.generated.json já existe, pulando (use --regenerar para forçar)',
  );
} else {
  /** @type {Record<string, unknown>} */
  const manifestos = {};
  for (const area of AREAS) {
    const caminho = caminhosPorArea[area];
    const bytes = caminho
      ? new Uint8Array(await readFile(caminho))
      : emitirFixtures
        ? await emitirFixture(area)
        : await construirPacote(FIXTURES[area]);
    const {hash, conteudo} = await extrairManifesto(bytes);
    const versao = conteudo.metadata.version;
    if (versao === undefined) {
      throw new Error(
        `Pacote de '${area}' sem metadata.version — impossível fixar ref.versao`,
      );
    }
    manifestos[area] = {ref: {versao, hash}, conteudo};
    console.log(
      `Manifesto '${area}': versao ${versao}, sha256 ${hash} — fonte: ${
        caminho ??
        (emitirFixtures
          ? path.join(DIRETORIO_ASSETS, `${area}.comapeocat`) +
            ' (fixture interina emitida; trocar pelos pacotes reais de #30)'
          : 'fixture canônica de teste (pacotes aprovados de #30 ainda não entregues)')
      }`,
    );
  }

  await writeFile(
    OUTPUT_FILE,
    `${JSON.stringify(
      {
        '//': 'AUTO-GENERATED por scripts/gerar-manifestos-pacotes.mjs (`npm run build:manifestos-pacotes`) — não editar manualmente.',
        ...manifestos,
      },
      null,
      2,
    )}\n`,
    'utf-8',
  );

  console.log(
    `Manifestos embarcados escritos em ${path.relative(PROJECT_ROOT, OUTPUT_FILE)}`,
  );
}
