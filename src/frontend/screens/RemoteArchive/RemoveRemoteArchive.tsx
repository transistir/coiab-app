import {useRemoveServerPeer} from '@comapeo/core-react';
import {type NativeStackNavigationOptions} from '@react-navigation/native-stack';
import * as Sentry from '@sentry/react-native';
import {useEffect, useRef} from 'react';
import {defineMessages, useIntl} from 'react-intl';
import {StyleSheet, View} from 'react-native';
import {LoadingIndicator} from '../../sharedComponents/LoadingIndicator';
import MaterialIcons from '@react-native-vector-icons/material-icons';

import {useActiveProject} from '../../contexts/ActiveProjectContext';
import {useOrganizationMaterializer} from '../../contexts/OrganizationMaterializerContext';
import ErrorIcon from '../../images/Error.svg';
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

  // UI callbacks (navigate/goBack) are meaningless after unmount, but the
  // journal finalization must still run: going to background can replace this
  // screen with `AuthScreen` while Core is still answering.
  const montada = useRef(true);
  useEffect(() => {
    montada.current = true;
    return () => {
      montada.current = false;
    };
  }, []);

  return (
    <BottomSheetWrapper>
      <View style={styles.container}>
        <IconTitleDescription
          icon={<ErrorIcon />}
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
                  // Durable intent BEFORE the Core effect. Without a
                  // persisted `removendo` mark there is no way to reconcile a
                  // lost checkpoint after a restart, so a failed mark aborts
                  // the removal rather than removing unrecorded.
                  if (!materializador) {
                    const error = new Error(
                      'organization-materializer-unavailable',
                    );
                    Sentry.captureException(error);
                    navigation.navigate('ErrorBottomSheet', {error});
                    return;
                  }
                  let anterior;
                  try {
                    anterior = materializador.marcarRemocao(projectId);
                  } catch (error) {
                    Sentry.captureException(error);
                    navigation.navigate('ErrorBottomSheet', {
                      error:
                        error instanceof Error
                          ? error
                          : new Error(String(error)),
                    });
                    return;
                  }

                  // #142 review P2 (6ª rodada): the journal transition lives
                  // in the `mutateAsync` chain, NOT in mutation observer
                  // callbacks. An unmount (e.g. background → `AuthScreen`)
                  // drops the observer callbacks, which used to leave the
                  // slot `removendo` and the in-flight removal guard marked
                  // until restart. Awaited work survives the unmount.
                  void (async () => {
                    let sucesso = false;
                    let erro: unknown;
                    try {
                      await removeServerPeer.mutateAsync({serverDeviceId});
                      sucesso = true;
                    } catch (err) {
                      erro = err;
                    } finally {
                      try {
                        if (sucesso) {
                          // Finalize only after Core removed the server. A
                          // false return means the journal is still
                          // `removendo`; its timer/boot reconciliation will
                          // finish it, so the screen must not claim a durable
                          // success.
                          if (!materializador.removerArquivo(projectId)) {
                            Sentry.captureException(
                              new Error('archive-removal-checkpoint-pending'),
                            );
                          }
                        } else {
                          // Core kept the server: restore the exact previous
                          // slot. If that write also fails, the durable mark
                          // stays and Core reconciliation decides later.
                          materializador.cancelarRemocao(projectId, anterior);
                        }
                      } catch (journalError) {
                        Sentry.captureException(journalError);
                      }
                    }
                    if (sucesso) {
                      if (montada.current) navigation.goBack();
                      return;
                    }
                    Sentry.captureException(erro);
                    if (montada.current) {
                      navigation.navigate('ErrorBottomSheet', {
                        error:
                          erro instanceof Error
                            ? erro
                            : new Error(String(erro)),
                      });
                    }
                  })();
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
