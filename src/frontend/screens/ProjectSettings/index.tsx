import React from 'react';
import {ScrollView, StyleSheet, View, TouchableOpacity} from 'react-native';
import {useIntl, defineMessages} from 'react-intl';
import MaterialIcons from '@react-native-vector-icons/material-icons';

import {useActiveProject} from '../../contexts/ActiveProjectContext';
import {HeaderText} from '../../sharedComponents/Text/HeaderText';
import {BodyText} from '../../sharedComponents/Text/BodyText';
import ExchangeIcon from '../../images/Exchange.svg';
import GraphIcon from '../../images/Graph.svg';
import {
  COMAPEO_BLUE,
  NEW_DARK_GREY,
  WHITE,
  VERY_LIGHT_GREY,
  BLACK,
} from '../../lib/styles';
import {
  useActiveArchiveServer,
  useProjectSettings,
} from '../../hooks/server/projects';
import {useNavigationFromRoot} from '../../hooks/useNavigationWithTypes';

const m = defineMessages({
  title: {
    id: '$1Screens.ProjectSettings.title',
    defaultMessage: 'Coordinator Tools',
  },
  remoteArchiveOn: {
    id: '$1Screens.ProjectSettings.remoteArchiveOn',
    defaultMessage: 'Remote Archive  |  ON',
  },
  remoteArchiveOff: {
    id: '$1Screens.ProjectSettings.remoteArchiveOff',
    defaultMessage: 'Remote Archive  |  OFF',
  },
  remoteArchiveDesc: {
    id: 'Screens.ProjectSettings.remoteArchiveDesc',
    defaultMessage:
      'Share with a secure, encypted server. URL required to access.',
  },
  viewDetails: {
    id: 'Screens.ProjectSettings.viewDetails',
    defaultMessage: 'View Details',
  },
  projectStatsOn: {
    id: '$1Screens.ProjectSettings.projectStatsOn',
    defaultMessage: 'Project Statistics  |  ON',
  },
  projectStatsOff: {
    id: '$1Screens.ProjectSettings.projectStatsOff',
    defaultMessage: 'Project Statistics  |  OFF',
  },
  projectStatsOnDesc: {
    id: 'Screens.ProjectSettings.projectStatsOnDesc',
    defaultMessage: 'This project is sharing anonymous statistics.',
  },
  // this is not in the figma or the issue but needed for when stats are off
  projectStatsOffDesc: {
    id: 'Screens.ProjectSettings.projectStatsOffDesc',
    defaultMessage: 'Project statistics are not being shared.',
  },
  update: {id: 'Screens.ProjectSettings.update', defaultMessage: 'Update'},
});

export const ProjectSettings = () => {
  const {projectId} = useActiveProject();
  const {formatMessage} = useIntl();
  const {navigate} = useNavigationFromRoot();
  const {data: configData} = useProjectSettings();
  const remoteArchiveOn = !!useActiveArchiveServer({projectId});

  const sendStatsOn = configData.sendStats;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <SettingsCardRow
        icon={<ExchangeIcon width={24} height={24} color={NEW_DARK_GREY} />}
        title={formatMessage(
          remoteArchiveOn ? m.remoteArchiveOn : m.remoteArchiveOff,
        )}
        subtitle={formatMessage(m.remoteArchiveDesc)}
        buttonText={formatMessage(m.viewDetails)}
        onPress={() => navigate('RemoteArchive')}
      />
      <SettingsCardRow
        icon={<GraphIcon width={24} height={24} color={NEW_DARK_GREY} />}
        title={formatMessage(
          sendStatsOn ? m.projectStatsOn : m.projectStatsOff,
        )}
        subtitle={formatMessage(
          sendStatsOn ? m.projectStatsOnDesc : m.projectStatsOffDesc,
        )}
        buttonText={formatMessage(m.update)}
        onPress={() => navigate('ProjectStatistics')}
      />
    </ScrollView>
  );
};

type SettingsCardRowProps = {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  buttonText: string;
  onPress: () => void;
};

const SettingsCardRow = ({
  icon,
  title,
  subtitle,
  buttonText,
  onPress,
}: SettingsCardRowProps) => {
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={buttonText}>
      <View style={styles.row}>
        <View style={{marginRight: 16}}>{icon}</View>
        <View style={styles.cardColumn}>
          <HeaderText variant="header5">{title}</HeaderText>
          {!!subtitle && (
            <BodyText variant="smallMeta" style={styles.bodyText}>
              {subtitle}
            </BodyText>
          )}
          <View style={styles.buttonRow}>
            <HeaderText variant="header5" style={styles.buttonText}>
              {buttonText}
            </HeaderText>
            <MaterialIcons
              name="arrow-forward"
              size={24}
              color={COMAPEO_BLUE}
            />
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 20,
    gap: 20,
  },
  card: {
    borderWidth: 1.5,
    borderRadius: 10,
    padding: 20,
    gap: 12,
    shadowColor: BLACK,
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 1,
    backgroundColor: WHITE,
    borderColor: VERY_LIGHT_GREY,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  cardColumn: {
    flex: 1,
    flexDirection: 'column',
    gap: 8,
  },
  bodyText: {
    color: NEW_DARK_GREY,
    flexShrink: 1,
    flexWrap: 'wrap',
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  buttonText: {
    color: COMAPEO_BLUE,
  },
});

ProjectSettings.navTitle = m.title;
