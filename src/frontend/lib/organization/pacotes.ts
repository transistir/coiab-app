import {Buffer} from 'buffer';

import {
  CryptoDigestAlgorithm,
  CryptoEncoding,
  digest,
  digestStringAsync,
} from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';

import {AREAS, type Area, type TemplateRef} from './documento';
import manifestosGeradosJson from './manifestos.generated.json';
import type {TemplatePackage, TemplateSource} from './materializar';
import type {
  CategoriaPacote,
  ConteudoPacote,
  ManifestoPacote,
  TagsPacote,
} from './tipos-pacote';

export type {
  CampoPacote,
  CategoriaPacote,
  ConteudoPacote,
  ManifestoPacote,
  TagsPacote,
} from './tipos-pacote';

/**
 * REAL validation adapter for the two canonical category packages of #30
 * (SPEC B §5.2 / CA5), under R1 bundling: the packages are real
 * `.comapeocat` archives (ZIP: VERSION, categories.json,
 * categorySelection.json, metadata.json, optional fields.json and
 * icons/*.svg) — the same format `@comapeo/core` `$importCategories`
 * consumes. Their canonical content is extracted ONCE, at BUILD time, by the
 * real comapeocat `Reader` (`scripts/lib/manifesto-pacote.mjs` →
 * `scripts/gerar-manifestos-pacotes.mjs` → `manifestos.generated.json`), so
 * the ZIP engine (`yauzl-promise`), `comapeocat` and `node:fs` NEVER enter
 * the React Native bundle. At runtime this module proves existence,
 * integrity (hash over the ORIGINAL BYTES) and the pinned version against
 * the EMBEDDED manifesto BEFORE any project is created, and re-proves the
 * imported Core documents (presets with `tags` per @comapeo/schema,
 * field/icon references, default selection and config metadata) after
 * `$importCategories` (SPEC B §5.4).
 *
 * The file reader is injectable (`LeitorArquivo`, ORIGINAL BYTES) so tests
 * never touch the disk; the default reads the local file with
 * expo-file-system (legacy API, base64 → bytes).
 */

/** Returns the original bytes of `filePath`, or `null` when the file is absent. */
export type LeitorArquivo = (filePath: string) => Promise<Uint8Array | null>;

/** An opened package: the pinned ref, its local path and the canonical content. */
export type Pacote = TemplatePackage & {conteudo: ConteudoPacote};

export type CodigoErroPacote =
  | 'pacote_ausente'
  | 'pacote_corrompido'
  | 'pacote_hash_mismatch'
  | 'pacote_versao_mismatch';

/** Typed package failure: `{codigo, filePath}` — never carries package content. */
export class ErroPacote extends Error {
  readonly codigo: CodigoErroPacote;
  readonly filePath: string;
  constructor(codigo: CodigoErroPacote, filePath: string) {
    super(`${codigo}: ${filePath}`);
    this.name = 'ErroPacote';
    this.codigo = codigo;
    this.filePath = filePath;
  }
}

export const leitorPadrao: LeitorArquivo = async filePath => {
  try {
    const info = await FileSystem.getInfoAsync(filePath);
    if (!info.exists) return null;
    const base64 = await FileSystem.readAsStringAsync(filePath, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return new Uint8Array(Buffer.from(base64, 'base64'));
  } catch {
    // Unreadable file behaves as absent: the flow fails before creating.
    return null;
  }
};

/** Zero-copy Buffer view over the bytes (yauzl-promise asserts `instanceof Buffer`). */
function paraBuffer(bytes: Uint8Array): Buffer {
  return Buffer.from(
    bytes.buffer as ArrayBuffer,
    bytes.byteOffset,
    bytes.byteLength,
  );
}

/**
 * SHA-256 (hex) over the ORIGINAL BYTES of the package. On-device the real
 * expo-crypto `digest` hashes the bytes directly; under the repo jest mock
 * (which lacks `digest`) `digestStringAsync` is backed by node:crypto and
 * hashes a Uint8Array's bytes identically — hence the runtime detection and
 * the cast, the mock signature only types `string`.
 */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (typeof digest === 'function') {
    const resultado = await digest(
      CryptoDigestAlgorithm.SHA256,
      paraBuffer(bytes),
    );
    return [...new Uint8Array(resultado)]
      .map(octet => octet.toString(16).padStart(2, '0'))
      .join('');
  }
  return digestStringAsync(
    CryptoDigestAlgorithm.SHA256,
    bytes as unknown as string,
    {encoding: CryptoEncoding.HEX},
  );
}

