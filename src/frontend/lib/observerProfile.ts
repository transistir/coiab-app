import type {Observation} from '@comapeo/schema';

import type {UserProfileState} from '../contexts/UserProfileStoreContext';

/**
 * Chaves de tag da issue #133 (Opção C). O dado pertence ao observador que
 * criou a observação e replica como qualquer outra tag.
 */
export const OBSERVER_TAG_KEYS = {
  ethnicity: 'coiab:etnia',
  village: 'coiab:aldeia',
} as const;

const OBSERVER_TAG_KEY_VALUES: readonly string[] =
  Object.values(OBSERVER_TAG_KEYS);

function normalizedText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();

  return trimmed || null;
}

/**
 * Retrato do perfil no momento da criação. Valores vazios (ou só espaços) não
 * viram chave: nem `''` nem `null` chegam ao rascunho.
 */
export function observerTags(profile: UserProfileState): Observation['tags'] {
  const tags: Observation['tags'] = {};

  const ethnicity = normalizedText(profile.ethnicity);
  if (ethnicity !== null) {
    tags[OBSERVER_TAG_KEYS.ethnicity] = ethnicity;
  }

  const village = normalizedText(profile.village);
  if (village !== null) {
    tags[OBSERVER_TAG_KEYS.village] = village;
  }

  return tags;
}

/**
 * Normalização do commit (save): as pontas das duas chaves do observador são
 * aparadas e a chave que ficou vazia é removida. Espaços internos e todas as
 * demais tags permanecem intactos. Não muta o objeto recebido.
 */
export function normalizeObserverTags(
  tags: Observation['tags'],
): Observation['tags'] {
  const normalized: Observation['tags'] = {...tags};

  for (const key of OBSERVER_TAG_KEY_VALUES) {
    if (!(key in normalized)) {
      continue;
    }

    const value = normalizedText(normalized[key]);

    if (value === null) {
      delete normalized[key];
    } else {
      normalized[key] = value;
    }
  }

  return normalized;
}

/** True quando ao menos uma das chaves do observador tem valor não vazio. */
export function hasObserverTags(
  tags: Observation['tags'] | undefined,
): boolean {
  if (!tags) {
    return false;
  }

  return OBSERVER_TAG_KEY_VALUES.some(
    key => normalizedText(tags[key]) !== null,
  );
}
