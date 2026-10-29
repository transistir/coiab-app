import {
  getEthnicitySuggestions,
  getTerritories,
  getVillageSuggestions,
  parseProfileCatalog,
} from './profileCatalog';

describe('parseProfileCatalog', () => {
  it('keeps valid territories and string lists', () => {
    const catalog = parseProfileCatalog({
      territories: [
        {
          id: '4999',
          name: 'Kaxuyana-Tunayana',
          states: 'PA, AM',
          legalStatus: 'Homologada',
          areaHa: 2183000,
          population: 841,
        },
      ],
      ethnicGroups: ['Tunayana', 'Mawayana'],
      villages: ['Aldeia X'],
    });

    expect(catalog.territories).toEqual([
      {
        id: '4999',
        name: 'Kaxuyana-Tunayana',
        states: 'PA, AM',
        legalStatus: 'Homologada',
        areaHa: 2183000,
        population: 841,
      },
    ]);
    expect(catalog.ethnicGroups).toEqual(['Tunayana', 'Mawayana']);
    expect(catalog.villages).toEqual(['Aldeia X']);
  });

  it('drops non-string, blank and duplicate entries without throwing', () => {
    const catalog = parseProfileCatalog({
      ethnicGroups: [
        'Tunayana',
        5,
        null,
        {name: 'X'},
        '   ',
        '  Tunayana  ',
        'tunayana',
        'Mawayana',
      ],
      villages: 'not-an-array',
    });

    expect(catalog.ethnicGroups).toEqual(['Tunayana', 'Mawayana']);
    expect(catalog.villages).toEqual([]);
  });

  it('drops territories with invalid fields or duplicated ids', () => {
    const catalog = parseProfileCatalog({
      territories: [
        {
          id: 'a',
          name: 'A',
          states: 'PA',
          legalStatus: 'Homologada',
          areaHa: 1,
          population: 2,
        },
        {
          id: 'a',
          name: 'Duplicada',
          states: 'PA',
          legalStatus: 'Homologada',
          areaHa: 1,
          population: 2,
        },
        {id: 'b', name: 'Sem números'},
        'not-an-object',
      ],
    });

    expect(catalog.territories.map(territory => territory.id)).toEqual(['a']);
  });

  it.each([
    ['invalid JSON text', '{chave: quebrada'],
    ['null', null],
    ['an array', []],
    ['a number', 7],
    ['an empty object', {}],
  ])('returns an empty catalog for %s', (_label, raw) => {
    expect(parseProfileCatalog(raw)).toEqual({
      territories: [],
      ethnicGroups: [],
      villages: [],
    });
  });
});

describe('getEthnicitySuggestions', () => {
  it('finds a real ethnic group without regard to case', () => {
    expect(getEthnicitySuggestions('kahyana')).toContain('Kahyana');
    expect(getEthnicitySuggestions('KAHYANA')).toEqual(['Kahyana']);
  });

  it('matches accent-insensitively against a real ethnic group', () => {
    // The query carries accents the dataset does not: normalization strips
    // them on both sides, so "KÁHYÁNA" still finds "Kahyana".
    expect(getEthnicitySuggestions('KÁHYÁNA')).toEqual(['Kahyana']);
    expect(getEthnicitySuggestions('katxuyána')).toContain('Katxuyana');
  });

  it('returns an empty list for an empty or whitespace query', () => {
    expect(getEthnicitySuggestions('')).toEqual([]);
    expect(getEthnicitySuggestions('   ')).toEqual([]);
  });

  it('returns at most 6 suggestions', () => {
    // "a" appears in more than six entries of the shipped catalog.
    expect(getEthnicitySuggestions('a').length).toBeLessThanOrEqual(6);
  });

  it('returns an empty list when nothing matches', () => {
    expect(getEthnicitySuggestions('zzzz')).toEqual([]);
  });
});

describe('getVillageSuggestions', () => {
  it('is empty because the ISA source lists no villages for this territory', () => {
    expect(getVillageSuggestions('aldeia')).toEqual([]);
    expect(getVillageSuggestions('')).toEqual([]);
  });
});

describe('getTerritories', () => {
  it('exposes the real Kaxuyana-Tunayana territory', () => {
    const territories = getTerritories();

    expect(territories).toHaveLength(1);
    expect(territories[0]).toMatchObject({
      id: '4999',
      name: 'Kaxuyana-Tunayana',
      states: 'PA, AM',
      legalStatus: 'Homologada',
      areaHa: 2183000,
      population: 841,
    });
  });
});
