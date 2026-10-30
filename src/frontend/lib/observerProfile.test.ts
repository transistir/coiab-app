import type {Observation} from '@comapeo/schema';

import type {UserProfileState} from '../contexts/UserProfileStoreContext';
import {
  OBSERVER_TAG_KEYS,
  hasObserverTags,
  normalizeObserverTags,
  observerTags,
} from './observerProfile';

function profile(
  ethnicity: string | null,
  village: string | null,
): UserProfileState {
  return {ethnicity, village};
}

describe('OBSERVER_TAG_KEYS', () => {
  test('usa as chaves de tag canônicas da issue #133', () => {
    expect(OBSERVER_TAG_KEYS).toStrictEqual({
      ethnicity: 'coiab:etnia',
      village: 'coiab:aldeia',
    });
  });
});

describe('observerTags()', () => {
  test('perfil completo gera as duas tags aparadas', () => {
    expect(
      observerTags(profile('  Mawayana  ', '  Aldeia Nova  ')),
    ).toStrictEqual({
      'coiab:etnia': 'Mawayana',
      'coiab:aldeia': 'Aldeia Nova',
    });
  });

  test('espaço interno é preservado no valor da tag', () => {
    expect(observerTags(profile('Kaxuyana', 'Aldeia Nova'))).toStrictEqual({
      'coiab:etnia': 'Kaxuyana',
      'coiab:aldeia': 'Aldeia Nova',
    });
  });

  test('perfil parcial gera só a tag preenchida', () => {
    expect(observerTags(profile('Mawayana', null))).toStrictEqual({
      'coiab:etnia': 'Mawayana',
    });
    expect(observerTags(profile(null, 'Aldeia Y'))).toStrictEqual({
      'coiab:aldeia': 'Aldeia Y',
    });
  });

  test('perfil vazio ou só com espaços não gera nenhuma tag', () => {
    expect(observerTags(profile(null, null))).toStrictEqual({});
    expect(observerTags(profile('', '   '))).toStrictEqual({});
  });

  test('nunca cria chave com valor vazio', () => {
    const tags = observerTags(profile('  ', null));
    expect(tags).not.toHaveProperty('coiab:etnia');
    expect(Object.values(tags)).not.toContain('');
  });
});

describe('normalizeObserverTags()', () => {
  test('apara as pontas das duas chaves do observador', () => {
    expect(
      normalizeObserverTags({
        'coiab:etnia': '  Mawayana  ',
        'coiab:aldeia': '\tAldeia Nova\n',
      }),
    ).toStrictEqual({
      'coiab:etnia': 'Mawayana',
      'coiab:aldeia': 'Aldeia Nova',
    });
  });

  test('preserva espaço interno durante a normalização', () => {
    expect(
      normalizeObserverTags({'coiab:aldeia': '  Aldeia Nova  '}),
    ).toStrictEqual({'coiab:aldeia': 'Aldeia Nova'});
  });

  test('remove a chave que ficou vazia', () => {
    expect(
      normalizeObserverTags({
        notes: 'observação',
        'coiab:etnia': '   ',
        'coiab:aldeia': '',
      }),
    ).toStrictEqual({notes: 'observação'});
  });

  test('preserva todas as demais tags intactas', () => {
    const tags: Observation['tags'] = {
      notes: 'nota',
      categoria: 'pesca',
      contagem: 3,
      marcadores: ['a', 'b'],
      'coiab:etnia': ' Mawayana ',
    };

    expect(normalizeObserverTags(tags)).toStrictEqual({
      notes: 'nota',
      categoria: 'pesca',
      contagem: 3,
      marcadores: ['a', 'b'],
      'coiab:etnia': 'Mawayana',
    });
  });

  test('não muta o objeto de tags original', () => {
    const tags: Observation['tags'] = {'coiab:etnia': '  Mawayana  '};
    normalizeObserverTags(tags);
    expect(tags['coiab:etnia']).toBe('  Mawayana  ');
  });
});

describe('hasObserverTags()', () => {
  test('true quando só etnia está presente e não vazia', () => {
    expect(hasObserverTags({'coiab:etnia': 'Mawayana'})).toBe(true);
  });

  test('true quando só aldeia está presente e não vazia', () => {
    expect(hasObserverTags({'coiab:aldeia': 'Aldeia X'})).toBe(true);
  });

  test('false quando nenhuma das chaves existe', () => {
    expect(hasObserverTags({notes: 'nota'})).toBe(false);
    expect(hasObserverTags({})).toBe(false);
  });

  test('false quando as chaves estão vazias ou só com espaços', () => {
    expect(hasObserverTags({'coiab:etnia': '', 'coiab:aldeia': '   '})).toBe(
      false,
    );
  });
});
