import {createHash} from 'crypto';

import {Writer} from 'comapeocat/writer.js';

import {extrairManifesto} from '../../../../scripts/lib/manifesto-pacote.mjs';

import type {Area, TemplateRef} from './documento';
import manifestosGerados from './manifestos.generated.json';
import {
  ErroPacote,
  abrirPacote,
  criarTemplateSourceDePacotes,
  verificarImportacao,
  type CampoImportado,
  type ConfiguracoesProjeto,
  type LeitorArquivo,
  type ManifestoPacote,
  type Pacote,
  type PresetImportado,
} from './pacotes';

// FS tests never touch the disk: the reader is injected as an in-memory map
// of ORIGINAL BYTES. Fixtures are real `.comapeocat` archives built with the
// comapeocat Writer — the same format the real #30 packages ship in.

const CAMINHO = '/pkg/monitoramento.comapeocat';

const SVG_ARVORE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#228B22"/></svg>';

type CategoriaFixture = {
  id: string;
  name: string;
  appliesTo: ('observation' | 'track')[];
  tags: Record<string, string>;
  fields?: string[];
  icon?: string;
  color?: string;
};

type PacoteFixture = {
  metadata: {name: string; version?: string};
  categorias: CategoriaFixture[];
  campos?: Array<{id: string; tagKey: string; label: string}>;
  icones?: Array<{id: string; svg: string}>;
  selecao: {observation: string[]; track: string[]};
};

const FIXTURE_MONITORAMENTO: PacoteFixture = {
  metadata: {name: 'Monitoramento COIAB', version: '1.0.0'},
  categorias: [
    {
      id: 'arvore',
      name: 'Árvore',
      appliesTo: ['observation'],
      tags: {natural: 'tree'},
      fields: ['especie'],
      icon: 'arvore',
      color: '#228B22',
    },
    {
      id: 'rio',
      name: 'Rio',
      appliesTo: ['track'],
      tags: {waterway: 'river'},
    },
  ],
  campos: [{id: 'especie', tagKey: 'especie', label: 'Espécie'}],
  icones: [{id: 'arvore', svg: SVG_ARVORE}],
  selecao: {observation: ['arvore'], track: ['rio']},
};

const FIXTURE_ALERTAS: PacoteFixture = {
  metadata: {name: 'Alertas COIAB', version: '1.0.0'},
  categorias: [
    {
      id: 'alerta-fogo',
      name: 'Fogo',
      appliesTo: ['observation'],
      tags: {alerta: 'fogo'},
    },
    {
      id: 'alerta-rio',
      name: 'Rio cheio',
      appliesTo: ['track'],
      tags: {alerta: 'rio-cheio'},
    },
  ],
  selecao: {observation: ['alerta-fogo'], track: ['alerta-rio']},
};

