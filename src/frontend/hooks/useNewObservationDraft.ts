import * as React from 'react';

import {useDraftObservationActions} from '../contexts/DraftObservationContext';
import {useUserProfileState} from '../contexts/UserProfileStoreContext';
import {observerTags} from '../lib/observerProfile';

/**
 * Devolve o callback que inicia um rascunho novo já com a etnia e a aldeia do
 * perfil local (issue #133). O perfil é lido no momento da chamada: mudanças
 * posteriores não reescrevem rascunhos já criados.
 */
export function useNewObservationDraft() {
  const {createDraft} = useDraftObservationActions();
  const profile = useUserProfileState();

  return React.useCallback(() => {
    createDraft(undefined, observerTags(profile));
  }, [createDraft, profile]);
}
