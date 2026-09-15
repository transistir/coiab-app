/**
 * PROOF (plan Phase 2, "beco sem saída" risk) + CANARY: the REAL
 * @comapeo/core project exposed over the REAL IPC client (`createManager` +
 * `setUpIPC`) must expose the surface the materializer's package
 * verification (`conferirImportacao`) needs, and must NOT expose what it
 * does not have: `preset.getMany`, `field.getMany`, `$getOwnRole`,
 * `$setProjectSettings`, `$getProjectSettings`, `$importCategories` EXIST;
 * `icon.getMany` DOES NOT — `mapeo-project.js` exposes prototype getters
 * for `preset` and `field` but NOT for `icon` (the icon DataType lives in
 * the private `#dataTypes`, Symbol-keyed — rpc-reflector refuses Symbol
 * property paths). `project.$icons` (IconApi) has no listing either — its
 * only reads are URL construction (`getIconUrl`).
 *
 * Final design (Decision C), verified end-to-end in
 * tests/integration/verificacao-pacotes.test.ts: because rpc-reflector
 * proxies make every property callable, the adapter announces NO listing
 * member (client) and `conferirImportacao` decides presence STATICALLY and
 * never swallows a rejecting read (`leitura_falhou`). Without a listing,
 * icons are proven BY REFERENCE and then resolved THROUGH CORE's icon HTTP
 * route via `iconeResolvivel` — the route 404s a dangling docId, which
 * `fetch(...).ok` surfaces as false.
 *
 * This file pins the ABSENCE: a core upgrade that adds a public icon
 * surface flips the negative test here — readd the listing member in
 * `clienteDeCriacao` ONLY then (the by-reference + resolver proof stays).
 */
import type {ComapeoCoreClientApi} from '@comapeo/ipc';
import path from 'node:path';
import {clienteDeCriacao} from '../../src/frontend/lib/organization/clienteDeCriacao';
import {createManager, setUpIPC} from './helpers/core';

jest.setTimeout(240_000);

describe('IPC project surface (real core, real IPC)', () => {
  let client: ComapeoCoreClientApi;
  let onTeardown: Array<() => Promise<unknown> | unknown> = [];
  let fastifyController: Awaited<
    ReturnType<typeof createManager>
  >['fastifyController'];
  let projectId: string;

  beforeEach(async () => {
    onTeardown = [];
    const managerSetup = await createManager({
      name: 'test',
      deviceType: 'mobile',
    });
    ({fastifyController} = managerSetup);
    const ipcSetup = setUpIPC({manager: managerSetup.manager});
    ({client} = ipcSetup);
    const {stop} = ipcSetup;
    onTeardown.push(stop);
    await fastifyController.start();
    onTeardown.push(() => fastifyController.stop());
    projectId = await client.createProject({name: 'Superficie'});
  });

  afterEach(async () => {
    for (const fn of onTeardown) await fn();
  });

  test('métodos $ do proxy IPC cru existem e são chamáveis', async () => {
    const cliente = clienteDeCriacao(client);
    const project = await cliente.getProject(projectId);
    const device = await cliente.getDeviceInfo();

    const role = await project.$member.getById(device.deviceId);
    expect(role.role.roleId).toBe('a12a6702b93bd7ff');

    await project.$setProjectSettings({
      name: 'Monitoramento',
      sendStats: false,
      projectDescription: 'x'.repeat(64),
    });
    await expect(project.$getProjectSettings()).resolves.toMatchObject({
      name: 'Monitoramento',
      sendStats: false,
    });
  });

  test('preset.getMany e field.getMany devolvem arrays via IPC cru', async () => {
    const p = await client.getProject(projectId);
    await expect(p.preset.getMany()).resolves.toStrictEqual([]);
    await expect(p.field.getMany()).resolves.toStrictEqual([]);
  });

  test('icon.getMany NÃO existe no IPC (ReferenceError) — veredito do plano', async () => {
    const p = await client.getProject(projectId);
    await expect(p.icon.getMany()).rejects.toThrow('icon is not defined');
  });

  test('$importCategories importa um pacote real via adaptador (file:// → caminho puro)', async () => {
    const cliente = clienteDeCriacao(client);
    const project = await cliente.getProject(projectId);

    const pacote = path.join(
      __dirname,
      '../assets/comapeo-categories-devtest.comapeocat',
    );
    // The real round trip: URI input → plain path → Core import succeeds.
    await project.$importCategories({filePath: `file://${pacote}`});

    const presets = await project.preset.getMany();
    expect(presets.length).toBeGreaterThan(0);
    expect(presets[0]?.name).toBe('Agroindustry');
    // Categories with icons carry the iconRef Core wrote on import.
    expect(typeof presets[0]?.iconRef?.docId).toBe('string');
  });
});
