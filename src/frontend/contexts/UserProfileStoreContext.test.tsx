import {act, renderHook} from '@testing-library/react-native';
import {type ReactNode} from 'react';

import {MMKVStoreInitializer} from '../hooks/persistedState/createPersistedState';
import {
  COIAB_USER_PROFILE_STORAGE_KEY,
  UserProfileStoreProvider,
  createUserProfileStore,
  isProfileComplete,
  useUserProfileActions,
  useUserProfileState,
  type UserProfileStore,
} from './UserProfileStoreContext';

const EMPTY_PROFILE = {ethnicity: null, village: null};

function createWrapper(store: UserProfileStore) {
  return ({children}: {children: ReactNode}) => {
    return (
      <UserProfileStoreProvider store={store}>
        {children}
      </UserProfileStoreProvider>
    );
  };
}

function persistedRaw(value: unknown): string {
  return JSON.stringify(value);
}

function writeRaw(raw: string) {
  MMKVStoreInitializer.setItem(COIAB_USER_PROFILE_STORAGE_KEY, raw);
}

function readEnvelope() {
  const raw = MMKVStoreInitializer.getItem(COIAB_USER_PROFILE_STORAGE_KEY) as
    string | null;
  return raw === null ? null : JSON.parse(raw);
}

describe('UserProfileStore', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    MMKVStoreInitializer.removeItem(COIAB_USER_PROFILE_STORAGE_KEY);
  });

  test('chave MMKV é CoiabUserProfile e o estado começa vazio', () => {
    expect(COIAB_USER_PROFILE_STORAGE_KEY).toBe('CoiabUserProfile');
    expect(createUserProfileStore().instance.getState()).toStrictEqual(
      EMPTY_PROFILE,
    );
  });

  test('setEthnicity e setVillage persistem o envelope {state, version: 2}', () => {
    const store = createUserProfileStore({persist: true});

    store.actions.setEthnicity('  Kaxuyana-Tunayana  ');
    store.actions.setVillage('  Aldeia X  ');

    expect(store.instance.getState()).toStrictEqual({
      ethnicity: 'Kaxuyana-Tunayana',
      village: 'Aldeia X',
    });
    expect(readEnvelope()).toStrictEqual({
      state: {ethnicity: 'Kaxuyana-Tunayana', village: 'Aldeia X'},
      version: 2,
    });
  });

  test('texto livre fora do dataset é aceito e persistido', () => {
    const store = createUserProfileStore({persist: true});

    store.actions.setEthnicity('Etnia que não está no catálogo');
    store.actions.setVillage('Aldeia inventada pela comunidade');

    expect(store.instance.getState()).toStrictEqual({
      ethnicity: 'Etnia que não está no catálogo',
      village: 'Aldeia inventada pela comunidade',
    });
    expect(readEnvelope()?.state).toStrictEqual({
      ethnicity: 'Etnia que não está no catálogo',
      village: 'Aldeia inventada pela comunidade',
    });
  });

  test.each(['', '   ', '\n\t '])(
    'texto só com espaços (%j) vira null',
    text => {
      const store = createUserProfileStore({persist: true});

      store.actions.setEthnicity(text);
      store.actions.setVillage(text);

      expect(store.instance.getState()).toStrictEqual(EMPTY_PROFILE);
      expect(readEnvelope()?.state).toStrictEqual(EMPTY_PROFILE);
    },
  );

  test('uma instância nova sobre o mesmo MMKV reidrata o perfil', () => {
    const primeiro = createUserProfileStore({persist: true});
    primeiro.actions.setEthnicity('Mawayana');
    primeiro.actions.setVillage('Aldeia Y');

    const segundo = createUserProfileStore({persist: true});

    expect(segundo.instance.getState()).toStrictEqual({
      ethnicity: 'Mawayana',
      village: 'Aldeia Y',
    });
  });

  test('getItem lançando hidrata vazio sem quebrar a construção', () => {
    const read = jest
      .spyOn(MMKVStoreInitializer, 'getItem')
      .mockImplementation(() => {
        throw new Error('mmkv adapter broken');
      });

    let store: UserProfileStore | undefined;
    try {
      expect(() => {
        store = createUserProfileStore({persist: true});
      }).not.toThrow();
    } finally {
      read.mockRestore();
    }

    expect(store).toBeDefined();
    expect(store!.instance.getState()).toStrictEqual(EMPTY_PROFILE);
  });

  test('falha de hidratação NÃO bloqueia escritas posteriores', () => {
    const read = jest
      .spyOn(MMKVStoreInitializer, 'getItem')
      .mockImplementationOnce(() => {
        throw new Error('mmkv adapter broken');
      });

    const store = createUserProfileStore({persist: true});
    read.mockRestore();

    store.actions.setEthnicity('Tunayana');

    expect(store.instance.getState().ethnicity).toBe('Tunayana');
    expect(readEnvelope()).toStrictEqual({
      state: {ethnicity: 'Tunayana', village: null},
      version: 2,
    });
  });

  test('raw não-JSON hidrata vazio', () => {
    writeRaw('{estado: quebrado');

    const store = createUserProfileStore({persist: true});

    expect(store.instance.getState()).toStrictEqual(EMPTY_PROFILE);
  });

  test('perfil v1 antigo é descartado, sem migração', () => {
    writeRaw(
      persistedRaw({
        state: {ethnicGroupId: 'dummy-1', village: 'Aldeia antiga'},
        version: 1,
      }),
    );

    const store = createUserProfileStore({persist: true});

    expect(store.instance.getState()).toStrictEqual(EMPTY_PROFILE);
  });

  test.each([
    ['raiz null', null],
    ['raiz array', []],
    ['raiz string', 'x'],
    ['envelope sem state', {}],
    ['state null', {state: null}],
    ['state com ethnicity numérico', {state: {ethnicity: 5}}],
    [
      'state com village não-string',
      {state: {ethnicity: 'Tunayana', village: 7}},
    ],
    [
      'versão desconhecida',
      {state: {ethnicity: 'Tunayana', village: 'Aldeia X'}, version: 3},
    ],
  ])('envelope inválido (%s) hidrata vazio', (_nome, value) => {
    writeRaw(persistedRaw(value));

    const store = createUserProfileStore({persist: true});

    expect(store.instance.getState()).toStrictEqual(EMPTY_PROFILE);
  });

  test('envelope v2 reidrata texto livre sem validar contra o dataset', () => {
    writeRaw(
      persistedRaw({
        state: {ethnicity: 'Etnia livre', village: '  Aldeia livre  '},
        version: 2,
      }),
    );

    const store = createUserProfileStore({persist: true});

    expect(store.instance.getState()).toStrictEqual({
      ethnicity: 'Etnia livre',
      village: 'Aldeia livre',
    });
  });

  test('setItem lançando: estado não é publicado e a ação repassa o erro', () => {
    const store = createUserProfileStore({persist: true});
    const write = jest
      .spyOn(MMKVStoreInitializer, 'setItem')
      .mockImplementation(() => {
        throw new Error('disk full');
      });
    const publish = jest.fn();
    store.instance.subscribe(publish);

    try {
      expect(() => store.actions.setVillage('Aldeia Z')).toThrow('disk full');
    } finally {
      write.mockRestore();
    }

    expect(store.instance.getState()).toStrictEqual(EMPTY_PROFILE);
    expect(publish).not.toHaveBeenCalled();
  });

  test.each([
    [
      'etnia e aldeia preenchidas',
      {ethnicity: 'Tunayana', village: 'Aldeia X'},
      true,
    ],
    ['etnia nula', {ethnicity: null, village: 'Aldeia X'}, false],
    ['etnia vazia', {ethnicity: '', village: 'Aldeia X'}, false],
    ['etnia só com espaços', {ethnicity: '   ', village: 'Aldeia X'}, false],
    ['aldeia nula', {ethnicity: 'Tunayana', village: null}, false],
    ['aldeia vazia', {ethnicity: 'Tunayana', village: ''}, false],
    ['aldeia só com espaços', {ethnicity: 'Tunayana', village: '   '}, false],
  ])('isProfileComplete: %s', (_nome, state, expected) => {
    expect(isProfileComplete(state)).toBe(expected);
  });

  test('hooks expõem estado e ações sob o provider', async () => {
    const store = createUserProfileStore();
    const wrapper = createWrapper(store);

    const stateHook = await renderHook(() => useUserProfileState(), {wrapper});
    const actionsHook = await renderHook(() => useUserProfileActions(), {
      wrapper,
    });

    expect(stateHook.result.current).toStrictEqual(EMPTY_PROFILE);

    await act(async () => {
      actionsHook.result.current.setEthnicity('Mawayana');
      actionsHook.result.current.setVillage('Aldeia W');
    });

    expect(stateHook.result.current).toStrictEqual({
      ethnicity: 'Mawayana',
      village: 'Aldeia W',
    });
  });
});
