import {
  ETHNIC_GROUPS,
  parseEthnicGroupCatalog,
  type EthnicGroup,
} from './ethnicGroups';

describe('parseEthnicGroupCatalog', () => {
  it('parses valid entries and drops invalid ones', () => {
    const result = parseEthnicGroupCatalog({
      ethnicGroups: [
        {id: 'a', name: 'A'},
        'not-an-object',
        null,
        {id: '', name: 'B'},
        {id: '   ', name: 'C'},
        {id: 'd', name: 5},
        {id: 'e'},
        {id: 'f', name: ''},
        {id: 'g', name: '   '},
      ],
    });

    expect(result).toEqual([{id: 'a', name: 'A'}]);
  });

  it('drops entries with duplicated id', () => {
    const result = parseEthnicGroupCatalog({
      ethnicGroups: [
        {id: 'a', name: 'A'},
        {id: 'a', name: 'Another A'},
        {id: 'b', name: 'B'},
      ],
    });

    expect(result).toEqual([
      {id: 'a', name: 'A'},
      {id: 'b', name: 'B'},
    ]);
  });

  it('drops entries with duplicated name', () => {
    const result = parseEthnicGroupCatalog({
      ethnicGroups: [
        {id: 'a', name: 'A'},
        {id: 'b', name: 'A'},
        {id: 'c', name: 'C'},
      ],
    });

    expect(result).toEqual([
      {id: 'a', name: 'A'},
      {id: 'c', name: 'C'},
    ]);
  });

  it('ignores extra root keys such as territories', () => {
    const result = parseEthnicGroupCatalog({
      territories: [{id: 't', name: 'T'}],
      ethnicGroups: [{id: 'a', name: 'A'}],
    });

    expect(result).toEqual([{id: 'a', name: 'A'}]);
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'x'],
    ['an empty object', {}],
    ['a non-array ethnicGroups', {ethnicGroups: 5}],
  ])('returns an empty array for %s', (_label, raw) => {
    expect(parseEthnicGroupCatalog(raw)).toEqual([]);
  });
});

describe('ETHNIC_GROUPS', () => {
  it('ships at least one ethnic group', () => {
    expect(ETHNIC_GROUPS.length).toBeGreaterThan(0);
  });

  it('has unique ids and names', () => {
    const ids = new Set(ETHNIC_GROUPS.map((group: EthnicGroup) => group.id));
    const names = new Set(
      ETHNIC_GROUPS.map((group: EthnicGroup) => group.name),
    );

    expect(ids.size).toBe(ETHNIC_GROUPS.length);
    expect(names.size).toBe(ETHNIC_GROUPS.length);
  });
});