/**
 * Opens one canonical `.comapeocat` package WITHOUT parsing the archive (R1
 * bundling): the file must EXIST, be non-empty, its SHA-256 over the
 * ORIGINAL BYTES must equal `ref.hash`, and the journal-pinned `ref` must
 * equal the EMBEDDED manifesto's ref (version AND hash) — so a retry after
 * an app update can never mix versions (SPEC B §6). The canonical content
 * comes from the manifesto extracted at build time with the real comapeocat
 * `Reader` (`scripts/lib/manifesto-pacote.mjs`); the structural
 * `pacote_corrompido` gate lives there (and in `$importCategories`
 * downstream). Any failure throws a typed `ErroPacote` (`pacote_ausente |
 * pacote_hash_mismatch | pacote_versao_mismatch`) with the offending
 * `filePath`.
 */
export async function abrirPacote(
  filePath: string,
  ref: TemplateRef,
  manifesto: ManifestoPacote,
  ler: LeitorArquivo = leitorPadrao,
): Promise<Pacote> {
  const bytes = await ler(filePath);
  if (bytes === null || bytes.byteLength === 0) {
    throw new ErroPacote('pacote_ausente', filePath);
  }
  const hash = await sha256Hex(bytes);
  if (hash !== ref.hash) {
    throw new ErroPacote('pacote_hash_mismatch', filePath);
  }
  if (ref.versao !== manifesto.ref.versao || ref.hash !== manifesto.ref.hash) {
    throw new ErroPacote('pacote_versao_mismatch', filePath);
  }
  return {ref, filePath, conteudo: manifesto.conteudo};
}

/**
 * Preset document as @comapeo/schema defines it: the canonical identity is
 * `tags` (a record), NOT `tagKey` — `tagKey` belongs to FIELD documents.
 * This mirrors what `@comapeo/core` `$importCategories` writes.
 */
export type PresetImportado = {
  docId?: string;
  name?: string;
  tags?: TagsPacote;
  fieldRefs?: Array<{docId?: string}>;
  iconRef?: {docId?: string} | null;
  deleted?: boolean;
};

export type CampoImportado = {
  docId?: string;
  tagKey?: string;
  deleted?: boolean;
};

/**
 * Icon document as @comapeo/core `$importCategories` writes it: `name` is the
 * package icon id (`import-categories.js` → `project.$icons.create({name})`),
 * and it is that document's `docId` a preset's `iconRef` points to.
 */
export type IconeImportado = {
  docId?: string;
  name?: string;
  deleted?: boolean;
};

export type ConfiguracoesProjeto = {
  name?: string;
  sendStats?: boolean;
  defaultPresets?: {point?: string[]; line?: string[]};
  configMetadata?: {name?: string; version?: string; fileVersion?: string};
};

/** Project surface needed to read the imported Core documents. */
export type ProjetoComPresets = {
  preset?: {getMany(): Promise<PresetImportado[]>};
  field?: {getMany(): Promise<CampoImportado[]>};
  icon?: {getMany(): Promise<IconeImportado[]>};
  $getProjectSettings?: () => Promise<ConfiguracoesProjeto>;
};

