import {act, renderHook} from '@testing-library/react-native';

import {useValidarArquivoRemoto} from './useValidarArquivoRemoto';

// A deferred fetch response so a test can control exactly WHEN the network
// answers — the stale-response proof (5) needs URL A to answer AFTER the user
// has already typed URL B.
type Deferred = {
  promise: Promise<Response>;
  resolve: (name: string | null, status?: number) => void;
  reject: (error?: unknown) => void;
};

function deferredResponse(): Deferred {
  let resolve!: Deferred['resolve'];
  let reject!: Deferred['reject'];
  const promise = new Promise<Response>((res, rej) => {
    resolve = (name, status = 200) =>
      res({
        status,
        json: async () => (name === null ? {} : {data: {name}}),
      } as Response);
    reject = (error = new Error('network')) => rej(error);
  });
  return {promise, resolve, reject};
}

const fetchMock = jest.fn();

/** Flush the microtask queue so settled fetch promises apply their state. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  fetchMock.mockReset();
  (global as unknown as {fetch: jest.Mock}).fetch = fetchMock;
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('useValidarArquivoRemoto', () => {
  test('prova 1: URL válida passa por verificando, chega a valido e chama fetch uma vez após o debounce', async () => {
    const deferred = deferredResponse();
    fetchMock.mockReturnValue(deferred.promise);

    const {result} = await renderHook(() =>
      useValidarArquivoRemoto('https://exemplo.org/'),
    );

    // The spinner is shown immediately, before the debounced request fires.
    expect(result.current.estado).toBe('verificando');
    expect(fetchMock).not.toHaveBeenCalled();

    // The debounce window elapses — now the single request goes out.
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://exemplo.org/info',
      expect.objectContaining({signal: expect.anything()}),
    );

    await act(async () => {
      deferred.resolve('Arquivo A');
    });
    await flush();

    expect(result.current.estado).toBe('valido');
    expect(result.current.nome).toBe('Arquivo A');
    expect(result.current.urlNormalizada).toBe('https://exemplo.org/');
  });

  test('prova 2: digitação rápida a/ab/abc dispara UMA requisição, para a URL final', async () => {
    const deferred = deferredResponse();
    fetchMock.mockReturnValue(deferred.promise);

    const {result, rerender} = await renderHook(
      ({url}: {url: string}) => useValidarArquivoRemoto(url),
      {initialProps: {url: 'https://a.example/'}},
    );
    // Each keystroke restarts the debounce before 600 ms elapse.
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    // `act` is required around rerender here so the hook's effect cleanup
    // (which clears the pending debounce for the previous URL) flushes before
    // the fake-timer advance below — the point this proof asserts.
    // eslint-disable-next-line testing-library/no-unnecessary-act
    await act(async () => {
      rerender({url: 'https://ab.example/'});
    });
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    // eslint-disable-next-line testing-library/no-unnecessary-act
    await act(async () => {
      rerender({url: 'https://abc.example/'});
    });

    // Only now let the debounce complete for the FINAL url.
    await act(async () => {
      jest.advanceTimersByTime(600);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://abc.example/info',
      expect.anything(),
    );

    await act(async () => {
      deferred.resolve('Arquivo ABC');
    });
    await flush();
    expect(result.current.estado).toBe('valido');
    expect(result.current.urlNormalizada).toBe('https://abc.example/');
  });

  test('prova 3a: um 404 leva a invalido', async () => {
    fetchMock.mockResolvedValue({
      status: 404,
      json: async () => ({}),
    } as Response);

    const {result} = await renderHook(() =>
      useValidarArquivoRemoto('https://exemplo.org/'),
    );
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    await flush();
    expect(result.current.estado).toBe('invalido');
    expect(result.current.nome).toBeUndefined();
  });

  test('prova 3b: um timeout de 8 s leva a invalido', async () => {
    // The request never resolves on its own; the abort after 8 s must settle
    // it as `invalido`. The fetch rejects when its abort signal fires.
    fetchMock.mockImplementation(
      (_url: string, opts: {signal: AbortSignal}) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    );

    const {result} = await renderHook(() =>
      useValidarArquivoRemoto('https://lenta.example/'),
    );
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    expect(result.current.estado).toBe('verificando');

    await act(async () => {
      // The 8 s timeout fires the abort.
      jest.advanceTimersByTime(8000);
    });
    await flush();
    expect(result.current.estado).toBe('invalido');
  });

  test('prova 4: formato inválido não chama fetch', async () => {
    const {result} = await renderHook(() =>
      useValidarArquivoRemoto('http://sem-https'),
    );
    expect(result.current.estado).toBe('formato-invalido');

    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('prova 5: resposta atrasada da URL A não sobrescreve o estado da URL B', async () => {
    const respostaA = deferredResponse();
    const respostaB = deferredResponse();
    fetchMock
      .mockReturnValueOnce(respostaA.promise)
      .mockReturnValueOnce(respostaB.promise);

    const {result, rerender} = await renderHook(
      ({url}: {url: string}) => useValidarArquivoRemoto(url),
      {initialProps: {url: 'https://a.example/'}},
    );
    // A's request goes out.
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://a.example/info',
      expect.anything(),
    );

    // The user types B before A answered.
    // eslint-disable-next-line testing-library/no-unnecessary-act
    await act(async () => {
      rerender({url: 'https://b.example/'});
    });
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://b.example/info',
      expect.anything(),
    );

    // NOW A answers (late) with a different name — it must be ignored — and B
    // answers with its own name.
    await act(async () => {
      respostaA.resolve('Arquivo A');
      respostaB.resolve('Arquivo B');
    });
    await flush();

    expect(result.current.estado).toBe('valido');
    expect(result.current.nome).toBe('Arquivo B');
    expect(result.current.urlNormalizada).toBe('https://b.example/');
  });
});
