/**
 * Contador de operações de convite em voo (Fase 8a). O motor de ativação
 * recusa uma troca de área enquanto houver trabalho pendente — incluída a
 * aceitação de um pacote de convite ou um envio de convite em andamento
 * (SPEC A §5.2:172). Estado de módulo: os hooks `start()` registram a
 * operação na entrada e a encerram no `finally`; o `finish` devolvido é
 * idempotente, então um encerramento duplo não decrementa duas vezes.
 */
let operacoesEmAndamento = 0;

export function iniciarOperacao(): () => void {
  operacoesEmAndamento += 1;
  let encerrada = false;
  return () => {
    if (encerrada) return;
    encerrada = true;
    operacoesEmAndamento -= 1;
  };
}

export function haOperacoesEmAndamento(): boolean {
  return operacoesEmAndamento > 0;
}