/**
 * The SPECIFIC divergence that made a conferência fail — the package is only
 * `ready` when `conferirImportacao` returns `null`. A partial or interrupted
 * import can leave the project looking complete (every category resolves) and
 * still diverge from the approved configuration: leftover active fields the
 * package never declared (`campos_divergentes`) or an `iconRef` resolving to
 * another icon document (`icone_divergente`).
 */
export type MotivoDivergencia =
  | 'pacote_ausente'
  | 'pacote_hash_mismatch'
  | 'pacote_sem_categorias'
  | 'superficie_ausente'
  | 'quantidade_de_presets'
  | 'preset_ausente'
  | 'preset_nome_divergente'
  | 'campos_divergentes'
  | 'campo_referencia_invalida'
  | 'icone_divergente'
  | 'selecao_divergente'
  | 'metadata_divergente'
  | 'leitura_falhou';

/** Canonical key of a tag record: sorted entries, order-independent. */
function chaveTags(tags: TagsPacote | undefined | null): string | null {
  if (typeof tags !== 'object' || tags === null) return null;
  return JSON.stringify(
    Object.keys(tags)
      .sort()
      .map(chave => [chave, tags[chave]]),
  );
}

function mesmoConjunto(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const ordenado = [...b].sort();
  return [...a].sort().every((valor, index) => valor === ordenado[index]);
}

/**
 * Post-import verification (SPEC B §5.4 canonical conferência): RE-READS and
 * RE-HASHES the package file (existence and integrity must still hold at
 * verification time — R1 bundling: no ZIP reopening) and compares the
 * project's imported Core documents against the package's canonical content
 * (from the embedded manifesto):
 *
 * - presets (non-deleted) match the categories in a strict bijection via
 *   their canonical `tags` (@comapeo/schema shape) and carry the same `name`
 *   — never translated labels, counts alone or generated ids;
 * - the WHOLE set of active fields is a bijection with the package fields the
 *   categories reference (Core deletes every pre-existing field and creates
 *   ONLY the referenced ones — `import-categories.js`), so a leftover active
 *   field the package never declared can never pass as `ready`;
 * - every `fieldRefs` entry resolves to an existing non-deleted field whose
 *   `tagKey` set equals the tagKeys of the category's package fields;
 * - `iconRef` mirrors the category's `icon` AND resolves: its docId must be an
 *   active icon document whose `name` is the category's package icon — a
 *   reference to another (or missing) icon document is a divergence;
 * - the default selection (`defaultPresets.point/line`) equals the preset
 *   docIds of the package `categorySelection` (observation/track);
 * - `configMetadata` (name/version/fileVersion) equals the package metadata.
 *
 * Any missing read surface, empty-fallback settings read or divergence
 * returns the SPECIFIC `MotivoDivergencia` — verification never throws.
 */
