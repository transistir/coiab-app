import * as React from 'react';
import {useQueryClient} from '@tanstack/react-query';
import type {WriteableDocumentType} from '@comapeo/core-react';

import {useActiveProject} from '../../contexts/ActiveProjectContext';

// Mirrors `getManyDocumentsQueryKey` from `@comapeo/core-react`
// (dist/esm/lib/react-query.js): the function is not re-exported from the
// package index and the package `exports` map blocks deep imports. It must
// match the key `useManyDocs({projectId, docType})` uses (no `includeDeleted`,
// no `lang`), as in `useObservations` and `useTracks`.
function manyDocsQueryKey(projectId: string, docType: WriteableDocumentType) {
  return [
    '@comapeo/core-react',
    'projects',
    projectId,
    docType,
    {includeDeleted: undefined, lang: undefined},
  ] as const;
}

/**
 * Whether the react-query cache already holds a non-empty `useManyDocs` list
 * of `docType` for the active project. Never suspends and never fetches: it
 * only reads what another component's query (e.g. the screen's own
 * `useObservations`) already put in the cache, and re-renders when that flips.
 *
 * The snapshot is a boolean, so cache events that do not change the answer do
 * not re-render the caller.
 */
export function useHasCachedDocs(docType: WriteableDocumentType): boolean {
  const {projectId} = useActiveProject();
  const queryClient = useQueryClient();

  const subscribe = React.useCallback(
    (onChange: () => void) => queryClient.getQueryCache().subscribe(onChange),
    [queryClient],
  );
  const getSnapshot = React.useCallback(() => {
    const data = queryClient.getQueryData(manyDocsQueryKey(projectId, docType));
    return Array.isArray(data) && data.length > 0;
  }, [queryClient, projectId, docType]);

  return React.useSyncExternalStore(subscribe, getSnapshot);
}
