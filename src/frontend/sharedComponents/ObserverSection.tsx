import * as React from 'react';
import * as Sentry from '@sentry/react-native';
import {getErrorCode, NotFoundError} from '@comapeo/core/errors.js';
import {useSingleMember} from '@comapeo/core-react';

import {useActiveProject} from '../contexts/ActiveProjectContext';
import {ViewStyleProp} from '../sharedTypes';
import {Divider} from './Divider';
import {ObserverDetails} from './ObserverDetails';

const OBSERVER_SECTION_STYLE = {paddingHorizontal: 20};

/**
 * `useSingleMember` consulta `projectApi.$member.getById(deviceId)`. Quando o
 * membro que criou a observação ainda não sincronizou, a consulta lança
 * `NotFoundError` — um caso esperado, não um bug. A instância pode perder o
 * protótipo ao cruzar serialização/RPC, então `instanceof NotFoundError` não é
 * confiável; o `code` é a fonte de verdade.
 */
function isMemberNotFound(error: unknown): boolean {
  return getErrorCode(error) === NotFoundError.code;
}

type ObserverErrorBoundaryProps = {children: React.ReactNode};
type ObserverErrorBoundaryState = {failed: boolean};

/**
 * Boundary local: o `ErrorBoundary` do Sentry sempre chama
 * `captureException`, o que trataria o membro não sincronizado como erro. Aqui
 * só erros inesperados viram evento; os casos conhecidos renderizam fallback
 * vazio.
 */
class ObserverErrorBoundary extends React.Component<
  ObserverErrorBoundaryProps,
  ObserverErrorBoundaryState
> {
  state: ObserverErrorBoundaryState = {failed: false};

  static getDerivedStateFromError(): ObserverErrorBoundaryState {
    return {failed: true};
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (isMemberNotFound(error)) {
      return;
    }

    Sentry.captureException(error, {
      contexts: {react: {componentStack: info.componentStack}},
    });
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Nome do aparelho que registrou. Etnia e aldeia não aparecem na tela: o dado
 * continua nas tags, semeado do perfil em `useNewObservationDraft`.
 */
function ObserverAuthor({
  createdBy,
  style,
}: {
  createdBy: string;
  style: ViewStyleProp;
}) {
  const {projectId} = useActiveProject();
  const {data: member} = useSingleMember({projectId, deviceId: createdBy});

  if (!member?.name) {
    return null;
  }

  return (
    <>
      <Divider />
      <ObserverDetails style={style} authorName={member.name} />
    </>
  );
}

type ObserverSectionProps = {
  createdBy: string;
};

/**
 * Autor da observação. A consulta de membro usa suspense e pode falhar, por
 * isso fica isolada num filho com `Suspense` e `ErrorBoundary` próprios.
 */
export function ObserverSection({createdBy}: ObserverSectionProps) {
  return (
    <ObserverErrorBoundary>
      <React.Suspense fallback={null}>
        <ObserverAuthor createdBy={createdBy} style={OBSERVER_SECTION_STYLE} />
      </React.Suspense>
    </ObserverErrorBoundary>
  );
}
