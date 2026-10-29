import * as React from 'react';
import {
  KeyboardAvoidingView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {defineMessages, useIntl} from 'react-intl';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Ionicons from '@react-native-vector-icons/ionicons';

import {BodyText} from '../../sharedComponents/Text/BodyText';
import {HeaderText} from '../../sharedComponents/Text/HeaderText';
import {
  useUserProfileActions,
  useUserProfileState,
} from '../../contexts/UserProfileStoreContext';
import type {AppStackParamsList} from '../../sharedTypes/navigation';
import {
  BLACK,
  COIAB_BEIGE,
  COIAB_GREEN,
  COIAB_ORANGE,
  DARK_GREY,
  RED,
  WHITE,
} from '../../lib/styles';

const m = defineMessages({
  title: {
    id: '$1screens.Onboarding.VillageEntry.title',
    defaultMessage: 'What is your village?',
  },
  placeholder: {
    id: '$1screens.Onboarding.VillageEntry.placeholder',
    defaultMessage: 'Village name',
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

/** Without a notch `insets.top` is 0, so the layout is unchanged there. */
const HEADER_TOP_PADDING = 12;

export const VillageEntry = ({navigation}: ScreenProps) => {
  const {formatMessage: t} = useIntl();
  const insets = useSafeAreaInsets();
  const {village} = useUserProfileState();
  const {setVillage} = useUserProfileActions();
  const [text, setText] = React.useState(village ?? '');
  const [saveError, setSaveError] = React.useState<string | null>(null);

  const trimmed = text.trim();
  const canContinue = trimmed.length > 0;

  function handleContinue() {
    if (!canContinue) {
      return;
    }

    setSaveError(null);

    try {
      setVillage(trimmed);
    } catch {
      setSaveError(t(m.saveError));
      return;
    }

    navigation.reset({index: 0, routes: [{name: 'Success'}]});
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior="padding">
      <View
        style={[styles.header, {paddingTop: HEADER_TOP_PADDING + insets.top}]}>
        <TouchableOpacity
          testID="ONBOARDING.village-back-btn"
          accessibilityRole="button"
          accessibilityLabel={t(m.back)}
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color={COIAB_BEIGE} />
        </TouchableOpacity>
        <HeaderText variant="header2" style={styles.title}>
          {t(m.title)}
        </HeaderText>
        <View style={styles.backButton} />
      </View>

      <View style={styles.body}>
        <TextInput
          testID="ONBOARDING.village-inp"
          value={text}
          onChangeText={next => {
            setText(next);
            setSaveError(null);
          }}
          placeholder={t(m.placeholder)}
          placeholderTextColor={COIAB_BEIGE}
          style={[styles.input, saveError ? styles.inputError : null]}
          maxLength={100}
          autoCorrect={false}
          returnKeyType="done"
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 16,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    color: COIAB_BEIGE,
    textAlign: 'center',
  },
  body: {
    paddingHorizontal: 20,
    gap: 12,
  },
  input: {
    height: 48,
    borderRadius: 8,
    paddingHorizontal: 16,
    backgroundColor: COIAB_GREEN,
    color: WHITE,
    fontSize: 16,
  },
  inputError: {
    borderWidth: 2,
    borderColor: RED,
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
