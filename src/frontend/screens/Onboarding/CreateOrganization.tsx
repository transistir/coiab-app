import * as React from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  StyleSheet,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import {defineMessages, useIntl} from 'react-intl';
import {NativeStackScreenProps} from '@react-navigation/native-stack';

import {HeaderText} from '../../sharedComponents/Text/HeaderText';
import {BodyText} from '../../sharedComponents/Text/BodyText';
import {PrimaryButton} from '../../sharedComponents/Buttons';
import {LoadingIndicator} from '../../sharedComponents/LoadingIndicator';
import {BLACK, LIGHT_GREY} from '../../lib/styles';
import {AppStackParamsList} from '../../sharedTypes/navigation';
import {useCreateOrganization} from '../../hooks/organization/useCreateOrganization';
import {OrganizationOperationError} from '../../lib/organization/fanout';
import {markerFor} from '../../lib/organization/marker';

const m = defineMessages({
  title: {
    id: '$1screens.Onboarding.CreateOrganization.title',
    defaultMessage: 'Name your Organization',
  },
  body: {
    id: '$1screens.Onboarding.CreateOrganization.body',
    defaultMessage:
      'The Organization is the way {app} organizes mapping. It contains the Monitoramento and Alertas projects.',
  },
  placeholder: {
    id: '$1screens.Onboarding.CreateOrganization.placeholder',
    defaultMessage: 'Organization name',
  },
  create: {
    id: '$1screens.Onboarding.CreateOrganization.create',
    defaultMessage: 'Create Organization',
  },
  creating: {
    id: '$1screens.Onboarding.CreateOrganization.creating',
    defaultMessage: 'Creating Organization…',
  },
  tooLong: {
    id: '$1screens.Onboarding.CreateOrganization.tooLong',
    defaultMessage: 'Organization name is too long',
  },
});

// SPEC 4.1/E3: the name's real bound is the minted marker's, not the
// input's — `coiab-org:v1:<16-hex>:<slot>:<encoded-name>` must fit 60 chars,
// and the encoded name can be much longer than the raw one (accents, emoji),
// so the guard runs on `encodeURIComponent(name)`. The overhead is measured
// off the real format rather than counted by hand (a hand count missed the
// colon after the slot and let 61-char markers through), so a format change
// cannot desynchronize them again.
const MARKER_OVERHEAD = markerFor('0123456789abcdef', 'm', 'x').length - 1;
const MARKER_MAX_LENGTH = 60;
// The longest encoded name that still mints a 60-char marker.
const MAX_ENCODED_NAME_LENGTH = MARKER_MAX_LENGTH - MARKER_OVERHEAD;

function encodedNameLength(name: string): number {
  return encodeURIComponent(name.trim()).length;
}

function isNameTooLong(name: string): boolean {
  return encodedNameLength(name) > MAX_ENCODED_NAME_LENGTH;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export const CreateOrganization = ({
  navigation,
}: NativeStackScreenProps<AppStackParamsList, 'CreateOrganization'>) => {
  const [name, setName] = React.useState('');
  const {formatMessage: t} = useIntl();
  const {start, status, error} = useCreateOrganization();

  const creating = status === 'creating';
  const trimmedName = name.trim();
  const tooLong = isNameTooLong(name);

  React.useEffect(() => {
    if (status === 'success') {
      navigation.reset({index: 0, routes: [{name: 'Home'}]});
    } else if (status === 'error' && error !== undefined) {
      // The fan-out refused to create a second organization while an
      // incomplete one sits on the device (Bug 46): the provisioning screen
      // owns that repair — it retries under the reconstructed id — so the
      // error sheet would only dead-end a recoverable state.
      if (
        error instanceof OrganizationOperationError &&
        error.code === 'incomplete-org-blocks-create'
      ) {
        navigation.navigate('OrganizationProvisioning');
        return;
      }
      navigation.navigate('ErrorBottomSheet', {error: toError(error)});
    }
  }, [status, error, navigation]);

  function handleCreatePress() {
    if (creating || trimmedName.length === 0 || tooLong) return;
    start(trimmedName);
  }

  return (
    <KeyboardAvoidingView style={{width: '100%', height: '100%'}}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={styles.container}>
          <View style={styles.headerArea}>
            <HeaderText variant="header2" style={styles.title}>
              {t(m.title)}
            </HeaderText>
            <BodyText style={styles.body}>
              {t(m.body, {app: 'CoMapeo'})}
            </BodyText>
            <View style={styles.nameForm}>
              <TextInput
                testID="ORG.create-name-inp"
                style={styles.textInput}
                value={name}
                onChangeText={setName}
                maxLength={MARKER_MAX_LENGTH}
                placeholderTextColor={LIGHT_GREY}
                placeholder={t(m.placeholder)}
                autoCapitalize="none"
              />
              {tooLong && (
                <BodyText variant="smallMeta" testID="ORG.create-name-too-long">
                  {t(m.tooLong)}
                </BodyText>
              )}
              <BodyText variant="smallMeta" style={styles.counterText}>
                {`${encodedNameLength(name)}/${MAX_ENCODED_NAME_LENGTH}`}
              </BodyText>
            </View>
          </View>
          <View style={styles.buttonContainer}>
            {creating ? (
              <>
                <LoadingIndicator size="large" style={{flex: 0}} />
                <BodyText variant="smallMeta">{t(m.creating)}</BodyText>
              </>
            ) : (
              <PrimaryButton
                testID="ORG.create-btn"
                fullSize
                text={t(m.create)}
                disabled={trimmedName.length === 0 || tooLong}
                onPress={handleCreatePress}
              />
            )}
          </View>
        </View>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 60,
    paddingHorizontal: 20,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerArea: {
    alignItems: 'center',
    gap: 10,
    width: 280,
  },
  title: {
    textAlign: 'center',
  },
  body: {
    textAlign: 'center',
  },
  nameForm: {
    gap: 10,
    width: '100%',
  },
  textInput: {
    borderWidth: 1,
    borderColor: LIGHT_GREY,
    borderRadius: 4,
    color: BLACK,
    fontSize: 16,
    paddingHorizontal: 16,
  },
  counterText: {
    alignSelf: 'flex-end',
  },
  buttonContainer: {
    paddingVertical: 20,
    alignItems: 'center',
  },
});
