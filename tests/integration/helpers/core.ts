import {spawn} from 'node:child_process';
import path from 'node:path';
import {MessageChannel} from 'node:worker_threads';
import {FastifyController, MapeoManager} from '@comapeo/core';
import type {ComapeoProjectClientApi} from '@comapeo/ipc';
import {
  closeComapeoCoreClient,
  createComapeoCoreClient,
  createComapeoCoreServer,
} from '@comapeo/ipc';
import {KeyManager} from '@mapeo/crypto';
import Fastify from 'fastify';
import {randomBytes} from 'node:crypto';
import {pEvent} from 'p-event';
import pEvery from 'p-every';
import RAM from 'random-access-memory';
import {sleep} from '../../../src/frontend/lib/sleep';
import {MEMBER_ROLE_ID} from '../../../src/frontend/sharedTypes';

const COMAPEO_CORE_PKG_FOLDER = path.dirname(
  require.resolve('@comapeo/core/package.json'),
);
const projectMigrationsFolder = path.join(
  COMAPEO_CORE_PKG_FOLDER,
  'drizzle/project',
);
const clientMigrationsFolder = path.join(
  COMAPEO_CORE_PKG_FOLDER,
  'drizzle/client',
);

export async function createManager(
  deviceInfo: Pick<
    Parameters<typeof MapeoManager.prototype.setDeviceInfo>[0],
    'name' | 'deviceType'
  >,
) {
  const fastify = Fastify();

  const manager = new MapeoManager({
    rootKey: KeyManager.generateRootKey(),
    dbFolder: ':memory:',
    coreStorage: () => new RAM(),
    projectMigrationsFolder,
    clientMigrationsFolder,
    fastify,
  });
  await manager.setDeviceInfo(deviceInfo);

  const fastifyController = new FastifyController({fastify});

  return {
    manager,
    fastifyController,
  };
}

// Prazo padrão da drenagem do `stop()` do setUpIPC.
const PRAZO_DRENAGEM_MS = 4_000;
// Prazo do FECHAMENTO (segunda fase do stop): `closeComapeoCoreClient`
// aguarda `Promise.allSettled(pendingProjectClients.values())` ANTES de
// fechar os clients de projeto e o canal de roteamento
// (@comapeo/ipc/dist/client.js:115-133), então um `getProject()` preso
// seguraria o fechamento até o timeout de 30s da própria RPC. O fechamento
// corre contra prazo próprio; no estouro, as portas são fechadas direto.
const PRAZO_FECHAMENTO_MS = 500;

/**
 * Nome legível de uma RPC emitida pelo cliente, para os diagnósticos de
 * drenagem. `assertProjectExists` é o método wire do canal de roteamento que
 * implementa `client.getProject(...)` — o cliente nunca emite "getProject" no
 * fio, ele resolve o projeto por este RPC (@comapeo/ipc/dist/client.js,
 * `resolveProjectClient`) — então o diagnóstico nomeia a operação que o
 * chamador emitiu, não o método interno de roteamento.
 */
function nomeDaOperacao(metodo: ReadonlyArray<string>): string {
  const nome = metodo.join('.');
  return nome === 'assertProjectExists' ? 'getProject (routing)' : nome;
}

