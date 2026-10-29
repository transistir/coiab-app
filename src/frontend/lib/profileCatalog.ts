import json from './territories.json';

/**
 * Catálogo local de apoio ao onboarding (#128/#129): territórios, etnias e
 * aldeias vêm do dataset embarcado. Etnia e aldeia são texto livre — o
 * catálogo só alimenta o autocomplete, nunca valida o que foi digitado.
 */

export type Territory = {
  id: string;
  name: string;
  states: string;
  legalStatus: string;
  areaHa: number;
  population: number;
};

export type ProfileCatalog = {
  territories: Territory[];
  ethnicGroups: string[];
  villages: string[];
};

const MAX_SUGGESTIONS = 6;

/** Remove acentos e caixa para comparar "Kaxuyana" com "kaxuyána". */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Lista tolerante de strings: chave ausente, item não-string, vazio e duplicata são ignorados. */
function parseStringList(entries: unknown): string[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  const seen = new Set<string>();
  const values: string[] = [];

  for (const entry of entries) {
    if (typeof entry !== 'string') {
      continue;
    }

    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }

    const key = normalize(trimmed);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    values.push(trimmed);
  }

  return values;
}

function parseTerritories(entries: unknown): Territory[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  const seenIds = new Set<string>();
  const territories: Territory[] = [];

  for (const entry of entries) {
    if (!isRecord(entry)) {
      continue;
    }

    const {id, name, states, legalStatus, areaHa, population} = entry;

    if (
      typeof id !== 'string' ||
      typeof name !== 'string' ||
      typeof states !== 'string' ||
      typeof legalStatus !== 'string' ||
      typeof areaHa !== 'number' ||
      typeof population !== 'number'
    ) {
      continue;
    }

    const trimmedId = id.trim();
    const trimmedName = name.trim();

    if (!trimmedId || !trimmedName) {
      continue;
    }

    if (seenIds.has(trimmedId)) {
      continue;
    }

    seenIds.add(trimmedId);
    territories.push({
      id: trimmedId,
      name: trimmedName,
      states: states.trim(),
      legalStatus: legalStatus.trim(),
      areaHa,
      population,
    });
  }

  return territories;
}

/**
 * Parser tolerante do dataset. Qualquer entrada que não seja um objeto com as
 * chaves esperadas resulta no catálogo vazio (ou naquela chave vazia); nunca
 * lança, mesmo recebendo JSON inválido já convertido em string.
 */
export function parseProfileCatalog(raw: unknown): ProfileCatalog {
  if (!isRecord(raw)) {
    return {territories: [], ethnicGroups: [], villages: []};
  }

  return {
    territories: parseTerritories(raw.territories),
    ethnicGroups: parseStringList(raw.ethnicGroups),
    villages: parseStringList(raw.villages),
  };
}

const CATALOG = parseProfileCatalog(json);

function suggest(values: ReadonlyArray<string>, query: string): string[] {
  const needle = normalize(query.trim());

  if (!needle) {
    return [];
  }

  return values
    .filter(value => normalize(value).includes(needle))
    .slice(0, MAX_SUGGESTIONS);
}

/** Sugestões de etnia: texto livre, filtro sem acento/caixa, no máximo 6. */
export function getEthnicitySuggestions(query: string): string[] {
  return suggest(CATALOG.ethnicGroups, query);
}

/** Sugestões de aldeia: mesma regra, sobre o dataset local (vazio por ora). */
export function getVillageSuggestions(query: string): string[] {
  return suggest(CATALOG.villages, query);
}

/** Territórios do dataset real (usados pela #129 e por relatórios locais). */
export function getTerritories(): Territory[] {
  return CATALOG.territories;
}
