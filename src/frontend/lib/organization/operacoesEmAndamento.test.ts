import {haOperacoesEmAndamento, iniciarOperacao} from './operacoesEmAndamento';

describe('operacoesEmAndamento', () => {
  test('operações aninhadas mantêm o contador até a última terminar', () => {
    const encerrarPrimeira = iniciarOperacao();
    const encerrarSegunda = iniciarOperacao();

    expect(haOperacoesEmAndamento()).toBe(true);

    encerrarPrimeira();
    // A segunda ainda está em voo: o guard continua ativo.
    expect(haOperacoesEmAndamento()).toBe(true);

    encerrarSegunda();
    expect(haOperacoesEmAndamento()).toBe(false);
  });

  test('finish é idempotente: chamar duas vezes não decrementa duas vezes', () => {
    const encerrar = iniciarOperacao();

    encerrar();
    expect(haOperacoesEmAndamento()).toBe(false);

    encerrar();
    // Um finish duplo não pode deixar o contador negativo, o que
    // desarmaria o guard para sempre.
    expect(haOperacoesEmAndamento()).toBe(false);
  });

  test('finish de outra operação não encerra a que está em voo', () => {
    const encerrarPrimeira = iniciarOperacao();
    const encerrarSegunda = iniciarOperacao();

    encerrarSegunda();
    encerrarSegunda();
    expect(haOperacoesEmAndamento()).toBe(true);

    encerrarPrimeira();
    expect(haOperacoesEmAndamento()).toBe(false);
  });
});
