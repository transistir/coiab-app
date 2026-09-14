import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {Asset} from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';

import {AREAS, documentoInicial, type Area} from './documento';
import {createMaterializer} from './materializar';
import {manifestosEmbarcados} from './pacotes';
import {
  CAMINHOS_INSTALADOS,
  criarTemplateSourceInstalado,
  instalarPacotes,
} from './pacotesInstalados';

// Both modules are MOCKED with throwing spies: every test injects its own
// deps, so any touch of the real APIs — in construction or in prepare with
// injected deps — fails loudly instead of hitting a native module.
jest.mock('expo-asset', () => ({
  Asset: {
    fromModule: jest.fn(() => {
      throw new Error(
        'expo-asset tocado sem injeção — construção/instalação não pode usar Asset diretamente nestes testes',
      );
    }),
  },
}));

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///fake-docs/',
  makeDirectoryAsync: jest.fn(() => {
    throw new Error('expo-file-system tocado sem injeção nestes testes');
  }),
  deleteAsync: jest.fn(() => {
    throw new Error('expo-file-system tocado sem injeção nestes testes');
  }),
  copyAsync: jest.fn(() => {
    throw new Error('expo-file-system tocado sem injeção nestes testes');
  }),
  getInfoAsync: jest.fn(() => {
    throw new Error('expo-file-system tocado sem injeção nestes testes');
  }),
  readAsStringAsync: jest.fn(() => {
    throw new Error('expo-file-system tocado sem injeção nestes testes');
  }),
  writeAsStringAsync: jest.fn(() => {
    throw new Error('expo-file-system tocado sem injeção nestes testes');
  }),
}));

const fromModuleEspia = Asset.fromModule as unknown as jest.Mock;
const espiasFileSystem = [
  FileSystem.makeDirectoryAsync,
  FileSystem.deleteAsync,
  FileSystem.copyAsync,
].map(espia => espia as unknown as jest.Mock);

const ASSETS_DIR = path.join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'assets',
  'categorias',
);

/** Recording fake fs: events keep the per-area order of the install steps. */
function fsFalso() {
  const eventos: string[] = [];
  return {
    eventos,
    documentDirectory: 'file:///fake-docs/',
    makeDirectoryAsync: jest.fn(async (fileUri: string) => {
      eventos.push(`mkdir:${fileUri}`);
    }),
    deleteAsync: jest.fn(async (fileUri: string) => {
      eventos.push(`delete:${fileUri}`);
    }),
    copyAsync: jest.fn(async ({to}: {from: string; to: string}) => {
      eventos.push(`copy:${to}`);
    }),
  };
}

/** Fake asset pair: `sufixo` builds each downloaded localUri. */
function assetFalso(sufixoPorArea: Record<Area, string>) {
  return AREAS.reduce(
    (registro, area) => {
      registro[area] = {
        downloadAsync: jest.fn(async () => ({
          localUri: `file:///cache/${sufixoPorArea[area]}`,
        })),
      };
      return registro;
    },
    {} as Record<Area, {downloadAsync: jest.Mock}>,
  );
}

describe('assets/categorias embarcados (interinos até os pacotes de #30)', () => {
  test('sha256 de cada .comapeocat commitado é o ref.hash do manifesto embarcado', () => {
    for (const area of AREAS) {
      const bytes = fs.readFileSync(
        path.join(ASSETS_DIR, `${area}.comapeocat`),
      );
      const hash = createHash('sha256').update(bytes).digest('hex');
      expect(hash).toBe(manifestosEmbarcados[area].ref.hash);
      expect(manifestosEmbarcados[area].ref.versao).toBe(
        manifestosEmbarcados[area].conteudo.metadata.version,
      );
    }
  });
});

