jest.mock('expo/fetch', () => ({fetch: globalThis.fetch}));

import {createActiveProjectIdStore} from '../../contexts/ActiveProjectIdStoreContext';
import {wireWorkOriginResolvers} from '../../contexts/AppProviders';
import {createDraftObservationStore} from '../../contexts/PersistedStores/DraftObservationStore';
import {createTrackStore} from '../../contexts/TrackStoreContext';

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
});
