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
  CancelledError,
  type QueryClient,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {ComapeoCoreClientApi} from '@comapeo/ipc';

import * as AppProvidersModule from '../../../src/frontend/contexts/AppProviders';
import {sleep} from '../../../src/frontend/lib/sleep';
import {createManager, setUpIPC} from './core';
import {createAppProvidersWrapper} from './react';

// Instância que a sonda enxerga pelo contexto do React Query.
let sondaClient: QueryClient | undefined;
// A operação da sonda: quantas vezes a queryFn rodou e como rejeitá-la.
let sondaOperacao: {chamadas: number; rejeitar?: (erro: Error) => void} = {
  chamadas: 0,
};

/**
 * Captura o client do contexto e monta uma query cuja operação só termina
 * quando o teste a rejeita — o equivalente de uma RPC ainda em voo quando o
 * teste termina. Como as queries do @comapeo/core-react, a queryFn não lê
 * `signal`: lido, o próprio unmount cancelaria o fetch
 * (`cancel({revert: true})`) e o teste não isolaria o teardown.
 */
function Sonda() {
  sondaClient = useQueryClient();
  useQuery({
    queryKey: ['sonda-presa'],
    queryFn: () => {
      sondaOperacao.chamadas++;
      return new Promise<never>((_resolver, rejeitar) => {
        sondaOperacao.rejeitar = rejeitar;
      });
    },
  });
  return <Text>sonda</Text>;
}

describe('createAppProvidersWrapper: um único QueryClient', () => {
  let mapeoApi: ComapeoCoreClientApi;
  let onTeardown: Array<() => unknown> = [];

  beforeEach(async () => {
    onTeardown = [];
    sondaClient = undefined;
    sondaOperacao = {chamadas: 0};

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

  test('teardown() cancels the in-flight fetch and clears the context client', async () => {
    const {appProviders, unmount} = await renderSonda();
    const client = sondaClient!;
    await waitFor(() => expect(client.isFetching()).toBe(1));
    const query = client.getQueryCache().find({queryKey: ['sonda-presa']})!;
    let desfecho: unknown = 'em voo';
    query.promise!.catch((erro: unknown) => {
      desfecho = erro;
    });

    // Sozinho, o unmount só cancela as retentativas: o fetch segue em voo.
    await unmount();
    await sleep(0);
    expect(desfecho).toBe('em voo');

    appProviders.teardown();
    await sleep(0);

    // Semântica observada (@tanstack/query-core 5.100.11): `clear()` →
    // `Query.destroy()` → `cancel({silent: true})` rejeita a promise do fetch
    // em voo com `CancelledError {silent: true}`. Por ser silencioso, o
    // cancelamento não despacha nada: a query destruída fica com
    // `status: 'pending'`, `fetchStatus: 'fetching'` (não `idle`) e
    // `error: null` — `isFetching()` dá 0 só porque o cache ficou vazio.
    expect(desfecho).toBeInstanceOf(CancelledError);
    expect(desfecho).toMatchObject({silent: true});

    // A rejeição tardia da operação — o canal fechando — é descartada: nenhum
    // erro chega à query e nada chama a queryFn de novo.
    sondaOperacao.rejeitar!(new Error('RpcChannelClosed'));
    await sleep(0);
    expect(query.state.error).toBeNull();
    expect(sondaOperacao.chamadas).toBe(1);
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
