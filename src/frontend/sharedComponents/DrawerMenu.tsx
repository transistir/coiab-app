import React from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
} from 'react-native';
import {useIntl, defineMessages} from 'react-intl';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import MaterialIcon from '@react-native-vector-icons/material-icons';

import {useNavigationFromRoot} from '../hooks/useNavigationWithTypes.ts';
import Exchange from '../images/Exchange.svg';
import {BodyText} from '../sharedComponents/Text/BodyText.tsx';
import {useProjectRoleAndDetails} from '../hooks/useProjectRoleAndDetails.ts';
import {
  COIAB_SAND,
  COMAPEO_BLUE,
  DARK_GREY,
  LIGHT_GREY,
  LIGHT_ORANGE,
  NEW_DARK_GREY,
  ORANGE,
  WHITE,
} from '../lib/styles.ts';
import {useActiveProject} from '../contexts/ActiveProjectContext.tsx';
import {MenuLowStorageAlert} from '../sharedComponents/Storage/MenuLowStorageAlert.tsx';
import {useStorageReadingQuery} from '../hooks/useStorageReadingQuery.ts';
import {ColorCard} from '../sharedComponents/ColorCard.tsx';
import {PrimaryButton} from '../sharedComponents/Buttons.tsx';
import {isLowStorage, calcUsedPercentage} from '../lib/storage.ts';
import {useEarlyAccessState} from '../contexts/EarlyAccessContext';
import {useCoiabOrganizationsState} from '../contexts/CoiabOrganizationsStoreContext';
import {derivarProjectIdAtivo} from '../lib/organization/coiabOrganizations';
import {OrganizationAreaAccesses} from './OrganizationAreaAccesses.tsx';

const m = defineMessages({
  greeting: {
    id: '$1Navigation.Menu.greeting',
    defaultMessage: 'Olá, Parente',
    description:
      'Página Entroncamento greeting (Figma Kutary App V2, 2668:4539)',
  },
  switchOrganizationTitle: {
    id: '$1Navigation.Menu.switchOrganizationTitle',
    defaultMessage: 'Trocar de organização',
    // SPEC A §6.1:201 — pt-BR ships the verbatim string; a nova página usa
    // id próprio para não divergir da duplicata canônica do seletor.
    description: 'Menu list entry that opens the organization selector',
  },
  switchOrganizationSubtitle: {
    id: '$1Navigation.Menu.switchOrganizationSubtitle',
    defaultMessage: 'Escolher outra org',
    description: 'Subtitle of the organization selector menu entry',
  },
  convidar: {
    id: '$1Navigation.Menu.convidar',
    defaultMessage: 'Convidar',
    description: 'Menu list entry that opens the team screen',
  },
  convidarSubtitle: {
    id: '$1Navigation.Menu.convidarSubtitle',
    defaultMessage: 'Adicionar pessoas',
    description: 'Subtitle of the invite menu entry',
  },
  criarOrganizacao: {
    id: '$1Navigation.Menu.criarOrganizacao',
    defaultMessage: 'Criar organização',
    description: 'Menu list entry that opens the organization creation flow',
  },
  exchange: {
    id: '$1Navigation.Menu.exchange',
    defaultMessage: 'Exchange',
  },
  earlyAccessOn: {
    id: '$1Navigation.Menu.earlyAccessOn',
    defaultMessage: 'Early Access ON',
  },
  earlyAccessTurnOff: {
    id: '$1Navigation.Menu.earlyAccessTurnOff',
    defaultMessage: 'Turn Off',
  },
});
type Mensagem = {id: string; defaultMessage: string};

/** List item da Página Entroncamento (Figma `2668:4539`): 392×64, ícone
 * quadrado laranja (raio 8), título 16 SemiBold branco e subtítulo 14
 * Medium cinza suave. */
