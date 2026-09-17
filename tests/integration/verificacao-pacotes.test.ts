/**
 * REAL-CORE gate for the post-import conferência (Decision C/D — the test
 * that would have caught both C and D before a device did): for EACH area,
 * the REAL `.comapeocat` asset goes through the REAL adapter
 * (`clienteDeCriacao` over real IPC) into a fresh REAL @comapeo/core project
 * and the production verifier `conferirImportacao` must ACCEPT the import
 * (null). Real core 7.4.0 / ipc 9.0.1 exposes NO icon listing
 * (`icon.getMany` — tests/integration/cliente-superficie.test.ts), so the
 * icon proof runs through `iconeResolvivel`: core's icon HTTP route, the
 * ONLY variant core writes (`import-categories.js:82-91`,
 * `{mimeType: 'image/svg+xml', size: 'medium'}`). That route must REFUSE a
 * docId no import ever created — `getIconUrl` itself succeeds for any
 * string (it only builds a URL), so the NEGATIVE case here is the actual
 * proof; `getIconUrl` can never be cited as icon evidence.
 */
import {FastifyController} from '@comapeo/core';
import type {ComapeoCoreClientApi} from '@comapeo/ipc';
import {promises as fsPromises} from 'node:fs';
import path from 'node:path';

import {clienteDeCriacao} from '../../src/frontend/lib/organization/clienteDeCriacao';
import {AREAS, type Area} from '../../src/frontend/lib/organization/documento';
import type {CreationProject} from '../../src/frontend/lib/organization/materializar';
import {
  conferirImportacao,
  manifestosEmbarcados,
  abrirPacote,
  type LeitorArquivo,
  type ProjetoComPresets,
} from '../../src/frontend/lib/organization/pacotes';
import {createManager, setUpIPC, useRealFetch} from './helpers/core';

jest.setTimeout(240_000);

/** Each area's REAL bundled `.comapeocat` — the same bytes the app ships. */
const ASSET_POR_AREA: Record<Area, string> = {
  monitoramento: path.join(
    __dirname,
    '../../assets/categorias/monitoramento.comapeocat',
  ),
  alertas: path.join(__dirname, '../../assets/categorias/alertas.comapeocat'),
};

/** Original bytes from the REAL filesystem (Node side). */
const lerReal: LeitorArquivo = async filePath =>
  new Uint8Array(await fsPromises.readFile(filePath));

describe('verificação real de pacotes (core real, IPC real, assets reais)', () => {
  let client: ComapeoCoreClientApi;
  let onTeardown: Array<() => Promise<unknown> | unknown> = [];
  let fastifyController: FastifyController;

  beforeEach(async () => {
    onTeardown = [];
    const managerSetup = await createManager({
      name: 'test',
      deviceType: 'mobile',
    });
    fastifyController = managerSetup.fastifyController;
    const ipcSetup = setUpIPC({manager: managerSetup.manager});
    client = ipcSetup.client;
    onTeardown.push(ipcSetup.stop);
    await fastifyController.start();
    onTeardown.push(() => fastifyController.stop());
    // jest-expo subs `fetch` with a non-working stub; the icon proof fetches
    // core's real HTTP route, so swap in undici's real implementation.
    onTeardown.push(useRealFetch());
  });

  afterEach(async () => {
    for (const fn of onTeardown) await fn();
  });

  for (const area of AREAS) {
    test(`asset de ${area} importado pelo adaptador real → conferirImportacao null`, async () => {
      const manifesto = manifestosEmbarcados[area];
      const pacote = await abrirPacote(
        ASSET_POR_AREA[area],
        manifesto.ref,
        manifesto,
        lerReal,
      );

      const cliente = clienteDeCriacao(client);
      const projectId = await cliente.createProject({
        name: manifesto.conteudo.metadata.name,
        configPath: '',
        projectDescription: 'x'.repeat(64),
      });
      const project: CreationProject & ProjetoComPresets =
        await cliente.getProject(projectId);

      await project.$importCategories({filePath: pacote.filePath});

      await expect(
        conferirImportacao(project, pacote, lerReal),
      ).resolves.toBeNull();
    });
  }

  test("iconeResolvivel recusa docId que nenhuma importação criou ('0'.repeat(64)) → false", async () => {
    const cliente = clienteDeCriacao(client);
    const projectId = await cliente.createProject({
      name: 'Sem icones',
      configPath: '',
      projectDescription: 'x'.repeat(64),
    });
    const project = await cliente.getProject(projectId);

    await expect(project.iconeResolvivel!('0'.repeat(64))).resolves.toBe(false);
  });
});
