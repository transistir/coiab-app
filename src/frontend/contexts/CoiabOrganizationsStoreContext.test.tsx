import * as React from 'react';
import {renderHook} from '@testing-library/react-native';
import {act} from '@testing-library/react-native';

import {
  createCoiabOrganizationsStore,
  CoiabOrganizationsStoreProvider,
  STORAGE_KEY,
  useCoiabOrganizationsDocument,
  useCoiabOrganizationsActions,
  type CoiabOrganizationsState,
  type CoiabOrganizationsStore,
} from './CoiabOrganizationsStoreContext';
import {
  documentoInicial,
  type EstadoOrganizacoes,
  type OrganizacaoLocal,
} from '../lib/organization/documento';
import {MMKVStoreInitializer} from '../hooks/persistedState/createPersistedState';

// NOTE (harness): @testing-library/react-native 14 makes `renderHook` and
// `act` async (an unawaited `act` leaks its React act scope into later
// tests). Every `act`/`renderHook` below is awaited — same pattern as
// AppUsageStatsContext.test.tsx. Assertions are unchanged.

const TEMPLATES = {
  monitoramento: {versao: '1.0.0', hash: 'hash-m'},
  alertas: {versao: '1.0.0', hash: 'hash-a'},
};

function createWrapper(store: CoiabOrganizationsStore) {
  return function Wrapper({children}: {children: React.ReactNode}) {
    return (
      <CoiabOrganizationsStoreProvider store={store}>
        {children}
      </CoiabOrganizationsStoreProvider>
    );
  };
}

function org(store: CoiabOrganizationsStore): OrganizacaoLocal {
  const state = store.instance.getState();
  if (state.organizacoes.length !== 1) {
    throw new Error(
      `expected exactly one organization, found ${state.organizacoes.length}`,
    );
  }
  return state.organizacoes[0]!;
}

async function startedStore({persist} = {persist: false}) {
  const store = createCoiabOrganizationsStore({persist});
  await act(async () => {
    store.actions.iniciarOrganizacao({
      id: '0123456789abcdef',
      nome: '  Órgão Teste  ',
      templates: TEMPLATES,
    });
  });
  return store;
}

