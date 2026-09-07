import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';

import {Reader} from 'comapeocat/reader.js';
import {fromBuffer} from 'yauzl-promise';

/**
 * NODE-ONLY extraction of `.comapeocat` package manifests (R1 bundling).
 *
 * The real comapeocat `Reader` (the same engine `@comapeo/core`
 * `$importCategories` consumes) plus `yauzl-promise` and `node:crypto` — none
 * of which may enter the React Native bundle — run HERE, at build time
 * (`scripts/gerar-manifestos-pacotes.mjs`) and in the jest Node environment
 * (tests exercise the REAL archive bytes, never hand-written JSON). The app
 * side (`src/frontend/lib/organization/pacotes.ts`) only re-reads, re-hashes
 * and consumes the embedded result.
 *
 * The extraction logic is the one previously inlined in `abrirPacote`,
 * moved without semantic change.
 */

/**
 * @typedef {import('../../src/frontend/lib/organization/tipos-pacote').ConteudoPacote} ConteudoPacote
 */

/** Zero-copy Buffer view over the bytes (yauzl-promise asserts `instanceof Buffer`). */
function paraBuffer(bytes) {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function porId(a, b) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Opens the real archive and extracts its embedded manifest: SHA-256 (hex)
 * over the ORIGINAL BYTES plus the canonical content (`validate()`d comapeocat
 * structure — categories, fields, icon names, category selection, metadata and
 * file version). Any structural failure THROWS (loud build-time failure for
 * the generator; `pacote_corrompido` semantics for the runtime live here).
 *
 * @param {Uint8Array} bytes original bytes of a `.comapeocat` package
 * @returns {Promise<{hash: string, conteudo: ConteudoPacote}>}
 */
export async function extrairManifesto(bytes) {
  const hash = createHash('sha256').update(bytes).digest('hex');
  let reader;
  try {
    const zip = await fromBuffer(paraBuffer(bytes));
    reader = new Reader(zip);
    await reader.opened();
    await reader.validate();
    const categorias = await reader.categories();
    const campos = await reader.fields();
    const icones = await reader.iconNames();
    const selecao = await reader.categorySelection();
    const metadata = await reader.metadata();
    const fileVersion = await reader.fileVersion();
    return {
      hash,
      conteudo: {
        fileVersion,
        metadata: {
          name: metadata.name,
          ...(metadata.version !== undefined
            ? {version: metadata.version}
            : {}),
          ...(metadata.builderName !== undefined
            ? {builderName: metadata.builderName}
            : {}),
          ...(metadata.builderVersion !== undefined
            ? {builderVersion: metadata.builderVersion}
            : {}),
        },
        categorias: [...categorias.entries()]
          .map(([id, categoria]) => ({
            id,
            name: categoria.name,
            appliesTo: [...categoria.appliesTo],
            tags: {...categoria.tags},
            fields: [...categoria.fields],
            ...(categoria.icon !== undefined ? {icon: categoria.icon} : {}),
            ...(categoria.color !== undefined ? {color: categoria.color} : {}),
          }))
          .sort(porId),
        campos: [...campos.entries()]
          .map(([id, campo]) => ({id, tagKey: campo.tagKey}))
          .sort(porId),
        icones: [...icones].sort(),
        selecao: {
          observation: [...selecao.observation],
          track: [...selecao.track],
        },
      },
    };
  } finally {
    try {
      await reader?.close();
    } catch {
      /* closing a broken archive can itself fail — the error above stands. */
    }
  }
}