export function setUpIPC({manager}: {manager: MapeoManager}) {
  const {port1, port2} = new MessageChannel();

  // Cast needed: Node's MessagePort type doesn't match rpc-reflector's
  // MessagePortLike, though it satisfies it at runtime.
  const server = createComapeoCoreServer(
    manager,
    port1 as unknown as Parameters<typeof createComapeoCoreServer>[1],
  );

  // A drenagem observa TODA RPC emitida pelo cliente — o hook é repassado ao
  // `createClient` de cada canal interno (manager, roteamento e projetos).
  const emVoo = new Map<Promise<unknown>, string>();
  let drenando = false;

  const soltar = (p: Promise<unknown>) => {
    emVoo.delete(p);
  };
  // NUNCA `.finally()`: ele cria uma promise derivada sem handler de
  // rejeição, e cada rejeição de drenagem viraria unhandledRejection.
  // `then(del, del)` observa os dois desfechos sem derivar promise
  // rejeitável.
  const acompanhar = (p: Promise<unknown>) => {
    p.then(
      () => soltar(p),
      () => soltar(p),
    );
  };

  const client = createComapeoCoreClient(
    port2 as unknown as Parameters<typeof createComapeoCoreClient>[0],
    {
      timeout: 30_000,
      onRequestHook: (request, next) => {
        // `next` EXATAMENTE uma vez, síncrono, sem alterar o request. NADA
        // pode lançar daqui para baixo: o catch do rpc-reflector
        // (client.js:103-114) trataria o hook como falho e REENVIARIA a RPC.
        const p = next(request);
        emVoo.set(p, nomeDaOperacao(request.method));
        // Handlers de drenagem só quando `stop()` começou (flag acima);
        // antes disso, `void rpc()` no corpo de um teste precisa continuar
        // falhando como unhandledRejection (jest-circus falha o teste em
        // execução).
        if (drenando) acompanhar(p);
      },
    },
  );

  let parada: Promise<void> | null = null;

  const parar = async ({drainTimeoutMs}: {drainTimeoutMs: number}) => {
    drenando = true;
    // Handlers só agora, nunca no registro (ver comentário no hook).
    for (const p of emVoo.keys()) acompanhar(p);

    // — Fase 1: drenagem, contra prazo —
    let prazoEstourou = false;
    let liberarPrazoDrenagem!: () => void;
    const prazoDrenagemDisparou = new Promise<void>(resolve => {
      liberarPrazoDrenagem = resolve;
    });
    const prazoDrenagem = setTimeout(() => {
      prazoEstourou = true;
      liberarPrazoDrenagem();
    }, drainTimeoutMs);
    try {
      while (emVoo.size > 0) {
        await Promise.race([
          Promise.allSettled([...emVoo.keys()]),
          prazoDrenagemDisparou,
        ]);
        if (prazoEstourou) break;
        // Espaço para RPCs emitidas durante a drenagem entrarem em `emVoo`.
        await sleep(0);
      }
    } finally {
      clearTimeout(prazoDrenagem);
    }
    // Contagem por método no instante do estouro (o fechamento abaixo pode
    // rejeitar e soltar entradas, o que não mudaria o diagnóstico da
    // drenagem).
    const contagemPorMetodo = new Map<string, number>();
    for (const nome of emVoo.values()) {
      contagemPorMetodo.set(nome, (contagemPorMetodo.get(nome) ?? 0) + 1);
    }
    const totalPresas = [...contagemPorMetodo.values()].reduce(
      (total, n) => total + n,
      0,
    );
    const resumoPresas = [...contagemPorMetodo]
      .map(([nome, n]) => `${nome} ×${n}`)
      .join(', ');

    // — Fase 2: fechamento, também contra prazo próprio —
    server.close();
    let erroFechamento: unknown = null;
    // Sem await direto: o início do CLOSE é síncrono (fecha o client do
    // manager e rejeita as RPCs dele); o resto corre contra o prazo abaixo.
    const fechado = closeComapeoCoreClient(client).catch(err => {
      erroFechamento = err;
    });
    let fechamentoEstourou = false;
    let liberarPrazoFechamento!: () => void;
    const prazoFechamentoDisparou = new Promise<void>(resolve => {
      liberarPrazoFechamento = resolve;
    });
    const prazoFechamento = setTimeout(() => {
      fechamentoEstourou = true;
      liberarPrazoFechamento();
    }, PRAZO_FECHAMENTO_MS);
    try {
      await Promise.race([fechado, prazoFechamentoDisparou]);
    } finally {
      clearTimeout(prazoFechamento);
    }

    if (fechamentoEstourou) {
      // Fecha o que der: as portas direto. A cauda suspensa do CLOSE (a
      // criação de projeto presa) segue com handlers ligados e se resolve no
      // timeout de 30s da própria RPC — sem unhandledRejection.
      port1.close();
      port2.close();
      throw new Error(
        `setUpIPC: fechamento do canal IPC não concluiu após ${PRAZO_FECHAMENTO_MS}ms (fase: fechamento)${
          resumoPresas ? `; RPC(s) presa(s): ${resumoPresas}` : ''
        }`,
      );
    }
    if (erroFechamento) throw erroFechamento;
    // O prazo pode estourar no mesmo turno do último settle: sem RPC presa,
    // a drenagem concluiu e não há o que reportar.
    if (prazoEstourou && totalPresas > 0) {
      throw new Error(
        `setUpIPC: ${totalPresas} RPC(s) presas após ${drainTimeoutMs}ms: ${resumoPresas} (fase: drenagem)`,
      );
    }
  };

  return {
    client,
    clientPort: port2,
    server,
    serverPort: port1,
    start: () => {
      port1.start();
      port2.start();
    },
    /**
     * Drena as RPCs em voo antes de fechar o canal, contra prazos. Memoizada:
     * chamadas repetidas retornam a mesma promise (inclusive rejeitada).
     *
     * Contrato de ordem: chame antes de `fastifyController.stop()` — RPCs
     * drenadas aqui podem depender das rotas HTTP que o fastify serve
     * (ícones, blobs, importação).
     */
    stop: ({drainTimeoutMs = PRAZO_DRENAGEM_MS} = {}) =>
      (parada ??= parar({drainTimeoutMs})),
  };
}

