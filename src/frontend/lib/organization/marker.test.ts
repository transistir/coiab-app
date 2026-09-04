import {isInternalOrgProject, markerFor, parseMarker} from './marker';

const ORG_ID = 'a1b2c3d4e5f60718';

describe('markerFor', () => {
  it('builds a 5-segment marker with an encoded name', () => {
    expect(markerFor(ORG_ID, 'm', 'Acme')).toBe(
      `coiab-org:v1:${ORG_ID}:m:Acme`,
    );
  });

  it('encodes the name so it never contains a literal colon', () => {
    const marker = markerFor(ORG_ID, 'a', 'Assentamento: Zênite');
    expect(marker).not.toContain('Assentamento:');
    expect(marker.split(':')).toHaveLength(5);
  });

  it('throws on an empty or whitespace-only name', () => {
    expect(() => markerFor(ORG_ID, 'm', '')).toThrow();
    expect(() => markerFor(ORG_ID, 'm', '   ')).toThrow();
  });

  it('throws on an organization id that is not 16 lowercase hex chars', () => {
    expect(() => markerFor('a1b2c3d4e5f6071', 'm', 'Acme')).toThrow();
    expect(() => markerFor('a1b2c3d4e5f607180', 'm', 'Acme')).toThrow();
    expect(() => markerFor('A1B2C3D4E5F60718', 'm', 'Acme')).toThrow();
    expect(() => markerFor('zzzzzzzzzzzzzzzz', 'm', 'Acme')).toThrow();
  });
});

describe('parseMarker', () => {
  it('round-trips names with spaces, colons, and unicode', () => {
    for (const name of [
      'Acme',
      'Assentamento Zênite',
      'a:b',
      'Espaço Duplo  Nome',
      ' Организация ',
    ]) {
      const marker = parseMarker(markerFor(ORG_ID, 'm', name));
      expect(marker).toEqual({
        organizationId: ORG_ID,
        slot: 'm',
        organizationName: name,
      });
    }
  });

  it('rejects a wrong prefix and a wrong version', () => {
    expect(parseMarker(`coiab-x:v1:${ORG_ID}:m:Acme`)).toBeUndefined();
    expect(parseMarker(`coiab-org:v2:${ORG_ID}:m:Acme`)).toBeUndefined();
  });

  it('rejects 4 and 6 segments (a colon in the name breaks the split)', () => {
    expect(parseMarker(`coiab-org:v1:${ORG_ID}:m`)).toBeUndefined();
    expect(parseMarker(`coiab-org:v1:${ORG_ID}:m:Acme:extra`)).toBeUndefined();
    // A raw unencoded colon in the name yields 6 segments → rejected.
    expect(
      parseMarker(`coiab-org:v1:${ORG_ID}:m:Assentamento: Zênite`),
    ).toBeUndefined();
  });

  it('rejects organization ids that are not exactly 16 lowercase hex chars', () => {
    expect(parseMarker(`coiab-org:v1:a1b2c3d4e5f6071:m:Acme`)).toBeUndefined();
    expect(
      parseMarker(`coiab-org:v1:a1b2c3d4e5f607180:m:Acme`),
    ).toBeUndefined();
    expect(parseMarker(`coiab-org:v1:A1B2C3D4E5F60718:m:Acme`)).toBeUndefined();
    expect(parseMarker(`coiab-org:v1:zzzzzzzzzzzzzzzz:m:Acme`)).toBeUndefined();
  });

  it('rejects an unknown slot', () => {
    expect(parseMarker(`coiab-org:v1:${ORG_ID}:x:Acme`)).toBeUndefined();
    expect(
      parseMarker(`coiab-org:v1:${ORG_ID}:monitoramento:Acme`),
    ).toBeUndefined();
  });

  it('rejects invalid percent-encoding in the name', () => {
    expect(parseMarker(`coiab-org:v1:${ORG_ID}:m:%E0%A4%A`)).toBeUndefined();
  });

  it('rejects an empty name (nothing emits a nameless marker)', () => {
    expect(parseMarker(`coiab-org:v1:${ORG_ID}:m:`)).toBeUndefined();
  });

  it('rejects a whitespace-only name (symmetry with markerFor)', () => {
    expect(parseMarker(`coiab-org:v1:${ORG_ID}:m:%20%20`)).toBeUndefined();
  });
});

describe('isInternalOrgProject', () => {
  it('is true only for descriptions holding a valid marker', () => {
    expect(isInternalOrgProject(markerFor(ORG_ID, 'm', 'Acme'))).toBe(true);
    expect(isInternalOrgProject(markerFor(ORG_ID, 'a', 'Acme'))).toBe(true);
    expect(isInternalOrgProject(undefined)).toBe(false);
    expect(isInternalOrgProject('')).toBe(false);
    expect(isInternalOrgProject('Plano de manejo')).toBe(false);
    expect(isInternalOrgProject(`coiab-org:v2:${ORG_ID}:m:Acme`)).toBe(false);
  });
});
