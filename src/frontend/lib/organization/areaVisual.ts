import {defineMessages} from 'react-intl';
import type {MessageDescriptor} from 'react-intl';
import type {Area} from './coiabOrganizations';
import {CHARCOAL, COIAB_ORANGE, COIAB_RED, DARK_GREY, WHITE} from '../styles';

const m = defineMessages({
  cardMonitoramento: {
    id: '$1sharedComponents.OrganizationAreaAccesses.cardMonitoramento',
    defaultMessage: 'Monitoramento Territorial',
    description: 'Título do card Monitoramento (Figma 2668:4539)',
  },
  cardAlertas: {
    id: '$1sharedComponents.OrganizationAreaAccesses.cardAlertas',
    defaultMessage: 'Alertas',
    description: 'Título do card Alertas (Figma 2668:4539)',
  },
});

export const VISUAL_TERRITORIO = {fundo: DARK_GREY, texto: WHITE} as const;

export const VISUAL_AREA: Readonly<
  Record<Area, {fundo: string; texto: string; rotulo: MessageDescriptor}>
> = {
  monitoramento: {
    fundo: COIAB_ORANGE,
    texto: CHARCOAL,
    rotulo: m.cardMonitoramento,
  },
  alertas: {fundo: COIAB_RED, texto: WHITE, rotulo: m.cardAlertas},
};
