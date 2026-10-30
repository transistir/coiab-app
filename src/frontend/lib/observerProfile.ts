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
 * Texto de apresentação de uma tag: aparado quando é string, `null` para
 * qualquer outro tipo (número, array, boolean). Usado na tela de observação;
 * não serve para o valor controlado de um `TextInput`, que precisa preservar o
 * texto cru enquanto o usuário digita.
 */
export function observerTagText(value: unknown): string | null {
  return normalizedText(value);
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
 * aparadas quando o valor é string e a chave que ficou vazia é removida.
 * Valor não-string (número, array, boolean) permanece intacto — nunca é
 * removido. Espaços internos e todas as demais tags também permanecem
 * intactos. Não muta o objeto recebido.
 */
export function normalizeObserverTags(
  tags: Observation['tags'],
): Observation['tags'] {
  const normalized: Observation['tags'] = {...tags};

  for (const key of OBSERVER_TAG_KEY_VALUES) {
    if (!(key in normalized)) {
      continue;
    }

    const raw = normalized[key];

    // Só string é aparada. Um valor não-string é preservado como veio.
    if (typeof raw !== 'string') {
      continue;
    }

    const value = raw.trim();

    if (value === '') {
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
