import * as React from 'react';
import {defineMessages, useIntl} from 'react-intl';
import {StyleSheet, Text, TextInput, View} from 'react-native';

import {
  useDraftObservationActions,
  useDraftObservationState,
} from '../contexts/DraftObservationContext';
import {OBSERVER_TAG_KEYS} from '../lib/observerProfile';
import {BLACK, BLUE_GREY, NEW_DARK_GREY} from '../lib/styles';
import {BodyText} from './Text/BodyText';

const m = defineMessages({
  ethnicity: {
    id: '$1screens.ObservationCreate.observerEthnicity',
    defaultMessage: 'Observer ethnicity',
    description:
      'Label for the observer ethnicity field in create/edit observation',
  },
  village: {
    id: '$1screens.ObservationCreate.observerVillage',
    defaultMessage: 'Observer village',
    description:
      'Label for the observer village field in create/edit observation',
  },
  helper: {
    id: '$1screens.ObservationCreate.observerFieldsHelper',
    defaultMessage: 'From your profile. Edit or leave blank.',
    description:
      'Helper text explaining the observer fields come from the local profile',
  },
  existingHelper: {
    id: '$1screens.ObservationCreate.observerFieldsExistingHelper',
    defaultMessage: 'Observer data.',
    description:
      'Helper text for the observer fields when editing an existing observation',
  },
});

export const OBSERVER_FIELDS_TEST_IDS = {
  ethnicity: 'OBS.observer-ethnicity-inp',
  village: 'OBS.observer-village-inp',
} as const;

function tagText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

type ObserverFieldsProps = {
  /**
   * `create` semeia os campos com o perfil local; `edit` mostra os dados já
   * salvos na observação. O texto de apoio muda, os campos são os mesmos.
   */
  mode: 'create' | 'edit';
};

export const ObserverFields = ({mode}: ObserverFieldsProps) => {
  const {formatMessage} = useIntl();
  const tags = useDraftObservationState(store => store.value?.tags);
  const {updateTag} = useDraftObservationActions();
  const villageRef = React.useRef<TextInput>(null);

  const ethnicityLabel = formatMessage(m.ethnicity);
  const villageLabel = formatMessage(m.village);

  return (
    <View style={styles.container}>
      <BodyText variant="smallMeta" style={styles.helper}>
        {formatMessage(mode === 'edit' ? m.existingHelper : m.helper)}
      </BodyText>

      <View style={styles.field}>
        <Text style={styles.label}>{ethnicityLabel}</Text>
        <TextInput
          style={styles.textInput}
          value={tagText(tags?.[OBSERVER_TAG_KEYS.ethnicity])}
          onChangeText={next => updateTag(OBSERVER_TAG_KEYS.ethnicity, next)}
          onSubmitEditing={() => villageRef.current?.focus()}
          accessibilityLabel={ethnicityLabel}
          testID={OBSERVER_FIELDS_TEST_IDS.ethnicity}
          returnKeyType="next"
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>{villageLabel}</Text>
        <TextInput
          ref={villageRef}
          style={styles.textInput}
          value={tagText(tags?.[OBSERVER_TAG_KEYS.village])}
          onChangeText={next => updateTag(OBSERVER_TAG_KEYS.village, next)}
          accessibilityLabel={villageLabel}
          testID={OBSERVER_FIELDS_TEST_IDS.village}
          returnKeyType="done"
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginTop: 20,
    paddingHorizontal: 20,
  },
  helper: {
    color: NEW_DARK_GREY,
    marginBottom: 12,
  },
  field: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontFamily: 'Rubik',
    color: NEW_DARK_GREY,
    marginBottom: 6,
  },
  textInput: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: BLUE_GREY,
    padding: 10,
    paddingHorizontal: 20,
    borderRadius: 4,
    fontSize: 18,
    color: BLACK,
  },
});