export async function conferirImportacao(
  project: ProjetoComPresets,
  pacote: Pacote,
  ler?: LeitorArquivo,
): Promise<MotivoDivergencia | null> {
  try {
    const lerArquivo = ler ?? leitorPadrao;
    const bytes = await lerArquivo(pacote.filePath);
    if (bytes === null || bytes.byteLength === 0) return 'pacote_ausente';
    if ((await sha256Hex(bytes)) !== pacote.ref.hash) {
      return 'pacote_hash_mismatch';
    }
    const conteudo = pacote.conteudo;
    if (conteudo.categorias.length === 0) return 'pacote_sem_categorias';
    if (!project.preset || !project.field || !project.$getProjectSettings) {
      return 'superficie_ausente';
    }
    // Icons the categories reference: without the icon read surface their
    // references cannot be proven, so the import cannot be declared complete.
    const iconesDoPacote = new Set(
      conteudo.categorias
        .map(categoria => categoria.icon)
        .filter((icone): icone is string => typeof icone === 'string'),
    );
    if (iconesDoPacote.size > 0 && !project.icon) return 'superficie_ausente';
    const lerIcones = project.icon;
    const [presetsBrutos, camposBrutos, iconesBrutos, settings] =
      await Promise.all([
        project.preset.getMany(),
        project.field.getMany(),
        lerIcones ? lerIcones.getMany() : Promise.resolve([]),
        project.$getProjectSettings(),
      ]);
    const presets = presetsBrutos.filter(preset => !preset.deleted);
    const campos = camposBrutos.filter(campo => !campo.deleted);
    if (presets.length !== conteudo.categorias.length) {
      return 'quantidade_de_presets';
    }

    const camposPacote = new Map(
      conteudo.campos.map(campo => [campo.id, campo.tagKey]),
    );

    // The FULL active field set (not only the referenced ones) must match the
    // package: extra/missing/duplicated field documents are a divergence.
    const tagKeysDoPacote: string[] = [];
    for (const id of new Set(
      conteudo.categorias.flatMap(categoria => categoria.fields),
    )) {
      const tagKey = camposPacote.get(id);
      if (typeof tagKey !== 'string') return 'campos_divergentes';
      tagKeysDoPacote.push(tagKey);
    }
    const tagKeysImportadosTodos: string[] = [];
    for (const campo of campos) {
      if (typeof campo.docId !== 'string' || typeof campo.tagKey !== 'string') {
        return 'campos_divergentes';
      }
      tagKeysImportadosTodos.push(campo.tagKey);
    }
    if (!mesmoConjunto(tagKeysDoPacote, tagKeysImportadosTodos)) {
      return 'campos_divergentes';
    }
    const camposPorDocId = new Map(
      campos.map(campo => [campo.docId as string, campo]),
    );
    if (camposPorDocId.size !== campos.length) return 'campos_divergentes';

    // Active icon documents by docId: `name` is the package icon id.
    const nomePorIconeDocId = new Map<string, string>();
    for (const icone of iconesBrutos) {
      if (icone.deleted) continue;
      if (typeof icone.docId !== 'string' || typeof icone.name !== 'string') {
        continue;
      }
      nomePorIconeDocId.set(icone.docId, icone.name);
    }

    // Strict bijection categories ↔ presets via canonical tags.
    const usados = new Set<number>();
    const pares: Array<{categoria: CategoriaPacote; preset: PresetImportado}> =
      [];
    for (const categoria of conteudo.categorias) {
      const chave = chaveTags(categoria.tags);
      if (chave === null) return 'preset_ausente';
      const indice = presets.findIndex(
        (preset, index) =>
          !usados.has(index) && chaveTags(preset.tags) === chave,
      );
      if (indice === -1) return 'preset_ausente';
      const preset = presets[indice]!;
      usados.add(indice);
      if (preset.name !== categoria.name) return 'preset_nome_divergente';
      if ((preset.iconRef == null) !== (categoria.icon == null)) {
        return 'icone_divergente';
      }
      if (categoria.icon != null) {
        const docIdIcone = preset.iconRef?.docId;
        if (typeof docIdIcone !== 'string') return 'icone_divergente';
        if (nomePorIconeDocId.get(docIdIcone) !== categoria.icon) {
          return 'icone_divergente';
        }
      }
      const tagKeysEsperados = categoria.fields.map(id => camposPacote.get(id));
      if (tagKeysEsperados.some(tagKey => typeof tagKey !== 'string')) {
        return 'campos_divergentes';
      }
      const refs = preset.fieldRefs ?? [];
      if (refs.length !== tagKeysEsperados.length) {
        return 'campo_referencia_invalida';
      }
      const tagKeysImportados: string[] = [];
      for (const ref of refs) {
        const campo =
          typeof ref.docId === 'string'
            ? camposPorDocId.get(ref.docId)
            : undefined;
        if (!campo || typeof campo.tagKey !== 'string') {
          return 'campo_referencia_invalida';
        }
        tagKeysImportados.push(campo.tagKey);
      }
      if (!mesmoConjunto(tagKeysEsperados as string[], tagKeysImportados)) {
        return 'campo_referencia_invalida';
      }
      pares.push({categoria, preset});
    }

    // Default selection: categorySelection ↔ defaultPresets docIds.
    const docIdPorCategoria = new Map(
      pares.map(({categoria, preset}) => [categoria.id, preset.docId]),
    );
    const docIdsSelecionados = (ids: readonly string[]) => {
      const selecionados: string[] = [];
      for (const id of ids) {
        const docId = docIdPorCategoria.get(id);
        if (typeof docId !== 'string') return null;
        selecionados.push(docId);
      }
      return selecionados;
    };
    const point = docIdsSelecionados(conteudo.selecao.observation);
    const line = docIdsSelecionados(conteudo.selecao.track);
    if (!point || !line) return 'selecao_divergente';
    const defaultPresets = settings.defaultPresets;
    if (!defaultPresets) return 'selecao_divergente';
    if (!mesmoConjunto(point, defaultPresets.point ?? [])) {
      return 'selecao_divergente';
    }
    if (!mesmoConjunto(line, defaultPresets.line ?? [])) {
      return 'selecao_divergente';
    }

    // Import metadata: the project must carry the package's own metadata.
    const configMetadata = settings.configMetadata;
    if (!configMetadata) return 'metadata_divergente';
    if (configMetadata.name !== conteudo.metadata.name) {
      return 'metadata_divergente';
    }
    if (configMetadata.version !== conteudo.metadata.version) {
      return 'metadata_divergente';
    }
    if (configMetadata.fileVersion !== conteudo.fileVersion) {
      return 'metadata_divergente';
    }
    return null;
  } catch {
    // A package that cannot be re-read cannot prove a successful import.
    return 'leitura_falhou';
  }
}

