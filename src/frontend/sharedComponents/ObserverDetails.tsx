import * as React from 'react';
import {defineMessages, useIntl} from 'react-intl';
import {StyleSheet, View} from 'react-native';

import {HeaderText} from './Text/HeaderText';
import {BodyText} from './Text/BodyText';
import {ViewStyleProp} from '../sharedTypes';

const m = defineMessages({
  ethnicity: {
    id: '$1screens.Observation.observerEthnicity',
    defaultMessage: 'Observer ethnicity',
    description: 'Label for the observer ethnicity in the observation view',
  },
  village: {
    id: '$1screens.Observation.observerVillage',
    defaultMessage: 'Observer village',
    description: 'Label for the observer village in the observation view',
  },
  recordedBy: {
    id: '$1screens.Observation.recordedBy',
    defaultMessage: 'Recorded by',
    description: 'Label for the device that recorded the observation',
  },
});

type ObserverDetailsProps = {
  ethnicity?: string;
  village?: string;
  authorName?: string;
  style?: ViewStyleProp;
};

function present(value: string | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();

  return trimmed || null;
}

/**
 * Apresentação pura dos dados do observador (etnia, aldeia e aparelho que
 * registrou). Só renderiza o que existe.
 */
export const ObserverDetails = ({
  ethnicity,
  village,
  authorName,
  style,
}: ObserverDetailsProps) => {
  const {formatMessage} = useIntl();

  const ethnicityValue = present(ethnicity);
  const villageValue = present(village);
  const authorValue = present(authorName);

  if (!ethnicityValue && !villageValue && !authorValue) {
    return null;
  }

  return (
    <View>
      {ethnicityValue ? (
        <View style={[styles.section, style]}>
          <HeaderText variant="header3" style={styles.title}>
            {formatMessage(m.ethnicity)}
          </HeaderText>
          <BodyText>{ethnicityValue}</BodyText>
        </View>
      ) : null}
      {villageValue ? (
        <View style={[styles.section, style]}>
          <HeaderText variant="header3" style={styles.title}>
            {formatMessage(m.village)}
          </HeaderText>
          <BodyText>{villageValue}</BodyText>
        </View>
      ) : null}
      {authorValue ? (
        <View style={[styles.section, style]}>
          <HeaderText variant="header3" style={styles.title}>
            {formatMessage(m.recordedBy)}
          </HeaderText>
          <BodyText>{authorValue}</BodyText>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  section: {
    flex: 1,
    paddingVertical: 15,
  },
  title: {
    marginBottom: 10,
  },
});
