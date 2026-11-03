import * as React from 'react';
import {View} from 'react-native';
import * as Sentry from '@sentry/react-native';
import {getErrorCode, NotFoundError} from '@comapeo/core/errors.js';
import {useSingleMember} from '@comapeo/core-react';
import type {Observation} from '@comapeo/schema';

import {useActiveProject} from '../contexts/ActiveProjectContext';
import {OBSERVER_TAG_KEYS, observerTagText} from '../lib/observerProfile';
import {ViewStyleProp} from '../sharedTypes';
import {ObserverDetails} from './ObserverDetails';

const OBSERVER_SECTION_STYLE = {paddingHorizontal: 20};

/**
 * `useSingleMember` consulta `projectApi.$member.getById(deviceId)`. Quando o
 * membro que criou a observação ainda não sincronizou, a consulta lança
 * `NotFoundError` — um caso esperado, não um bug. A instância pode perder o
 * protótipo ao cruzar serialização/RPC, então `instanceof NotFoundError` não é
 * confiável; o `code` é a fonte de verdade. `getErrorCode` encapsula essa
 * checagem e evita duplicar o literal no código de produção.
 */
function isMemberNotFound(error: unknown): boolean {
  return getErrorCode(error) === NotFoundError.code;
}

type ObserverErrorBoundaryProps = {children: React.ReactNode};
type ObserverErrorBoundaryState = {failed: boolean};

/**
 * Boundary local: o `ErrorBoundary` do Sentry sempre chama
 * `captureException`, o que trataria o membro não sincronizado como erro. Aqui
 * só erros inesperados viram evento; os dois casos renderizam fallback vazio
 * para não derrubar etnia e aldeia, que ficam fora deste boundary.
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
 * Apenas o nome do aparelho que registrou depende da consulta de membro. O
 * hook usa suspense e pode falhar; por isso fica isolado num filho com
 * `Suspense` e `ErrorBoundary` próprios (mesmo padrão de
 * AttachedPhotoPreviewModal).
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

  return <ObserverDetails style={style} authorName={member?.name} />;
}

type ObserverSectionProps = {
  createdBy: string;
  tags: Observation['tags'];
};

/**
 * Etnia, aldeia e aparelho que registrou. Etnia e aldeia vêm direto das tags
 * e renderizam fora de qualquer Suspense/ErrorBoundary: uma consulta de membro
 * lenta ou com erro nunca esconde nem derruba esses dados.
 */
export function ObserverSection({createdBy, tags}: ObserverSectionProps) {
  return (
    <View>
      <ObserverDetails
        style={OBSERVER_SECTION_STYLE}
        ethnicity={observerTagText(tags[OBSERVER_TAG_KEYS.ethnicity])}
        village={observerTagText(tags[OBSERVER_TAG_KEYS.village])}
      />
      <ObserverErrorBoundary>
        <React.Suspense fallback={null}>
          <ObserverAuthor
            createdBy={createdBy}
            style={OBSERVER_SECTION_STYLE}
          />
        </React.Suspense>
      </ObserverErrorBoundary>
    </View>
  );
}
