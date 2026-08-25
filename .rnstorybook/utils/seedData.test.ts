import {selectPointPreset} from './seedData';
import type {Preset} from '@comapeo/schema';

/**
 * Only the fields `selectPointPreset` reads are meaningful here; the rest of
 * `Preset` is padded out so the fixtures type-check against the real schema.
 */
function preset(
  overrides: Partial<Preset> & Pick<Preset, 'name' | 'docId'>,
): Preset {
  return {
    geometry: ['point'],
    fieldRefs: [],
    ...overrides,
  } as Preset;
}

describe('selectPointPreset', () => {
  const air = preset({name: 'Air', docId: 'zzz', fieldRefs: [{docId: 'f1'}]});
  const animal = preset({
    name: 'Animal',
    docId: 'aaa',
    fieldRefs: [{docId: 'f2'}],
  });
  const water = preset({name: 'Water', docId: 'mmm'});

  it('picks the same preset regardless of the docIds a project run generates', () => {
    // docId is generated when a project's config is written, and every capture
    // run seeds a fresh project, so this is the exact axis that made the
    // "deterministic" preset differ on every run.
    const runOne = [
      preset({...air, docId: 'a-1'}),
      preset({...animal, docId: 'b-2'}),
      preset({...water, docId: 'c-3'}),
    ];
    const runTwo = [
      preset({...air, docId: 'z-9'}),
      preset({...animal, docId: 'y-8'}),
      preset({...water, docId: 'x-7'}),
    ];

    expect(selectPointPreset(runOne)?.name).toBe('Air');
    expect(selectPointPreset(runTwo)?.name).toBe('Air');
  });

  it('picks the same preset regardless of the order the API returns', () => {
    expect(selectPointPreset([air, animal, water])?.name).toBe('Air');
    expect(selectPointPreset([water, animal, air])?.name).toBe('Air');
    expect(selectPointPreset([animal, water, air])?.name).toBe('Air');
  });

  it('skips presets that cannot hold a point', () => {
    const areaOnly = preset({
      name: 'AAA area',
      docId: 'aaa',
      geometry: ['area'],
    });
    expect(selectPointPreset([areaOnly, air])?.name).toBe('Air');
  });

  it('skips presets without fields when fields are required', () => {
    const noFields = preset({name: 'AAA bare', docId: 'aaa'});
    expect(selectPointPreset([noFields, air])?.name).toBe('AAA bare');
    expect(
      selectPointPreset([noFields, air], {requireFields: true})?.name,
    ).toBe('Air');
  });

  it('breaks name ties on docId rather than on input order', () => {
    const first = preset({name: 'Same', docId: 'bbb'});
    const second = preset({name: 'Same', docId: 'aaa'});
    expect(selectPointPreset([first, second])?.docId).toBe('aaa');
    expect(selectPointPreset([second, first])?.docId).toBe('aaa');
  });

  it('returns undefined when nothing is eligible', () => {
    expect(selectPointPreset([])).toBeUndefined();
    expect(selectPointPreset([water], {requireFields: true})).toBeUndefined();
  });

  it('does not reorder the caller’s array', () => {
    const presets = [water, animal, air];
    selectPointPreset(presets);
    expect(presets.map(entry => entry.name)).toEqual([
      'Water',
      'Animal',
      'Air',
    ]);
  });
});
