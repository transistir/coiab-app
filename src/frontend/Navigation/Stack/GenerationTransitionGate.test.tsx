import * as React from 'react';
import {act, render} from '@testing-library/react-native';

import {GenerationTransitionGate} from './index';

/**
 * #147 P2 (review independente): o reset de navegação para Home/Map é
 * adiado um tick porque o commit do `ready` troca o conjunto de telas
 * registrado. A geração já foi consumida (`previousGeneration.current`) antes
 * do timer disparar, então o timer NÃO pode ser cancelado por um re-render
 * causado por mudança de `state`/`navigation` — quem cancela perde a
 * transição e a navegação para Home nunca acontece.
 *
 * O `state` aqui é mínimo de propósito: o gate só lê `state.index` e
 * `state.routes`, e o teste isola a lógica do gate do navigator real.
 */
function buildState(routeName: string, key = 'state-1') {
  return {
    key,
    index: 0,
    routeNames: [routeName],
    routes: [{key: 'route-1', name: routeName}],
    type: 'stack',
    stale: false,
  };
}

type GateProps = React.ComponentProps<typeof GenerationTransitionGate>;

function renderGate({
  state,
  navigation,
  generation,
  status = 'ready',
  enabled = true,
}: {
  state: ReturnType<typeof buildState>;
  navigation: {reset: jest.Mock};
  generation: number;
  status?: GateProps['status'];
  enabled?: boolean;
}) {
  return (
    <GenerationTransitionGate
      state={state as unknown as GateProps['state']}
      navigation={navigation as unknown as GateProps['navigation']}
      status={status}
      generation={generation}
      enabled={enabled}
    />
  );
}

describe('GenerationTransitionGate (#147)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('um re-render com novo `state` antes do tick não cancela o reset adiado', async () => {
    const navigation = {reset: jest.fn()};
    const estadoInicial = buildState('OrganizationProvisioning');
    const estadoAtualizado = buildState('OrganizationProvisioning', 'state-2');

    const {rerender} = await render(
      renderGate({state: estadoInicial, navigation, generation: 0}),
    );

    // Publica uma nova geração `ready`: agenda o reset para o próximo tick e
    // consome a geração imediatamente.
    await rerender(
      renderGate({state: estadoInicial, navigation, generation: 1}),
    );

    expect(navigation.reset).not.toHaveBeenCalled();

    // O navigator publica um novo `state` no commit seguinte. Isto muda as
    // dependências do efeito: o reset NÃO pode ser cancelado (a geração já
    // foi consumida e não seria reagendada).
    await rerender(
      renderGate({state: estadoAtualizado, navigation, generation: 1}),
    );

    await act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(navigation.reset).toHaveBeenCalledTimes(1);
    expect(navigation.reset).toHaveBeenCalledWith({
      index: 0,
      routes: [{name: 'Home', params: {screen: 'Map'}}],
    });
  });

  test('recovery antes do tick impede o reset adiado para Home', async () => {
    const navigation = {reset: jest.fn()};
    // A rota atual não é Home (o reset adiado está armado), mas é uma rota de
    // projeto: o branch de recovery precisa resetar para a superfície de
    // provisionamento.
    const estadoInicial = buildState('Projects');
    const estadoRecovery = buildState('Projects', 'state-2');

    const {rerender} = await render(
      renderGate({state: estadoInicial, navigation, generation: 0}),
    );

    // `ready` com nova geração: agenda o reset para Home no próximo tick.
    await rerender(
      renderGate({state: estadoInicial, navigation, generation: 1}),
    );
    expect(navigation.reset).not.toHaveBeenCalled();

    // Antes do tick o status vira `recovery`: o branch síncrono reseta para
    // OrganizationProvisioning. O timer obsoleto do `ready` não pode reabrir
    // Home depois dessa decisão.
    await rerender(
      renderGate({
        state: estadoRecovery,
        navigation,
        generation: 1,
        status: 'recovery',
      }),
    );

    expect(navigation.reset).toHaveBeenCalledTimes(1);
    expect(navigation.reset).toHaveBeenCalledWith({
      index: 0,
      routes: [{name: 'OrganizationProvisioning'}],
    });

    await act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(navigation.reset).toHaveBeenCalledTimes(1);
    expect(navigation.reset).not.toHaveBeenCalledWith(
      expect.objectContaining({
        routes: [{name: 'Home', params: {screen: 'Map'}}],
      }),
    );
  });

  test('unmount antes do tick não chama reset', async () => {
    const navigation = {reset: jest.fn()};
    const estado = buildState('OrganizationProvisioning');

    const {rerender, unmount} = await render(
      renderGate({state: estado, navigation, generation: 0}),
    );
    await rerender(renderGate({state: estado, navigation, generation: 1}));

    await unmount();

    await act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(navigation.reset).not.toHaveBeenCalled();
  });
});
