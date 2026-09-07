import {createDraftObservationStore} from '../../contexts/PersistedStores/DraftObservationStore';
import {createTrackStore} from '../../contexts/TrackStoreContext';
import {hasPendingOrganizationWork} from './pendingWork';

describe('trabalho com origem persistida (CA08/CA09)', () => {
  test('rascunho conserva origem após reidratação e recusa gravação em outra área', () => {
    const draft = createDraftObservationStore({persist: true});
    draft.setProjectResolver(() => 'A-m');
    draft.actions.createDraft();
    const restored = createDraftObservationStore({persist: true});
    expect(restored.instance.getState().projectId).toBe('A-m');
    expect(() => restored.actions.assertOrigin('B-m')).toThrow(
      'work-origin-mismatch',
    );
    expect(() => restored.actions.assertOrigin('A-m')).not.toThrow();
  });
  test('rascunho legado sem origem não recebe ID da nova organização, mas continua salvável', () => {
    const draft = createDraftObservationStore({persist: false});
    draft.actions.createDraft();
    draft.setProjectResolver(() => 'B-m');
    // A origem do rascunho não é reescrita pelo projeto ativo...
    expect(draft.instance.getState().projectId).toBeUndefined();
    // ...e a ausência de carimbo não bloqueia o salvamento (trabalho pendente
    // anterior à camada de organização não fica preso após a atualização).
    expect(() => draft.actions.assertOrigin('B-m')).not.toThrow();
  });
  test('trilha parada continua pendente e mantém origem até salvar ou descartar', () => {
    const track = createTrackStore({persist: true});
    track.setProjectResolver(() => 'A-a');
    track.actions.setTracking(true);
    track.actions.setTracking(false);
    const restored = createTrackStore({persist: true});
    expect(restored.instance.getState().projectId).toBe('A-a');
    expect(
      hasPendingOrganizationWork({track: restored.instance.getState()}),
    ).toBe(true);
    expect(() => restored.actions.assertOrigin('B-m')).toThrow(
      'work-origin-mismatch',
    );
    restored.actions.clearCurrentTrack();
    expect(
      hasPendingOrganizationWork({track: restored.instance.getState()}),
    ).toBe(false);
  });
  test.each([
    {draft: {value: {tags: {}}}},
    {track: {isTracking: true}},
    {track: {locationHistory: [{}]}},
    {track: {docId: 'edit'}},
    {media: true},
    {mutations: 1},
    {invites: true},
    {archive: true},
  ])('bloqueia trabalho %j', work => {
    expect(hasPendingOrganizationWork(work)).toBe(true);
  });
});
