/**
 * Contract for MapeoApiWrapper's QueryClient (issue #104): the wrapper owns
 * ONE client per mount, configured with `gcTime: Infinity` so no GC timers
 * outlive the test. Before the fix the client was created in the component
 * body, so every render minted a fresh cache and dropped the previous one's
 * registration.
 */
import * as React from 'react';
import {Text} from 'react-native';
import {render} from '@testing-library/react-native';
import {type QueryClient, useQueryClient} from '@tanstack/react-query';
import type {ComapeoCoreClientApi} from '@comapeo/ipc';

import {MapeoApiWrapper} from './MapeoApiWrapper';

// Passthrough: the test is about the wrapper's own QueryClient, not the real
// core provider, which would drag IPC into the harness.
jest.mock('@comapeo/core-react', () => ({
  ComapeoCoreProvider: ({children}: {children: React.ReactNode}) => children,
}));

const mapeoApi = {} as ComapeoCoreClientApi;

// Every render of the probe records the client `useQueryClient()` sees.
let instancias: QueryClient[] = [];

function Probe() {
  instancias.push(useQueryClient());
  return <Text>probe</Text>;
}

describe('MapeoApiWrapper: um QueryClient estável', () => {
  beforeEach(() => {
    instancias = [];
  });

  test('rerender preserva a instância e desliga o GC', async () => {
    const {rerender} = await render(
      <MapeoApiWrapper mapeoApi={mapeoApi}>
        <Probe />
      </MapeoApiWrapper>,
    );

    const primeira = instancias[instancias.length - 1]!;

    await rerender(
      <MapeoApiWrapper mapeoApi={mapeoApi}>
        <Probe />
      </MapeoApiWrapper>,
    );

    const segunda = instancias[instancias.length - 1]!;

    expect(Object.is(primeira, segunda)).toBe(true);
    expect(primeira.getDefaultOptions().queries?.gcTime).toBe(Infinity);
    expect(primeira.getDefaultOptions().mutations?.gcTime).toBe(Infinity);
  });
});
