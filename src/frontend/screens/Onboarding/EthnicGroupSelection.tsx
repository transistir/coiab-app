import * as React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {defineMessages, useIntl} from 'react-intl';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {BodyText} from '../../sharedComponents/Text/BodyText';
import {HeaderText} from '../../sharedComponents/Text/HeaderText';
import {AutocompleteField} from '../../sharedComponents/AutocompleteField';
import {OnboardingCompactHeader} from './OnboardingCompactHeader';
import {getEthnicitySuggestions} from '../../lib/profileCatalog';
import {
  useUserProfileActions,
  useUserProfileState,
} from '../../contexts/UserProfileStoreContext';
import type {AppStackParamsList} from '../../sharedTypes/navigation';
import {
  BLACK,
  COIAB_BEIGE,
  COIAB_ORANGE,
  DARK_GREY,
  RED,
} from '../../lib/styles';

const SUBTITLE_COLOR = '#BFCCBF';

const m = defineMessages({
  title: {
    id: '$1screens.Onboarding.EthnicGroupSelection.title',
    defaultMessage: 'What is your ethnicity?',
  },
  subtitle: {
    id: '$1screens.Onboarding.EthnicGroupSelection.subtitle',
    defaultMessage: 'Choose or type your ethnicity',
  },
  placeholder: {
    id: '$1screens.Onboarding.EthnicGroupSelection.placeholder',
    defaultMessage: 'Type or choose an option',
  },
  continue: {
    id: '$1screens.Onboarding.EthnicGroupSelection.continue',
    defaultMessage: 'Continue',
  },
  saveError: {
    id: '$1screens.Onboarding.EthnicGroupSelection.saveError',
    defaultMessage: 'Could not save your ethnicity. Please try again.',
  },
});

type ScreenProps = NativeStackScreenProps<
  AppStackParamsList,
  'EthnicGroupSelection'
>;

export const EthnicGroupSelection = ({navigation}: ScreenProps) => {
  const {formatMessage: t} = useIntl();
  const insets = useSafeAreaInsets();
  const {ethnicity} = useUserProfileState();
  const {setEthnicity} = useUserProfileActions();
  const [text, setText] = React.useState(ethnicity ?? '');
  const [saveError, setSaveError] = React.useState<string | null>(null);

  const suggestions = getEthnicitySuggestions(text);
  const canContinue = text.trim().length > 0;

  function handleContinue() {
    if (!canContinue) {
      return;
    }

    setSaveError(null);

    try {
      setEthnicity(text);
    } catch {
      setSaveError(t(m.saveError));
      return;
    }

    navigation.navigate('VillageEntry');
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, {paddingTop: insets.top}]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <OnboardingCompactHeader />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled">
        <HeaderText variant="header2" style={styles.title}>
          {t(m.title)}
        </HeaderText>
        <BodyText variant="smallMeta" style={styles.subtitle}>
          {t(m.subtitle)}
        </BodyText>
        <AutocompleteField
          value={text}
          onChangeText={next => {
            setText(next);
            setSaveError(null);
          }}
          suggestions={suggestions}
          onSelect={name => {
            setText(name);
            setSaveError(null);
          }}
          placeholder={t(m.placeholder)}
          accessibilityLabel={t(m.title)}
          testID="ONBOARDING.ethnic-group-inp"
        />
        {saveError ? (
          <BodyText style={styles.error} testID="ONBOARDING.save-error">
            {saveError}
          </BodyText>
        ) : null}
      </ScrollView>
      <View style={styles.actions}>
        <TouchableOpacity
          testID="ONBOARDING.ethnic-group-continue-btn"
          accessibilityRole="button"
          accessibilityState={{disabled: !canContinue}}
          disabled={!canContinue}
          onPress={handleContinue}
          style={[
            styles.continueButton,
            !canContinue && styles.disabledButton,
          ]}>
          <HeaderText variant="header5" style={styles.continueLabel}>
            {t(m.continue)}
          </HeaderText>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DARK_GREY,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    gap: 12,
  },
  title: {
    color: COIAB_BEIGE,
    textAlign: 'center',
  },
  subtitle: {
    color: SUBTITLE_COLOR,
    textAlign: 'center',
  },
  error: {
    color: RED,
    textAlign: 'center',
  },
  actions: {
    marginTop: 'auto',
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  continueButton: {
    height: 48,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COIAB_ORANGE,
  },
  disabledButton: {
    opacity: 0.5,
  },
  continueLabel: {
    color: BLACK,
  },
});