export async function connectPeers(
  managers: ReadonlyArray<MapeoManager>,
): Promise<() => Promise<void>> {
  await tellPeersAboutEachOther(managers);
  await waitForPeersToBeConnected(managers);
  return () => stopPeerDiscovery(managers);
}

async function tellPeersAboutEachOther(
  managers: ReadonlyArray<MapeoManager>,
): Promise<void> {
  await Promise.all(
    managers.map(async manager => {
      const {name, port} = await manager.startLocalPeerDiscoveryServer();
      for (const otherManager of managers) {
        if (otherManager === manager) continue;
        otherManager.connectLocalPeer({address: '127.0.0.1', name, port});
      }
    }),
  );
}

async function waitForPeersToBeConnected(
  managers: ReadonlyArray<MapeoManager>,
): Promise<void> {
  const deviceIds = new Set(managers.map(m => m.deviceId));

  const isDone = async (): Promise<boolean> =>
    pEvery(managers, async manager => {
      const unconnectedDeviceIds = new Set(deviceIds);
      unconnectedDeviceIds.delete(manager.deviceId);
      for (const peer of await manager.listLocalPeers()) {
        if (peer.status === 'connected') {
          unconnectedDeviceIds.delete(peer.deviceId);
        }
      }
      return unconnectedDeviceIds.size === 0;
    });

  if (await isDone()) return;

  return new Promise(res => {
    const onLocalPeers = async () => {
      if (await isDone()) {
        for (const manager of managers) {
          manager.off('local-peers', onLocalPeers);
        }
        res();
      }
    };
    for (const manager of managers) manager.on('local-peers', onLocalPeers);
  });
}

async function stopPeerDiscovery(
  managers: ReadonlyArray<MapeoManager>,
): Promise<void> {
  await Promise.all(
    managers.map(manager =>
      manager.stopLocalPeerDiscoveryServer({force: true}),
    ),
  );
}

export async function inviteToProject(
  project: ComapeoProjectClientApi,
  invitee: MapeoManager,
): Promise<void> {
  const inviteId = randomBytes(32);

  const inviteeInvitePromise = pEvent(
    invitee.invite,
    'invite-received',
    invite =>
      Buffer.from((invite as {inviteId: string}).inviteId, 'hex').equals(
        inviteId,
      ),
  );

  await Promise.all([
    project.$member.invite(invitee.deviceId, {
      roleId: MEMBER_ROLE_ID,
      __testOnlyInviteId: inviteId,
    }),
    (async () => {
      const invite = (await inviteeInvitePromise) as {inviteId: string};
      await invitee.invite.accept(invite);
    })(),
  ]);
}

export const createTestServer = (opts?: {
  /**
   * How many projects the server agrees to host (`allowedProjects` in
   * `@comapeo/cloud`; the library default is 1). Tests that add the server
   * to more than one project need to raise this.
   */
  allowedProjects?: number;
}): Promise<{
  serverBaseUrl: string;
  close: () => void;
}> =>
  new Promise((resolve, reject) => {
    const startServerPath =
      require.resolve('../../../tests/integration/helpers/startTestCloudServer.mjs');
    const childProcess = spawn('node', [startServerPath], {
      stdio: ['ignore', 'pipe', 'inherit'],
      env: {
        ...process.env,
        TEST_SERVER_ALLOWED_PROJECTS: String(opts?.allowedProjects ?? 1),
      },
    });

    childProcess.unref();

    // @comapeo/core needs to reach the server spawned above (e.g. to add it
    // as a peer).
    const callFetch = useRealFetch();

    childProcess.stdout.on('data', data => {
      const url = data.toString().trim();

      if (urlIsValid(url)) {
        resolve({
          serverBaseUrl: url,
          close: () => {
            childProcess.kill('SIGTERM');
            callFetch();
          },
        });
      } else {
        childProcess.kill();
        callFetch();
        reject(new Error('Test is not set up correctly: invalid URL'));
      }
    });

    childProcess.on('close', code => {
      // If `code` is `null`, the process was terminated by a signal, like the
      // one above.
      if (code !== null) {
        reject(
          new Error(
            `Test is not set up correctly: server code ended early with code ${code}`,
          ),
        );
      }
    });
  });

// jest-expo subs `fetch` with a non-working stub; this swaps in undici's real implementation.
export function useRealFetch(): () => void {
  const originalFetch = global.fetch;
  const originalHeaders = global.Headers;
  const originalResponse = global.Response;

  const {fetch, Headers, Response} = require('undici');
  global.fetch = fetch;
  global.Headers = Headers;
  global.Response = Response;

  return () => {
    global.fetch = originalFetch;
    global.Headers = originalHeaders;
    global.Response = originalResponse;
  };
}

function urlIsValid(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}
