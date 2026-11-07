import * as React from 'react';
import {act, render, screen, userEvent} from '@testing-library/react-native';
import {IntlProvider} from 'react-intl';

import {RemoveRemoteArchive} from './RemoveRemoteArchive';
import {useRemoveServerPeer} from '@comapeo/core-react';
import {useOrganizationMaterializer} from '../../contexts/OrganizationMaterializerContext';
import type {
  ArquivoRemoto,
  EstadoOrganizacoes,
  OrganizacaoLocal,
} from '../../lib/organization/documento';
import {
  createArquivoRemotoExecutor,
  criarArquivoRemotoPendente,
} from '../../lib/organization/arquivoRemoto';
import type {IdentidadeArquivoRemoto} from '../../lib/organization/identidadeArquivo';

jest.mock('@sentry/react-native', () => ({
  captureException: jest.fn(),
}));

jest.mock('@comapeo/core-react', () => ({
  useRemoveServerPeer: jest.fn(),
}));

jest.mock('../../contexts/OrganizationMaterializerContext', () => ({
  useOrganizationMaterializer: jest.fn(),
}));

jest.mock('../../contexts/ActiveProjectContext', () => ({
  useActiveProject: () => ({projectId: 'org-1-m', projectApi: {}}),
}));

// The P2 under test is the async journal transition, not the sheet chrome.
// Rendering the real wrapper here would drag in navigation focus/back-button
// context with no bearing on the mutation lifecycle.
jest.mock('../../sharedComponents/BottomSheetWrapper', () => {
  const ReactActual = jest.requireActual('react') as typeof React;
  return {
    BottomSheetWrapper: ({children}: {children: React.ReactNode}) =>
      ReactActual.createElement(ReactActual.Fragment, null, children),
  };
});

const ORG_ID = 'org-1';
const PROJECT_M = 'org-1-m';
const PROJECT_A = 'org-1-a';
const URL_ANTIGA = 'https://arquivo.example/';
const URL_NOVA = 'https://novo-arquivo.example/';

const mockNavigation = {
  navigate: jest.fn(),
  goBack: jest.fn(),
};

const useRemoveServerPeerMock = useRemoveServerPeer as unknown as jest.Mock;
const useMaterializadorMock =
  useOrganizationMaterializer as unknown as jest.Mock;

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {promise, resolve, reject};
}

function arquivoConcluido(url = URL_ANTIGA): ArquivoRemoto {
  return {
    url,
    estado: 'concluido',
    slots: {
      m: {estado: 'concluido', tentativaId: 'tentativa-m'},
      a: {estado: 'concluido', tentativaId: 'tentativa-a'},
    },
  };
}

function organizacao(arquivoRemoto: ArquivoRemoto): OrganizacaoLocal {
  return {
    id: ORG_ID,
    nome: 'Organização',
    estado: 'pronta',
    confirmacaoPendente: false,
    materializacao: {
      monitoramento: {
        etapa: 'verificado',
        projectId: PROJECT_M,
        template: {versao: '1', hash: 'm'},
        idsAntesDaCriacao: null,
      },
      alertas: {
        etapa: 'verificado',
        projectId: PROJECT_A,
        template: {versao: '1', hash: 'a'},
        idsAntesDaCriacao: null,
      },
    },
    areaEmExecucao: null,
    ultimoErro: null,
    arquivoRemoto,
  };
}

/**
 * Real journal executor over an in-memory repository. The screen must leave the
 * durable slot in a converged state; asserting on a mock call would not prove
 * that `removendo` stopped blocking the next URL.
 */
function criarCenario(
  consultarArquivo: (projectId: string) => Promise<boolean> = async () => false,
  arquivoInicial: ArquivoRemoto = arquivoConcluido(),
) {
  let documento: EstadoOrganizacoes = {
    versao: 1,
    organizacoes: [organizacao(arquivoInicial)],
    ativa: null,
  };
  const repository = {
    read: () => documento,
    write: (next: EstadoOrganizacoes) => {
      documento = next;
    },
  };
  const addServerPeer = jest.fn(async () => {});
  const criarExecutor = () =>
    createArquivoRemotoExecutor({
      repository,
      rede: {addServerPeer},
      consultarArquivo,
    });
  const executor = criarExecutor();

  useMaterializadorMock.mockReturnValue({
    marcarRemocao: (projectId: string, identidade: IdentidadeArquivoRemoto) =>
      executor.marcarRemocao(projectId, identidade),
    removerArquivo: (projectId: string, identidade: IdentidadeArquivoRemoto) =>
      executor.removerArquivo(projectId, identidade),
    reconciliarRemocao: (projectId: string) =>
      executor.reconciliarRemocao(projectId),
    cancelarRemocao: (
      projectId: string,
      anterior: Parameters<typeof executor.cancelarRemocao>[1],
    ) => executor.cancelarRemocao(projectId, anterior),
  });

  return {
    executor,
    /** New executor over the SAME storage: the in-memory passes are gone. */
    criarExecutor,
    addServerPeer,
    get documento() {
      return documento;
    },
    slot: () => documento.organizacoes[0]!.arquivoRemoto!.slots,
    /** The manual path's "different URL" replacement, without the screen. */
    trocarUrl: (url: string) => {
      repository.write({
        ...documento,
        organizacoes: documento.organizacoes.map(item =>
          item.id === ORG_ID
            ? {
                ...item,
                arquivoRemoto: criarArquivoRemotoPendente(url),
              }
            : item,
        ),
      });
    },
  };
}

