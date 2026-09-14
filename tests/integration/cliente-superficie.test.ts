/**
 * PROOF (plan Phase 2, "beco sem saída" risk): the REAL @comapeo/core project
 * exposed over the REAL IPC client (`createManager` + `setUpIPC`) must expose
 * the surface the materializer's package verification (`conferirImportacao`)
 * needs: `preset.getMany`, `field.getMany`, `icon.getMany`, `$getOwnRole`,
 * `$setProjectSettings`, `$getProjectSettings`, `$importCategories`.
 *
 * EMPIRICAL VERDICT on @comapeo/core 7.4.0 / @comapeo/ipc 9.0.1:
 * - preset.getMany, field.getMany, $getOwnRole, $setProjectSettings,
 *   $getProjectSettings, $importCategories, $member.getById — EXIST and work.
 * - icon.getMany — DOES NOT EXIST: `ReferenceError: icon is not defined`.
 *   `mapeo-project.js` exposes prototype getters for `preset` and `field`
 *   but NOT for `icon`; the icon DataType lives in the private `#dataTypes`
 *   (`kDataTypes`, Symbol-keyed — rpc-reflector refuses Symbol property
 *   paths). `project.$icons` (IconApi) has no getMany/getAll either — its
 *   only reads are URL construction (`getIconUrl`), which never verifies a
 *   docId. This test pins the absence so a core upgrade that adds a public
 *   icon surface flips it and unblocks the plan.
 *
 * Consequence for the plan: with a real package that declares icons,
 * `conferirImportacao` hits its `superficie_ausente` guard forever, so
 * materialized creation never reaches `pronta` — the icon verification
 * needs a plan decision (read surface on core, or a non-list verification).
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
