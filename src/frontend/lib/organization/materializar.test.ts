import {createHash} from 'crypto';

import {Writer} from 'comapeocat/writer.js';

import {extrairManifesto} from '../../../../scripts/lib/manifesto-pacote.mjs';

import {
  documentoInicial,
  type Area,
  type EstadoOrganizacoes,
  type TemplateRef,
} from './documento';
import {createMaterializer} from './materializar';
import {criarTemplateSourceDePacotes, type ManifestoPacote} from './pacotes';

const MEMBER_INICIALIZADO = {
  name: 'Meu aparelho',
  deviceType: 'mobile',
  role: {roleId: 'a12a6702b93bd7ff'},
};

function harness() {
  let document = documentoInicial();
  const events: string[] = [];
  const projects: string[] = [];
  const imported = new Set<string>();
  const client = {
    listProjects: jest.fn(async () => projects.map(projectId => ({projectId}))),
    createProject: jest.fn(async ({name, configPath}) => {
      expect(configPath).toBe('');
      const area = name === 'Monitoramento' ? 'monitoramento' : 'alertas';
      expect(document.organizacoes[0]?.materializacao[area]).toMatchObject({
        etapa: 'criando',
        idsAntesDaCriacao: [...projects],
      });
      const id = `id-${projects.length}`;
      projects.push(id);
      events.push(`create:${name}`);
      return id;
    }),
    getDeviceInfo: jest.fn(async () => ({
      deviceId: 'device',
      name: 'Meu aparelho',
      deviceType: 'mobile' as const,
    })),
    setDeviceInfo: jest.fn(async () => {}),
    getProject: jest.fn(async (id: string) => ({
      $importCategories: jest.fn(async ({filePath}: {filePath: string}) => {
        expect(
          document.organizacoes[0]?.materializacao[
            projects.indexOf(id) === 0 ? 'monitoramento' : 'alertas'
          ].projectId,
        ).toBe(id);
        events.push(`import:${filePath}`);
        imported.add(id);
      }),
      $setProjectSettings: jest.fn(async (settings: unknown) => {
        events.push(`settings:${JSON.stringify(settings)}`);
      }),
      // §5.4 step 6 conferência reads the settings back: the mock project
      // reports exactly what the flow must have configured.
      $getProjectSettings: jest.fn(async () => ({
        name: projects.indexOf(id) === 0 ? 'Monitoramento' : 'Alertas',
        sendStats: false,
      })),
      $member: {
        getById: jest.fn(async () => MEMBER_INICIALIZADO),
      },
    })),
  };
  const templates = {
    prepare: jest.fn(async () => ({
      monitoramento: {ref: {versao: '1', hash: 'm'}, filePath: '/local/m'},
      alertas: {ref: {versao: '1', hash: 'a'}, filePath: '/local/a'},
    })),
    verify: jest.fn(async (_project: unknown, _template: unknown, id: string) =>
      imported.has(id),
    ),
  };
  const repository = {
    read: () => document,
    write: jest.fn((next: EstadoOrganizacoes) => {
      document = next;
    }),
  };
  return {
    client,
    templates,
    repository,
    events,
    projects,
    imported,
    get document() {
      return document;
    },
    service: createMaterializer({
      client,
      templates,
      repository,
      generateId: () => 'org-local',
    }),
  };
}

/** Persisted journal from a previous run: BOTH areas already verified. */
function documentoAmbosVerificados(): EstadoOrganizacoes {
  const area = (projectId: string, template: TemplateRef) => ({
    etapa: 'verificado' as const,
    projectId,
    template,
    idsAntesDaCriacao: [] as string[],
  });
  return {
    versao: 1,
    organizacoes: [
      {
        id: 'org-local',
        nome: 'Associação',
        estado: 'preparando',
        confirmacaoPendente: false,
        materializacao: {
          monitoramento: area('id-0', {versao: '1', hash: 'm'}),
          alertas: area('id-1', {versao: '1', hash: 'a'}),
        },
        areaEmExecucao: null,
        ultimoErro: null,
      },
    ],
    ativa: null,
  };
}