function renderScreen() {
  return render(
    <IntlProvider locale="en" messages={{}}>
      <RemoveRemoteArchive
        navigation={mockNavigation as never}
        route={
          {
            key: 'RemoveRemoteArchive',
            name: 'RemoveRemoteArchive',
            params: {
              baseUrl: URL_ANTIGA,
              name: 'Arquivo',
              serverDeviceId: 'server-device-1',
            },
          } as never
        }
      />
    </IntlProvider>,
  );
}

async function pressRemove() {
  const user = userEvent.setup();
  await user.press(screen.getByText('Remove Archive'));
}

async function flushMicrotasks() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

describe('RemoveRemoteArchive journal ownership on unmount (#142 P2 6ª rodada)', () => {
  let core: Deferred<void>;
  let observadorMontado: boolean;

  beforeEach(() => {
    jest.clearAllMocks();
    observadorMontado = true;
    core = deferred<void>();

    // `mutate` models the old mutation-observer path: after unmount the
    // observer is gone, so its callbacks are never delivered. The test keeps
    // both entry points so it also demonstrates the pre-fix failure.
    const mutate = jest.fn(
      (
        _variables: unknown,
        options?: {onSuccess?: () => void; onError?: (error: unknown) => void},
      ) => {
        core.promise.then(
          () => {
            if (observadorMontado) options?.onSuccess?.();
          },
          error => {
            if (observadorMontado) options?.onError?.(error);
          },
        );
      },
    );
    const mutateAsync = jest.fn(() => core.promise);
    useRemoveServerPeerMock.mockReturnValue({
      mutate,
      mutateAsync,
      status: 'idle',
    });
  });

  test('Core success after unmount finalizes the journal and a new URL runs', async () => {
    const cenario = criarCenario();
    const view = await renderScreen();

    await pressRemove();
    expect(cenario.slot().m).toMatchObject({estado: 'removendo'});

    // Background → AuthScreen replaces the modal while Core is still running.
    await view.unmount();
    observadorMontado = false;

    await act(async () => {
      core.resolve();
      await flushMicrotasks();
    });

    expect(cenario.slot().m).toEqual({
      estado: 'removido',
      baseUrl: 'https://arquivo.example',
      deviceId: 'server-device-1',
    });
    expect(cenario.executor.emAndamento(ORG_ID)).toBe(false);
    // The unmounted screen must not navigate after the late answer.
    expect(mockNavigation.goBack).not.toHaveBeenCalled();

    cenario.trocarUrl(URL_NOVA);
    await cenario.executor.executar(ORG_ID, {modo: 'retry'});

    expect(cenario.addServerPeer).toHaveBeenCalledWith({
      projectId: PROJECT_M,
      url: URL_NOVA,
    });
    expect(cenario.addServerPeer).toHaveBeenCalledWith({
      projectId: PROJECT_A,
      url: URL_NOVA,
    });
  });

  test('Core rejects after blocking: journal is `removido` and re-adding the SAME URL really sends', async () => {
    // The literal Core shape (`member-api.js`): assign BLOCKED_ROLE_ID, then
    // fail the initial sync. The active-server read therefore reports the
    // archive as gone even though `mutateAsync` rejected.
    let bloqueado = false;
    const cenario = criarCenario(async () => !bloqueado);
    const view = await renderScreen();

    await pressRemove();
    expect(cenario.slot().m).toMatchObject({estado: 'removendo'});

    await view.unmount();
    observadorMontado = false;

    await act(async () => {
      bloqueado = true;
      core.reject(new Error('sync failed after blocking'));
      await flushMicrotasks();
    });

    // Not the old slot, and not `pendente` (which would let the boot re-add
    // the file): the removal is a terminal state.
    expect(cenario.slot().m).toEqual({
      estado: 'removido',
      baseUrl: 'https://arquivo.example',
      deviceId: 'server-device-1',
    });
    // `a` still has the archive, so the aggregate is `concluido`, not the
    // terminal "no archive" state.
    expect(cenario.documento.organizacoes[0]!.arquivoRemoto!.estado).toBe(
      'concluido',
    );
    expect(cenario.executor.emAndamento(ORG_ID)).toBe(false);
    expect(mockNavigation.navigate).not.toHaveBeenCalled();

    // Restart: a fresh executor over the same journal. The explicit re-add of
    // the SAME URL must produce a real send, never a false `concluido`.
    const reiniciado = cenario.criarExecutor();
    const resultado = await reiniciado.executar(ORG_ID, {modo: 'retry'});

    expect(resultado.estado).toBe('concluido');
    expect(cenario.addServerPeer).toHaveBeenCalledWith({
      projectId: PROJECT_M,
      url: URL_ANTIGA,
    });
    expect(cenario.addServerPeer).toHaveBeenCalledTimes(1);
  });

  test('Core rejects without effect: journal stays `concluido` and a re-add sends nothing', async () => {
    // The failure happened before blocking: the read still finds the active
    // server, so the archive is considered present and a re-add has nothing
    // to send until the user removes it again.
    const cenario = criarCenario(async () => true);
    const view = await renderScreen();

    await pressRemove();
    await view.unmount();
    observadorMontado = false;

    await act(async () => {
      core.reject(new Error('refused before blocking'));
      await flushMicrotasks();
    });

    expect(cenario.slot().m).toEqual({
      estado: 'concluido',
      baseUrl: 'https://arquivo.example',
      deviceId: 'server-device-1',
    });
    expect(cenario.documento.organizacoes[0]!.arquivoRemoto!.estado).toBe(
      'concluido',
    );
    expect(cenario.executor.emAndamento(ORG_ID)).toBe(false);
    expect(mockNavigation.navigate).not.toHaveBeenCalled();

    const reiniciado = cenario.criarExecutor();
    const resultado = await reiniciado.executar(ORG_ID, {modo: 'retry'});

    expect(resultado.estado).toBe('concluido');
    expect(cenario.addServerPeer).not.toHaveBeenCalled();
  });

  test('Core unreachable while reconciling: slot stays `removendo` and no false success', async () => {
    const cenario = criarCenario(async () => {
      throw new Error('core-offline');
    });
    const view = await renderScreen();

    await pressRemove();
    await view.unmount();
    observadorMontado = false;

    await act(async () => {
      core.reject(new Error('core refused'));
      await flushMicrotasks();
    });

    expect(cenario.slot().m).toMatchObject({estado: 'removendo'});
    // A durable `removendo` is a live operation: the new request is blocked
    // and no send is attempted.
    expect(cenario.executor.emAndamento(ORG_ID)).toBe(true);
    const resultado = await cenario.executor.executar(ORG_ID, {
      modo: 'retry',
    });
    expect(resultado.estado).not.toBe('concluido');
    expect(cenario.addServerPeer).not.toHaveBeenCalled();
    expect(mockNavigation.navigate).not.toHaveBeenCalled();
  });
});