function MenuListItem({
  testID,
  onPress,
  titulo,
  subtitulo,
  icone,
  accessibilityLabel,
}: {
  testID: string;
  onPress: () => void;
  titulo: Mensagem;
  subtitulo?: Mensagem;
  icone: string;
  accessibilityLabel: string;
}) {
  const {formatMessage} = useIntl();
  return (
    <TouchableOpacity
      testID={testID}
      style={styles.listItem}
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}>
      <View style={styles.listItemIcon}>
        <MaterialIcon name={icone as never} size={22} color={DARK_GREY} />
      </View>
      <View style={styles.listItemText}>
        <BodyText style={styles.listItemTitle}>
          {formatMessage(titulo)}
        </BodyText>
        {subtitulo && (
          <BodyText style={styles.listItemSubtitle}>
            {formatMessage(subtitulo)}
          </BodyText>
        )}
      </View>
    </TouchableOpacity>
  );
}

/**
 * A Página Entroncamento (Figma Kutary App V2, `2668:4539`): saudação
 * "Olá, Parente" + nome do projeto corrente, os DOIS cards clicáveis de
 * área (Monitoramento Territorial e Alertas — Cadeias Produtivas e Censo
 * Demográfico ficam para fases seguintes, decisão do dono do produto) e a
 * lista: Trocar de organização (early access + ≥2 organizações), Convidar
 * (somente coordinator) e Criar organização (early access + organização
 * operável). As 5 entradas legadas do CoMapeo (Team, Coordinator Tools,
 * Gather Observations, Background Map, AppSettings) migraram: Background
 * Maps/Project Settings/Your Team agora vivem em AppSettings
 * (ComapeoSettings). O botão Exchange permanece no rodapé.
 */
