import type {ComapeoCoreClientApi} from '@comapeo/ipc';
import {clienteDeCriacao} from './clienteDeCriacao';

// Test seam: a real ComapeoCoreClientApi is an rpc-reflector proxy whose
// shape is irrelevant here — the adapter only needs the members it wraps.
const apiFake = {
  getDeviceInfo: jest.fn(async () => ({
    deviceId: 'dev',
    name: 'Meu aparelho',
    deviceType: 'mobile' as const,
  })),
  setDeviceInfo: jest.fn(async () => {}),
  listProjects: jest.fn(async () => [{projectId: 'p1', name: 'S'}]),
  createProject: jest.fn(async () => 'p1'),
  getProject: jest.fn(async () => projetoFake),
};

const projetoFake = {
  $member: {
    getById: jest.fn(async () => ({
      name: 'Meu aparelho',
      deviceType: 'mobile',
      role: {roleId: 'a12a6702b93bd7ff'},
    })),
  },
  $importCategories: jest.fn(async () => undefined),
  $setProjectSettings: jest.fn(async () => ({name: 'Monitoramento'})),
  $getProjectSettings: jest.fn(async () => ({name: 'Monitoramento'})),
  preset: {getMany: jest.fn(async () => [{docId: 'preset-1'}])},
  field: {getMany: jest.fn(async () => [{docId: 'field-1'}])},
  icon: {getMany: jest.fn(async () => [{docId: 'icon-1', name: 'icone'}])},
};

const api = apiFake as unknown as ComapeoCoreClientApi;

describe('clienteDeCriacao', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('o mesmo api devolve o mesmo objeto de cliente', () => {
    // The materializer's exclusive-operation registry keys on the client
    // object (materializar.ts `running`): two lookups MUST return one.
    const cliente = clienteDeCriacao(api);
    expect(clienteDeCriacao(api)).toBe(cliente);
  });

  test('$importCategories recebe caminho puro a partir de file:///', async () => {
    const cliente = clienteDeCriacao(api);
    const project = await cliente.getProject('p1');

    await project.$importCategories({
      filePath: 'file:///data/coiab/pacotes/monitoramento.comapeocat',
    });
    // Core reads the package by a plain filesystem path, never a URI.
    expect(projetoFake.$importCategories).toHaveBeenCalledWith({
      filePath: '/data/coiab/pacotes/monitoramento.comapeocat',
    });
  });

  test('$importCategories decoda escapes de URI no caminho', async () => {
    const cliente = clienteDeCriacao(api);
    const project = await cliente.getProject('p1');

    await project.$importCategories({
      filePath: 'file:///data/dir%20com%20espa%C3%A7o/monitoramento.comapeocat',
    });
    expect(projetoFake.$importCategories).toHaveBeenCalledWith({
      filePath: '/data/dir com espaço/monitoramento.comapeocat',
    });
  });

  test('$importCategories mantém um caminho já puro inalterado', async () => {
    const cliente = clienteDeCriacao(api);
    const project = await cliente.getProject('p1');

    await project.$importCategories({
      filePath: '/data/coiab/pacotes/monitoramento.comapeocat',
    });
    expect(projetoFake.$importCategories).toHaveBeenCalledWith({
      filePath: '/data/coiab/pacotes/monitoramento.comapeocat',
    });
  });

  test('os demais métodos do projeto passam inalterados', async () => {
    const cliente = clienteDeCriacao(api);
    const project = await cliente.getProject('p1');

    await expect(project.$member.getById('dev')).resolves.toStrictEqual({
      name: 'Meu aparelho',
      deviceType: 'mobile',
      role: {roleId: 'a12a6702b93bd7ff'},
    });
    expect(projetoFake.$member.getById).toHaveBeenCalledWith('dev');

    await project.$setProjectSettings({
      name: 'Monitoramento',
      sendStats: false,
      projectDescription: 'x'.repeat(64),
    });
    expect(projetoFake.$setProjectSettings).toHaveBeenCalledWith({
      name: 'Monitoramento',
      sendStats: false,
      projectDescription: 'x'.repeat(64),
    });

    await expect(project.$getProjectSettings()).resolves.toStrictEqual({
      name: 'Monitoramento',
    });
    expect(projetoFake.$getProjectSettings).toHaveBeenCalledTimes(1);

    await expect(project.preset!.getMany()).resolves.toStrictEqual([
      {docId: 'preset-1'},
    ]);
    await expect(project.field!.getMany()).resolves.toStrictEqual([
      {docId: 'field-1'},
    ]);
    // NO `icon` member (BY EVIDENCE: core 7.4.0 / ipc 9.0.1 has no public
    // icon DataType — `icon.getMany` rejects on the real proxy), so
    // `conferirImportacao` takes its by-reference icon path. The fake below
    // still carries an `icon` member on the RAW proxy: the wrapper must
    // hide it. Reintroduce the member only when
    // tests/integration/cliente-superficie.test.ts proves a public listing.
    expect(project.icon).toBeUndefined();
  });

  test('os métodos do gerenciador passam inalterados', async () => {
    const cliente = clienteDeCriacao(api);

    await expect(cliente.getDeviceInfo()).resolves.toMatchObject({
      deviceId: 'dev',
    });

    await cliente.setDeviceInfo({name: 'Meu aparelho', deviceType: 'mobile'});
    expect(apiFake.setDeviceInfo).toHaveBeenCalledWith({
      name: 'Meu aparelho',
      deviceType: 'mobile',
    });

    const rows = await cliente.listProjects();
    expect(rows).toStrictEqual([{projectId: 'p1', name: 'S'}]);

    await cliente.createProject({
      name: 'Monitoramento',
      configPath: '',
      projectDescription: 'x'.repeat(64),
    });
    expect(apiFake.createProject).toHaveBeenCalledWith({
      name: 'Monitoramento',
      configPath: '',
      projectDescription: 'x'.repeat(64),
    });
  });
});
