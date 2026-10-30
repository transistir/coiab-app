import * as React from 'react';
import {View} from 'react-native';
import {ErrorBoundary} from '@sentry/react-native';
import {useSingleMember} from '@comapeo/core-react';
import type {Observation} from '@comapeo/schema';

import {useActiveProject} from '../contexts/ActiveProjectContext';
import {OBSERVER_TAG_KEYS, observerTagText} from '../lib/observerProfile';
import {ViewStyleProp} from '../sharedTypes';
import {ObserverDetails} from './ObserverDetails';

const OBSERVER_SECTION_STYLE = {paddingHorizontal: 20};

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
      <ErrorBoundary fallback={() => <></>}>
        <React.Suspense fallback={null}>
          <ObserverAuthor
            createdBy={createdBy}
            style={OBSERVER_SECTION_STYLE}
          />
        </React.Suspense>
      </ErrorBoundary>
    </View>
  );
}