async function construirPacote(fixture: PacoteFixture): Promise<Uint8Array> {
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
  const pedacos: Uint8Array[] = [];
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

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function refPara(bytes: Uint8Array, versao = '1.0.0'): TemplateRef {
  return {versao, hash: sha256(bytes)};
}

function leitorEmMemoria(arquivos: Record<string, Uint8Array>): LeitorArquivo {
  return async filePath => arquivos[filePath] ?? null;
}

// Memoized fixture bytes — ZIP building (with svgo icon optimization) runs
// once per fixture for the whole file.
let bytesMonitoramento: Promise<Uint8Array> | null = null;
function pacoteMonitoramentoBytes(): Promise<Uint8Array> {
  if (!bytesMonitoramento) {
    bytesMonitoramento = construirPacote(FIXTURE_MONITORAMENTO);
  }
  return bytesMonitoramento;
}

/**
 * Emulates @comapeo/core `import-categories.js` against the real package
 * bytes — read through `extrairManifesto` (the REAL comapeocat Reader, on the
 * jest Node side): categories become presets carrying `tags` (the
 * @comapeo/schema field — NOT `tagKey`), fieldRefs and iconRef;
 * categorySelection becomes `defaultPresets.point/line` (preset docIds);
 * metadata becomes `configMetadata` with the package `fileVersion`.
 */
async function emularImportacaoCore(bytes: Uint8Array) {
  const {conteudo} = await extrairManifesto(bytes);
  const presets = conteudo.categorias.map(categoria => ({
    docId: `preset-${categoria.id}`,
    name: categoria.name,
    tags: {...categoria.tags},
    fieldRefs: categoria.fields.map(campoId => ({
      docId: `campo-${campoId}`,
    })),
    ...(categoria.icon ? {iconRef: {docId: `icone-${categoria.icon}`}} : {}),
  }));
  const camposCore = conteudo.campos.map(campo => ({
    docId: `campo-${campo.id}`,
    tagKey: campo.tagKey,
  }));
  const settings = {
    defaultPresets: {
      point: conteudo.selecao.observation.map(id => `preset-${id}`),
      line: conteudo.selecao.track.map(id => `preset-${id}`),
    },
    configMetadata: {
      name: conteudo.metadata.name,
      version: conteudo.metadata.version,
      fileVersion: conteudo.fileVersion,
    },
  };
  return {presets, campos: camposCore, settings};
}

/**
 * The embedded manifest of REAL bytes: extracted with the Node-side
 * `extrairManifesto` (real Reader over the real archive) and pinned by the
 * package's own `metadata.version` and byte hash — the same construction the
 * generator (scripts/gerar-manifestos-pacotes.mjs) uses.
 */
async function manifestoDe(bytes: Uint8Array): Promise<ManifestoPacote> {
  const {hash, conteudo} = await extrairManifesto(bytes);
  const versao = conteudo.metadata.version;
  if (versao === undefined) throw new Error('pacote sem metadata.version');
  return {ref: {versao, hash}, conteudo};
}

// Loose `object` inputs on purpose: divergence tests build deliberately
// off-shape documents (extra `tagKey`, missing `tags`...) that the real
// verification must reject at runtime.
function projetoCore(importado: {
  presets: readonly object[];
  campos: readonly object[];
  settings: object;
}) {
  return {
    preset: {
      getMany: jest.fn(async () => importado.presets as PresetImportado[]),
    },
    field: {
      getMany: jest.fn(async () => importado.campos as CampoImportado[]),
    },
    $getProjectSettings: jest.fn(
      async () => importado.settings as ConfiguracoesProjeto,
    ),
  };
}

describe('abrirPacote (real .comapeocat bytes + embedded manifesto — SPEC B §5.2 CA5 / #30, R1 bundling)', () => {
  test('opens a real package: bytes proven by hash, canonical content from the embedded manifesto', async () => {
    const bytes = await pacoteMonitoramentoBytes();
    const manifesto = await manifestoDe(bytes);
    const pacote = await abrirPacote(
      CAMINHO,
      manifesto.ref,
      manifesto,
      leitorEmMemoria({[CAMINHO]: bytes}),
    );
    expect(pacote.ref).toEqual(manifesto.ref);
    expect(pacote.filePath).toBe(CAMINHO);
    expect(pacote.conteudo.fileVersion).toEqual(expect.any(String));
    expect(pacote.conteudo.metadata).toEqual({
      name: 'Monitoramento COIAB',
      version: '1.0.0',
    });
    expect(pacote.conteudo.categorias).toEqual([
      {
        id: 'arvore',
        name: 'Árvore',
        appliesTo: ['observation'],
        tags: {natural: 'tree'},
        fields: ['especie'],
        icon: 'arvore',
        color: '#228B22',
      },
      {
        id: 'rio',
        name: 'Rio',
        appliesTo: ['track'],
        tags: {waterway: 'river'},
        fields: [],
      },
    ]);
    expect(pacote.conteudo.campos).toEqual([
      {id: 'especie', tagKey: 'especie'},
    ]);
    expect(pacote.conteudo.icones).toEqual(['arvore']);
    expect(pacote.conteudo.selecao).toEqual({
      observation: ['arvore'],
      track: ['rio'],
    });
  });

  test('SHA-256 is computed over the ORIGINAL BYTES: a string-decoded hash mismatches', async () => {
    const bytes = await pacoteMonitoramentoBytes();
    // A lossy utf8 decode of the binary ZIP yields a different digest — the
    // old string-based hashing would have accepted it.
    const manifesto = await manifestoDe(bytes);
    const hashDeString = createHash('sha256')
      .update(Buffer.from(bytes).toString('utf8'))
      .digest('hex');
    expect(hashDeString).not.toBe(sha256(bytes));
    const ref: TemplateRef = {versao: '1.0.0', hash: hashDeString};
    await expect(
      abrirPacote(CAMINHO, ref, manifesto, leitorEmMemoria({[CAMINHO]: bytes})),
    ).rejects.toMatchObject({
      codigo: 'pacote_hash_mismatch',
      filePath: CAMINHO,
    });
  });

  test('missing file → typed pacote_ausente error carrying the filePath', async () => {
    const manifesto = await manifestoDe(await pacoteMonitoramentoBytes());
    const erro = await abrirPacote(
      CAMINHO,
      manifesto.ref,
      manifesto,
      leitorEmMemoria({}),
    ).catch(error => error);
    expect(erro).toBeInstanceOf(ErroPacote);
    expect(erro).toBeInstanceOf(Error);
    expect(erro).toMatchObject({codigo: 'pacote_ausente', filePath: CAMINHO});
  });

  test('empty file (zero bytes) → pacote_ausente', async () => {
    const manifesto = await manifestoDe(await pacoteMonitoramentoBytes());
    await expect(
      abrirPacote(
        CAMINHO,
        manifesto.ref,
        manifesto,
        leitorEmMemoria({[CAMINHO]: new Uint8Array(0)}),
      ),
    ).rejects.toMatchObject({codigo: 'pacote_ausente', filePath: CAMINHO});
  });

  test('foreign bytes with a self-consistent hash → pacote_versao_mismatch (ZIP parsing lives at build time)', async () => {
    // The runtime NEVER opens the archive: the structural gate is
    // extrairManifesto at build time (see its own describe below). Foreign
    // bytes whose hash only proves themselves can never match the embedded
    // manifesto's ref — the divergence surfaces as pacote_versao_mismatch
    // (pacote_corrompido stays in the union for $importCategories failures).
    const manifesto = await manifestoDe(await pacoteMonitoramentoBytes());
    const bytes = new TextEncoder().encode(
      JSON.stringify({versao: '1.0.0', categorias: [{tagKey: 'agua'}]}),
    );
    await expect(
      abrirPacote(
        CAMINHO,
        refPara(bytes),
        manifesto,
        leitorEmMemoria({[CAMINHO]: bytes}),
      ),
    ).rejects.toMatchObject({
      codigo: 'pacote_versao_mismatch',
      filePath: CAMINHO,
    });
  });

  test('truncated ZIP bytes with a self-consistent hash → pacote_versao_mismatch', async () => {
    const manifesto = await manifestoDe(await pacoteMonitoramentoBytes());
    const bytes = await pacoteMonitoramentoBytes();
    const truncado = bytes.slice(0, Math.floor(bytes.byteLength / 2));
    await expect(
      abrirPacote(
        CAMINHO,
        refPara(truncado),
        manifesto,
        leitorEmMemoria({[CAMINHO]: truncado}),
      ),
    ).rejects.toMatchObject({
      codigo: 'pacote_versao_mismatch',
      filePath: CAMINHO,
    });
  });

  test('divergent SHA-256 → pacote_hash_mismatch', async () => {
    const bytes = await pacoteMonitoramentoBytes();
    const manifesto = await manifestoDe(bytes);
    const ref: TemplateRef = {versao: '1.0.0', hash: 'hash-errado'};
    await expect(
      abrirPacote(CAMINHO, ref, manifesto, leitorEmMemoria({[CAMINHO]: bytes})),
    ).rejects.toMatchObject({
      codigo: 'pacote_hash_mismatch',
      filePath: CAMINHO,
    });
  });

  test('package version diverging from the pinned ref → pacote_versao_mismatch', async () => {
    const bytes = await construirPacote({
      ...FIXTURE_MONITORAMENTO,
      metadata: {name: 'Monitoramento COIAB', version: '2.0.0'},
    });
    // The embedded manifesto is this package's own (2.0.0); the pinned ref
    // carries the real hash but an older version.
    const manifesto = await manifestoDe(bytes);
    const ref = refPara(bytes, '1.0.0');
    await expect(
      abrirPacote(CAMINHO, ref, manifesto, leitorEmMemoria({[CAMINHO]: bytes})),
    ).rejects.toMatchObject({
      codigo: 'pacote_versao_mismatch',
      filePath: CAMINHO,
    });
  });

  test('journal-pinned ref diverging from the embedded manifesto (app updated during retry) → pacote_versao_mismatch', async () => {
    // §261: a retry after an app update sees the NEW embedded manifesto but
    // the OLD journal-pinned ref. Even with the old bytes intact on the
    // device (their hash matches the pinned ref), versions must never mix.
    const manifesto = await manifestoDe(await pacoteMonitoramentoBytes());
    const bytesAntigos = await construirPacote({
      ...FIXTURE_MONITORAMENTO,
      metadata: {name: 'Monitoramento COIAB', version: '0.9.0'},
    });
    const pinned: TemplateRef = {versao: '0.9.0', hash: sha256(bytesAntigos)};
    await expect(
      abrirPacote(
        CAMINHO,
        pinned,
        manifesto,
        leitorEmMemoria({[CAMINHO]: bytesAntigos}),
      ),
    ).rejects.toMatchObject({
      codigo: 'pacote_versao_mismatch',
      filePath: CAMINHO,
    });
  });
});

describe('verificarImportacao (Core preset shape + §5.4 canonical conferência — re-read/re-hash, no ZIP reopening)', () => {
  async function abrir(): Promise<{
    pacote: Pacote;
    leitor: LeitorArquivo;
    importado: Awaited<ReturnType<typeof emularImportacaoCore>>;
  }> {
    const bytes = await pacoteMonitoramentoBytes();
    const leitor = leitorEmMemoria({[CAMINHO]: bytes});
    const manifesto = await manifestoDe(bytes);
    const pacote = await abrirPacote(CAMINHO, manifesto.ref, manifesto, leitor);
    const importado = await emularImportacaoCore(bytes);
    return {pacote, leitor, importado};
  }

  test('complete import in the REAL Core format (presets with tags) → true', async () => {
    const {pacote, leitor, importado} = await abrir();
    await expect(
      verificarImportacao(projetoCore(importado), pacote, leitor),
    ).resolves.toBe(true);
  });

  test('presets carrying only tagKey (inverted legacy shape) never verify → false', async () => {
    const {pacote, leitor, importado} = await abrir();
    const legado = {
      ...importado,
      presets: importado.presets.map(preset => ({
        ...preset,
        tags: undefined,
        tagKey: Object.entries(preset.tags)[0]?.join(':'),
      })),
    };
    await expect(
      verificarImportacao(projetoCore(legado), pacote, leitor),
    ).resolves.toBe(false);
  });

  test('a missing mandatory preset → false', async () => {
    const {pacote, leitor, importado} = await abrir();
    await expect(
      verificarImportacao(
        projetoCore({...importado, presets: importado.presets.slice(0, 1)}),
        pacote,
        leitor,
      ),
    ).resolves.toBe(false);
  });

  test('extra presets beyond the package (interrupted import leftovers) → false', async () => {
    const {pacote, leitor, importado} = await abrir();
    await expect(
      verificarImportacao(
        projetoCore({
          ...importado,
          presets: [
            ...importado.presets,
            {
              docId: 'preset-extra',
              name: 'Extra',
              tags: {extra: '1'},
              fieldRefs: [],
            },
          ],
        }),
        pacote,
        leitor,
      ),
    ).resolves.toBe(false);
  });

  test('deleted presets do not count as imported → false', async () => {
    const {pacote, leitor, importado} = await abrir();
    await expect(
      verificarImportacao(
        projetoCore({
          ...importado,
          presets: importado.presets.map((preset, index) =>
            index === 0 ? {...preset, deleted: true} : preset,
          ),
        }),
        pacote,
        leitor,
      ),
    ).resolves.toBe(false);
  });

  test('preset name diverging from the canonical category → false', async () => {
    const {pacote, leitor, importado} = await abrir();
    await expect(
      verificarImportacao(
        projetoCore({
          ...importado,
          presets: importado.presets.map(preset =>
            preset.docId === 'preset-arvore'
              ? {...preset, name: 'Tree'}
              : preset,
          ),
        }),
        pacote,
        leitor,
      ),
    ).resolves.toBe(false);
  });

  test('field reference pointing to a missing field → false', async () => {
    const {pacote, leitor, importado} = await abrir();
    await expect(
      verificarImportacao(
        projetoCore({
          ...importado,
          presets: importado.presets.map(preset =>
            preset.docId === 'preset-arvore'
              ? {...preset, fieldRefs: [{docId: 'campo-inexistente'}]}
              : preset,
          ),
        }),
        pacote,
        leitor,
      ),
    ).resolves.toBe(false);
  });

  test('preset without the mandatory field references → false', async () => {
    const {pacote, leitor, importado} = await abrir();
    await expect(
      verificarImportacao(
        projetoCore({
          ...importado,
          presets: importado.presets.map(preset =>
            preset.docId === 'preset-arvore'
              ? {...preset, fieldRefs: []}
              : preset,
          ),
        }),
        pacote,
        leitor,
      ),
    ).resolves.toBe(false);
  });

  test('imported field with a divergent tagKey → false', async () => {
    const {pacote, leitor, importado} = await abrir();
    await expect(
      verificarImportacao(
        projetoCore({
          ...importado,
          campos: importado.campos.map(campo => ({
            ...campo,
            tagKey: 'species',
          })),
        }),
        pacote,
        leitor,
      ),
    ).resolves.toBe(false);
  });

  test('missing iconRef for a category that has an icon → false', async () => {
    const {pacote, leitor, importado} = await abrir();
    await expect(
      verificarImportacao(
        projetoCore({
          ...importado,
          presets: importado.presets.map(preset =>
            Object.fromEntries(
              Object.entries(preset).filter(([chave]) => chave !== 'iconRef'),
            ),
          ),
        }),
        pacote,
        leitor,
      ),
    ).resolves.toBe(false);
  });

  test('iconRef on a category that has no icon → false', async () => {
    const {pacote, leitor, importado} = await abrir();
    await expect(
      verificarImportacao(
        projetoCore({
          ...importado,
          presets: importado.presets.map(preset =>
            preset.docId === 'preset-rio'
              ? {...preset, iconRef: {docId: 'icone-extra'}}
              : preset,
          ),
        }),
        pacote,
        leitor,
      ),
    ).resolves.toBe(false);
  });

  test('default selection diverging from categorySelection (point) → false', async () => {
    const {pacote, leitor, importado} = await abrir();
    await expect(
      verificarImportacao(
        projetoCore({
          ...importado,
          settings: {
            ...importado.settings,
            defaultPresets: {point: [], line: ['preset-rio']},
          },
        }),
        pacote,
        leitor,
      ),
    ).resolves.toBe(false);
  });

  test('default selection diverging from categorySelection (track) → false', async () => {
    const {pacote, leitor, importado} = await abrir();
    await expect(
      verificarImportacao(
        projetoCore({
          ...importado,
          settings: {
            ...importado.settings,
            defaultPresets: {point: ['preset-arvore'], line: []},
          },
        }),
        pacote,
        leitor,
      ),
    ).resolves.toBe(false);
  });

  test('configMetadata name diverging from the package metadata → false', async () => {
    const {pacote, leitor, importado} = await abrir();
    await expect(
      verificarImportacao(
        projetoCore({
          ...importado,
          settings: {
            ...importado.settings,
            configMetadata: {
              ...importado.settings.configMetadata,
              name: 'Outro',
            },
          },
        }),
        pacote,
        leitor,
      ),
    ).resolves.toBe(false);
  });

  test('configMetadata version diverging from the package metadata → false', async () => {
    const {pacote, leitor, importado} = await abrir();
    await expect(
      verificarImportacao(
        projetoCore({
          ...importado,
          settings: {
            ...importado.settings,
            configMetadata: {
              ...importado.settings.configMetadata,
              version: '9.9.9',
            },
          },
        }),
        pacote,
        leitor,
      ),
    ).resolves.toBe(false);
  });

  test('empty-fallback project settings never count as success → false', async () => {
    const {pacote, leitor, importado} = await abrir();
    await expect(
      verificarImportacao(
        {
          preset: projetoCore(importado).preset,
          field: projetoCore(importado).field,
          $getProjectSettings: jest.fn(async () => ({})),
        },
        pacote,
        leitor,
      ),
    ).resolves.toBe(false);
  });

  test('project without the Core read surfaces → false', async () => {
    const {pacote, leitor} = await abrir();
    await expect(verificarImportacao({}, pacote, leitor)).resolves.toBe(false);
  });

  test('package unavailable at verification time (re-read fails) → false', async () => {
    const {pacote, importado} = await abrir();
    await expect(
      verificarImportacao(projetoCore(importado), pacote, leitorEmMemoria({})),
    ).resolves.toBe(false);
  });

  test('file swapped at verification time (hash diverges from the pinned ref) → false', async () => {
    const {pacote, importado} = await abrir();
    const outrosBytes = await construirPacote(FIXTURE_ALERTAS);
    await expect(
      verificarImportacao(
        projetoCore(importado),
        pacote,
        leitorEmMemoria({[CAMINHO]: outrosBytes}),
      ),
    ).resolves.toBe(false);
  });
});

describe('criarTemplateSourceDePacotes (real adapter behind TemplateSource)', () => {
  const CAMINHOS: Record<Area, string> = {
    monitoramento: '/pkg/monitoramento.comapeocat',
    alertas: '/pkg/alertas.comapeocat',
  };

  async function fontes() {
    const bytesM = await pacoteMonitoramentoBytes();
    const bytesA = await construirPacote(FIXTURE_ALERTAS);
    const manifestos = {
      monitoramento: await manifestoDe(bytesM),
      alertas: await manifestoDe(bytesA),
    };
    return {
      bytesM,
      bytesA,
      manifestos,
      refs: {
        monitoramento: manifestos.monitoramento.ref,
        alertas: manifestos.alertas.ref,
      },
    };
  }

  test('prepare opens both pinned real packages before anything is created', async () => {
    const {bytesM, bytesA, refs, manifestos} = await fontes();
    const source = criarTemplateSourceDePacotes({
      caminhos: CAMINHOS,
      refs,
      manifestos,
      ler: leitorEmMemoria({
        [CAMINHOS.monitoramento]: bytesM,
        [CAMINHOS.alertas]: bytesA,
      }),
    });
    const pacotes = await source.prepare();
    expect(pacotes.monitoramento?.conteudo.metadata).toEqual({
      name: 'Monitoramento COIAB',
      version: '1.0.0',
    });
    expect(pacotes.monitoramento?.ref).toEqual(refs.monitoramento);
    expect(pacotes.alertas?.conteudo.metadata).toEqual({
      name: 'Alertas COIAB',
      version: '1.0.0',
    });
    expect(
      pacotes.alertas?.conteudo.categorias.map(categoria => categoria.id),
    ).toEqual(['alerta-fogo', 'alerta-rio']);
  });

  test('prepare fails typed when either package is missing', async () => {
    const {bytesM, refs, manifestos} = await fontes();
    const source = criarTemplateSourceDePacotes({
      caminhos: CAMINHOS,
      refs,
      manifestos,
      ler: leitorEmMemoria({[CAMINHOS.monitoramento]: bytesM}),
    });
    await expect(source.prepare()).rejects.toMatchObject({
      codigo: 'pacote_ausente',
      filePath: CAMINHOS.alertas,
    });
  });

  test('prepare honours journal-pinned refs so a retry never mixes versions', async () => {
    const {bytesM, bytesA, refs, manifestos} = await fontes();
    const source = criarTemplateSourceDePacotes({
      caminhos: CAMINHOS,
      refs,
      manifestos,
      ler: leitorEmMemoria({
        [CAMINHOS.monitoramento]: bytesM,
        [CAMINHOS.alertas]: bytesA,
      }),
    });
    await expect(
      source.prepare({
        monitoramento: {versao: '0.9.0', hash: refs.monitoramento.hash},
        alertas: refs.alertas,
      }),
    ).rejects.toMatchObject({
      codigo: 'pacote_versao_mismatch',
      filePath: CAMINHOS.monitoramento,
    });
  });

  test('verify delegates to verificarImportacao against the imported project', async () => {
    const {bytesM, bytesA, refs, manifestos} = await fontes();
    const source = criarTemplateSourceDePacotes({
      caminhos: CAMINHOS,
      refs,
      manifestos,
      ler: leitorEmMemoria({
        [CAMINHOS.monitoramento]: bytesM,
        [CAMINHOS.alertas]: bytesA,
      }),
    });
    const pacotes = await source.prepare();
    const completo = projetoCore(await emularImportacaoCore(bytesM));
    await expect(
      source.verify(completo, pacotes.monitoramento!, 'id-0'),
    ).resolves.toBe(true);
    const importado = await emularImportacaoCore(bytesM);
    const incompleto = projetoCore({
      ...importado,
      presets: importado.presets.slice(0, 1),
    });
    await expect(
      source.verify(incompleto, pacotes.monitoramento!, 'id-0'),
    ).resolves.toBe(false);
  });

  test('the embedded manifestos.generated.json is the default when manifestos are not injected', async () => {
    const gerados = manifestosGerados as unknown as Record<
      Area,
      ManifestoPacote
    >;
    const source = criarTemplateSourceDePacotes({
      caminhos: CAMINHOS,
      refs: {
        monitoramento: gerados.monitoramento.ref,
        alertas: gerados.alertas.ref,
      },
      ler: leitorEmMemoria({}),
    });
    await expect(source.prepare()).rejects.toMatchObject({
      codigo: 'pacote_ausente',
      filePath: CAMINHOS.monitoramento,
    });
  });
});

describe('extrairManifesto (extração Node — R1 bundling, anti-drift)', () => {
  test('deep-equals the real package canonical content and hashes like node:crypto sha256', async () => {
    const bytes = await pacoteMonitoramentoBytes();
    const {hash, conteudo} = await extrairManifesto(bytes);
    expect(hash).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(conteudo).toEqual({
      fileVersion: expect.any(String),
      metadata: {name: 'Monitoramento COIAB', version: '1.0.0'},
      categorias: [
        {
          id: 'arvore',
          name: 'Árvore',
          appliesTo: ['observation'],
          tags: {natural: 'tree'},
          fields: ['especie'],
          icon: 'arvore',
          color: '#228B22',
        },
        {
          id: 'rio',
          name: 'Rio',
          appliesTo: ['track'],
          tags: {waterway: 'river'},
          fields: [],
        },
      ],
      campos: [{id: 'especie', tagKey: 'especie'}],
      icones: ['arvore'],
      selecao: {observation: ['arvore'], track: ['rio']},
    });
  });

  test('non-archive bytes throw at build time (the corrupted-package gate moved to the Node side)', async () => {
    const lixo = new TextEncoder().encode(
      JSON.stringify({versao: '1.0.0', categorias: [{tagKey: 'agua'}]}),
    );
    await expect(extrairManifesto(lixo)).rejects.toThrow();
    const bytes = await pacoteMonitoramentoBytes();
    const truncado = bytes.slice(0, Math.floor(bytes.byteLength / 2));
    await expect(extrairManifesto(truncado)).rejects.toThrow();
  });
});

describe('manifestos.generated.json (manifestos embarcados — anti-drift)', () => {
  test('the generated JSON deep-equals the canonical fixtures extracted at test time', async () => {
    const gerados = manifestosGerados as unknown as Record<
      Area,
      ManifestoPacote
    >;
    const bytesM = await pacoteMonitoramentoBytes();
    const bytesA = await construirPacote(FIXTURE_ALERTAS);
    const pares: Array<[Area, Uint8Array]> = [
      ['monitoramento', bytesM],
      ['alertas', bytesA],
    ];
    for (const [area, bytes] of pares) {
      const {conteudo} = await extrairManifesto(bytes);
      // The embedded content survives regeneration byte-churn (the Writer
      // stamps buildDateValue into metadata.json, excluded from the mapping).
      expect(gerados[area].conteudo).toEqual(conteudo);
      expect(gerados[area].ref.versao).toBe(conteudo.metadata.version);
      expect(gerados[area].ref.hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
