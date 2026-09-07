import React, {FC} from 'react';
import {Image, Pressable, StyleSheet} from 'react-native';

import {useTrackActions, useTrackState} from '../../contexts/TrackStoreContext';
import {useNavigationFromRoot} from '../../hooks/useNavigationWithTypes';
import {useCreateDocument} from '@comapeo/core-react';
import {useActiveProject} from '../../contexts/ActiveProjectContext';
import * as Sentry from '@sentry/react-native';
import {toError} from '../../utils/errors';
import type {Position} from '@comapeo/schema/dist/schema/track';

export const SaveTrackButton: FC = () => {
  const navigation = useNavigationFromRoot();
  const {projectId} = useActiveProject();
  const {mutate: createTrack, status} = useCreateDocument({
    docType: 'track',
    projectId,
  });
  const observationRefs = useTrackState(state => state.observationRefs);
  const locationHistory = useTrackState(state => state.locationHistory);
  const description = useTrackState(state => state.description);
  const {clearCurrentTrack, assertOrigin} = useTrackActions();
  const preset = useTrackState(state => state.preset);

  const handleSaveClick = () => {
    try {
      // SPEC A CA09 / FIX-F: validate the persisted track's origin against
      // the ACTIVE operational projectId BEFORE writing to core — a diverged
      // origin (e.g. after an organization switch) throws
      // 'work-origin-mismatch' and prevents the save.
      assertOrigin(projectId);
    } catch (err) {
      Sentry.captureException(err);
      navigation.navigate('ErrorBottomSheet', {
        error: toError(err, 'Error saving track'),
      });
      return;
    }
    createTrack(
      {
        value: {
          observationRefs: observationRefs,
          tags: {
            notes: description,
          },
          locations: locationHistory.map(loc => ({
            coords: {
              latitude: loc.latitude,
              longitude: loc.longitude,
            },
            mocked: false,
            timestamp: new Date(loc.timestamp).toISOString()!,
          })) as [Position, Position, ...Position[]],
          ...(preset
            ? {
                presetRef: {
                  docId: preset.docId,
                  versionId: preset.versionId,
                },
              }
            : {}),
        },
      },
      {
        onSuccess: () => {
          clearCurrentTrack();
          navigation.popTo('Home', {
            screen: 'Map',
          });
        },
      },
    );
  };

  return (
    <Pressable
      disabled={status === 'pending'}
      onPress={handleSaveClick}
      accessibilityLabel="Save track.">
      <Image
        style={styles.completeIcon}
        source={require('../../images/completed/checkComplete.png')}
      />
    </Pressable>
  );
};

const styles = StyleSheet.create({
  completeIcon: {width: 30, height: 30},
});
