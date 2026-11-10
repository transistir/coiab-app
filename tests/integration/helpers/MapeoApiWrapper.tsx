import {type ComapeoCoreClientApi} from '@comapeo/ipc';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';

import {ComapeoCoreProvider} from '@comapeo/core-react';
import {ReactNode, useState} from 'react';

export const MapeoApiWrapper = ({
  mapeoApi,
  children,
}: {
  mapeoApi: ComapeoCoreClientApi;
  children: ReactNode;
}) => {
  // One client per mount, not per render: a rerender of the wrapper (e.g. a
  // test's `rerender`) must keep the same cache. `useState`'s lazy initializer
  // is React's documented "create once" escape hatch. Module-level would leak
  // the cache across tests; a fresh client per render would drop it mid-test
  // and leave its garbage-collection timers unreset.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        // Disable garbage collection, so that no "collect garbage" timers are
        // started, which would otherwise leave an open handle, giving a Jest
        // warning. See [this tip in the Tanstack Query docs][0] and [this cache
        // example scenario][1].
        // [0]: https://tanstack.com/query/latest/docs/framework/react/guides/testing#set-gctime-to-infinity-with-jest
        // [1]: https://tanstack.com/query/latest/docs/framework/react/guides/caching
        defaultOptions: {
          queries: {gcTime: Infinity},
          mutations: {gcTime: Infinity},
        },
      }),
  );

  // Mock map server API for tests
  const getMapServerBaseUrl = async () => new URL('http://localhost:8080');
  const mockFetch = async () => ({}) as Response;

  return (
    <QueryClientProvider client={queryClient}>
      <ComapeoCoreProvider
        clientApi={mapeoApi}
        getMapServerBaseUrl={getMapServerBaseUrl}
        fetch={mockFetch}
        queryClient={queryClient}>
        {children}
      </ComapeoCoreProvider>
    </QueryClientProvider>
  );
};