describe('RemoveRemoteArchive identity still resolving (#142 P2 14ª rodada)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useRemoveServerPeerMock.mockReturnValue({
      mutate: jest.fn(),
      mutateAsync: jest.fn(),
      status: 'idle',
    });
  });

  test('recusa a remoção: erro visível, Core intocado e tela mantida', async () => {
    const arquivo: ArquivoRemoto = {
      url: URL_ANTIGA,
      estado: 'aplicando',
      slots: {
        m: {
          estado: 'aplicando',
          tentativaId: 'tentativa-m',
          baseUrl: 'https://arquivo.example',
        },
        a: {
          estado: 'aplicando',
          tentativaId: 'tentativa-a',
          baseUrl: 'https://arquivo.example',
        },
      },
    };
    const cenario = criarCenario(async () => true, arquivo);
    await renderScreen();

    await pressRemove();

    const removeServerPeer = useRemoveServerPeerMock.mock.results[0]!.value as {
      mutateAsync: jest.Mock;
    };
    // A throw from `marcarRemocao` IS the abort signal: Core is never asked to
    // remove, so the durable `concluido` can never be written over a server
    // that is still being added.
    expect(removeServerPeer.mutateAsync).not.toHaveBeenCalled();
    expect(mockNavigation.goBack).not.toHaveBeenCalled();
    expect(cenario.slot().m).toMatchObject({estado: 'aplicando'});

    const chamada = mockNavigation.navigate.mock.calls.find(
      ([nome]) => nome === 'ErrorBottomSheet',
    );
    expect(chamada).toBeDefined();
    const erro = (chamada as [string, {error: Error}])[1].error;
    expect(erro).toBeInstanceOf(Error);
    expect(erro.message).toBe('archive-identity-pending');
  });
});
