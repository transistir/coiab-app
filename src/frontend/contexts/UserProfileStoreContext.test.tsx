import {act, renderHook} from '@testing-library/react-native';
import {type ReactNode} from 'react';

import {MMKVStoreInitializer} from '../hooks/persistedState/createPersistedState';
import {ETHNIC_GROUPS, type EthnicGroup} from '../lib/ethnicGroups';
import {
  COIAB_USER_PROFILE_STORAGE_KEY,
  UserProfileStoreProvider,
  createUserProfileStore,
  isProfileComplete,
  useUserProfileActions,
  useUserProfileState,
  type UserProfileStore,
} from './UserProfileStoreContext';

const EMPTY_PROFILE = {ethnicGroupId: null, village: null};

const CATALOG: EthnicGroup[] = [
  {id: 'etnia-a', name: 'Etnia A'},
  {id: 'etnia-b', name: 'Etnia B'},
];

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
  const raw = MMKVStoreInitializer.getItem(
    COIAB_USER_PROFILE_STORAGE_KEY,
  ) as string | null;
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

  test('setEthnicGroup e setVillage persistem o envelope {state, version: 1}', () => {
    const store = createUserProfileStore({persist: true, catalog: CATALOG});

    store.actions.setEthnicGroup('etnia-a');
    store.actions.setVillage('  Aldeia X  ');

    expect(store.instance.getState()).toStrictEqual({
      ethnicGroupId: 'etnia-a',
      village: 'Aldeia X',
    });
    expect(readEnvelope()).toStrictEqual({
      state: {ethnicGroupId: 'etnia-a', village: 'Aldeia X'},
      version: 1,
    });
  });

  test('uma instância nova sobre o mesmo MMKV reidrata o perfil', () => {
    const primeiro = createUserProfileStore({persist: true, catalog: CATALOG});
    primeiro.actions.setEthnicGroup('etnia-b');
    primeiro.actions.setVillage('Aldeia Y');

    const segundo = createUserProfileStore({persist: true, catalog: CATALOG});

    expect(segundo.instance.getState()).toStrictEqual({
      ethnicGroupId: 'etnia-b',
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
        store = createUserProfileStore({persist: true, catalog: CATALOG});
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

    const store = createUserProfileStore({persist: true, catalog: CATALOG});
    read.mockRestore();

    store.actions.setEthnicGroup('etnia-a');

    expect(store.instance.getState().ethnicGroupId).toBe('etnia-a');
    expect(readEnvelope()).toStrictEqual({
      state: {ethnicGroupId: 'etnia-a', village: null},
      version: 1,
    });
  });

  test('raw não-JSON hidrata vazio', () => {
    writeRaw('{estado: quebrado');

    const store = createUserProfileStore({persist: true, catalog: CATALOG});

    expect(store.instance.getState()).toStrictEqual(EMPTY_PROFILE);
  });

  test.each([
    ['raiz null', null],
    ['raiz array', []],
    ['raiz string', 'x'],
    ['envelope sem state', {}],
    ['state null', {state: null}],
    ['state com ethnicGroupId numérico', {state: {ethnicGroupId: 5}}],
    [
      'state com village não-string',
      {state: {ethnicGroupId: 'etnia-a', village: 7}},
    ],
    [
      'versão desconhecida',
      {state: {ethnicGroupId: 'etnia-a', village: 'Aldeia X'}, version: 2},
    ],
  ])('envelope inválido (%s) hidrata vazio', (_nome, value) => {
    writeRaw(persistedRaw(value));

    const store = createUserProfileStore({persist: true, catalog: CATALOG});

    expect(store.instance.getState()).toStrictEqual(EMPTY_PROFILE);
  });

  test('ethnicGroupId fora do catálogo vira null', () => {
    writeRaw(
      persistedRaw({
        state: {ethnicGroupId: 'desconhecida', village: 'Aldeia X'},
        version: 1,
      }),
    );

    const store = createUserProfileStore({persist: true, catalog: CATALOG});

    expect(store.instance.getState()).toStrictEqual({
      ethnicGroupId: null,
      village: 'Aldeia X',
    });
  });

  test('setEthnicGroup fora do catálogo lança sem publicar', () => {
    const store = createUserProfileStore({persist: true, catalog: CATALOG});
    const publish = jest.fn();
    store.instance.subscribe(publish);

    expect(() => store.actions.setEthnicGroup('desconhecida')).toThrow();

    expect(store.instance.getState()).toStrictEqual(EMPTY_PROFILE);
    expect(publish).not.toHaveBeenCalled();
    expect(readEnvelope()).toBeNull();
  });

  test('setItem lançando: estado não é publicado e a ação repassa o erro', () => {
    const store = createUserProfileStore({persist: true, catalog: CATALOG});
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

  test.each(['', '   ', '\n\t '])(
    'aldeia só com espaços (%j) é rejeitada',
    text => {
      const store = createUserProfileStore({persist: true, catalog: CATALOG});

      expect(() => store.actions.setVillage(text)).toThrow();

      expect(store.instance.getState()).toStrictEqual(EMPTY_PROFILE);
      expect(readEnvelope()).toBeNull();
    },
  );

  test.each([
    [
      'etnia válida + aldeia preenchida',
      {ethnicGroupId: 'etnia-a', village: 'Aldeia X'},
      true,
    ],
    ['etnia nula', {ethnicGroupId: null, village: 'Aldeia X'}, false],
    [
      'etnia fora do catálogo',
      {ethnicGroupId: 'desconhecida', village: 'Aldeia X'},
      false,
    ],
    ['aldeia nula', {ethnicGroupId: 'etnia-a', village: null}, false],
    ['aldeia vazia', {ethnicGroupId: 'etnia-a', village: ''}, false],
    ['aldeia só com espaços', {ethnicGroupId: 'etnia-a', village: '   '}, false],
  ])('isProfileComplete: %s', (_nome, state, expected) => {
    expect(isProfileComplete(state, CATALOG)).toBe(expected);
  });

  test('hooks expõem estado e ações sob o provider', async () => {
    const store = createUserProfileStore({catalog: CATALOG});
    const wrapper = createWrapper(store);

    const stateHook = await renderHook(() => useUserProfileState(), {wrapper});
    const actionsHook = await renderHook(() => useUserProfileActions(), {
      wrapper,
    });

    expect(stateHook.result.current).toStrictEqual(EMPTY_PROFILE);

    await act(async () => {
      actionsHook.result.current.setEthnicGroup('etnia-b');
      actionsHook.result.current.setVillage('Aldeia W');
    });

    expect(stateHook.result.current).toStrictEqual({
      ethnicGroupId: 'etnia-b',
      village: 'Aldeia W',
    });
  });

  test('catálogo padrão é o ETHNIC_GROUPS', () => {
    const store = createUserProfileStore({persist: true});
    const [primeiraEtnia] = ETHNIC_GROUPS;

    store.actions.setEthnicGroup(primeiraEtnia!.id);

    expect(store.instance.getState().ethnicGroupId).toBe(primeiraEtnia!.id);
  });
});
