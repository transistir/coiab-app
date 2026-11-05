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
  type PendingArchiveIntent,
  type UserProfileStore,
} from './UserProfileStoreContext';

const EMPTY_PROFILE = {
  ethnicity: null,
  village: null,
  coordinationRole: null,
  pendingArchives: [],
};

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

  test('setEthnicity e setVillage persistem o envelope {state, version: 6}', () => {
    const store = createUserProfileStore({persist: true});

    store.actions.setEthnicity('  Kaxuyana-Tunayana  ');
    store.actions.setVillage('  Aldeia X  ');

    expect(store.instance.getState()).toStrictEqual({
      ethnicity: 'Kaxuyana-Tunayana',
      village: 'Aldeia X',
      coordinationRole: null,
      pendingArchives: [],
    });
    expect(readEnvelope()).toStrictEqual({
      state: {
        ethnicity: 'Kaxuyana-Tunayana',
        village: 'Aldeia X',
        coordinationRole: null,
        pendingArchives: [],
      },
      version: 6,
    });
  });

  test('texto livre fora do dataset é aceito e persistido', () => {
    const store = createUserProfileStore({persist: true});

    store.actions.setEthnicity('Etnia que não está no catálogo');
    store.actions.setVillage('Aldeia inventada pela comunidade');

    expect(store.instance.getState()).toStrictEqual({
      ethnicity: 'Etnia que não está no catálogo',
      village: 'Aldeia inventada pela comunidade',
      coordinationRole: null,
      pendingArchives: [],
    });
    expect(readEnvelope()?.state).toStrictEqual({
      ethnicity: 'Etnia que não está no catálogo',
      village: 'Aldeia inventada pela comunidade',
      coordinationRole: null,
      pendingArchives: [],
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
      coordinationRole: null,
      pendingArchives: [],
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
      state: {
        ethnicity: 'Tunayana',
        village: null,
        coordinationRole: null,
        pendingArchives: [],
      },
      version: 6,
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
      {
        state: {
          ethnicity: 'Tunayana',
          village: 'Aldeia X',
          coordinationRole: null,
        },
        version: 7,
      },
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
      coordinationRole: null,
      pendingArchives: [],
    });
  });

  test('envelope v3 reidrata o papel e pendingArchives vazio', () => {
    writeRaw(
      persistedRaw({
        state: {
          ethnicity: 'Tunayana',
          village: 'Aldeia X',
          coordinationRole: 'coordinator',
        },
        version: 3,
      }),
    );

    expect(
      createUserProfileStore({persist: true}).instance.getState(),
    ).toStrictEqual({
      ethnicity: 'Tunayana',
      village: 'Aldeia X',
      coordinationRole: 'coordinator',
      pendingArchives: [],
    });
  });

  test('setCoordinationRole persiste o papel no envelope v6', () => {
    const store = createUserProfileStore({persist: true});

    store.actions.setCoordinationRole('coordinator');

    expect(store.instance.getState().coordinationRole).toBe('coordinator');
    expect(readEnvelope()).toStrictEqual({
      state: {
        ethnicity: null,
        village: null,
        coordinationRole: 'coordinator',
        pendingArchives: [],
      },
      version: 6,
    });

    // The persisted role is what a new instance hydrates.
    expect(
      createUserProfileStore({persist: true}).instance.getState()
        .coordinationRole,
    ).toBe('coordinator');
  });

  test('addPendingArchiveIntent persiste a lista por id e update/remove são funcionais', () => {
    const store = createUserProfileStore({persist: true});

    const a: PendingArchiveIntent = {
      id: 'intent-a',
      url: 'https://exemplo.org/',
      organizationId: null,
      createdAt: 1_000,
      sendingSince: null,
      appliedFor: null,
    };
    store.actions.addPendingArchiveIntent(a);

    expect(store.instance.getState().pendingArchives).toStrictEqual([a]);
    expect(readEnvelope()).toStrictEqual({
      state: {
        ethnicity: null,
        village: null,
        coordinationRole: null,
        pendingArchives: [a],
      },
      version: 6,
    });

    const reidratado = createUserProfileStore({persist: true});
    expect(reidratado.instance.getState().pendingArchives).toStrictEqual([a]);

    store.actions.updatePendingArchiveIntent('intent-a', {
      organizationId: 'org-1',
      sendingSince: 2_000,
    });
    expect(store.instance.getState().pendingArchives[0]).toStrictEqual({
      ...a,
      organizationId: 'org-1',
      sendingSince: 2_000,
    });

    store.actions.removePendingArchiveIntent('intent-a');
    expect(store.instance.getState().pendingArchives).toStrictEqual([]);
    expect(
      createUserProfileStore({persist: true}).instance.getState()
        .pendingArchives,
    ).toStrictEqual([]);
  });

  test('conclusão antiga não apaga o intent criado depois (P1-B)', () => {
    const store = createUserProfileStore({persist: true});
    store.actions.addPendingArchiveIntent({
      id: 'intent-a',
      url: 'https://a.example/',
    });
    // B is created while A is still in flight.
    store.actions.addPendingArchiveIntent({
      id: 'intent-b',
      url: 'https://b.example/',
    });

    // A completes: only the addressed id is touched.
    store.actions.updatePendingArchiveIntent('intent-a', {
      appliedFor: 'org-a',
    });
    store.actions.removePendingArchiveIntent('intent-a');

    expect(
      store.instance.getState().pendingArchives.map(intent => intent.id),
    ).toEqual(['intent-b']);
  });

  test('envelope v4 hidrata lista vazia e ignora pendingArchiveUrl', () => {
    writeRaw(
      persistedRaw({
        state: {
          ethnicity: 'Tunayana',
          village: 'Aldeia X',
          coordinationRole: 'coordinator',
          pendingArchiveUrl: 'https://legado.example/',
        },
        version: 4,
      }),
    );

    expect(
      createUserProfileStore({persist: true}).instance.getState(),
    ).toStrictEqual({
      ethnicity: 'Tunayana',
      village: 'Aldeia X',
      coordinationRole: 'coordinator',
      pendingArchives: [],
    });
  });

  test('envelope v5 (intent único) hidrata lista vazia, sem migração', () => {
    writeRaw(
      persistedRaw({
        state: {
          ethnicity: 'Tunayana',
          village: 'Aldeia X',
          coordinationRole: null,
          pendingArchive: {
            url: 'https://legado.example/',
            organizationId: 'org-legada',
            appliedFor: null,
          },
        },
        version: 5,
      }),
    );

    expect(
      createUserProfileStore({persist: true}).instance.getState(),
    ).toStrictEqual({
      ethnicity: 'Tunayana',
      village: 'Aldeia X',
      coordinationRole: null,
      pendingArchives: [],
    });
  });

  test.each([
    ['lista não-array', 'x'],
    ['item não-objeto', ['x']],
    ['id ausente', [{url: 'https://exemplo.org/', createdAt: 1}]],
    ['url vazia', [{id: 'a', url: '   ', createdAt: 1}]],
    ['url numérica', [{id: 'a', url: 7, createdAt: 1}]],
    ['createdAt inválido', [{id: 'a', url: 'https://exemplo.org/'}]],
    [
      'organizationId numérico',
      [
        {
          id: 'a',
          url: 'https://exemplo.org/',
          organizationId: 7,
          createdAt: 1,
        },
      ],
    ],
    [
      'appliedFor numérico',
      [
        {
          id: 'a',
          url: 'https://exemplo.org/',
          appliedFor: 7,
          createdAt: 1,
        },
      ],
    ],
    [
      'sendingSince string',
      [
        {
          id: 'a',
          url: 'https://exemplo.org/',
          sendingSince: 'agora',
          createdAt: 1,
        },
      ],
    ],
  ])(
    'pendingArchives inválido no envelope v6 (%s) hidrata vazio',
    (_nome, pendingArchives) => {
      writeRaw(
        persistedRaw({
          state: {
            ethnicity: 'Tunayana',
            village: 'Aldeia X',
            coordinationRole: null,
            pendingArchives,
          },
          version: 6,
        }),
      );

      expect(
        createUserProfileStore({persist: true}).instance.getState(),
      ).toStrictEqual(EMPTY_PROFILE);
    },
  );

  test('papel inválido no envelope v3 hidrata o perfil vazio', () => {
    writeRaw(
      persistedRaw({
        state: {
          ethnicity: 'Tunayana',
          village: 'Aldeia X',
          coordinationRole: 'chief',
        },
        version: 3,
      }),
    );

    expect(
      createUserProfileStore({persist: true}).instance.getState(),
    ).toStrictEqual(EMPTY_PROFILE);
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
      {
        ethnicity: 'Tunayana',
        village: 'Aldeia X',
        coordinationRole: null,
        pendingArchives: [],
      },
      true,
    ],
    [
      'etnia nula',
      {
        ethnicity: null,
        village: 'Aldeia X',
        coordinationRole: null,
        pendingArchives: [],
      },
      false,
    ],
    [
      'etnia vazia',
      {
        ethnicity: '',
        village: 'Aldeia X',
        coordinationRole: null,
        pendingArchives: [],
      },
      false,
    ],
    [
      'etnia só com espaços',
      {
        ethnicity: '   ',
        village: 'Aldeia X',
        coordinationRole: null,
        pendingArchives: [],
      },
      false,
    ],
    [
      'aldeia nula',
      {
        ethnicity: 'Tunayana',
        village: null,
        coordinationRole: null,
        pendingArchives: [],
      },
      false,
    ],
    [
      'aldeia vazia',
      {
        ethnicity: 'Tunayana',
        village: '',
        coordinationRole: null,
        pendingArchives: [],
      },
      false,
    ],
    [
      'aldeia só com espaços',
      {
        ethnicity: 'Tunayana',
        village: '   ',
        coordinationRole: null,
        pendingArchives: [],
      },
      false,
    ],
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
      coordinationRole: null,
      pendingArchives: [],
    });
  });
});