describe('materialização da organização', () => {
  test('CA4: persists intent and snapshot, creates and imports two areas sequentially, publishes confirmation without activation', async () => {
    const h = harness();
    await h.service.start('  Associação  ');
    expect(h.events).toEqual([
      'create:Monitoramento',
      'import:/local/m',
      'settings:{"name":"Monitoramento","sendStats":false}',
      'create:Alertas',
      'import:/local/a',
      'settings:{"name":"Alertas","sendStats":false}',
    ]);
    expect(h.client.createProject).toHaveBeenCalledTimes(2);
    expect(h.document).toMatchObject({
      ativa: null,
      organizacoes: [
        {
          id: 'org-local',
          nome: 'Associação',
          estado: 'pronta',
          confirmacaoPendente: true,
          materializacao: {
            monitoramento: {projectId: 'id-0', etapa: 'verificado'},
            alertas: {projectId: 'id-1', etapa: 'verificado'},
          },
        },
      ],
    });
  });
  test('CA6/CA7: second creation failure is durable; automatic resume waits for retry and reuses Monitoramento', async () => {
    const h = harness();
    const create = h.client.createProject.getMockImplementation()!;
    h.client.createProject.mockImplementation(async options => {
      if (options.name === 'Alertas') throw new Error('disk-full');
      return create(options);
    });
    await h.service.start('Associação');
    expect(h.document.organizacoes[0]).toMatchObject({
      estado: 'falha_recuperavel',
      materializacao: {monitoramento: {projectId: 'id-0', etapa: 'verificado'}},
    });
    h.client.createProject.mockImplementation(create);
    await h.service.resume();
    expect(h.client.createProject).toHaveBeenCalledTimes(2);
    await h.service.retry();
    expect(h.document.organizacoes[0]).toMatchObject({
      estado: 'pronta',
      nome: 'Associação',
    });
    expect(h.projects).toEqual(['id-0', 'id-1']);
    expect(h.events.filter(event => event.startsWith('import:'))).toEqual([
      'import:/local/m',
      'import:/local/a',
    ]);
  });
  test.each(['monitoramento', 'alertas'] as const)(
    'CA8/CA10: recovers %s when Core created it but saving its id failed',
    async area => {
      const h = harness();
      const write = h.repository.write.getMockImplementation()!;
      let fail = true;
      h.repository.write.mockImplementation(next => {
        if (
          fail &&
          next.organizacoes[0]?.materializacao[area].etapa === 'criado'
        ) {
          fail = false;
          throw new Error('write interrupted');
        }
        write(next);
      });
      await h.service.start('Associação');
      expect(h.document.organizacoes[0]?.estado).toBe('falha_recuperavel');
      await h.service.retry();
      expect(h.document.organizacoes[0]?.estado).toBe('pronta');
      expect(h.client.createProject).toHaveBeenCalledTimes(2);
      expect(h.projects).toEqual(['id-0', 'id-1']);
    },
  );
  test('CA11/CA12: double submit, remount and start with an existing organization share one operation', async () => {
    const h = harness();
    const other = createMaterializer({
      client: h.client,
      templates: h.templates,
      repository: h.repository,
      generateId: () => 'different',
    });
    await Promise.all([
      h.service.start('Original'),
      h.service.start('Double'),
      other.start('Remount'),
    ]);
    expect(h.client.createProject).toHaveBeenCalledTimes(2);
    expect(h.document.organizacoes[0]?.nome).toBe('Original');
    await other.start('Overwrite');
    expect(h.client.createProject).toHaveBeenCalledTimes(2);
    expect(h.document.organizacoes[0]?.nome).toBe('Original');
  });
  test('M-1: start and resume through two client wrappers share the repository operation and journal exactly two projects', async () => {
    const h = harness();
    let releaseCreation!: () => void;
    let creationEntered!: () => void;
    const blocked = new Promise<void>(resolve => {
      releaseCreation = resolve;
    });
    const entered = new Promise<void>(resolve => {
      creationEntered = resolve;
    });
    const names = new Map<string, string>();
    h.client.createProject.mockImplementation(async ({name}) => {
      if (h.client.createProject.mock.calls.length === 1) {
        creationEntered();
        await blocked;
      }
      const id = `id-${h.projects.length}`;
      h.projects.push(id);
      names.set(id, name);
      return id;
    });
    const getProject = h.client.getProject.getMockImplementation()!;
    h.client.getProject.mockImplementation(async id => ({
      ...(await getProject(id)),
      $getProjectSettings: jest.fn(async () => ({
        name: names.get(id)!,
        sendStats: false,
      })),
    }));
    const other = createMaterializer({
      client: {...h.client},
      templates: h.templates,
      repository: h.repository,
      generateId: () => 'other-org',
    });
    const started = h.service.start('Original');
    await entered;
    const resumed = other.resume();
    const outcomes = [started, resumed].map(operation =>
      operation.then(() => h.document),
    );
    // Give resume every opportunity to create while the first native call
    // has not returned an id or made its project visible to listProjects.
    await new Promise(resolve => setTimeout(resolve, 0));
    releaseCreation();
    const [startOutcome, resumeOutcome] = await Promise.all(outcomes);

    expect(h.projects).toHaveLength(2);
    expect(h.client.createProject).toHaveBeenCalledTimes(2);
    expect(resumed).toBe(started);
    expect(resumeOutcome).toBe(startOutcome);
    expect(h.document.organizacoes[0]?.estado).toBe('pronta');
    expect(
      Object.values(h.document.organizacoes[0]!.materializacao).map(
        entry => entry.projectId,
      ),
    ).toEqual(h.projects);
  });
  test.each([
    '',
    '   ',
    'a'.repeat(61),
    'a\nb',
    'a\tb',
    'a' + String.fromCharCode(0) + 'b',
  ])(
    'CA3: rejects invalid name %j before persisting or calling Core',
    async name => {
      const h = harness();
      await expect(h.service.start(name)).rejects.toThrow();
      expect(h.repository.write).not.toHaveBeenCalled();
      expect(h.client.createProject).not.toHaveBeenCalled();
    },
  );
  test.each(['A', 'Á'.repeat(60), '  Nome  com acentos ç  '])(
    'CA3: accepts %j without ASCII or encoded-marker restrictions',
    async name => {
      const h = harness();
      await h.service.start(name);
      expect(h.document.organizacoes[0]?.nome).toBe(name.trim());
      expect(h.document.organizacoes[0]?.estado).toBe('pronta');
    },
  );
  test('CA5/CA16: checks both installed packages before creation and keeps the pinned pair on retry', async () => {
    const h = harness();
    h.templates.prepare.mockRejectedValueOnce(new Error('missing-template'));
    await expect(h.service.start('Teste')).rejects.toThrow('missing-template');
    expect(h.client.createProject).not.toHaveBeenCalled();
    const create = h.client.createProject.getMockImplementation()!;
    h.client.createProject.mockImplementation(async options => {
      if (options.name === 'Alertas') throw new Error('full');
      return create(options);
    });
    await h.service.start('Teste');
    h.templates.prepare.mockRejectedValueOnce(
      new Error('old-template-not-installed'),
    );
    await h.service.retry();
    expect(h.templates.prepare).toHaveBeenLastCalledWith({
      monitoramento: {versao: '1', hash: 'm'},
      alertas: {versao: '1', hash: 'a'},
    });
    expect(h.document.organizacoes[0]?.estado).toBe('falha_recuperavel');
    expect(h.client.createProject).toHaveBeenCalledTimes(2);
  });
  test('CA5: refuses publication when Core returns the same id for both areas', async () => {
    const h = harness();
    const create = h.client.createProject.getMockImplementation()!;
    h.client.createProject.mockImplementation(async options =>
      options.name === 'Monitoramento' ? create(options) : 'id-0',
    );
    await h.service.start('Teste');
    expect(h.document.organizacoes[0]?.estado).toBe('falha_recuperavel');
    expect(h.document.ativa).toBeNull();
  });
  test('CA8: repairs own device information and verifies creator role in both projects', async () => {
    const h = harness();
    const get = h.client.getProject.getMockImplementation()!;
    let initialized = false;
    const member = jest.fn(async () =>
      initialized
        ? MEMBER_INICIALIZADO
        : {
            name: '',
            deviceType: 'unspecified',
            role: {roleId: 'a12a6702b93bd7ff'},
          },
    );
    h.client.getProject.mockImplementation(async id => ({
      ...(await get(id)),
      $member: {getById: member},
    }));
    h.client.setDeviceInfo.mockImplementation(async () => {
      initialized = true;
    });
    await h.service.start('Teste');
    expect(h.client.setDeviceInfo).toHaveBeenCalledWith({
      name: 'Meu aparelho',
      deviceType: 'mobile',
    });
    expect(member).toHaveBeenCalledWith('device');
    expect(h.document.organizacoes[0]?.estado).toBe('pronta');
  });

  test('§5.4 step 6: resuming a document with both areas verified re-applies idempotent settings then executes the final conferência before publishing pronta', async () => {
    const h = harness();
    h.repository.write(documentoAmbosVerificados());
    h.projects.push('id-0', 'id-1');
    h.imported.add('id-0');
    h.imported.add('id-1');
    const conferencia: string[] = [];
    const base = h.client.getProject.getMockImplementation()!;
    h.client.getProject.mockImplementation(async (id: string) => {
      const project = await base(id);
      return {
        ...project,
        $getProjectSettings: jest.fn(async () => {
          conferencia.push(`settings:${id}`);
          return {
            name: id === 'id-0' ? 'Monitoramento' : 'Alertas',
            sendStats: false,
          };
        }),
        $member: {
          getById: jest.fn(async () => {
            conferencia.push(`member:${id}`);
            return MEMBER_INICIALIZADO;
          }),
        },
      };
    });
    await h.service.resume();
    expect(h.document.organizacoes[0]?.estado).toBe('pronta');
    expect(h.document.organizacoes[0]?.confirmacaoPendente).toBe(true);
    // Each project is reopened TWICE: once for the §242 settings repair pass
    // over the already-verificado area, once for the final conferência.
    expect(h.client.getProject).toHaveBeenCalledTimes(4);
    expect(h.client.getProject).toHaveBeenCalledWith('id-0');
    expect(h.client.getProject).toHaveBeenCalledWith('id-1');
    // The repair re-applies the canonical settings idempotently (same args as
    // the normal path) — never a re-import or a re-create.
    expect(h.events.filter(event => event.startsWith('settings:'))).toEqual([
      'settings:{"name":"Monitoramento","sendStats":false}',
      'settings:{"name":"Alertas","sendStats":false}',
    ]);
    expect(conferencia).toEqual([
      'settings:id-0',
      'member:id-0',
      'settings:id-1',
      'member:id-1',
    ]);
    // NO full re-import and NO re-create: the journal was already verificado.
    expect(h.client.createProject).not.toHaveBeenCalled();
    expect(h.client.setDeviceInfo).not.toHaveBeenCalled();
    expect(h.events.filter(event => event.startsWith('import:'))).toEqual([]);
  });

  test('§5.4 step 6: conferência failure on resume blocks pronta → falha_recuperavel with the journal preserved', async () => {
    const h = harness();
    h.repository.write(documentoAmbosVerificados());
    h.projects.push('id-0', 'id-1');
    h.imported.add('id-0');
    h.imported.add('id-1');
    const base = h.client.getProject.getMockImplementation()!;
    h.client.getProject.mockImplementation(async (id: string) => {
      if (id === 'id-1') throw new Error('reopen-failed');
      return base(id);
    });
    await h.service.resume();
    expect(h.document.organizacoes[0]?.estado).toBe('falha_recuperavel');
    expect(h.document.organizacoes[0]?.estado).not.toBe('pronta');
    expect(h.document.organizacoes[0]?.confirmacaoPendente).toBe(false);
    expect(
      h.document.organizacoes[0]?.materializacao.monitoramento,
    ).toMatchObject({etapa: 'verificado', projectId: 'id-0'});
    expect(h.document.organizacoes[0]?.materializacao.alertas).toMatchObject({
      etapa: 'verificado',
      projectId: 'id-1',
    });
    expect(h.document.organizacoes[0]?.ultimoErro).toMatchObject({
      codigo: 'preparation-failed',
    });
  });

  test('§5.4 step 6: a fresh creation also reopens both projects for the final conferência before pronta', async () => {
    const h = harness();
    const aberturas: string[] = [];
    const base = h.client.getProject.getMockImplementation()!;
    h.client.getProject.mockImplementation(async (id: string) => {
      aberturas.push(id);
      return base(id);
    });
    await h.service.start('Associação');
    expect(h.document.organizacoes[0]?.estado).toBe('pronta');
    // The loop opens each project once; the conferência REOPENS both before
    // publication — four opens in total, two per project, distinct ids.
    expect(aberturas).toEqual(['id-0', 'id-1', 'id-0', 'id-1']);
    // Conferência is a light re-read: exactly one import per area.
    expect(h.events.filter(event => event.startsWith('import:'))).toEqual([
      'import:/local/m',
      'import:/local/a',
    ]);
  });

  test('§242/CA9: retry re-applies settings on a verificado area to repair post-checkpoint drift, without re-importing', async () => {
    const h = harness();
    const journal = documentoAmbosVerificados();
    journal.organizacoes[0]!.estado = 'falha_recuperavel';
    journal.organizacoes[0]!.ultimoErro = {
      codigo: 'preparation-failed',
      area: null,
      ocorridoEm: '2026-01-01T00:00:00.000Z',
    };
    h.repository.write(journal);
    h.projects.push('id-0', 'id-1');
    h.imported.add('id-0');
    h.imported.add('id-1');

    // id-0's name drifted after its `verificado` checkpoint (external change).
    const nomeAtual = new Map<string, string>([
      ['id-0', 'Renomeado por engano'],
      ['id-1', 'Alertas'],
    ]);
    const base = h.client.getProject.getMockImplementation()!;
    h.client.getProject.mockImplementation(async (id: string) => {
      const project = await base(id);
      return {
        ...project,
        $setProjectSettings: jest.fn(async (settings: unknown) => {
          nomeAtual.set(id, (settings as {name: string}).name);
        }),
        $getProjectSettings: jest.fn(async () => ({
          name: nomeAtual.get(id)!,
          sendStats: false,
        })),
      };
    });

    await h.service.retry();

    // A completed area is never re-imported (§242); its settings ARE
    // re-applied idempotently, so conferenciaFinal now passes and the op
    // reaches pronta instead of looping in falha_recuperavel forever.
    expect(h.events.filter(event => event.startsWith('import:'))).toEqual([]);
    expect(h.client.createProject).not.toHaveBeenCalled();
    expect(nomeAtual.get('id-0')).toBe('Monitoramento');
    expect(h.document.organizacoes[0]?.estado).toBe('pronta');
    expect(h.document.organizacoes[0]?.confirmacaoPendente).toBe(true);
  });

  test('§242/CA9: resume from importando with an already-complete import re-verifies without re-importing', async () => {
    const h = harness();
    const template: Record<Area, TemplateRef> = {
      monitoramento: {versao: '1', hash: 'm'},
      alertas: {versao: '1', hash: 'a'},
    };
    h.repository.write({
      versao: 1,
      organizacoes: [
        {
          id: 'org-local',
          nome: 'Associação',
          estado: 'preparando',
          confirmacaoPendente: false,
          materializacao: {
            monitoramento: {
              etapa: 'importando',
              projectId: 'id-0',
              template: template.monitoramento,
              idsAntesDaCriacao: [],
            },
            alertas: {
              etapa: 'importando',
              projectId: 'id-1',
              template: template.alertas,
              idsAntesDaCriacao: [],
            },
          },
          areaEmExecucao: 'monitoramento',
          ultimoErro: null,
        },
      ],
      ativa: null,
    });
    h.projects.push('id-0', 'id-1');
    // The import finished in Core before the `importando` checkpoint was lost.
    h.imported.add('id-0');
    h.imported.add('id-1');

    await h.service.resume();

    expect(h.events.filter(event => event.startsWith('import:'))).toEqual([]);
    expect(h.client.createProject).not.toHaveBeenCalled();
    expect(h.document.organizacoes[0]?.materializacao.monitoramento.etapa).toBe(
      'verificado',
    );
    expect(h.document.organizacoes[0]?.materializacao.alertas.etapa).toBe(
      'verificado',
    );
    expect(h.document.organizacoes[0]?.estado).toBe('pronta');
  });

  test('R4: retry routes a failed "preparando" checkpoint write to falha_recuperavel instead of rejecting', async () => {
    const h = harness();
    const create = h.client.createProject.getMockImplementation()!;
    h.client.createProject.mockImplementation(async options => {
      if (options.name === 'Alertas') throw new Error('disk-full');
      return create(options);
    });
    await h.service.start('Associação');
    expect(h.document.organizacoes[0]?.estado).toBe('falha_recuperavel');
    // MMKV fails exactly on retry's first checkpoint (estado → preparando,
    // ultimoErro → null); the failure must route through fail(), mirroring
    // resume(), never reject the exclusive operation.
    const write = h.repository.write.getMockImplementation()!;
    let falharUmaVez = true;
    h.repository.write.mockImplementation(next => {
      if (
        falharUmaVez &&
        next.organizacoes[0]?.estado === 'preparando' &&
        next.organizacoes[0]?.ultimoErro === null
      ) {
        falharUmaVez = false;
        throw new Error('mmkv-write-failed');
      }
      write(next);
    });
    await expect(h.service.retry()).resolves.toBeUndefined();
    expect(h.document.organizacoes[0]?.estado).toBe('falha_recuperavel');
    expect(h.document.organizacoes[0]?.ultimoErro).toMatchObject({
      codigo: 'preparation-failed',
    });
    // The retry aborted before resume(): no further Core activity.
    expect(h.client.createProject).toHaveBeenCalledTimes(2);
  });

  test('operation identity: a late Core callback from a superseded operation never touches the new journal', async () => {
    let document = documentoInicial();
    const repository = {
      read: () => document,
      write: jest.fn((next: EstadoOrganizacoes) => {
        document = next;
      }),
    };
    const imported = new Set<string>();
    const templates = {
      prepare: jest.fn(async () => ({
        monitoramento: {ref: {versao: '1', hash: 'm'}, filePath: '/local/m'},
        alertas: {ref: {versao: '1', hash: 'a'}, filePath: '/local/a'},
      })),
      verify: jest.fn(
        async (_project: unknown, _template: unknown, id: string) =>
          imported.has(id),
      ),
    };
    const device = {
      deviceId: 'device',
      name: 'Meu aparelho',
      deviceType: 'mobile' as const,
    };
    function projetoMock(id: string, projetos: string[]) {
      return {
        $importCategories: jest.fn(async () => {
          imported.add(id);
        }),
        $setProjectSettings: jest.fn(async () => {}),
        $getProjectSettings: jest.fn(async () => ({
          name: projetos.indexOf(id) === 0 ? 'Monitoramento' : 'Alertas',
          sendStats: false,
        })),
        $member: {getById: jest.fn(async () => MEMBER_INICIALIZADO)},
      };
    }

    // Operation 1 hangs inside Core createProject AFTER persisting its intent.
    let resolverCriacao: ((id: string) => void) | undefined;
    const clientA = {
      listProjects: jest.fn(async () => [] as Array<{projectId: string}>),
      createProject: jest.fn(
        () =>
          new Promise<string>(resolve => {
            resolverCriacao = resolve;
          }),
      ),
      getDeviceInfo: jest.fn(async () => device),
      setDeviceInfo: jest.fn(async () => {}),
      getProject: jest.fn(async (): Promise<ReturnType<typeof projetoMock>> => {
        throw new Error('the superseded operation must never reopen projects');
      }),
    };
    const serviceA = createMaterializer({
      client: clientA,
      templates,
      repository,
      generateId: () => 'org-1',
    });
    const operacao1 = serviceA.start('Órgão Um');
    const flush = () => new Promise(resolve => setTimeout(resolve, 0));
    for (let tick = 0; tick < 50 && !resolverCriacao; tick += 1) {
      await flush();
    }
    expect(resolverCriacao).toBeDefined();
    expect(document.organizacoes[0]).toMatchObject({
      id: 'org-1',
      estado: 'preparando',
    });

    // The journal is replaced externally. The in-flight callback must leave
    // the replacement intact, and another client must wait for it to settle.
    const replacement = documentoAmbosVerificados();
    replacement.organizacoes[0]!.id = 'org-replacement';
    repository.write(replacement);
    const projetosB: string[] = [];
    const clientB = {
      listProjects: jest.fn(async () =>
        projetosB.map(projectId => ({projectId})),
      ),
      createProject: jest.fn(async () => {
        const id = `id-B-${projetosB.length}`;
        projetosB.push(id);
        return id;
      }),
      getDeviceInfo: jest.fn(async () => device),
      setDeviceInfo: jest.fn(async () => {}),
      getProject: jest.fn(async (id: string) => projetoMock(id, projetosB)),
    };
    const serviceB = createMaterializer({
      client: clientB,
      templates,
      repository,
      generateId: () => 'org-2',
    });
    const waiting = serviceB.start('Órgão Dois');
    expect(waiting).toBe(operacao1);
    const antes = JSON.stringify(document);
    resolverCriacao!('id-late');
    await Promise.all([operacao1, waiting]);
    expect(JSON.stringify(document)).toBe(antes);
    expect(JSON.stringify(document)).not.toContain('id-late');
    expect(clientA.getProject).not.toHaveBeenCalled();
    expect(clientA.setDeviceInfo).not.toHaveBeenCalled();
    expect(clientB.createProject).not.toHaveBeenCalled();

    repository.write(documentoInicial());
    await serviceB.start('Órgão Dois');
    expect(document.organizacoes[0]).toMatchObject({
      id: 'org-2',
      estado: 'pronta',
      confirmacaoPendente: true,
    });
  });
});