describe('instalarPacotes', () => {
  test('baixa e copia cada asset para o caminho instalado, na ordem mkdir → delete → copy', async () => {
    const fs = fsFalso();
    const asset = assetFalso({
      monitoramento: 'monitoramento-baixado.comapeocat',
      alertas: 'alertas-baixado.comapeocat',
    });

    await instalarPacotes({asset, fs});

    const diretorio = CAMINHOS_INSTALADOS.monitoramento.slice(
      0,
      CAMINHOS_INSTALADOS.monitoramento.lastIndexOf('/'),
    );
    expect(fs.eventos).toEqual([
      `mkdir:${diretorio}`,
      `delete:${CAMINHOS_INSTALADOS.monitoramento}`,
      `copy:${CAMINHOS_INSTALADOS.monitoramento}`,
      `mkdir:${diretorio}`,
      `delete:${CAMINHOS_INSTALADOS.alertas}`,
      `copy:${CAMINHOS_INSTALADOS.alertas}`,
    ]);
    expect(fs.makeDirectoryAsync).toHaveBeenCalledWith(diretorio, {
      intermediates: true,
    });
    expect(fs.deleteAsync).toHaveBeenCalledWith(
      CAMINHOS_INSTALADOS.monitoramento,
      {idempotent: true},
    );
    expect(fs.copyAsync).toHaveBeenCalledWith({
      from: 'file:///cache/monitoramento-baixado.comapeocat',
      to: CAMINHOS_INSTALADOS.monitoramento,
    });
  });

  test('falha na instalação vira ErroPacote(pacote_ausente) com o caminho instalado da área', async () => {
    const fs = fsFalso();
    const asset = assetFalso({monitoramento: 'm', alertas: 'a'});
    asset.alertas.downloadAsync.mockImplementationOnce(async () => {
      throw new Error('download falhou');
    });

    await expect(instalarPacotes({asset, fs})).rejects.toMatchObject({
      name: 'ErroPacote',
      codigo: 'pacote_ausente',
      filePath: CAMINHOS_INSTALADOS.alertas,
    });
    // The failed area never reached the copy step.
    expect(fs.copyAsync).not.toHaveBeenCalledWith({
      from: 'file:///cache/a',
      to: CAMINHOS_INSTALADOS.alertas,
    });
  });
});

describe('criarTemplateSourceInstalado atrás do materializador', () => {
  test('falha no download rejeita start() com pacote_ausente; nada é escrito nem criado', async () => {
    const repositorio = {
      read: () => documentoInicial(),
      write: jest.fn(),
    };
    const cliente = {
      listProjects: jest.fn(async () => []),
      createProject: jest.fn(),
      getDeviceInfo: jest.fn(),
      setDeviceInfo: jest.fn(),
      getProject: jest.fn(),
    };
    const asset = assetFalso({monitoramento: 'm', alertas: 'a'});
    asset.monitoramento.downloadAsync.mockImplementationOnce(async () => {
      throw new Error('download falhou');
    });
    const fonte = criarTemplateSourceInstalado({
      asset,
      fs: fsFalso(),
      ler: async () => null,
    });
    const materializador = createMaterializer({
      client: cliente,
      templates: fonte,
      repository: repositorio,
      generateId: () => '0123456789abcdef',
    });

    await expect(
      materializador.start('Organização de Teste'),
    ).rejects.toMatchObject({
      name: 'ErroPacote',
      codigo: 'pacote_ausente',
      filePath: CAMINHOS_INSTALADOS.monitoramento,
    });
    // The install itself RAN (its failure is what propagated)...
    expect(asset.monitoramento.downloadAsync).toHaveBeenCalledTimes(1);
    // ...but the repository was never written and no project was created.
    expect(repositorio.write).not.toHaveBeenCalled();
    expect(cliente.createProject).not.toHaveBeenCalled();
    expect(cliente.getProject).not.toHaveBeenCalled();
    expect(repositorio.read().organizacoes).toEqual([]);
  });

  test('construir a fonte não toca Asset nem FileSystem (I/O só dentro de prepare)', () => {
    expect(() => criarTemplateSourceInstalado()).not.toThrow();

    expect(fromModuleEspia).not.toHaveBeenCalled();
    for (const espia of espiasFileSystem) {
      expect(espia).not.toHaveBeenCalled();
    }
  });
});
