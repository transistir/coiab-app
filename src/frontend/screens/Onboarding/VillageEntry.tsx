import * as React from 'react';
import {
  KeyboardAvoidingView,
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
import {getVillageSuggestions} from '../../lib/profileCatalog';
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
    id: '$1screens.Onboarding.VillageEntry.title',
    defaultMessage: 'What is your village?',
  },
  subtitle: {
    id: '$1screens.Onboarding.VillageEntry.subtitle',
    defaultMessage: 'Choose or type your village',
  },
  placeholder: {
    id: '$1screens.Onboarding.VillageEntry.placeholder',
    defaultMessage: 'Type or choose an option',
  },
  continue: {
    id: '$1screens.Onboarding.VillageEntry.continue',
    defaultMessage: 'Continue',
  },
  back: {
    id: '$1screens.Onboarding.VillageEntry.back',
    defaultMessage: 'Back',
  },
  saveError: {
    id: '$1screens.Onboarding.VillageEntry.saveError',
    defaultMessage: 'Could not save your village. Please try again.',
  },
});

type ScreenProps = NativeStackScreenProps<AppStackParamsList, 'VillageEntry'>;

export const VillageEntry = ({navigation}: ScreenProps) => {
  const {formatMessage: t} = useIntl();
  const insets = useSafeAreaInsets();
  const {village} = useUserProfileState();
  const {setVillage} = useUserProfileActions();
  const [text, setText] = React.useState(village ?? '');
  const [saveError, setSaveError] = React.useState<string | null>(null);

  const suggestions = getVillageSuggestions(text);
  const canContinue = text.trim().length > 0;

  function handleContinue() {
    if (!canContinue) {
      return;
    }

    setSaveError(null);

    try {
      setVillage(text);
    } catch {
      setSaveError(t(m.saveError));
      return;
    }

    navigation.reset({index: 0, routes: [{name: 'Success'}]});
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, {paddingTop: insets.top}]}
      behavior="padding">
      <OnboardingCompactHeader
        onBack={() => navigation.goBack()}
        backLabel={t(m.back)}
        backTestID="ONBOARDING.village-back-btn"
      />

      <View style={styles.body}>
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
          testID="ONBOARDING.village-inp"
        />
        {saveError ? (
          <BodyText style={styles.error} testID="ONBOARDING.save-error">
            {saveError}
          </BodyText>
        ) : null}
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          testID="ONBOARDING.village-continue-btn"
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
  body: {
    paddingHorizontal: 20,
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