describe('validação real dos pacotes (#30 / SPEC B §5.2 CA5)', () => {
  const CAMINHOS: Record<Area, string> = {
    monitoramento: '/pkg/monitoramento.comapeocat',
    alertas: '/pkg/alertas.comapeocat',
  };

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

  const FIXTURE_M: PacoteFixture = {
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

  const FIXTURE_A: PacoteFixture = {
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

  // Memoized fixture bytes — ZIP building (with svgo) runs once per fixture.
  let bytesM: Uint8Array | null = null;
  let bytesA: Uint8Array | null = null;
  async function monitoramentoBytes(): Promise<Uint8Array> {
    if (!bytesM) bytesM = await construirPacote(FIXTURE_M);
    return bytesM;
  }
  async function alertasBytes(): Promise<Uint8Array> {
    if (!bytesA) bytesA = await construirPacote(FIXTURE_A);
    return bytesA;
  }

  function sha256(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
  }

  /**
   * The embedded manifest of REAL bytes: extracted with the Node-side
   * `extrairManifesto` (real comapeocat Reader over the real archive) and
   * pinned by the package's own `metadata.version` and byte hash — the same
   * construction the generator (scripts/gerar-manifestos-pacotes.mjs) uses.
   */
  async function manifestoDe(bytes: Uint8Array): Promise<ManifestoPacote> {
    const {hash, conteudo} = await extrairManifesto(bytes);
    const versao = conteudo.metadata.version;
    if (versao === undefined) throw new Error('pacote sem metadata.version');
    return {ref: {versao, hash}, conteudo};
  }

  // Memoized — the canonical embedded manifests come from the canonical
  // fixture bytes, INDEPENDENT of the `arquivos` map each test injects.
  let manifestosMemo: Promise<Record<Area, ManifestoPacote>> | null = null;
  function manifestosPadrao(): Promise<Record<Area, ManifestoPacote>> {
    if (!manifestosMemo) {
      manifestosMemo = (async () => ({
        monitoramento: await manifestoDe(await monitoramentoBytes()),
        alertas: await manifestoDe(await alertasBytes()),
      }))();
    }
    return manifestosMemo;
  }

  async function refsPadrao(): Promise<Record<Area, TemplateRef>> {
    const manifestos = await manifestosPadrao();
    return {
      monitoramento: manifestos.monitoramento.ref,
      alertas: manifestos.alertas.ref,
    };
  }

  async function arquivosPadrao(): Promise<Record<string, Uint8Array>> {
    return {
      [CAMINHOS.monitoramento]: await monitoramentoBytes(),
      [CAMINHOS.alertas]: await alertasBytes(),
    };
  }

  // Injected in-memory reader — the flow never touches real files in tests.
  function leitorEmMemoria(
    arquivos: Record<string, Uint8Array>,
    eventos: string[],
  ) {
    return async (filePath: string): Promise<Uint8Array | null> => {
      eventos.push(`read:${filePath}`);
      return arquivos[filePath] ?? null;
    };
  }

  type SettingsCore = {
    name?: string;
    sendStats?: boolean;
    defaultPresets?: {point: string[]; line: string[]};
    configMetadata?: {name?: string; version?: string; fileVersion?: string};
  };

  /**
   * Emulates @comapeo/core `import-categories.js` against the real package
   * bytes — read through `extrairManifesto` (the REAL comapeocat Reader, on
   * the jest Node side — R1 bundling): categories become presets carrying
   * `tags` (@comapeo/schema — NOT `tagKey`), fieldRefs and iconRef;
   * categorySelection becomes `defaultPresets.point/line`; metadata becomes
   * `configMetadata`.
   */
  async function emularImportacaoCore(bytes: Uint8Array) {
    const {conteudo} = await extrairManifesto(bytes);
    const presets = conteudo.categorias.map(categoria => ({
      docId: `preset-${categoria.id}`,
      name: categoria.name,
      tags: {...categoria.tags},
      // Core derives the preset geometry from `appliesTo`.
      geometry: categoria.appliesTo.map(aplicacao =>
        aplicacao === 'observation' ? 'point' : 'line',
      ),
      fieldRefs: categoria.fields.map(campoId => ({
        docId: `campo-${campoId}`,
      })),
      ...(categoria.icon ? {iconRef: {docId: `icone-${categoria.icon}`}} : {}),
    }));
    // Core creates icon and field documents ONLY for the ones categories
    // reference, and each icon document carries the package icon id as `name`.
    const idsReferenciados = new Set(
      conteudo.categorias.flatMap(categoria => categoria.fields),
    );
    const camposCore = conteudo.campos
      .filter(campo => idsReferenciados.has(campo.id))
      .map(campo => ({
        docId: `campo-${campo.id}`,
        tagKey: campo.tagKey,
        // Core creates the field documents from the package entries verbatim.
        type: campo.type,
        ...(campo.options ? {options: campo.options} : {}),
      }));
    const icones = [
      ...new Set(
        conteudo.categorias
          .map(categoria => categoria.icon)
          .filter((icone): icone is string => typeof icone === 'string'),
      ),
    ].map(nome => ({docId: `icone-${nome}`, name: nome}));
    const settings: SettingsCore = {
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
    return {presets, campos: camposCore, icones, settings};
  }

  async function harnessComPacotes({
    arquivos,
    refs,
    manifestos,
    importar = 'completa',
  }: {
    arquivos: Record<string, Uint8Array>;
    refs?: Record<Area, TemplateRef>;
    manifestos?: Record<Area, ManifestoPacote>;
    importar?: 'completa' | 'incompleta';
  }) {
    let document = documentoInicial();
    const eventos: string[] = [];
    const projetos: string[] = [];
    type EstadoProjeto = {
      presets: object[];
      campos: object[];
      icones: object[];
      settings: SettingsCore;
    };
    const estados = new Map<string, EstadoProjeto>();
    const client = {
      listProjects: jest.fn(async () =>
        projetos.map(projectId => ({projectId})),
      ),
      createProject: jest.fn(
        async ({name, configPath}: {name: string; configPath: string}) => {
          expect(configPath).toBe('');
          const id = `id-${projetos.length}`;
          projetos.push(id);
          eventos.push(`create:${name}`);
          return id;
        },
      ),
      getDeviceInfo: jest.fn(async () => ({
        deviceId: 'device',
        name: 'Meu aparelho',
        deviceType: 'mobile' as const,
      })),
      setDeviceInfo: jest.fn(async () => {}),
      getProject: jest.fn(async (id: string) => {
        let estado = estados.get(id);
        if (!estado) {
          estado = {presets: [], campos: [], icones: [], settings: {}};
          estados.set(id, estado);
        }
        const estadoDoProjeto = estado;
        return {
          $importCategories: jest.fn(async ({filePath}: {filePath: string}) => {
            eventos.push(`import:${filePath}`);
            const bytes = arquivos[filePath];
            if (!bytes) throw new Error('file not found');
            const importado = await emularImportacaoCore(bytes);
            if (importar === 'incompleta') {
              // Interrupted import: the last preset never got created.
              importado.presets.pop();
            }
            estadoDoProjeto.presets = importado.presets;
            estadoDoProjeto.campos = importado.campos;
            estadoDoProjeto.icones = importado.icones;
            estadoDoProjeto.settings = {
              ...estadoDoProjeto.settings,
              defaultPresets: importado.settings.defaultPresets,
              configMetadata: importado.settings.configMetadata,
            };
          }),
          // Core MERGES settings ({...existing, ...new}) — mapeo-project.js.
          $setProjectSettings: jest.fn(async (settings: SettingsCore) => {
            estadoDoProjeto.settings = {
              ...estadoDoProjeto.settings,
              ...settings,
            };
          }),
          $getProjectSettings: jest.fn(async () => estadoDoProjeto.settings),
          $member: {
            getById: jest.fn(async () => MEMBER_INICIALIZADO),
          },
          preset: {getMany: jest.fn(async () => estadoDoProjeto.presets)},
          field: {getMany: jest.fn(async () => estadoDoProjeto.campos)},
          icon: {getMany: jest.fn(async () => estadoDoProjeto.icones)},
        };
      }),
    };
    // The REAL adapter: prepare → abrirPacote (existence/bytes SHA-256/
    // pinned ref vs the EMBEDDED manifesto — R1 bundling, no ZIP parsing at
    // runtime), verify → verificarImportacao (canonical Core documents
    // against the package content). The embedded manifests come from the
    // canonical fixture bytes, independent of the `arquivos` under test.
    const templates = criarTemplateSourceDePacotes({
      caminhos: CAMINHOS,
      refs: refs ?? (await refsPadrao()),
      manifestos: manifestos ?? (await manifestosPadrao()),
      ler: leitorEmMemoria(arquivos, eventos),
    });
    const repository = {
      read: () => document,
      write: jest.fn((next: EstadoOrganizacoes) => {
        document = next;
      }),
    };
    return {
      client,
      repository,
      eventos,
      projetos,
      get document() {
        return document;
      },
      service: createMaterializer({
        client,
        templates,
        repository,
        generateId: () => 'org-local',
      }),
    };
  }

  test('CA5: opens both real .comapeocat packages before creating, imports and publishes pronta', async () => {
    const h = await harnessComPacotes({arquivos: await arquivosPadrao()});
    await h.service.start('Associação Real');
    expect(h.eventos.filter(evento => evento.startsWith('create:'))).toEqual([
      'create:Monitoramento',
      'create:Alertas',
    ]);
    expect(h.eventos.filter(evento => evento.startsWith('import:'))).toEqual([
      `import:${CAMINHOS.monitoramento}`,
      `import:${CAMINHOS.alertas}`,
    ]);
    // Both packages are checked during preparation, before the first project.
    const primeiraCriacao = h.eventos.indexOf('create:Monitoramento');
    expect(h.eventos.indexOf(`read:${CAMINHOS.monitoramento}`)).toBeLessThan(
      primeiraCriacao,
    );
    expect(h.eventos.indexOf(`read:${CAMINHOS.alertas}`)).toBeLessThan(
      primeiraCriacao,
    );
    expect(h.document.organizacoes[0]).toMatchObject({
      estado: 'pronta',
      confirmacaoPendente: true,
      materializacao: {
        monitoramento: {etapa: 'verificado', projectId: 'id-0'},
        alertas: {etapa: 'verificado', projectId: 'id-1'},
      },
    });
    expect(h.document.ativa).toBeNull();
  });

  test('CA5: missing package aborts start with pacote_ausente before any creation or persisted intent', async () => {
    const arquivos = await arquivosPadrao();
    delete arquivos[CAMINHOS.alertas];
    const h = await harnessComPacotes({arquivos});
    await expect(h.service.start('Associação')).rejects.toMatchObject({
      codigo: 'pacote_ausente',
      filePath: CAMINHOS.alertas,
    });
    expect(h.client.createProject).not.toHaveBeenCalled();
    expect(h.repository.write).not.toHaveBeenCalled();
    expect(h.document).toEqual(documentoInicial());
  });

  test('§3.2: missing package on resume creates nothing and turns the preparing document into falha_recuperavel keeping the journal', async () => {
    const h = await harnessComPacotes({arquivos: {}});
    const refs = await refsPadrao();
    // Persisted intent from a previous run: preparing, Monitoramento already created.
    h.repository.write({
      versao: 1,
      organizacoes: [
        {
          id: 'org-pendente',
          nome: 'Pendente',
          estado: 'preparando',
          confirmacaoPendente: false,
          materializacao: {
            monitoramento: {
              etapa: 'criado',
              projectId: 'id-existente',
              template: refs.monitoramento,
              idsAntesDaCriacao: [],
            },
            alertas: {
              etapa: 'ausente',
              projectId: null,
              template: refs.alertas,
              idsAntesDaCriacao: null,
            },
          },
          areaEmExecucao: 'monitoramento',
          ultimoErro: null,
        },
      ],
      ativa: null,
    });
    await h.service.resume();
    expect(h.client.createProject).not.toHaveBeenCalled();
    expect(h.document.organizacoes[0]).toMatchObject({
      estado: 'falha_recuperavel',
      materializacao: {
        monitoramento: {etapa: 'criado', projectId: 'id-existente'},
      },
    });
    expect(h.document.organizacoes[0]?.ultimoErro).toMatchObject({
      codigo: 'preparation-failed',
      area: 'monitoramento',
    });
  });

  test('CA5: corrupted package (bytes that are not a comapeocat archive) → pacote_versao_mismatch before any creation', async () => {
    // R1 bundling: the runtime never opens the ZIP — the structural gate
    // (pacote_corrompido) lives at build time in extrairManifesto. Foreign
    // bytes with a self-consistent hash diverge from the embedded manifesto
    // ref and are rejected as a version mismatch.
    const corrompido = new TextEncoder().encode(
      JSON.stringify({versao: '1.0.0', categorias: []}),
    );
    const refs = await refsPadrao();
    const h = await harnessComPacotes({
      arquivos: {
        ...(await arquivosPadrao()),
        [CAMINHOS.monitoramento]: corrompido,
      },
      refs: {
        ...refs,
        monitoramento: {versao: '1.0.0', hash: sha256(corrompido)},
      },
    });
    await expect(h.service.start('Teste')).rejects.toMatchObject({
      codigo: 'pacote_versao_mismatch',
      filePath: CAMINHOS.monitoramento,
    });
    expect(h.client.createProject).not.toHaveBeenCalled();
  });

  test('CA5: tampered package with divergent SHA-256 → pacote_hash_mismatch before any creation', async () => {
    const adulterado = await construirPacote({
      ...FIXTURE_M,
      categorias: [
        ...FIXTURE_M.categorias,
        {
          id: 'extra',
          name: 'Extra',
          appliesTo: ['observation'],
          tags: {extra: '1'},
        },
      ],
      selecao: {observation: ['arvore', 'extra'], track: ['rio']},
    });
    const h = await harnessComPacotes({
      arquivos: {
        ...(await arquivosPadrao()),
        [CAMINHOS.monitoramento]: adulterado,
      },
    });
    await expect(h.service.start('Teste')).rejects.toMatchObject({
      codigo: 'pacote_hash_mismatch',
      filePath: CAMINHOS.monitoramento,
    });
    expect(h.client.createProject).not.toHaveBeenCalled();
  });

  test('CA5: package with divergent version → pacote_versao_mismatch before any creation', async () => {
    const outraVersao = await construirPacote({
      ...FIXTURE_M,
      metadata: {name: 'Monitoramento COIAB', version: '2.0.0'},
    });
    const refs = await refsPadrao();
    const h = await harnessComPacotes({
      arquivos: {
        ...(await arquivosPadrao()),
        [CAMINHOS.monitoramento]: outraVersao,
      },
      refs: {
        ...refs,
        monitoramento: {versao: '1.0.0', hash: sha256(outraVersao)},
      },
    });
    await expect(h.service.start('Teste')).rejects.toMatchObject({
      codigo: 'pacote_versao_mismatch',
      filePath: CAMINHOS.monitoramento,
    });
    expect(h.client.createProject).not.toHaveBeenCalled();
  });

  test('CA5: incomplete import makes verificarImportacao false and the flow never publishes pronta', async () => {
    const h = await harnessComPacotes({
      arquivos: await arquivosPadrao(),
      importar: 'incompleta',
    });
    await h.service.start('Teste');
    expect(h.document.organizacoes[0]?.estado).toBe('falha_recuperavel');
    expect(h.document.organizacoes[0]?.estado).not.toBe('pronta');
    expect(
      h.document.organizacoes[0]?.materializacao.monitoramento,
    ).toMatchObject({etapa: 'importando', projectId: 'id-0'});
    expect(h.document.ativa).toBeNull();
    // Alertas is never created after Monitoramento fails verification.
    expect(h.client.createProject).toHaveBeenCalledTimes(1);
  });
});
