/**
 * Runs the teardown steps in order, one at a time, and keeps going after a
 * failure: a failed unmount must not leave the IPC channel, the discovery
 * server or fastify open. The failures still fail the test — a single one is
 * rethrown as is, two or more as an `AggregateError`, in step order.
 */
export async function executarEmOrdem(
  passos: ReadonlyArray<() => unknown>,
): Promise<void> {
  const erros: Array<unknown> = [];
  for (const passo of passos) {
    try {
      await passo();
    } catch (erro) {
      erros.push(erro);
    }
  }
  if (erros.length === 1) throw erros[0];
  if (erros.length > 1) {
    throw new AggregateError(
      erros,
      `integration teardown: ${erros.length} steps failed`,
    );
  }
}
