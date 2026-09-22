import {
  buildOrganizationDocument,
  matchSeedIndex,
  selectPointPreset,
  selectSeedPosition,
  seededAreas,
  selectSeedPresets,
} from './seedData';
import {
  classificarDocumento,
  derivarProjectIdAtivo,
  organizacaoEmPreparo,
  ordenarOrganizacoes,
  parseEstadoOrganizacoes,
} from '../../src/frontend/lib/organization/coiabOrganizations';
import type {Preset} from '@comapeo/schema';
import type {BBox} from 'geojson';

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

describe('selectSeedPresets', () => {
  const air = preset({name: 'Air', docId: 'zzz'});
  const animal = preset({name: 'Animal', docId: 'aaa'});
  const water = preset({name: 'Water', docId: 'mmm'});

  it('is deterministic: repeated calls with the same inputs return the same presets', () => {
    const first = selectSeedPresets([water, animal, air], 5);
    const second = selectSeedPresets([air, water, animal], 5);
    expect(second.map(p => p.name)).toEqual(first.map(p => p.name));
    expect(first.map(p => p.name)).toEqual([
      'Air',
      'Animal',
      'Water',
      'Air',
      'Animal',
    ]);
  });

  it('produces observations that differ from each other when enough presets are eligible', () => {
    const selected = selectSeedPresets([water, animal, air], 3);
    const names = new Set(selected.map(p => p.name));
    expect(names.size).toBe(3);
  });

  it('wraps around the name-sorted list when there are fewer presets than observations', () => {
    const selected = selectSeedPresets([animal], 3);
    expect(selected.map(p => p.name)).toEqual(['Animal', 'Animal', 'Animal']);
  });

  it('offsets by existingCount so a second seeding pass continues the rotation', () => {
    const firstBatch = selectSeedPresets([water, animal, air], 2);
    const secondBatch = selectSeedPresets([water, animal, air], 1, {
      existingCount: 2,
    });
    expect(firstBatch.map(p => p.name)).toEqual(['Air', 'Animal']);
    expect(secondBatch.map(p => p.name)).toEqual(['Water']);
  });

  it('returns an empty array when there are no presets to choose from', () => {
    expect(selectSeedPresets([], 5)).toEqual([]);
  });
});

describe('selectSeedPosition', () => {
  const bbox: BBox = [-79, -1, -78, 0];

  it('is deterministic: the same index always returns the same coordinates', () => {
    expect(selectSeedPosition(bbox, 2)).toEqual(selectSeedPosition(bbox, 2));
  });

  it('keeps every generated position inside the bbox', () => {
    const [minLon, minLat, maxLon, maxLat] = bbox;
    for (let i = 0; i < 20; i++) {
      const {lon, lat} = selectSeedPosition(bbox, i);
      expect(lon).toBeGreaterThanOrEqual(minLon);
      expect(lon).toBeLessThanOrEqual(maxLon);
      expect(lat).toBeGreaterThanOrEqual(minLat);
      expect(lat).toBeLessThanOrEqual(maxLat);
    }
  });

  it('spreads consecutive indices to distinct positions', () => {
    const positions = Array.from({length: 5}, (_, i) =>
      selectSeedPosition(bbox, i),
    );
    const unique = new Set(positions.map(p => `${p.lon},${p.lat}`));
    expect(unique.size).toBe(positions.length);
  });
});

