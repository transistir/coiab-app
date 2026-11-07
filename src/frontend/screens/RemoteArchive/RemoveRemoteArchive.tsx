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
  // The journal only finalizes the slot that records THIS server. Removing a
  // different archive (A) from a project that currently records B must be a
  // journal no-op; only the Core removal happens.
  const identidade = {baseUrl, deviceId: serverDeviceId};

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
                  if (!materializador) {
                    const error = new Error(
                      'organization-materializer-unavailable',
                    );
                    Sentry.captureException(error);
                    navigation.navigate('ErrorBottomSheet', {error});
                    return;
                  }

                  // #142 review P2 (6ª rodada): the journal transition lives
                  // in the `mutateAsync` chain, NOT in mutation observer
                  // callbacks. An unmount (e.g. background → `AuthScreen`)
                  // drops the observer callbacks, which used to leave the
                  // slot `removendo` and the in-flight removal guard marked
                  // until restart. Awaited work survives the unmount.
                  // #142 review P2 (7ª rodada): a Core rejection is NOT proof
                  // that the removal did not happen. Core records the blocked
                  // role BEFORE syncing (`member-api.js`), so the error can
                  // arrive after the file became inactive. Only a real Core
                  // read may decide the slot; restoring the previous state
                  // would leave the journal durably wrong and block re-adding
                  // the same URL.
                  void (async () => {
                    // #142 review P2 (16ª rodada): `marcarRemocao` may need to
                    // resolve a slot whose identity is still unknown against
                    // the project members. A rejection (including
                    // `archive-identity-pending`) is the abort signal: Core is
                    // never asked to remove, so the journal cannot claim a
                    // false success.
                    let anterior: Awaited<
                      ReturnType<typeof materializador.marcarRemocao>
                    >;
                    try {
                      anterior = await materializador.marcarRemocao(
                        projectId,
                        identidade,
                      );
                    } catch (error) {
                      Sentry.captureException(error);
                      if (montada.current) {
                        navigation.navigate('ErrorBottomSheet', {
                          error:
                            error instanceof Error
                              ? error
                              : new Error(String(error)),
                        });
                      }
                      return;
                    }

                    let sucesso = false;
                    let erro: unknown;
                    // Tracks whether the native call actually started. A
                    // throw BEFORE it is a pre-flight failure: Core never saw
                    // the request, so the durable mark can be reverted.
                    let coreIniciado = false;
                    try {
                      const mutacao = removeServerPeer.mutateAsync({
                        serverDeviceId,
                      });
                      coreIniciado = true;
                      await mutacao;
                      sucesso = true;
                    } catch (err) {
                      erro = err;
                    }
                    try {
                      if (sucesso) {
                        // Finalize only after Core removed the server. A
                        // false return means the journal is still
                        // `removendo`; its timer/boot reconciliation will
                        // finish it, so the screen must not claim a durable
                        // success.
                        if (
                          !materializador.removerArquivo(projectId, identidade)
                        ) {
                          Sentry.captureException(
                            new Error('archive-removal-checkpoint-pending'),
                          );
                        }
                      } else if (!coreIniciado) {
                        // Pre-flight failure: the previous slot is restored
                        // exactly. This is the ONLY use of `cancelarRemocao`.
                        materializador.cancelarRemocao(projectId, anterior);
                      } else {
                        // Core rejected: keep `removendo` and let Core decide
                        // (`removido` / `concluido` / still `removendo`).
                        await materializador.reconciliarRemocao(projectId);
                      }
                    } catch (journalError) {
                      Sentry.captureException(journalError);
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
