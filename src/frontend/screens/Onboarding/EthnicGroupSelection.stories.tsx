import * as React from 'react';
import {StyleSheet, View} from 'react-native';
import type {Meta, StoryObj} from '@storybook/react-native';

import {EthnicGroupSelection} from './EthnicGroupSelection';
import {AutocompleteField} from '../../sharedComponents/AutocompleteField';
import {getEthnicitySuggestions} from '../../lib/profileCatalog';
import {DARK_GREY} from '../../lib/styles';
import {
  UserProfileStoreProvider,
  createUserProfileStore,
} from '../../contexts/UserProfileStoreContext';
import {withFlowState} from '../../../../.rnstorybook/decorators/withFlowState';
import {withPtBrLocale} from '../../../../.rnstorybook/decorators/withPtBrLocale';

/**
 * The screen takes its navigation from the real stack; these stories are for
 * visual review, so the callbacks are inert. Each story provides its own
 * non-persisted store: the AppProviders store would read and write the
 * device's real MMKV. `WithSelection` seeds its store with an ethnic group to
 * expose the pre-selected state.
 */
const NoStoryComponent = () => null;

const meta = {
  title: 'Onboarding/EthnicGroupSelection',
  component: NoStoryComponent,
  // `scripts/storybook-capture.sh` requires `STORYBOOK.flow-ready.<storyId>`
  // for every manifest row, including the `testID:` rows below; only the
  // decorators render it. These stories already supply their own store, so no
  // `parameters.flow.state` is needed.
  decorators: [withFlowState, withPtBrLocale],
} satisfies Meta<typeof NoStoryComponent>;

export default meta;
type Story = StoryObj<typeof meta>;

const navigation = {
  navigate: () => {},
  goBack: () => {},
  reset: () => {},
} as never;

const route = {
  key: 'EthnicGroupSelection',
  name: 'EthnicGroupSelection',
} as never;

/** Empty profile: the free-text field is empty and Continue is disabled. */
export const Default: Story = {
  render: () => (
    <UserProfileStoreProvider store={createUserProfileStore()}>
      <EthnicGroupSelection navigation={navigation} route={route} />
    </UserProfileStoreProvider>
  ),
};

/** A profile that already stored an ethnicity. */
export const WithSelection: Story = {
  render: () => {
    const store = createUserProfileStore();
    store.instance.setState({ethnicity: 'Tunayana'});

    return (
      <UserProfileStoreProvider store={store}>
        <EthnicGroupSelection navigation={navigation} route={route} />
      </UserProfileStoreProvider>
    );
  },
};

/**
 * Lista de sugestões aberta com o valor "a" (#132): prova visual do filtro
 * sobre o catálogo de etnias (Kahyana, Katuenayana, Katxuyana, Mawayana,
 * Tunayana, Txikiyana). A tela abre a lista só com foco, então a story
 * renderiza o campo direto com a prop story-only `defaultOpen`; nenhum
 * caminho do app passa essa prop.
 */
export const SuggestionsOpen: Story = {
  render: () => (
    <View style={styles.storyScreen}>
      <AutocompleteField
        value="a"
        onChangeText={() => {}}
        suggestions={getEthnicitySuggestions('a')}
        onSelect={() => {}}
        placeholder="Digite ou escolha uma opção"
        defaultOpen
        testID="ONBOARDING.ethnic-group-inp"
      />
    </View>
  ),
};

const styles = StyleSheet.create({
  storyScreen: {
    flex: 1,
    backgroundColor: DARK_GREY,
    paddingHorizontal: 20,
    paddingTop: 24,
  },
});
