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
function criarCenario() {
  let documento: EstadoOrganizacoes = {
    versao: 1,
    organizacoes: [organizacao(arquivoConcluido())],
    ativa: null,
  };
  const repository = {
    read: () => documento,
    write: (next: EstadoOrganizacoes) => {
      documento = next;
    },
  };
  const addServerPeer = jest.fn(async () => {});
  const executor = createArquivoRemotoExecutor({
    repository,
    rede: {addServerPeer},
  });

  useMaterializadorMock.mockReturnValue({
    marcarRemocao: (projectId: string) => executor.marcarRemocao(projectId),
    removerArquivo: (projectId: string) => executor.removerArquivo(projectId),
    cancelarRemocao: (
      projectId: string,
      anterior: Parameters<typeof executor.cancelarRemocao>[1],
    ) => executor.cancelarRemocao(projectId, anterior),
  });

  return {
    executor,
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
    expect(cenario.slot().m).toEqual({estado: 'removendo'});

    // Background → AuthScreen replaces the modal while Core is still running.
    await view.unmount();
    observadorMontado = false;

    await act(async () => {
      core.resolve();
      await flushMicrotasks();
    });

    expect(cenario.slot().m).toEqual({estado: 'pendente', erro: 'removido'});
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

  test('Core rejection after unmount restores the previous slot and a new URL runs', async () => {
    const cenario = criarCenario();
    const view = await renderScreen();

    await pressRemove();
    expect(cenario.slot().m).toEqual({estado: 'removendo'});

    await view.unmount();
    observadorMontado = false;

    await act(async () => {
      core.reject(new Error('core refused'));
      await flushMicrotasks();
    });

    expect(cenario.slot().m).toEqual({
      estado: 'concluido',
      tentativaId: 'tentativa-m',
    });
    expect(cenario.executor.emAndamento(ORG_ID)).toBe(false);
    expect(mockNavigation.navigate).not.toHaveBeenCalled();

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
});
