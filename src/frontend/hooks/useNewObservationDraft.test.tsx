import {act, renderHook} from '@testing-library/react-native';
import {type ReactNode} from 'react';
import {createStore} from 'zustand';
import {PermissionStatus} from 'expo-location';

import {createDraftObservationStore} from '../contexts/PersistedStores/DraftObservationStore';
import type {DraftObservationStore} from '../contexts/PersistedStores/DraftObservationStore';
import {DraftObservationProvider} from '../contexts/DraftObservationContext';
import type {LocationState} from '../contexts/LocationContext';
import {
  UserProfileStoreProvider,
  createUserProfileStore,
  type UserProfileStore,
} from '../contexts/UserProfileStoreContext';
import {useNewObservationDraft} from './useNewObservationDraft';

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

function createWrapper(
  draftStore: DraftObservationStore,
  profileStore: UserProfileStore,
) {
  return ({children}: {children: ReactNode}) => {
    return (
      <UserProfileStoreProvider store={profileStore}>
        <DraftObservationProvider draftObservationStore={draftStore}>
          {children}
        </DraftObservationProvider>
      </UserProfileStoreProvider>
    );
  };
}

async function setup({
  ethnicity,
  village,
}: {
  ethnicity?: string;
  village?: string;
}) {
  const draftStore = createDraftObservationStore({persist: false});
  const profileStore = createUserProfileStore();

  if (ethnicity !== undefined) {
    profileStore.actions.setEthnicity(ethnicity);
  }
  if (village !== undefined) {
    profileStore.actions.setVillage(village);
  }

  const {result} = await renderHook(() => useNewObservationDraft(), {
    wrapper: createWrapper(draftStore, profileStore),
  });

  await act(async () => {
    result.current();
  });

  return draftStore.instance.getState().value?.tags;
}

beforeEach(() => {
  mockUseLocationContext.mockReturnValue(createMockLocationStore());
});

describe('useNewObservationDraft()', () => {
  test('perfil completo cria o rascunho com as duas tags do observador', async () => {
    const tags = await setup({
      ethnicity: 'Mawayana',
      village: 'Aldeia Nova',
    });

    expect(tags).toStrictEqual({
      notes: '',
      'coiab:etnia': 'Mawayana',
      'coiab:aldeia': 'Aldeia Nova',
    });
  });

  test('perfil parcial cria o rascunho com só a tag existente', async () => {
    const tags = await setup({ethnicity: 'Mawayana'});

    expect(tags).toStrictEqual({
      notes: '',
      'coiab:etnia': 'Mawayana',
    });
  });

  test('perfil vazio não grava nenhuma tag do observador', async () => {
    const tags = await setup({});

    expect(tags).toStrictEqual({notes: ''});
    expect(tags).not.toHaveProperty('coiab:etnia');
    expect(tags).not.toHaveProperty('coiab:aldeia');
  });

  test('usa o perfil do momento da chamada (retrato da criação)', async () => {
    const draftStore = createDraftObservationStore({persist: false});
    const profileStore = createUserProfileStore();
    profileStore.actions.setEthnicity('Mawayana');

    const {result, rerender} = await renderHook(
      () => useNewObservationDraft(),
      {
        wrapper: createWrapper(draftStore, profileStore),
      },
    );

    await act(async () => {
      result.current();
    });
    expect(draftStore.instance.getState().value?.tags['coiab:etnia']).toBe(
      'Mawayana',
    );

    // Mudar o perfil depois não reescreve o rascunho já criado.
    await act(async () => {
      profileStore.actions.setEthnicity('Outra etnia');
    });
    await rerender({});

    expect(draftStore.instance.getState().value?.tags['coiab:etnia']).toBe(
      'Mawayana',
    );
  });

  test('cada chamada usa o perfil do momento em que foi feita', async () => {
    const draftStore = createDraftObservationStore({persist: false});
    const profileStore = createUserProfileStore();
    profileStore.actions.setEthnicity('Mawayana');

    const {result, rerender} = await renderHook(
      () => useNewObservationDraft(),
      {
        wrapper: createWrapper(draftStore, profileStore),
      },
    );

    await act(async () => {
      result.current();
    });
    expect(draftStore.instance.getState().value?.tags).toStrictEqual({
      notes: '',
      'coiab:etnia': 'Mawayana',
    });

    await act(async () => {
      profileStore.actions.setEthnicity('Baniwa');
      profileStore.actions.setVillage('Aldeia Nova');
    });
    await rerender({});

    await act(async () => {
      result.current();
    });
    expect(draftStore.instance.getState().value?.tags).toStrictEqual({
      notes: '',
      'coiab:etnia': 'Baniwa',
      'coiab:aldeia': 'Aldeia Nova',
    });
  });
});