export function DrawerMenu({closeMenu}: {closeMenu: () => void}) {
  const {formatMessage} = useIntl();
  const navigation = useNavigationFromRoot();

  const {projectId} = useActiveProject();
  const {role, projectHeader} = useProjectRoleAndDetails(projectId);
  const estadoOrganizacoes = useCoiabOrganizationsState();
  // SEM organização operável (solo/sem doc): os cards não existem — a
  // página mostra saudação + lista (paridade com o comportamento anterior
  // que retornava null).
  const semOrganizacaoOperavel =
    derivarProjectIdAtivo(estadoOrganizacoes) === null;
  // Review 2 (P1-1): com organização operável, `projectHeader` é
  // `projectData.name` — o materializador batiza o projeto com o nome da
  // ÁREA (`materializar.ts` NAMES), então a saudação mostraria
  // "Monitoramento"/"Alertas" e o nome da organização sumiria. Operando
  // uma organização, a saudação mostra `organizacao.nome`; sem
  // organização (solo/sem doc), mantém o header legado do projeto.
  const organizacao = estadoOrganizacoes.organizacoes.find(
    item => item.id === estadoOrganizacoes.ativa?.organizacaoId,
  );
  const saudacaoNome = semOrganizacaoOperavel
    ? projectHeader
    : (organizacao?.nome ?? projectHeader);
  const {data} = useStorageReadingQuery();
  const {freeBytes, totalBytes} = data;
  const isLow = isLowStorage(freeBytes);
  const percentUsed = calcUsedPercentage(freeBytes, totalBytes);

  const isEarly = useEarlyAccessState(s => s.isEarlyAccessEnabled);
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[styles.container, {paddingTop: insets.top}]}
      testID="MENU.conteudo">
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        {isLow && (
          <MenuLowStorageAlert
            freeBytes={freeBytes}
            percentUsed={percentUsed}
          />
        )}
        {isEarly ? (
          <ColorCard backgroundColor={LIGHT_ORANGE}>
            <View style={styles.earlyAccessAlert}>
              <View style={styles.earlyAccessRow}>
                <MaterialIcon name="flag" size={20} color={NEW_DARK_GREY} />
                <BodyText style={styles.earlyAccessLabel}>
                  {formatMessage(m.earlyAccessOn)}
                </BodyText>
                <Pressable
                  onPress={() => navigation.navigate('EarlyAccess')}
                  hitSlop={{top: 12, bottom: 12, left: 12, right: 12}}>
                  <BodyText style={styles.earlyAccessTurnOff}>
                    {formatMessage(m.earlyAccessTurnOff)}
                  </BodyText>
                </Pressable>
              </View>
            </View>
          </ColorCard>
        ) : null}
        <View style={styles.greetingBlock}>
          <BodyText style={styles.greeting}>
            {formatMessage(m.greeting)}
          </BodyText>
          <BodyText style={styles.greetingProject}>{saudacaoNome}</BodyText>
        </View>
        {!semOrganizacaoOperavel && <OrganizationAreaAccesses />}
        <View style={styles.listContainer}>
          {/* SPEC A §6.1:201/§8:247 — the selector entry exists only with
              early access on AND two or more organizations; with either
              false it does not exist (no hidden or disabled control). */}
          {isEarly && estadoOrganizacoes.organizacoes.length >= 2 && (
            <MenuListItem
              testID="MENU.trocar-organizacao"
              onPress={() => {
                closeMenu();
                navigation.navigate('Organizations');
              }}
              titulo={m.switchOrganizationTitle}
              subtitulo={m.switchOrganizationSubtitle}
              icone="swap-horiz"
              accessibilityLabel="Open the organization selector."
            />
          )}
          {/* O acesso à equipe fica COORD-only nesta página; participants
              seguem usando Your Team em AppSettings. */}
          {role === 'coordinator' && (
            <MenuListItem
              testID="MENU.convidar"
              onPress={() => navigation.navigate('YourTeam')}
              titulo={m.convidar}
              subtitulo={m.convidarSubtitle}
              icone="person-add"
              accessibilityLabel="Invite people to the organization."
            />
          )}
          {/* SPEC Fase 6/Q3: the create entry exists only with early
              access on AND an operating organization; with either false it
              does not exist (no hidden or disabled control). */}
          {isEarly && !semOrganizacaoOperavel && (
            <MenuListItem
              testID="MENU.criar-organizacao"
              onPress={() => {
                closeMenu();
                navigation.navigate('CreateOrganization');
              }}
              titulo={m.criarOrganizacao}
              icone="business"
              accessibilityLabel="Open the organization creation flow."
            />
          )}
        </View>
      </ScrollView>
      <View style={{marginBottom: 20, marginHorizontal: 20}}>
        <PrimaryButton
          testID="MENU.main-action-button"
          style={{
            alignSelf: 'center',
            width: '100%',
            maxWidth: 280,
          }}
          onPress={() => {
            navigation.navigate('Sync');
          }}
          fullSize={false}
          text={formatMessage(m.exchange)}
          renderIcon={({color}) => <Exchange color={color} />}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DARK_GREY,
  },
  scrollContainer: {
    flexGrow: 1,
    padding: 20,
    flexDirection: 'column',
    gap: 12,
  },
  greetingBlock: {
    gap: 4,
  },
  greeting: {
    color: COIAB_SAND,
    fontSize: 20,
    // O app só empacota Rubik (Inter não existe no bundle).
    fontFamily: 'Rubik_600SemiBold',
  },
  greetingProject: {
    color: WHITE,
    fontSize: 14,
    fontWeight: '500',
  },
  listContainer: {
    gap: 12,
    marginTop: 8,
  },
  listItem: {
    minHeight: 64,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  listItemIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: ORANGE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listItemText: {
    flex: 1,
  },
  listItemTitle: {
    color: WHITE,
    fontSize: 16,
    fontWeight: '600',
  },
  listItemSubtitle: {
    color: LIGHT_GREY,
    fontSize: 14,
    fontWeight: '500',
  },
  earlyAccessAlert: {
    padding: 15,
  },
  earlyAccessRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  earlyAccessLabel: {
    flex: 1,
    color: NEW_DARK_GREY,
  },
  earlyAccessTurnOff: {
    color: COMAPEO_BLUE,
  },
});
