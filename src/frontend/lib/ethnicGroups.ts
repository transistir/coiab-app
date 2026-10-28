import json from './territories.json';

export type EthnicGroup = {id: string; name: string};

/**
 * Valida o catálogo local de etnias.
 *
 * A raiz precisa ser um objeto com `ethnicGroups` em formato de array; chaves
 * extras (ex.: `territories`, prevista para a #129) são ignoradas. Entradas que
 * não sejam objeto, com `id`/`name` não-string ou vazios após trim são
 * descartadas, assim como `id` e `name` duplicados — `SelectOne` usa o label
 * (nome) como key.
 */
export function parseEthnicGroupCatalog(raw: unknown): EthnicGroup[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return [];
  }

  const entries = (raw as {ethnicGroups?: unknown}).ethnicGroups;

  if (!Array.isArray(entries)) {
    return [];
  }

  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const groups: EthnicGroup[] = [];

  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      continue;
    }

    const {id, name} = entry as {id?: unknown; name?: unknown};

    if (typeof id !== 'string' || typeof name !== 'string') {
      continue;
    }

    const trimmedId = id.trim();
    const trimmedName = name.trim();

    if (!trimmedId || !trimmedName) {
      continue;
    }

    if (seenIds.has(trimmedId) || seenNames.has(trimmedName)) {
      continue;
    }

    seenIds.add(trimmedId);
    seenNames.add(trimmedName);
    groups.push({id: trimmedId, name: trimmedName});
  }

  return groups;
}

export const ETHNIC_GROUPS = parseEthnicGroupCatalog(json);
