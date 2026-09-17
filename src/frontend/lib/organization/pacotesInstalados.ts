import {Asset} from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import {APP_VARIANT} from '../appVariant';
import {AREAS, type Area, type TemplateRef} from './documento';
import type {CreationProject, TemplateSource} from './materializar';
import {
  ErroPacote,
  criarTemplateSourceDePacotes,
  manifestosEmbarcados,
  type GravadorArquivo,
  type LeitorArquivo,
  type Pacote,
  type ProjetoComPresets,
} from './pacotes';

/** Minimal face of the expo-asset `Asset` used at install time (injectable). */
export type AdaptadorAsset = {
  downloadAsync(): Promise<{localUri: string | null}>;
};

/** Minimal face of the legacy `FileSystem` used at install time (injectable). */
export type AdaptadorFileSystem = {
  documentDirectory: string | null;
  makeDirectoryAsync(
    fileUri: string,
    options?: {intermediates?: boolean},
  ): Promise<void>;
  deleteAsync(fileUri: string, options?: {idempotent?: boolean}): Promise<void>;
  copyAsync(options: {from: string; to: string}): Promise<void>;
};

/** Installation and opening dependencies; omitted for the real device APIs. */
export type DependenciasInstalacao = {
  asset?: Record<Area, AdaptadorAsset>;
  fs?: AdaptadorFileSystem;
  ler?: LeitorArquivo;
  gravar?: GravadorArquivo;
  /** Overrides the variant default — tests and deliberately-forced paths. */
  permitirInterinos?: boolean;
};

/** Canonical suffix marking interim (invented, pre-#30) package bytes. */
export const SUFIXO_INTERINO = '-interino';

/** Interim placeholder version stamped into the pre-#30 fixture packages. */
export const VERSAO_INTERINA = `0.0.0${SUFIXO_INTERINO}`;

/** True when the package's pinned version is an interim fixture. */
export const pacoteInterino = (ref: TemplateRef) =>
  ref.versao.endsWith(SUFIXO_INTERINO);

/**
 * Interim packages are allowed ONLY on disposable devices (Decisão A):
 * development builds and release candidates (`test`/`storybook`/
 * `release-candidate` EAS profiles). Delivery variants (production,
 * preRelease) refuse them — SPEC B `:313` (nothing invented is delivered)
 * and `:279` (templates cannot be upgraded after use). The build-time twin
 * of this gate is `scripts/verificar-pacotes-entrega.mjs`.
 */
export const PERMITE_PACOTES_INTERINOS =
  APP_VARIANT === 'development' || APP_VARIANT === 'releaseCandidate';

const DIRETORIO_PACOTES = `${FileSystem.documentDirectory}coiab/pacotes`;

/** Where each area's package must live once installed (SPEC B §5.2). */
export const CAMINHOS_INSTALADOS: Record<Area, string> = {
  monitoramento: `${DIRETORIO_PACOTES}/monitoramento.comapeocat`,
  alertas: `${DIRETORIO_PACOTES}/alertas.comapeocat`,
};

/** Bundled asset module per area — resolved by metro (`assetExts` has `comapeocat`). */
function assetEmbarcado(area: Area): number {
  switch (area) {
    case 'monitoramento':
      return require('../../../../assets/categorias/monitoramento.comapeocat');
    case 'alertas':
      return require('../../../../assets/categorias/alertas.comapeocat');
  }
}

/**
 * Copies BOTH bundled assets to `CAMINHOS_INSTALADOS` (SPEC B §5.2). The app
 * bundle carries the packages as metro assets, which live wherever the OS
 * put the build — the materializer needs stable paths under
 * `documentDirectory`, so each asset is downloaded (a cache move) and copied
 * into place. Idempotent: an existing destination is removed before the copy.
 * ANY failure of the pair is a missing package to the flow — the embedded
 * manifest is trusted, the bytes simply did not reach the device — so it
 * surfaces as `pacote_ausente` for the area that failed.
 */
export async function instalarPacotes(
  deps?: DependenciasInstalacao,
): Promise<void> {
  const fs = deps?.fs ?? FileSystem;
  for (const area of AREAS) {
    try {
      const asset =
        deps?.asset?.[area] ?? Asset.fromModule(assetEmbarcado(area));
      const baixado = await asset.downloadAsync();
      const origem = baixado.localUri;
      if (!origem) throw new Error('asset sem localUri após downloadAsync');
      const destino = CAMINHOS_INSTALADOS[area];
      await fs.makeDirectoryAsync(destino.slice(0, destino.lastIndexOf('/')), {
        intermediates: true,
      });
      await fs.deleteAsync(destino, {idempotent: true});
      await fs.copyAsync({from: origem, to: destino});
    } catch {
      throw new ErroPacote('pacote_ausente', CAMINHOS_INSTALADOS[area]);
    }
  }
}

/**
 * The INSTALLED template source (Phase 3 — the wire point `useOrganizationActivation`
 * will receive in Phase 4): `prepare` first REFUSES interim packages on
 * delivery variants (below), then puts the two packages at their installed
 * paths and delegates to `criarTemplateSourceDePacotes`, which verifies
 * existence, size, SHA-256 against the EMBEDDED manifests and canonical
 * content BEFORE anything is created. CONSTRUCTION DOES NO I/O — building
 * the source at the root is cheap; the gate, the asset download and every
 * filesystem touch happen inside `prepare`.
 */
export function criarTemplateSourceInstalado(
  deps?: DependenciasInstalacao,
): TemplateSource<CreationProject & ProjetoComPresets, Pacote> {
  const fonte = criarTemplateSourceDePacotes<
    CreationProject & ProjetoComPresets
  >({
    caminhos: CAMINHOS_INSTALADOS,
    refs: {
      monitoramento: manifestosEmbarcados.monitoramento.ref,
      alertas: manifestosEmbarcados.alertas.ref,
    },
    ler: deps?.ler,
    gravar: deps?.gravar,
  });
  return {
    async prepare(pinned) {
      // Decisão A/A2 gate: BEFORE installing anything, the version that
      // WOULD be pinned — the journal's pinned ref when resuming, the
      // embedded one for a fresh start — must be approved. A refusal
      // throws before the first `save` of `start` (materializar.ts runs
      // `templates.prepare()` before its first `save`), so nothing is
      // written and no project is created.
      const permitir = deps?.permitirInterinos ?? PERMITE_PACOTES_INTERINOS;
      for (const area of AREAS) {
        const ref = pinned?.[area] ?? manifestosEmbarcados[area].ref;
        if (!permitir && pacoteInterino(ref)) {
          throw new ErroPacote(
            'pacote_nao_aprovado',
            CAMINHOS_INSTALADOS[area],
          );
        }
      }
      await instalarPacotes(deps);
      return fonte.prepare(pinned);
    },
    verify: fonte.verify,
  };
}