describe('matchSeedIndex', () => {
  const bbox: BBox = [-79, -1, -78, 0];

  it('recovers the index of every generated seed position', () => {
    for (let i = 0; i < 10; i++) {
      const {lon, lat} = selectSeedPosition(bbox, i);
      expect(matchSeedIndex({lat, lon}, bbox, 12)).toBe(i);
    }
  });

  it('sorts off-sequence positions and missing coordinates after seeded ones', () => {
    const seeded = selectSeedPosition(bbox, 3);
    expect(
      matchSeedIndex({lat: seeded.lat + 0.5, lon: seeded.lon}, bbox, 12),
    ).toBe(Number.MAX_SAFE_INTEGER);
    expect(matchSeedIndex({lat: null, lon: null}, bbox, 12)).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  it('never matches a position beyond maxIndex', () => {
    const beyond = selectSeedPosition(bbox, 7);
    expect(matchSeedIndex({lat: beyond.lat, lon: beyond.lon}, bbox, 5)).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });
});

describe('buildOrganizationDocument', () => {
  const organizationA = {id: 'aaaaaaaaaaaaaaaa', name: 'Test Organization A'};
  const organizationB = {id: 'bbbbbbbbbbbbbbbb', name: 'Test Organization B'};
  const projectIds = new Map([
    [organizationA.id, {monitoramento: 'project-a-m', alertas: 'project-a-a'}],
    [organizationB.id, {monitoramento: 'project-b-m', alertas: 'project-b-a'}],
  ]);
  const seed = {
    list: [organizationA, organizationB],
    activeId: organizationB.id,
  };

  it('builds a document the app parses as fully open', () => {
    const document = buildOrganizationDocument(seed, projectIds);

    expect(parseEstadoOrganizacoes(document)).not.toBeNull();
    expect(classificarDocumento(document)).toBe('pronta');
    expect(derivarProjectIdAtivo(document)).toBe('project-b-m');
  });

  it('gives the selector two activatable rows, the active one first although it sorts second', () => {
    expect(
      ordenarOrganizacoes(buildOrganizationDocument(seed, projectIds)),
    ).toEqual([
      {
        id: organizationB.id,
        rotulo: 'Test Organization B',
        atual: true,
        ativavel: true,
      },
      {
        id: organizationA.id,
        rotulo: 'Test Organization A',
        atual: false,
        ativavel: true,
      },
    ]);
  });

  it('refuses an active id that is not one of the organizations', () => {
    expect(() =>
      buildOrganizationDocument(
        {...seed, activeId: 'cccccccccccccccc'},
        projectIds,
      ),
    ).toThrow(/not a valid COIAB document/);
  });

  it('refuses an organization without seeded projects', () => {
    expect(() =>
      buildOrganizationDocument(seed, new Map([...projectIds].slice(0, 1))),
    ).toThrow(/has no seeded projects/);
  });

  it('refuses a project shared by two organizations', () => {
    expect(() =>
      buildOrganizationDocument(
        seed,
        new Map([
          ...projectIds,
          [
            organizationB.id,
            {monitoramento: 'project-a-m', alertas: 'project-b-a'},
          ],
        ]),
      ),
    ).toThrow(/not a valid COIAB document/);
  });

  describe('with one organization still being prepared', () => {
    const preparingSeed = {
      list: [organizationA, {...organizationB, preparing: 'alertas' as const}],
      activeId: organizationA.id,
    };

    it('keeps the ready one open and the other mid-materialization on its area in execution', () => {
      const document = buildOrganizationDocument(preparingSeed, projectIds);

      expect(parseEstadoOrganizacoes(document)).not.toBeNull();
      expect(classificarDocumento(document)).toBe('preparando');
      expect(derivarProjectIdAtivo(document)).toBe('project-a-m');
      expect(organizacaoEmPreparo(document)).toEqual({
        id: organizationB.id,
        nome: 'Test Organization B',
        estado: 'preparando',
        confirmacaoPendente: false,
        materializacao: {
          monitoramento: {
            etapa: 'verificado',
            projectId: 'project-b-m',
            template: {versao: '1', hash: 'monitoramento'},
            idsAntesDaCriacao: null,
          },
          alertas: {
            etapa: 'importando',
            projectId: 'project-b-a',
            template: {versao: '1', hash: 'alertas'},
            idsAntesDaCriacao: null,
          },
        },
        areaEmExecucao: 'alertas',
        ultimoErro: null,
      });
    });

    it('leaves the areas after the one in execution absent, without a project', () => {
      const document = buildOrganizationDocument(
        {
          list: [
            organizationA,
            {...organizationB, preparing: 'monitoramento' as const},
          ],
          activeId: organizationA.id,
        },
        new Map([
          ...projectIds,
          [organizationB.id, {monitoramento: 'project-b-m'}],
        ]),
      );

      const preparing = organizacaoEmPreparo(document)!;
      expect(preparing.areaEmExecucao).toBe('monitoramento');
      expect(preparing.materializacao.monitoramento.etapa).toBe('importando');
      expect(preparing.materializacao.alertas).toEqual({
        etapa: 'ausente',
        projectId: null,
        template: null,
        idsAntesDaCriacao: null,
      });
      expect(parseEstadoOrganizacoes(document)).not.toBeNull();
    });

    it('links projects only for the areas the materializer reached', () => {
      expect(seededAreas(organizationA)).toEqual(['monitoramento', 'alertas']);
      expect(seededAreas({...organizationB, preparing: 'alertas'})).toEqual([
        'monitoramento',
        'alertas',
      ]);
      expect(
        seededAreas({...organizationB, preparing: 'monitoramento'}),
      ).toEqual(['monitoramento']);
    });

    it('refuses to make the organization being prepared the active one', () => {
      expect(() =>
        buildOrganizationDocument(
          {...preparingSeed, activeId: organizationB.id},
          projectIds,
        ),
      ).toThrow(/not a valid COIAB document/);
    });

    it('refuses more than one organization being prepared', () => {
      expect(() =>
        buildOrganizationDocument(
          {
            list: [
              {...organizationA, preparing: 'alertas' as const},
              {...organizationB, preparing: 'alertas' as const},
            ],
            activeId: organizationA.id,
          },
          projectIds,
        ),
      ).toThrow(/at most one organization being prepared/);
    });
  });
});
