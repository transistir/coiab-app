import * as React from 'react';
import {fireEvent, render, screen} from '@testing-library/react-native';
import {IntlProvider} from 'react-intl';
import {TextInput} from 'react-native';
import {createStore} from 'zustand';
import {PermissionStatus} from 'expo-location';

import {createDraftObservationStore} from '../contexts/PersistedStores/DraftObservationStore';
import type {DraftObservationStore} from '../contexts/PersistedStores/DraftObservationStore';
import {DraftObservationProvider} from '../contexts/DraftObservationContext';
import type {LocationState} from '../contexts/LocationContext';

import {ObserverFields} from './ObserverFields';

// DraftObservationProvider observa o LocationContext; no teste ele fica inerte
// (mesmo padrão de DraftObservationContext.test.tsx).
jest.mock('../contexts/LocationContext', () => {
  const actual = jest.requireActual('../contexts/LocationContext');
  return {...actual, useLocationContext: jest.fn()};
});

import {useLocationContext} from '../contexts/LocationContext';

const mockUseLocationContext = useLocationContext as jest.MockedFunction<
  typeof useLocationContext
>;

const MESSAGES = {
  '$1screens.ObservationCreate.observerEthnicity': 'Etnia do observador',
  '$1screens.ObservationCreate.observerVillage': 'Aldeia do observador',
  '$1screens.ObservationCreate.observerFieldsHelper':
    'Vem do seu perfil. Edite ou deixe em branco.',
  '$1screens.ObservationCreate.observerFieldsExistingHelper':
    'Dados do observador.',
};

const ETHNICITY_TEST_ID = 'OBS.observer-ethnicity-inp';
const VILLAGE_TEST_ID = 'OBS.observer-village-inp';

function createMockLocationStore() {
  return createStore<LocationState>()(() => ({
    location: undefined,
    throttledMapLocation: undefined,
    locationPermission: PermissionStatus.DENIED,
    providerStatus: {
      locationServicesEnabled: false,
      backgroundModeEnabled: false,
      gpsAvailable: false,
      networkAvailable: false,
      passiveAvailable: false,
    },
  }));
}

function renderFields(
  draftStore: DraftObservationStore,
  mode: 'create' | 'edit' = 'create',
) {
  return render(
    <IntlProvider locale="pt-BR" messages={MESSAGES}>
      <DraftObservationProvider draftObservationStore={draftStore}>
        <ObserverFields mode={mode} />
      </DraftObservationProvider>
    </IntlProvider>,
  );
}

beforeEach(() => {
  mockUseLocationContext.mockReturnValue(createMockLocationStore());
});

describe('ObserverFields', () => {
  test('mostra os valores iniciais do rascunho', async () => {
    const draftStore = createDraftObservationStore({persist: false});
    draftStore.actions.createDraft(undefined, {
      'coiab:etnia': 'Mawayana',
      'coiab:aldeia': 'Aldeia Nova',
    });

    await renderFields(draftStore);

    expect(screen.getByTestId(ETHNICITY_TEST_ID).props.value).toBe('Mawayana');
    expect(screen.getByTestId(VILLAGE_TEST_ID).props.value).toBe('Aldeia Nova');
  });

  test('digita caractere a caractere preservando o espaço intermediário', async () => {
    const draftStore = createDraftObservationStore({persist: false});
    draftStore.actions.createDraft();

    await renderFields(draftStore);

    const input = screen.getByTestId(VILLAGE_TEST_ID);

    // "Aldeia Nova" digitado passo a passo. O espaço final de "Aldeia " é
    // texto cru e não pode ser aparado a cada tecla.
    for (const text of [
      'A',
      'Al',
      'Ald',
      'Alde',
      'Aldei',
      'Aldeia',
      'Aldeia ',
    ]) {
      await fireEvent.changeText(input, text);
      expect(draftStore.instance.getState().value?.tags['coiab:aldeia']).toBe(
        text,
      );
      expect(input.props.value).toBe(text);
    }

    await fireEvent.changeText(input, 'Aldeia N');
    await fireEvent.changeText(input, 'Aldeia Nova');

    expect(draftStore.instance.getState().value?.tags['coiab:aldeia']).toBe(
      'Aldeia Nova',
    );
    expect(screen.getByTestId(VILLAGE_TEST_ID).props.value).toBe('Aldeia Nova');
  });

  test('limpar o campo grava texto vazio no rascunho (normalização é no save)', async () => {
    const draftStore = createDraftObservationStore({persist: false});
    draftStore.actions.createDraft(undefined, {
      'coiab:etnia': 'Mawayana',
    });

    await renderFields(draftStore);

    const input = screen.getByTestId(ETHNICITY_TEST_ID);

    await fireEvent.changeText(input, '');

    expect(draftStore.instance.getState().value?.tags['coiab:etnia']).toBe('');
    expect(screen.getByTestId(ETHNICITY_TEST_ID).props.value).toBe('');
  });

  test('expõe rótulo permanente, a11y e testID nos dois campos', async () => {
    const draftStore = createDraftObservationStore({persist: false});
    draftStore.actions.createDraft();

    await renderFields(draftStore);

    // Rótulo visível mesmo com o teclado fechado (diferente do
    // DescriptionField, cujo rótulo só aparece com o teclado aberto).
    expect(screen.getByText('Etnia do observador')).toBeOnTheScreen();
    expect(screen.getByText('Aldeia do observador')).toBeOnTheScreen();
    expect(
      screen.getByText('Vem do seu perfil. Edite ou deixe em branco.'),
    ).toBeOnTheScreen();

    const ethnicity = screen.getByLabelText('Etnia do observador');
    const village = screen.getByLabelText('Aldeia do observador');

    expect(ethnicity.props.testID).toBe(ETHNICITY_TEST_ID);
    expect(village.props.testID).toBe(VILLAGE_TEST_ID);
    expect(ethnicity.props.returnKeyType).toBe('next');
    expect(village.props.returnKeyType).toBe('done');
    expect(ethnicity.props.multiline).not.toBe(true);
    expect(village.props.multiline).not.toBe(true);
  });

  test('modo create mostra o texto de apoio de perfil', async () => {
    const draftStore = createDraftObservationStore({persist: false});
    draftStore.actions.createDraft();

    await renderFields(draftStore, 'create');

    expect(
      screen.getByText('Vem do seu perfil. Edite ou deixe em branco.'),
    ).toBeOnTheScreen();
    expect(screen.queryByText('Dados do observador.')).not.toBeOnTheScreen();
  });

  test('modo edit mostra o texto de apoio de dados existentes', async () => {
    const draftStore = createDraftObservationStore({persist: false});
    draftStore.actions.createDraft();

    await renderFields(draftStore, 'edit');

    expect(screen.getByText('Dados do observador.')).toBeOnTheScreen();
    expect(
      screen.queryByText('Vem do seu perfil. Edite ou deixe em branco.'),
    ).not.toBeOnTheScreen();
  });

  test('submit do campo de etnia foca o campo de aldeia', async () => {
    const draftStore = createDraftObservationStore({persist: false});
    draftStore.actions.createDraft();

    const focusMock = (TextInput.prototype as unknown as {focus: jest.Mock})
      .focus;
    focusMock.mockClear();

    await renderFields(draftStore, 'create');
    await fireEvent(screen.getByTestId(ETHNICITY_TEST_ID), 'submitEditing');

    expect(focusMock).toHaveBeenCalledTimes(1);
  });
});
