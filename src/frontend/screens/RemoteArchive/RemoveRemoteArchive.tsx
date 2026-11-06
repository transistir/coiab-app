import {useRemoveServerPeer} from '@comapeo/core-react';
import {type NativeStackNavigationOptions} from '@react-navigation/native-stack';
import * as Sentry from '@sentry/react-native';
import {defineMessages, useIntl} from 'react-intl';
import {StyleSheet, View} from 'react-native';
import {LoadingIndicator} from '../../sharedComponents/LoadingIndicator';
import MaterialIcons from '@react-native-vector-icons/material-icons';

import {useActiveProject} from '../../contexts/ActiveProjectContext';
import {useOrganizationMaterializer} from '../../contexts/OrganizationMaterializerContext';
import Error from '../../images/Error.svg';
import {BottomSheetWrapper} from '../../sharedComponents/BottomSheetWrapper';
import {
  DestructiveButton,
  SecondaryButton,
} from '../../sharedComponents/Buttons';
import {type NativeRootNavigationProps} from '../../sharedTypes/navigation';
import {IconTitleDescription} from '../../sharedComponents/IconTitleDescription';

const m = defineMessages({
  title: {
    id: 'Settings.ProjectSettings.RemoteArchive.RemoveRemoteArchive.title',
    defaultMessage: 'Remove {name} from project?',
    description:
      'Text for title that asks about confirming archive server removal.',
  },
  description: {
    id: 'Settings.ProjectSettings.RemoteArchive.RemoveRemoteArchive.description',
    defaultMessage:
      'This will stop archiving new data for this project. Existing archived data will not be deleted.',
    description: 'Explanation for consequences of removing archive server.',
  },
  removeArchive: {
    id: 'Settings.ProjectSettings.RemoteArchive.RemoveRemoteArchive.removeArchive',
    defaultMessage: 'Remove Archive',
    description: 'Text for destructive action button.',
  },
  cancel: {
    id: 'Settings.ProjectSettings.RemoteArchive.RemoveRemoteArchive.cancel',
    defaultMessage: 'Cancel',
    description: 'Text for cancel action button.',
  },
});

export function RemoveRemoteArchive({
  navigation,
  route,
}: NativeRootNavigationProps<'RemoveRemoteArchive'>) {
  const {baseUrl, name, serverDeviceId} = route.params;

  const {formatMessage: t} = useIntl();
  const {projectId} = useActiveProject();

  const removeServerPeer = useRemoveServerPeer({projectId});
  const materializador = useOrganizationMaterializer();

  return (
    <BottomSheetWrapper>
      <View style={styles.container}>
        <IconTitleDescription
          icon={<Error />}
          title={t(m.title, {name: name || baseUrl})}
          description={t(m.description)}
        />

        <View style={styles.buttonContainer}>
          {removeServerPeer.status === 'pending' ? (
            <LoadingIndicator style={{flex: 0}} />
          ) : (
            <>
              <DestructiveButton
                fullSize
                text={t(m.removeArchive)}
                renderIcon={({color, size}) => (
                  <MaterialIcons name="delete" size={size} color={color} />
                )}
                onPress={() => {
                  removeServerPeer.mutate(
                    {serverDeviceId},
                    {
                      onError: err => {
                        Sentry.captureException(err);
                        navigation.navigate('ErrorBottomSheet', {error: err});
                      },
                      onSuccess: () => {
                        // The journal must not keep claiming success after
                        // Core lost the server: reopen only this project's
                        // slot so the same URL can really be requested again.
                        try {
                          materializador?.removerArquivo(projectId);
                        } catch (error) {
                          Sentry.captureException(error);
                        }
                        navigation.goBack();
                      },
                    },
                  );
                }}
              />
              <SecondaryButton
                fullSize
                text={t(m.cancel)}
                onPress={() => {
                  navigation.goBack();
                }}
              />
            </>
          )}
        </View>
      </View>
    </BottomSheetWrapper>
  );
}

export const navigationOptions: NativeStackNavigationOptions = {
  animation: 'none',
  contentStyle: {
    backgroundColor: 'transparent',
  },
  headerShown: false,
  presentation: 'transparentModal',
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 40,
  },
  buttonContainer: {
    gap: 20,
  },
});
