/**
 * Contracts for the `setUpIPC` teardown drain (issue #97): `stop()` must wait
 * for in-flight RPCs — including ones issued DURING the drain and per-project
 * ones — and reject past its deadline naming the stuck methods, with a stuck
 * `getProject` (routing RPC) unable to hold the close phase open. A rejection
 * that reaches its caller must still reach it, and the deadline timers must be
 * cleared so `stop()` leaves no open handles behind. The drain only attaches
 * its tracking handlers when `stop()` starts: before that, a fire-and-forget
 * rejection in a test body (`void rpc()`) must keep failing the running test
 * as an unhandled rejection.
 */
import {randomBytes} from 'node:crypto';

import type {MapeoManager} from '@comapeo/core';

import {sleep} from '../../../src/frontend/lib/sleep';
import {MEMBER_ROLE_ID} from '../../../src/frontend/sharedTypes';
import {createManager, setUpIPC} from './core';

function criarDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {promise, resolve, reject};
}

/**
 * Espera o spy registrar a N-ésima chamada. Sem polling com atraso: a RPC
 * cruza a ponte em poucos macrotasks, então `sleep(0)` basta; o limite de
 * ciclos só existe para a falha ser rápida e descritiva se a RPC nunca
 * chegar ao servidor.
 */
async function esperarChamada(spy: jest.Mock, quantidade = 1) {
  for (let i = 0; i < 1_000; i++) {
    if (spy.mock.calls.length >= quantidade) return;
    await sleep(0);
  }
  throw new Error(
    `spy não registrou ${quantidade} chamada(s) após 1000 ciclos (registrou ${spy.mock.calls.length})`,
  );
}