describe('CoiabOrganizations document store (SPEC B §5.3)', () => {
  beforeEach(() => {
    MMKVStoreInitializer.removeItem(STORAGE_KEY);
  });

  test('starts with an empty versioned document and no active organization', () => {
    const store = createCoiabOrganizationsStore();
    expect(store.instance.getState()).toStrictEqual({
      ...documentoInicial(),
      hidratacaoFalhou: false,
    });
    const initial: EstadoOrganizacoes = {
      versao: 1,
      organizacoes: [],
      ativa: null,
    };
    // hidratacaoFalhou is runtime-only; the durable document shape matches.
    expect(store.instance.getState()).toMatchObject(initial);
  });

  test('atomicSetState replace:true replaces the whole document, keeping only the runtime flag (from current)', async () => {
    const store = createCoiabOrganizationsStore();
    // Seed an `ativa` pointer via a full-state replace.
    await act(async () => {
      store.instance.setState(
        {
          versao: 1,
          organizacoes: [],
          ativa: {organizacaoId: '0123456789abcdef', area: 'monitoramento'},
        },
        true,
      );
    });
    expect(store.instance.getState().ativa).toEqual({
      organizacaoId: '0123456789abcdef',
      area: 'monitoramento',
    });

    // A later full-state replace that OMITS `ativa` must clear it — and the
    // replace payload cannot smuggle in the runtime-only `hidratacaoFalhou`.
    const semAtiva: Partial<CoiabOrganizationsState> = {
      versao: 1,
      organizacoes: [],
      hidratacaoFalhou: true,
    };
    await act(async () => {
      store.instance.setState(semAtiva as CoiabOrganizationsState, true);
    });
    const state = store.instance.getState();
    expect(state.ativa).toBeUndefined();
    expect(state.hidratacaoFalhou).toBe(false);
  });

  test('iniciarOrganizacao persists the intent with estado preparando before any project exists', async () => {
    const store = await startedStore();
    const organizacao = org(store);
    expect(organizacao).toMatchObject({
      id: '0123456789abcdef',
      nome: 'Órgão Teste',
      estado: 'preparando',
      confirmacaoPendente: false,
      areaEmExecucao: null,
      ultimoErro: null,
    });
    expect(organizacao.materializacao.monitoramento).toEqual({
      etapa: 'ausente',
      projectId: null,
      template: TEMPLATES.monitoramento,
      idsAntesDaCriacao: null,
    });
    expect(organizacao.materializacao.alertas).toEqual({
      etapa: 'ausente',
      projectId: null,
      template: TEMPLATES.alertas,
      idsAntesDaCriacao: null,
    });
    expect(store.instance.getState().ativa).toBeNull();
  });

  test('refuses to start a second organization while one exists (uma criação por vez)', async () => {
    const store = await startedStore();
    await act(async () => {
      const accepted = store.actions.iniciarOrganizacao({
        id: 'fedcba9876543210',
        nome: 'Outra',
        templates: TEMPLATES,
      });
      expect(accepted).toBe(false);
    });
    expect(org(store).id).toBe('0123456789abcdef');
  });

  test('iniciarEtapaCriacao records the listProjects snapshot and the running area', async () => {
    const store = await startedStore();
    await act(async () => {
      store.actions.iniciarEtapaCriacao('monitoramento', ['antes-1']);
    });
    expect(org(store).materializacao.monitoramento).toEqual({
      etapa: 'criando',
      projectId: null,
      template: TEMPLATES.monitoramento,
      idsAntesDaCriacao: ['antes-1'],
    });
    expect(org(store).areaEmExecucao).toBe('monitoramento');
  });

  test('registrarProjetoCriado persists the public id before any import', async () => {
    const store = await startedStore();
    await act(async () => {
      store.actions.iniciarEtapaCriacao('monitoramento', []);
      store.actions.registrarProjetoCriado('monitoramento', 'p-m-1');
    });
    expect(org(store).materializacao.monitoramento).toMatchObject({
      etapa: 'criado',
      projectId: 'p-m-1',
    });
  });

  test('tracks import and verification of each area', async () => {
    const store = await startedStore();
    await act(async () => {
      store.actions.iniciarEtapaCriacao('monitoramento', []);
      store.actions.registrarProjetoCriado('monitoramento', 'p-m-1');
      store.actions.iniciarImportacao('monitoramento');
    });
    expect(org(store).materializacao.monitoramento.etapa).toBe('importando');
    await act(async () => {
      store.actions.registrarAreaVerificada('monitoramento');
    });
    expect(org(store).materializacao.monitoramento.etapa).toBe('verificado');
    expect(org(store).areaEmExecucao).toBeNull();
  });

  test('registrarFalha keeps the journal and records ultimoErro without the organization name', async () => {
    const store = await startedStore();
    await act(async () => {
      store.actions.iniciarEtapaCriacao('monitoramento', []);
      store.actions.registrarProjetoCriado('monitoramento', 'p-m-1');
      store.actions.registrarFalha({
        codigo: 'import-failed',
        area: 'monitoramento',
      });
    });
    expect(org(store).estado).toBe('falha_recuperavel');
    expect(org(store).materializacao.monitoramento.projectId).toBe('p-m-1');
    expect(org(store).ultimoErro).toMatchObject({
      codigo: 'import-failed',
      area: 'monitoramento',
    });
    expect(org(store).ultimoErro?.ocorridoEm).toEqual(expect.any(String));
    expect(JSON.stringify(org(store).ultimoErro)).not.toContain('Órgão Teste');
  });

  test('retomarPreparacao returns to preparando keeping the journal (Tentar novamente)', async () => {
    const store = await startedStore();
    await act(async () => {
      store.actions.iniciarEtapaCriacao('monitoramento', []);
      store.actions.registrarProjetoCriado('monitoramento', 'p-m-1');
      store.actions.registrarFalha({codigo: 'x', area: 'monitoramento'});
      store.actions.retomarPreparacao();
    });
    expect(org(store).estado).toBe('preparando');
    expect(org(store).materializacao.monitoramento.projectId).toBe('p-m-1');
  });

  test('publicarPronta requires both areas verified with distinct ids', async () => {
    const store = await startedStore();
    await act(async () => {
      const refused = store.actions.publicarPronta();
      expect(refused).toBe(false);
    });
    expect(org(store).estado).toBe('preparando');

    await act(async () => {
      store.actions.iniciarEtapaCriacao('monitoramento', []);
      store.actions.registrarProjetoCriado('monitoramento', 'p-m-1');
      store.actions.registrarAreaVerificada('monitoramento');
    });
    await act(async () => {
      const refused = store.actions.publicarPronta();
      expect(refused).toBe(false);
    });
    expect(org(store).estado).toBe('preparando');

    await act(async () => {
      store.actions.iniciarEtapaCriacao('alertas', []);
      store.actions.registrarProjetoCriado('alertas', 'p-a-1');
      store.actions.registrarAreaVerificada('alertas');
      const published = store.actions.publicarPronta();
      expect(published).toBe(true);
    });
    expect(org(store).estado).toBe('pronta');
    expect(org(store).confirmacaoPendente).toBe(true);
  });

  test('publicarPronta refuses duplicated project ids', async () => {
    const store = await startedStore();
    await act(async () => {
      store.actions.iniciarEtapaCriacao('monitoramento', []);
      store.actions.registrarProjetoCriado('monitoramento', 'p-1');
      store.actions.registrarAreaVerificada('monitoramento');
      store.actions.iniciarEtapaCriacao('alertas', []);
      store.actions.registrarProjetoCriado('alertas', 'p-1');
      store.actions.registrarAreaVerificada('alertas');
      const published = store.actions.publicarPronta();
      expect(published).toBe(false);
    });
    expect(org(store).estado).not.toBe('pronta');
  });

  test('reconhecerConfirmacao writes acknowledgement and activation in a single write', async () => {
    const store = await startedStore();
    await act(async () => {
      store.actions.iniciarEtapaCriacao('monitoramento', []);
      store.actions.registrarProjetoCriado('monitoramento', 'p-m-1');
      store.actions.registrarAreaVerificada('monitoramento');
      store.actions.iniciarEtapaCriacao('alertas', []);
      store.actions.registrarProjetoCriado('alertas', 'p-a-1');
      store.actions.registrarAreaVerificada('alertas');
      store.actions.publicarPronta();
    });

    let notifications = 0;
    store.instance.subscribe(() => {
      notifications += 1;
    });

    await act(async () => {
      store.actions.reconhecerConfirmacao();
    });

    expect(notifications).toBe(1);
    expect(org(store).confirmacaoPendente).toBe(false);
    expect(store.instance.getState().ativa).toEqual({
      organizacaoId: '0123456789abcdef',
      area: 'monitoramento',
    });
  });

  test('reconhecerConfirmacao is refused before the organization is ready', async () => {
    const store = await startedStore();
    await act(async () => {
      store.actions.reconhecerConfirmacao();
    });
    expect(store.instance.getState().ativa).toBeNull();
    expect(org(store).confirmacaoPendente).toBe(false);
  });

  test('rehydrates the persisted document into a fresh store (restart)', async () => {
    const persisted = createCoiabOrganizationsStore({persist: true});
    await act(async () => {
      persisted.actions.iniciarOrganizacao({
        id: '0123456789abcdef',
        nome: 'Órgão Persistido',
        templates: TEMPLATES,
      });
      persisted.actions.iniciarEtapaCriacao('monitoramento', ['antes-1']);
      persisted.actions.registrarProjetoCriado('monitoramento', 'p-m-1');
    });

    const rehydrated = createCoiabOrganizationsStore({persist: true});
    expect(rehydrated.instance.getState().organizacoes).toHaveLength(1);
    expect(rehydrated.instance.getState().organizacoes[0]).toMatchObject({
      id: '0123456789abcdef',
      nome: 'Órgão Persistido',
      estado: 'preparando',
    });
    expect(
      rehydrated.instance.getState().organizacoes[0]?.materializacao
        .monitoramento,
    ).toMatchObject({etapa: 'criado', projectId: 'p-m-1'});
  });

  test('an invalid persisted document exposes hidratacaoFalhou, keeps MMKV and blocks a new creation (SPEC B §6)', () => {
    const raw = '{"versao": 99, "junk": true}';
    MMKVStoreInitializer.setItem(STORAGE_KEY, raw);
    const store = createCoiabOrganizationsStore({persist: true});
    // In-memory state is the initial document, but the failure is exposed.
    expect(store.instance.getState()).toStrictEqual({
      ...documentoInicial(),
      hidratacaoFalhou: true,
    });
    const antes = store.instance.getState();
    let notifications = 0;
    store.instance.subscribe(() => {
      notifications += 1;
    });
    // A new creation is REFUSED — it can no longer overwrite the journal.
    expect(
      store.actions.iniciarOrganizacao({
        id: '0123456789abcdef',
        nome: 'Nova',
        templates: TEMPLATES,
      }),
    ).toBe(false);
    // Even a raw full-state write is blocked while the failure is active.
    store.instance.setState({...documentoInicial(), organizacoes: []}, true);
    expect(store.instance.getState()).toBe(antes);
    expect(notifications).toBe(0);
    // The persisted record is PRESERVED untouched — never fixed by deleting.
    expect(MMKVStoreInitializer.getItem(STORAGE_KEY)).toBe(raw);
    expect(store.actions.publicarPronta()).toBe(false);
  });

  test('a shape-valid pronta document that breaks the D9 activation invariant fails hydration and preserves storage (SPEC B §6)', () => {
    const prontaComArea = (
      monitoramento: OrganizacaoLocal['materializacao']['monitoramento'],
      alertas: OrganizacaoLocal['materializacao']['alertas'],
    ): EstadoOrganizacoes => ({
      versao: 1,
      organizacoes: [
        {
          id: '0123456789abcdef',
          nome: 'Inválida',
          estado: 'pronta',
          confirmacaoPendente: true,
          materializacao: {monitoramento, alertas},
          areaEmExecucao: null,
          ultimoErro: null,
        },
      ],
      ativa: null,
    });
    const areaVerificada = (
      projectId: string | null,
    ): OrganizacaoLocal['materializacao']['monitoramento'] => ({
      etapa: 'verificado',
      projectId,
      template: {versao: '1.0.0', hash: 'hash-x'},
      idsAntesDaCriacao: null,
    });

    // A pronta org whose monitoramento area has no projectId — shape is valid
    // (isEtapaArea allows projectId: null) but D9 requires two distinct real
    // ids, so hydration must fail and leave the raw record in place.
    const raw = JSON.stringify(
      prontaComArea(areaVerificada(null), areaVerificada('p-a-1')),
    );
    MMKVStoreInitializer.setItem(STORAGE_KEY, raw);
    const store = createCoiabOrganizationsStore({persist: true});
    expect(store.instance.getState().hidratacaoFalhou).toBe(true);
    expect(store.instance.getState().organizacoes).toEqual([]);
    expect(MMKVStoreInitializer.getItem(STORAGE_KEY)).toBe(raw);
  });

  test('resolverFalhaHidratacao clears the record, resets the document and unblocks writes', () => {
    const raw = '{"versao": 99, "junk": true}';
    MMKVStoreInitializer.setItem(STORAGE_KEY, raw);
    const store = createCoiabOrganizationsStore({persist: true});
    expect(store.instance.getState().hidratacaoFalhou).toBe(true);
    store.actions.resolverFalhaHidratacao();
    expect(store.instance.getState()).toStrictEqual({
      ...documentoInicial(),
      hidratacaoFalhou: false,
    });
    expect(MMKVStoreInitializer.getItem(STORAGE_KEY)).toBeNull();
    // Writes work again and persist normally.
    expect(
      store.actions.iniciarOrganizacao({
        id: '0123456789abcdef',
        nome: 'Nova',
        templates: TEMPLATES,
      }),
    ).toBe(true);
    expect(org(store).nome).toBe('Nova');
    expect(MMKVStoreInitializer.getItem(STORAGE_KEY)).not.toBeNull();
  });

  test('resolverFalhaHidratacao is a no-op on a healthy store (never deletes a good record)', () => {
    const store = createCoiabOrganizationsStore({persist: true});
    store.actions.iniciarOrganizacao({
      id: '0123456789abcdef',
      nome: 'Íntegra',
      templates: TEMPLATES,
    });
    const antes = store.instance.getState();
    const remove = jest.spyOn(MMKVStoreInitializer, 'removeItem');
    store.actions.resolverFalhaHidratacao();
    expect(store.instance.getState()).toBe(antes);
    expect(remove).not.toHaveBeenCalled();
    remove.mockRestore();
  });

  test('exposes the document and actions through context hooks', async () => {
    const store = createCoiabOrganizationsStore();
    const {result: documentResult} = await renderHook(
      () => useCoiabOrganizationsDocument(),
      {wrapper: createWrapper(store)},
    );
    const {result: actionsResult} = await renderHook(
      () => useCoiabOrganizationsActions(),
      {wrapper: createWrapper(store)},
    );
    expect(documentResult.current).toStrictEqual({
      ...documentoInicial(),
      hidratacaoFalhou: false,
    });
    await act(async () => {
      actionsResult.current.iniciarOrganizacao({
        id: '0123456789abcdef',
        nome: 'Contexto',
        templates: TEMPLATES,
      });
    });
    expect(documentResult.current.organizacoes).toHaveLength(1);
  });
});

