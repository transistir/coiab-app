/**
 * Contracts for the integration harness teardown (issue #97). `executarEmOrdem`
 * is the executor behind the harness's `afterEach`: every step runs, in order
 * and one at a time, even after an earlier step fails — a failed unmount must
 * not leave the IPC channel, the discovery server or fastify open — and the
 * failures still fail the test instead of being swallowed.
 */
import {sleep} from '../../../src/frontend/lib/sleep';
import {executarEmOrdem} from './setupIntegrationTest';

describe('executarEmOrdem', () => {
  test('executarEmOrdem runs every step and surfaces the errors', async () => {
    // Um erro: os passos seguintes rodam, um de cada vez, e o erro é
    // relançado tal como foi lançado.
    const ordem: Array<string> = [];
    const erroUnico = new Error('passo 1');
    await expect(
      executarEmOrdem([
        async () => {
          ordem.push('1');
          throw erroUnico;
        },
        async () => {
          ordem.push('2:inicio');
          await sleep(0);
          ordem.push('2:fim');
        },
        async () => {
          ordem.push('3');
        },
      ]),
    ).rejects.toBe(erroUnico);
    expect(ordem).toEqual(['1', '2:inicio', '2:fim', '3']);

    // Dois erros — um deles lançado de forma síncrona, como faria um
    // teardown síncrono —: AggregateError com os dois, na ordem dos passos.
    const passosRodados: Array<string> = [];
    const erroA = new Error('passo A');
    const erroC = new Error('passo C');
    const agregado = await executarEmOrdem([
      () => {
        passosRodados.push('A');
        throw erroA;
      },
      async () => {
        passosRodados.push('B');
      },
      async () => {
        passosRodados.push('C');
        throw erroC;
      },
    ]).then(
      () => {
        throw new Error('executarEmOrdem deveria ter rejeitado');
      },
      (erro: unknown) => erro,
    );
    expect(passosRodados).toEqual(['A', 'B', 'C']);
    expect(agregado).toBeInstanceOf(AggregateError);
    const {errors} = agregado as AggregateError;
    expect(errors).toHaveLength(2);
    expect(errors[0]).toBe(erroA);
    expect(errors[1]).toBe(erroC);

    // Sem erros: resolve.
    await expect(executarEmOrdem([async () => {}])).resolves.toBeUndefined();
  });
});
