/**
 * Contracts for the integration wrapper's QueryClient (issue #97): the wrapper
 * holds ONE QueryClient — the instance `useQueryClient()` sees, the one
 * AppProviders receives and the one exposed as `appProviders.queryClient`, as
 * in production (App.tsx) — and `teardown()` cancels and clears it, so a query
 * still in flight when a test ends cannot outlive the test.
 */
import {Text} from 'react-native';
import {render, screen, waitFor} from '@testing-library/react-native';
import {
  type QueryClient,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {ComapeoCoreClientApi} from '@comapeo/ipc';

import * as AppProvidersModule from '../../../src/frontend/contexts/AppProviders';
import {createManager, setUpIPC} from './core';
import {createAppProvidersWrapper} from './react';

// Instância que a sonda enxerga pelo contexto do React Query.
let sondaClient: QueryClient | undefined;

/**
 * Captura o client do contexto e monta uma query que nunca resolve — o
 * equivalente de uma query ainda em voo quando o teste termina.
 */
function Sonda() {
  sondaClient = useQueryClient();
  useQuery({
    queryKey: ['sonda-presa'],
    queryFn: () => new Promise<never>(() => {}),
  });
  return <Text>sonda</Text>;
}

describe('createAppProvidersWrapper: um único QueryClient', () => {
  let mapeoApi: ComapeoCoreClientApi;
  let onTeardown: Array<() => unknown> = [];

  beforeEach(async () => {
    onTeardown = [];
    sondaClient = undefined;

    const {manager, fastifyController} = await createManager({
      name: 'test',
      deviceType: 'mobile',
    });
    await fastifyController.start();
    const ipc = setUpIPC({manager});
    mapeoApi = ipc.client;
    // Ordem do contrato de `setUpIPC().stop()`: a drenagem antes do fastify.
    onTeardown.push(ipc.stop, () => fastifyController.stop());
  });

  afterEach(async () => {
    for (const fn of onTeardown) await fn();
  });

  const renderSonda = async () => {
    const appProviders = createAppProvidersWrapper({mapeoApi});
    const {unmount} = await render(<Sonda />, {
      wrapper: appProviders.wrapper,
    });
    // Árvore e providers encerrados antes do IPC e do fastify. Ambos são
    // idempotentes: T7 também os chama no corpo do teste.
    onTeardown.unshift(async () => {
      await unmount();
      appProviders.teardown();
    });
    // O IntlProvider só monta os filhos (AppProviders e a sonda) depois de
    // carregar as mensagens.
    await screen.findByText('sonda');
    return {appProviders, unmount};
  };

  test('teardown() cancels and clears the query living in the context client', async () => {
    const {appProviders, unmount} = await renderSonda();
    const client = sondaClient!;
    await waitFor(() => expect(client.isFetching()).toBe(1));

    await unmount();
    appProviders.teardown();

    expect(client.isFetching()).toBe(0);
    expect(client.getQueryCache().getAll()).toEqual([]);
  });

  test('one QueryClient: context === AppProviders prop === exposed', async () => {
    const appProvidersSpy = jest.spyOn(AppProvidersModule, 'AppProviders');
    onTeardown.push(() => appProvidersSpy.mockRestore());

    const {appProviders} = await renderSonda();

    expect(appProvidersSpy).toHaveBeenCalled();
    const [props] = appProvidersSpy.mock.lastCall!;
    expect(sondaClient).toBeDefined();
    expect(props.queryClient).toBe(sondaClient);
    expect(appProviders.queryClient).toBe(sondaClient);
  });
});
