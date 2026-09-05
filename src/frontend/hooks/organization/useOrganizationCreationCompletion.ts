import {type QueryClient, useQueryClient} from '@tanstack/react-query';
import {createStore, useStore} from 'zustand';

function createCompletionStore() {
  return createStore<{projectId: string | undefined}>(() => ({
    projectId: undefined,
  }));
}

// Survives creation-screen and active-project provider remounts, but remains
// isolated to this app's query client (including independent test clients).
// This is a transient navigation handoff, not persisted organization state.
const completions = new WeakMap<
  QueryClient,
  ReturnType<typeof createCompletionStore>
>();

export function getOrganizationCreationCompletion(queryClient: QueryClient) {
  let store = completions.get(queryClient);
  if (!store) {
    store = createCompletionStore();
    completions.set(queryClient, store);
  }
  return store;
}

export function useOrganizationCreationCompletion() {
  const store = getOrganizationCreationCompletion(useQueryClient());
  const projectId = useStore(store, state => state.projectId);
  return {projectId, store};
}
