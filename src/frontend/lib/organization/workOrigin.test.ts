jest.mock('expo/fetch', () => ({fetch: globalThis.fetch}));

import {createActiveProjectIdStore} from '../../contexts/ActiveProjectIdStoreContext';
import {wireWorkOriginResolvers} from '../../contexts/AppProviders';
import {createDraftObservationStore} from '../../contexts/PersistedStores/DraftObservationStore';
import {createTrackStore} from '../../contexts/TrackStoreContext';
import {MMKVStoreInitializer} from '../../hooks/persistedState/createPersistedState';

describe('origem do trabalho nos stores do app (CA09)', () => {
  test('resolvers seguem o projeto ativo e assertOrigin recusa origem divergente', () => {
    const activeProjectIdStore = createActiveProjectIdStore();
    const draftObservationStore = createDraftObservationStore({persist: false});
    const trackStore = createTrackStore();
    wireWorkOriginResolvers({
      draftObservationStore,
      trackStore,
      activeProjectIdStore,
    });

    activeProjectIdStore.actions.setActiveProjectId('A-m');
    draftObservationStore.actions.createDraft();
    expect(draftObservationStore.instance.getState().projectId).toBe('A-m');
    trackStore.actions.setTracking(true);
    expect(trackStore.instance.getState().projectId).toBe('A-m');

    // Troca de organização: o projeto ativo agora diverge da origem persistida.
    activeProjectIdStore.actions.setActiveProjectId('B-m');
    expect(() => draftObservationStore.actions.assertOrigin('B-m')).toThrow(
      'work-origin-mismatch',
    );
    expect(() =>
      draftObservationStore.actions.assertOrigin('A-m'),
    ).not.toThrow();
    expect(() => trackStore.actions.assertOrigin('B-m')).toThrow(
      'work-origin-mismatch',
    );

    // Retomada de trilha incompatível com o projeto ativo também é recusada.
    trackStore.actions.setTracking(false);
    expect(() => trackStore.actions.setTracking(true)).toThrow(
      'work-origin-mismatch',
    );
    expect(trackStore.instance.getState().projectId).toBe('A-m');
  });

  test('origem explícita divergente do projeto ativo continua recusada', () => {
    const draftObservationStore = createDraftObservationStore({persist: false});
    const trackStore = createTrackStore();

    draftObservationStore.instance.setState({projectId: 'A-m'});
    trackStore.instance.setState({projectId: 'A-m'});
    expect(() => draftObservationStore.actions.assertOrigin('B-m')).toThrow(
      'work-origin-mismatch',
    );
    expect(() => trackStore.actions.assertOrigin('B-m')).toThrow(
      'work-origin-mismatch',
    );
  });
});

/**
 * M-1: a ausência de carimbo só é exceção legada quando a MIGRAÇÃO de versão
 * do payload afirma isso. Trabalho NOVO cujo projeto não foi resolvido carrega
 * um estado explícito ('unresolved') e é recusado no portão de gravação — sem
 * isso, um rascunho novo criado sem projeto ativo seria gravável em qualquer
 * organização depois da reidratação.
 */
describe('carimbo explícito de origem: legado migrado × trabalho novo (M-1)', () => {
  type WorkStore = {
    instance: {getState(): {projectId?: string; originStatus?: string}};
    actions: {assertOrigin(projectId: string): void};
  };
  type WorkFixture = {
    name: string;
    key: string;
    /** Cria trabalho NOVO (posterior a esta mudança) e o persiste. */
    createWork: (projectId?: string) => WorkStore;
    /** Reabre o store persistido, como faz um reinício do app. */
    restore: () => WorkStore;
  };

  const fixtures: WorkFixture[] = [
    {
      name: 'rascunho',
      key: '@MapeoDraftStore',
      createWork: projectId => {
        const store = createDraftObservationStore({persist: true});
        store.setProjectResolver(() => projectId);
        store.actions.createDraft();
        return store;
      },
      restore: () => createDraftObservationStore({persist: true}),
    },
    {
      name: 'trilha parada',
      key: 'MapeoTrack',
      createWork: projectId => {
        const store = createTrackStore({persist: true});
        store.setProjectResolver(() => projectId);
        store.actions.setTracking(true);
        store.actions.setTracking(false);
        return store;
      },
      restore: () => createTrackStore({persist: true}),
    },
  ];

  beforeEach(() => {
    for (const fixture of fixtures)
      MMKVStoreInitializer.removeItem(fixture.key);
  });

  for (const fixture of fixtures) {
    describe(`${fixture.name}`, () => {
      test.each([undefined, ''])(
        'trabalho novo com origem não resolvida (%j) é recusado ao salvar',
        (projectId: string | undefined) => {
          fixture.createWork(projectId);
          const restored = fixture.restore();
          expect(restored.instance.getState().projectId).toBeUndefined();
          expect(() => restored.actions.assertOrigin('B-m')).toThrow(
            'work-origin-unresolved',
          );
        },
      );

      test('payload v0 sem carimbo migra para legado explícito e continua salvável', () => {
        fixture.createWork('A-m');
        // Payload anterior à camada de organização: sem carimbo algum.
        const persisted = JSON.parse(
          MMKVStoreInitializer.getItem(fixture.key) as string,
        ).state as Record<string, unknown>;
        delete persisted.projectId;
        delete persisted.originStatus;
        MMKVStoreInitializer.setItem(
          fixture.key,
          JSON.stringify({state: persisted, version: 0}),
        );

        const restored = fixture.restore();
        expect(restored.instance.getState()).toMatchObject({
          originStatus: 'legacy',
        });
        expect(restored.instance.getState().projectId).toBeUndefined();
        // Trabalho pendente de quem atualiza o app no meio do rascunho nunca
        // fica preso: salvar no projeto ativo continua permitido.
        expect(() => restored.actions.assertOrigin('B-m')).not.toThrow();
        // A migração é durável — o reinício seguinte já lê o carimbo legado.
        expect(() =>
          fixture.restore().actions.assertOrigin('B-m'),
        ).not.toThrow();
      });

      test('origem resolvida de trabalho novo só é salvável no próprio projeto', () => {
        fixture.createWork('A-m');
        const restored = fixture.restore();
        expect(restored.instance.getState().projectId).toBe('A-m');
        expect(() => restored.actions.assertOrigin('A-m')).not.toThrow();
        expect(() => restored.actions.assertOrigin('B-m')).toThrow(
          'work-origin-mismatch',
        );
      });
    });
  }
});
