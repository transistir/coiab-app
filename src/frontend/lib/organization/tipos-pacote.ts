import type {TemplateRef} from './documento';

/**
 * PURE shared package types (R1 bundling) — no native imports, importable by
 * BOTH sides: the RN app (`./pacotes`) and the Node-only build-time
 * extraction (`scripts/lib/manifesto-pacote.mjs`, via JSDoc). The canonical
 * content of a `.comapeocat` archive is extracted ONCE, at build time, by the
 * real comapeocat `Reader`; the app only ever consumes the embedded result.
 */

export type TagsPacote = Record<string, string | number | boolean | null>;

/** Canonical category as stored in the package (`categories.json`). */
export type CategoriaPacote = {
  id: string;
  name: string;
  appliesTo: ('observation' | 'track')[];
  tags: TagsPacote;
  /** Field ids (package `fields.json`) shown for this category. */
  fields: string[];
  icon?: string;
  color?: string;
};

export type CampoPacote = {id: string; tagKey: string};

/** The canonical content of an opened `.comapeocat` package. */
export type ConteudoPacote = {
  /** comapeocat file-format version (e.g. "1.2"), from the VERSION entry. */
  fileVersion: string;
  metadata: {
    name: string;
    version?: string;
    builderName?: string;
    builderVersion?: string;
  };
  categorias: CategoriaPacote[];
  campos: CampoPacote[];
  icones: string[];
  selecao: {observation: string[]; track: string[]};
};

/**
 * The embedded manifest of one canonical package: the pinned `TemplateRef` it
 * was built from (`versao` = the package's own `metadata.version`, `hash` =
 * SHA-256 over its original bytes) plus the canonical content extracted with
 * the real comapeocat `Reader`. Generated at build time
 * (`scripts/gerar-manifestos-pacotes.mjs` → `manifestos.generated.json`).
 */
export type ManifestoPacote = {ref: TemplateRef; conteudo: ConteudoPacote};