/** Boolean face of `conferirImportacao`: true ONLY when nothing diverges. */
export async function verificarImportacao(
  project: ProjetoComPresets,
  pacote: Pacote,
  ler?: LeitorArquivo,
): Promise<boolean> {
  return (await conferirImportacao(project, pacote, ler)) === null;
}

/**
 * The EMBEDDED manifests (R1 bundling): generated at build time by
 * `scripts/gerar-manifestos-pacotes.mjs` (`npm run build:manifestos-pacotes`,
 * wired into `prestart` and `eas-build-post-install`) from the real
 * `.comapeocat` packages of #30 — extracted with the real comapeocat
 * `Reader`, so the app bundle never ships the ZIP engine.
 */
export const manifestosEmbarcados = manifestosGeradosJson as unknown as Record<
  Area,
  ManifestoPacote
>;

/**
 * Builds the real `TemplateSource` injected into `createMaterializer`
 * (materializar.ts): `prepare` opens BOTH packages before any project is
 * created — against the EMBEDDED manifests (`manifestos.generated.json` by
 * default) and honouring journal-pinned refs on retry so versions never mix
 * (SPEC B §6) — and `verify` delegates to `verificarImportacao`.
 */
export function criarTemplateSourceDePacotes<P extends ProjetoComPresets>({
  caminhos,
  refs,
  manifestos = manifestosEmbarcados,
  ler,
}: {
  caminhos: Record<Area, string>;
  refs: Record<Area, TemplateRef>;
  /** Embedded manifests; default: the generated `manifestos.generated.json`. */
  manifestos?: Record<Area, ManifestoPacote>;
  ler?: LeitorArquivo;
}): TemplateSource<P, Pacote> {
  return {
    async prepare(pinned) {
      const pacotes = {} as Record<Area, Pacote>;
      for (const area of AREAS) {
        pacotes[area] = await abrirPacote(
          caminhos[area],
          pinned?.[area] ?? refs[area],
          manifestos[area],
          ler,
        );
      }
      return pacotes;
    },
    verify(project, pacote) {
      return verificarImportacao(project, pacote, ler);
    },
  };
}
