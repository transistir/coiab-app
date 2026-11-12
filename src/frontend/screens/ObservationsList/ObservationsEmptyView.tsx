import {defineMessages, useIntl} from 'react-intl';
import {StyleSheet, View} from 'react-native';

import {WHITE} from '../../lib/styles';
import {ObservationListIcon} from '../../sharedComponents/icons';
import {ScreenContentWithDock} from '../../sharedComponents/ScreenContentWithDock';
import {BodyText} from '../../sharedComponents/Text/BodyText';
import {HeaderText} from '../../sharedComponents/Text/HeaderText';
import {SecondaryButton} from '../../sharedComponents/Buttons';
import {useActiveProject} from '../../contexts/ActiveProjectContext';
import {useCoiabOrganizationsState} from '../../contexts/CoiabOrganizationsStoreContext';
import {derivarProjectIdAtivo} from '../../lib/organization/coiabOrganizations';

const m = defineMessages({
  emptyMonitoramento: {
    id: '$1screens.ObservationsList.emptyMonitoramento',
    description:
      'Title of the empty observation list in the Monitoring area of an organization',
    defaultMessage: 'No records yet in Monitoring',
  },
  emptyAlertas: {
    id: '$1screens.ObservationsList.emptyAlertas',
    description:
      'Title of the empty observation list in the Alerts area of an organization',
    defaultMessage: 'No records yet in Alerts',
  },
  goToMap: {
    id: '$1screens.ObservationsList.goToMap',
    description:
      'Action that opens the map of the current work area from the empty observation list',
    defaultMessage: 'Go to the map',
  },
  noObservationsTitle: {
    id: '$1screens.ObservationsList.ObservationsEmptyView.noObservationsTitle',
    description:
      'Title of observation list view when the user has not yet recorded observations',
    defaultMessage: 'Add Observations',
  },
  noObservationsDesc: {
    id: 'screens.ObservationsList.ObservationsEmptyView.noObservationsDesc',
    description:
      'Description of observation list view when the user has not yet recorded observations',
    defaultMessage:
      'Start from map or camera view to record your first observation.',
  },
  backButton: {
    id: '$1screens.ObservationsList.ObservationsEmptyView.backButton',
    description:
      'Back button on observation list screen when no observations are yet recorded',
    defaultMessage: 'Go To Map',
  },
});

const ICON_SIZE = 48;

export const ObservationEmptyView = ({
  onPressBack,
}: {
  onPressBack: () => void;
}) => {
  const {formatMessage: t} = useIntl();
  // SPEC A §4.4:147 — the per-area empty copy names the area the device
  // operates, resolved from the persisted document exactly like
  // HomeHeader does (derivation must match the project being rendered).
  const {projectId} = useActiveProject();
  const estado = useCoiabOrganizationsState();
  const derivado = derivarProjectIdAtivo(estado);
  const areaAtiva =
    derivado !== null && derivado === projectId
      ? estado.ativa?.area
      : undefined;

  return (
    <ScreenContentWithDock
      testID="observationsEmptyView"
      contentContainerStyle={styles.contentContainer}
      dockContainerStyle={styles.dockContainer}
      dockContent={
        <SecondaryButton
          fullSize
          onPress={onPressBack}
          text={t(areaAtiva ? m.goToMap : m.backButton)}
        />
      }>
      <View style={styles.iconCircle}>
        <ObservationListIcon size={ICON_SIZE} />
      </View>
      {areaAtiva ? (
        <HeaderText variant="header2" style={styles.text}>
          {areaAtiva === 'monitoramento'
            ? t(m.emptyMonitoramento)
            : t(m.emptyAlertas)}
        </HeaderText>
      ) : (
        <>
          <HeaderText variant="header2" style={styles.text}>
            {t(m.noObservationsTitle)}
          </HeaderText>
          <BodyText style={styles.text}>{t(m.noObservationsDesc)}</BodyText>
        </>
      )}
    </ScreenContentWithDock>
  );
};

const styles = StyleSheet.create({
  contentContainer: {
    backgroundColor: WHITE,
    flex: 1,
    gap: 20,
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  dockContainer: {
    backgroundColor: WHITE,
  },
  iconCircle: {
    alignItems: 'center',
    backgroundColor: '#CCE0FF',
    borderRadius: ICON_SIZE,
    height: ICON_SIZE * 2,
    justifyContent: 'center',
    width: ICON_SIZE * 2,
  },
  text: {
    textAlign: 'center',
  },
});
