import * as React from 'react';
import {
  Image,
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
import {SelectOne} from '../../sharedComponents/SelectOne';
import {ETHNIC_GROUPS} from '../../lib/ethnicGroups';
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
  WHITE,
} from '../../lib/styles';

const m = defineMessages({
  title: {
    id: '$1screens.Onboarding.EthnicGroupSelection.title',
    defaultMessage: 'What is your ethnicity?',
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

/** Without a notch `insets.top` is 0, so the layout is unchanged there. */
const CONTENT_TOP_PADDING = 24;

export const EthnicGroupSelection = ({navigation}: ScreenProps) => {
  const {formatMessage: t} = useIntl();
  const insets = useSafeAreaInsets();
  const {ethnicGroupId} = useUserProfileState();
  const {setEthnicGroup} = useUserProfileActions();
  const [selectedId, setSelectedId] = React.useState(ethnicGroupId);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  const options = React.useMemo(
    () => ETHNIC_GROUPS.map(group => ({value: group.id, label: group.name})),
    [],
  );

  function handleContinue() {
    if (!selectedId) {
      return;
    }

    setSaveError(null);

    try {
      setEthnicGroup(selectedId);
    } catch {
      setSaveError(t(m.saveError));
      return;
    }

    navigation.navigate('VillageEntry');
  }

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {paddingTop: CONTENT_TOP_PADDING + insets.top},
        ]}
        keyboardShouldPersistTaps="handled">
        <Image
          source={require('../../images/ekanadyby-wordmark.png')}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel="Ekanadyby"
        />
        <HeaderText variant="header2" style={styles.title}>
          {t(m.title)}
        </HeaderText>
        <View style={styles.listCard}>
          <SelectOne
            value={selectedId}
            onChange={next => setSelectedId(next)}
            options={options}
            color={COIAB_ORANGE}
          />
        </View>
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
          accessibilityState={{disabled: !selectedId}}
          disabled={!selectedId}
          onPress={handleContinue}
          style={[styles.continueButton, !selectedId && styles.disabledButton]}>
          <HeaderText variant="header5" style={styles.continueLabel}>
            {t(m.continue)}
          </HeaderText>
        </TouchableOpacity>
      </View>
    </View>
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
    gap: 16,
  },
  logo: {
    width: 180,
    height: 48,
    alignSelf: 'center',
  },
  title: {
    color: COIAB_BEIGE,
    textAlign: 'center',
  },
  listCard: {
    backgroundColor: WHITE,
    borderRadius: 12,
    overflow: 'hidden',
    paddingHorizontal: 8,
  },
  error: {
    color: RED,
    textAlign: 'center',
  },
  actions: {
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
