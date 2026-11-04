import * as React from 'react';
import {defineMessages, useIntl} from 'react-intl';
import {StyleSheet, View} from 'react-native';

import {HeaderText} from './Text/HeaderText';
import {BodyText} from './Text/BodyText';
import {ViewStyleProp} from '../sharedTypes';
import {observerTagText} from '../lib/observerProfile';

const m = defineMessages({
  recordedBy: {
    id: '$1screens.Observation.recordedBy',
    defaultMessage: 'Recorded by',
    description: 'Label for the device that recorded the observation',
  },
});

type ObserverDetailsProps = {
  authorName?: unknown;
  style?: ViewStyleProp;
};

/**
 * Apresentação pura do aparelho que registrou a observação. Só renderiza
 * quando há um autor; etnia e aldeia não são exibidas.
 */
export const ObserverDetails = ({authorName, style}: ObserverDetailsProps) => {
  const {formatMessage} = useIntl();

  const authorValue = observerTagText(authorName);

  if (!authorValue) {
    return null;
  }

  return (
    <View>
      <View style={[styles.section, style]}>
        <HeaderText variant="header3" style={styles.title}>
          {formatMessage(m.recordedBy)}
        </HeaderText>
        <BodyText>{authorValue}</BodyText>
      </View>
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