describe('falha de hidratação — leitura e persistência (SPEC B §6)', () => {
  beforeEach(() => {
    MMKVStoreInitializer.removeItem(STORAGE_KEY);
  });

  test('corrupt JSON raw exposes the failure and preserves the record', () => {
    const raw = '{estado: quebrado';
    MMKVStoreInitializer.setItem(STORAGE_KEY, raw);
    const store = createCoiabOrganizationsStore({persist: true});
    expect(store.instance.getState().hidratacaoFalhou).toBe(true);
    expect(MMKVStoreInitializer.getItem(STORAGE_KEY)).toBe(raw);
  });

  test('a getItem read error gets the same treatment as an invalid record', () => {
    MMKVStoreInitializer.setItem(
      STORAGE_KEY,
      JSON.stringify(documentoInicial()),
    );
    const getItem = jest
      .spyOn(MMKVStoreInitializer, 'getItem')
      .mockImplementationOnce(() => {
        throw new Error('mmkv read failure');
      });
    const store = createCoiabOrganizationsStore({persist: true});
    getItem.mockRestore();
    expect(store.instance.getState().hidratacaoFalhou).toBe(true);
    expect(store.instance.getState().organizacoes).toEqual([]);
  });

  test('a healthy rehydration keeps hidratacaoFalhou false', () => {
    const primeiro = createCoiabOrganizationsStore({persist: true});
    primeiro.actions.iniciarOrganizacao({
      id: '0123456789abcdef',
      nome: 'Órgão',
      templates: TEMPLATES,
    });
    const segundo = createCoiabOrganizationsStore({persist: true});
    expect(segundo.instance.getState().hidratacaoFalhou).toBe(false);
    expect(segundo.instance.getState().organizacoes).toHaveLength(1);
  });

  test('the persisted document never carries the runtime flag', () => {
    const store = createCoiabOrganizationsStore({persist: true});
    store.actions.iniciarOrganizacao({
      id: '0123456789abcdef',
      nome: 'Órgão',
      templates: TEMPLATES,
    });
    const raw = MMKVStoreInitializer.getItem(STORAGE_KEY);
    expect(typeof raw).toBe('string');
    const texto = raw as string;
    expect(texto).not.toContain('hidratacaoFalhou');
    const documento = JSON.parse(texto) as Record<string, unknown>;
    expect(Object.keys(documento).sort()).toEqual([
      'ativa',
      'organizacoes',
      'versao',
    ]);
    expect(documento.versao).toBe(1);
  });

  test('a non-persisted store resolves the failure without touching MMKV', () => {
    MMKVStoreInitializer.setItem(STORAGE_KEY, 'registro intocado');
    const store = createCoiabOrganizationsStore();
    store.instance.setState({hidratacaoFalhou: true});
    expect(store.instance.getState().hidratacaoFalhou).toBe(true);
    const remove = jest.spyOn(MMKVStoreInitializer, 'removeItem');
    store.actions.resolverFalhaHidratacao();
    expect(remove).not.toHaveBeenCalled();
    remove.mockRestore();
    expect(store.instance.getState().hidratacaoFalhou).toBe(false);
    expect(MMKVStoreInitializer.getItem(STORAGE_KEY)).toBe('registro intocado');
  });
});