describe('setUpIPC stop: drenagem determinística', () => {
  let manager: MapeoManager;
  let ipc: ReturnType<typeof setUpIPC>;

  beforeEach(async () => {
    const managerSetup = await createManager({
      name: 'test',
      deviceType: 'mobile',
    });
    manager = managerSetup.manager;
    ipc = setUpIPC({manager});
    ipc.start();
  });

  afterEach(async () => {
    // Limpeza tolerante: nos testes de prazo a promise memoizada de stop()
    // já rejeitou (rejeição essa assertada pelo teste) — o `.catch` só a
    // desarma aqui, e o `race` garante que a limpeza nunca pendura a suíte.
    // O limite é abortado assim que o `race` decide, para o timer de 2s não
    // ficar como handle aberto.
    const limite = new AbortController();
    await Promise.race([
      ipc.stop().catch(() => {}),
      sleep(2_000, {signal: limite.signal}).catch(() => {}),
    ]);
    limite.abort();
  });

  test('stop() waits for an in-flight manager RPC', async () => {
    const deferred = criarDeferred<Array<unknown>>();
    const spy = jest
      .spyOn(manager, 'listProjects')
      .mockReturnValue(deferred.promise);

    const rpc = ipc.client.listProjects();
    await esperarChamada(spy);

    const ordem: Array<string> = [];
    let pararResolveu = false;
    rpc.then(
      () => ordem.push('rpc'),
      () => ordem.push('rpc:reject'),
    );
    const parada = ipc.stop().then(() => {
      pararResolveu = true;
      ordem.push('stop');
    });

    await sleep(0);
    await sleep(0);
    expect(pararResolveu).toBe(false);

    deferred.resolve([]);
    await parada;

    expect(ordem).toEqual(['rpc', 'stop']);
    await expect(rpc).resolves.toEqual([]);
    await expect(ipc.client.listProjects()).rejects.toThrow(/closed/i);
  });

  test('stop() drains RPCs issued while draining', async () => {
    const primeira = criarDeferred<Array<unknown>>();
    const segunda = criarDeferred<Array<unknown>>();
    const spy = jest
      .spyOn(manager, 'listProjects')
      .mockReturnValueOnce(primeira.promise)
      .mockReturnValueOnce(segunda.promise);

    const rpc1 = ipc.client.listProjects();
    await esperarChamada(spy);
    // Emitida durante a drenagem: só sai quando a primeira resolver, o que
    // só acontece DEPOIS de stop() ter começado.
    const rpc2 = rpc1.then(() => ipc.client.listProjects());

    const ordem: Array<string> = [];
    let pararResolveu = false;
    rpc1.then(
      () => ordem.push('rpc1'),
      () => ordem.push('rpc1:reject'),
    );
    rpc2.then(
      () => ordem.push('rpc2'),
      () => ordem.push('rpc2:reject'),
    );
    const parada = ipc.stop().then(() => {
      pararResolveu = true;
      ordem.push('stop');
    });

    await sleep(0);
    await sleep(0);
    expect(pararResolveu).toBe(false);

    primeira.resolve([]);
    // A segunda RPC entra em voo durante a drenagem; espaço para o loop de
    // drenagem registrá-la antes de prosseguir.
    await sleep(0);
    await sleep(0);
    expect(pararResolveu).toBe(false);

    segunda.resolve([]);
    await parada;

    expect(ordem).toEqual(['rpc1', 'rpc2', 'stop']);
    await expect(rpc2).resolves.toEqual([]);
    await expect(ipc.client.listProjects()).rejects.toThrow(/closed/i);
  });

  test('stop() drains an in-flight project RPC', async () => {
    const projectId = await ipc.client.createProject({name: 'T3'});
    const projeto = await ipc.client.getProject(projectId);
    // O manager guarda as instâncias abertas (`#activeProjects`), então esta
    // é a MESMA instância que o lado servidor do IPC reflete.
    const projetoServidor = await manager.getProject(projectId);
    const deferred = criarDeferred<void>();
    const spy = jest
      .spyOn(projetoServidor.$member, 'invite')
      .mockReturnValue(deferred.promise);

    const rpc = projeto.$member.invite('dispositivo-convidado', {
      roleId: MEMBER_ROLE_ID,
      __testOnlyInviteId: randomBytes(32),
    });
    await esperarChamada(spy);

    const ordem: Array<string> = [];
    rpc.then(
      () => ordem.push('rpc'),
      () => ordem.push('rpc:reject'),
    );
    const parada = ipc.stop().then(() => {
      ordem.push('stop');
    });

    await sleep(0);
    await sleep(0);
    expect(ordem).toEqual([]);

    deferred.resolve();
    await parada;

    expect(ordem).toEqual(['rpc', 'stop']);
    await expect(rpc).resolves.toBeUndefined();
    await expect(ipc.client.listProjects()).rejects.toThrow(/closed/i);
  });

  test('a normal rejection during the drain reaches the caller and does not hang the drain', async () => {
    const deferred = criarDeferred<never>();
    const spy = jest
      .spyOn(manager, 'listProjects')
      .mockReturnValue(deferred.promise);

    const rpc = ipc.client.listProjects();
    await esperarChamada(spy);

    const parada = ipc.stop();
    await sleep(0);
    deferred.reject(new Error('boom'));

    await expect(rpc).rejects.toThrow('boom');
    await parada;
    await expect(ipc.client.listProjects()).rejects.toThrow(/closed/i);
  });

  test('drain deadline: stop() rejects naming stuck methods and count, after closing', async () => {
    const deferred = criarDeferred<Array<unknown>>();
    const spy = jest
      .spyOn(manager, 'listProjects')
      .mockReturnValue(deferred.promise);

    const rpc1 = ipc.client.listProjects();
    const rpc2 = ipc.client.listProjects();
    await esperarChamada(spy, 2);

    const inicio = Date.now();
    await expect(ipc.stop({drainTimeoutMs: 50})).rejects.toThrow(
      /listProjects ×2/,
    );
    const decorrido = Date.now() - inicio;
    // Tolerância de 5ms: os timers do Node medem pelo relógio do loop (em
    // cache, ms inteiros), então o prazo pode disparar um pouco antes do que
    // `Date.now()` registra.
    expect(decorrido).toBeGreaterThanOrEqual(45);
    // Muito abaixo do timeout de 30s da própria RPC: o prazo é do drain.
    expect(decorrido).toBeLessThan(4_000);

    await expect(rpc1).rejects.toThrow(/closed/i);
    await expect(rpc2).rejects.toThrow(/closed/i);
    await expect(ipc.client.listProjects()).rejects.toThrow(/closed/i);
  });

  test('a stuck getProject (routing RPC) cannot hold stop() open past its deadline', async () => {
    const deferred = criarDeferred<never>();
    // O cliente nunca emite "getProject" no fio: ele roteia por
    // `assertProjectExists`, que no servidor chama `manager.getProject`.
    const spy = jest
      .spyOn(manager, 'getProject')
      .mockReturnValue(deferred.promise);

    const presa = ipc.client.getProject('projeto-inexistente');
    await esperarChamada(spy);
    // A promise do chamador só rejeita no timeout de 30s da RPC de
    // roteamento — muito depois deste teste. Desarmada aqui; o contrato
    // (stop não segurar o fechamento) é assertado abaixo.
    presa.catch(() => {});

    const inicio = Date.now();
    await expect(ipc.stop({drainTimeoutMs: 100})).rejects.toThrow(/getProject/);
    const decorrido = Date.now() - inicio;
    // Mesma tolerância de 5ms do teste anterior.
    expect(decorrido).toBeGreaterThanOrEqual(95);
    expect(decorrido).toBeLessThan(5_000);

    // Canal fechado: novas RPCs rejeitam.
    await expect(ipc.client.listProjects()).rejects.toThrow(/closed/i);
  });

  test('stop() is idempotent and clears its deadline timer', async () => {
    const closeSpy = jest.spyOn(ipc.server, 'close');
    // Pass-through: sleep()/p-timeout dependem dos timers reais.
    const setTimeoutReal = globalThis.setTimeout.bind(globalThis);
    const setTimeoutSpy = jest
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation(
        setTimeoutReal as unknown as typeof globalThis.setTimeout,
      );
    const clearTimeoutReal = globalThis.clearTimeout.bind(globalThis);
    const clearTimeoutSpy = jest
      .spyOn(globalThis, 'clearTimeout')
      .mockImplementation(
        clearTimeoutReal as unknown as typeof globalThis.clearTimeout,
      );

    const parada = ipc.stop({drainTimeoutMs: 43_210});
    const repetida = ipc.stop({drainTimeoutMs: 43_210});
    await parada;

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(repetida).toBe(parada);

    const indice = setTimeoutSpy.mock.calls.findIndex(
      chamada => chamada[1] === 43_210,
    );
    expect(indice).toBeGreaterThanOrEqual(0);
    const handle = setTimeoutSpy.mock.results[indice].value as ReturnType<
      typeof setTimeoutReal
    >;
    expect(clearTimeoutSpy.mock.calls).toContainEqual([handle]);
  });
});
