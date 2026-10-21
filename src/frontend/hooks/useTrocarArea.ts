import * as React from 'react';

import {useCoiabOrganizationsState} from '../contexts/CoiabOrganizationsStoreContext';
import {useOrganizationActivationContext} from '../contexts/OrganizationActivationContext';
import {useNavigationFromRoot} from './useNavigationWithTypes';
import {type Area} from '../lib/organization/coiabOrganizations';

/**
 * Lógica de troca de área da Página Entroncamento (Figma Kutary App V2,
 * `2668:4539`), extraída de OrganizationAreaAccesses (SPEC A §5.2/§6.1) e
 * compartilhada pelos DOIS cards: o componente que renderiza os cards chama
 * este hook UMA vez, com um único `useRef` de trava, e entrega o mesmo
 * `trocarArea` a ambos (toque duplo num card não repete a ativação do
 * outro).
 *
 * - Toque na área corrente: NÃO reativa — volta ao mapa (`popTo`
 *   `Home/Map`), o novo no-op da página (antes fechava a gaveta).
 * - Toque na outra área: guard síncrono contra toque duplo (o 2º toque vê
 *   a flag ANTES de qualquer await, então nunca inicia outra ativação — o
 *   lock do motor só agruparia a mesma intenção e repetiria o resultado),
 *   ativa e, em sucesso, reseta a pilha para `Home/Map` limpo (§5.2:168).
 *   A trava é liberada no `finally`.
 */
export function useTrocarArea(): {
  trocarArea: (area: Area) => void;
  areaAtual: Area;
  trocaRecusada: boolean;
} {
  const navigation = useNavigationFromRoot();
  const activation = useOrganizationActivationContext();
  const estado = useCoiabOrganizationsState();
  const trocaEmAndamento = React.useRef(false);

  const organizacao = estado.organizacoes.find(
    item => item.id === estado.ativa?.organizacaoId,
  );
  // A derivação (verificada pelo chamador) garante que a organização
  // referenciada existe.
  const organizacaoId = organizacao?.id ?? '';
  const areaAtual: Area = estado.ativa?.area ?? 'monitoramento';

  const trocarArea = (area: Area) => {
    if (area === areaAtual) {
      // Tapping the current area never reactivates (§5.2:163): volta ao
      // mapa.
      navigation.popTo('Home', {screen: 'Map'});
      return;
    }
    if (trocaEmAndamento.current) return;
    trocaEmAndamento.current = true;
    void (async () => {
      try {
        const ok = await activation.activate(organizacaoId, {area});
        if (ok) {
          navigation.reset({
            index: 0,
            routes: [{name: 'Home', params: {screen: 'Map'}}],
          });
        }
      } catch {
        // A ativação reporta as próprias falhas no motor (`activation.error`,
        // exibido como mensagem de recusa); engolir aqui só evita a
        // unhandled rejection se `activate` lançar.
      } finally {
        trocaEmAndamento.current = false;
      }
    })();
  };

  return {
    trocarArea,
    areaAtual,
    trocaRecusada: activation.error === 'pending-work',
  };
}
