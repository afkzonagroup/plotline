// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { convert, validate } from '../src/core/api.js';
import { decodeUtf8, detectFormat, readInput } from '../src/core/input.js';
import { DEFAULT_LIMITS } from '../src/core/limits.js';
import { detectDelimiter, parseCsv } from '../src/core/read-csv.js';
import { parseXml } from '../src/core/read-kml.js';

const csv = (text: string): ReturnType<typeof validate> => validate(text, { format: 'csv' });
const kml = (text: string): ReturnType<typeof validate> => validate(text, { format: 'kml' });

describe('format detection and decoding', () => {
  it('detects by extension, then by content', () => {
    expect(detectFormat('a.GeoJSON', '')).toBe('geojson');
    expect(detectFormat('a.json', '')).toBe('geojson');
    expect(detectFormat('a.kml', '')).toBe('kml');
    expect(detectFormat('a.tsv', '')).toBe('csv');
    expect(detectFormat(undefined, '  {"type":1}')).toBe('geojson');
    expect(detectFormat(undefined, '\n<kml/>')).toBe('kml');
    expect(detectFormat(undefined, 'lon,lat')).toBe('csv');
  });

  it('rejects invalid UTF-8 and accepts a byte-order mark', () => {
    expect(decodeUtf8(new Uint8Array([0xc3, 0x28]))).toBeNull();
    expect(decodeUtf8(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]))).toBe('{}');
    expect(validate(new Uint8Array([0xff, 0xfe, 0x7b])).issues[0]?.rule).toBe('file-format');
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('{"type":"Point","coordinates":[1.000001,2.000001]}')]);
    expect(validate(bom).issues.map((i) => i.rule)).not.toContain('json-syntax');
  });

  it('rejects empty input and input over the byte limit before parsing', () => {
    expect(validate('   ').issues[0]?.rule).toBe('file-format');
    // Checked before decoding: invalid UTF-8 over the limit is reported as too large, not as invalid.
    expect(validate(new Uint8Array(100).fill(0xff), { limits: { maxInputBytes: 99 } }).issues[0]?.rule).toBe('input-limit');
    const r = readInput(new Uint8Array(100), { limits: { maxInputBytes: 99 } });
    expect(r.readable).toBe(false);
    expect(r.findings.issues[0]?.rule).toBe('input-limit');
    expect(readInput('x'.repeat(100), { limits: { maxInputBytes: 99 } }).findings.issues[0]?.rule).toBe('input-limit');
  });
});

describe('CSV', () => {
  it('splits cells per RFC 4180 with quotes, doubled quotes and line breaks in quotes', () => {
    const r = parseCsv('a,b\n"x, ""y""","line\nbreak"\r\n1,2', ',', DEFAULT_LIMITS);
    expect(r).toEqual({ rows: [{ cells: ['a', 'b'], line: 1 }, { cells: ['x, "y"', 'line\nbreak'], line: 2 }, { cells: ['1', '2'], line: 4 }] });
  });

  it('detects the separator from the header', () => {
    expect(detectDelimiter('lon;lat;"a,b"\n')).toBe(';');
    expect(detectDelimiter('lon\tlat\n')).toBe('\t');
    expect(detectDelimiter('lon\n')).toBe(',');
  });

  it('reads points with column aliases and numbers', () => {
    const r = convert('Longitude,LATITUDE,producer_name,Country Code,area_ha\n-5.500001,6.800001,Ana,CI,1.5\n', { format: 'csv' });
    expect(r.output).toContain('{"type":"Feature","properties":{"ProducerName":"Ana","ProducerCountry":"CI","Area":1.5},"geometry":{"type":"Point","coordinates":[-5.500001,6.800001]}}');
  });

  it('groups rows into polygons by plot id and closes the ring', () => {
    const r = convert('plot_id;lon;lat\nA;-5,500001;6,800001\nA;-5,490001;6,800001\nA;-5,490001;6,810001\n', { format: 'csv' });
    expect(r.output).toContain('[[[-5.500001,6.800001],[-5.490001,6.800001],[-5.490001,6.810001],[-5.500001,6.800001]]]');
    expect(r.before.notes.join(' ')).toContain('decimal comma');
  });

  it('reports bad rows with their line numbers', () => {
    const r = csv('lon,lat\nabc,1\n1,\n');
    const bad = r.issues.filter((i) => i.rule === 'position-invalid');
    expect(bad.map((i) => i.line)).toEqual([2, 3]);
  });

  it('refuses tables without coordinates, duplicate columns and unclosed quotes', () => {
    expect(csv('a,b\n1,2\n').issues[0]?.rule).toBe('file-format');
    expect(csv('lon,lat,longitude\n1,2,3\n').issues[0]?.rule).toBe('file-format');
    expect(csv('lon,lat\n"1,2\n').issues[0]?.rule).toBe('file-format');
  });

  it('enforces cell and row limits', () => {
    // A quote opens a quoted cell only when nothing but whitespace precedes it in the cell.
    const cells = (text: string): string[] => {
      const r = parseCsv(text, ',', DEFAULT_LIMITS);
      return 'rows' in r ? (r.rows[0]?.cells ?? []) : [];
    };
    expect(cells(' \t "a,b" ,x"y"z,"""q",  ""')).toEqual(['a,b ', 'x"y"z', '"q', '']);
    expect(cells('"  ""x",a""b')).toEqual(['  "x', 'a""b']);
    // Cell lengths count UTF-16 code units, like the Python package.
    expect(parseCsv('\u{1F600}'.repeat(6), ',', { maxValues: 9, maxStringLength: 10 })).toMatchObject({ error: 'a cell longer than 10 characters' });
    expect(parseCsv('a,b,c', ',', { maxValues: 2, maxStringLength: 10 })).toMatchObject({ error: 'more than 2 cells' });
    expect(parseCsv('"aaaaaaaaaaaa"', ',', { maxValues: 9, maxStringLength: 10 })).toMatchObject({ error: 'a cell longer than 10 characters' });
    expect(parseCsv('aaaaaaaaaaaa', ',', { maxValues: 9, maxStringLength: 10 })).toMatchObject({ error: 'a cell longer than 10 characters' });
    expect(readInput('lon,lat\n1,1\n2,2\n3,3\n', { format: 'csv', limits: { maxFeatures: 2 } }).findings.issues[0]?.rule).toBe('input-limit');
    expect(readInput('plot,lon,lat\nA,1,1\nA,2,2\nA,3,3\n', { format: 'csv', limits: { maxPositions: 2 } }).findings.issues[0]?.rule).toBe('input-limit');
  });
});

describe('KML', () => {
  const doc = (body: string): string => `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>${body}</Document></kml>`;

  it('reads placemarks, names, extended data, inner rings and namespaces', () => {
    const r = convert(
      doc('<Folder><kml:Placemark xmlns:kml="x"><kml:name>A &amp; B &#233;&#xE9;</kml:name><ExtendedData><Data name="ProducerCountry"><value>CI</value></Data><SchemaData><SimpleData name="Area">2.50</SimpleData></SchemaData></ExtendedData><Polygon><outerBoundaryIs><LinearRing><coordinates>0.000001,0.000001 0.010001,0.000001 0.010001,0.010001 0.000001,0.010001 0.000001,0.000001</coordinates></LinearRing></outerBoundaryIs><innerBoundaryIs><LinearRing><coordinates>0.002001,0.002001 0.002001,0.003001 0.003001,0.003001 0.002001,0.002001</coordinates></LinearRing></innerBoundaryIs></Polygon></kml:Placemark></Folder>'),
      { format: 'kml' },
    );
    expect(r.output).toContain('"properties":{"ProductionPlace":"A & B éé","ProducerCountry":"CI","Area":2.50}');
    expect(r.before.issues.map((i) => i.rule)).toContain('polygon-has-holes');
  });

  it('turns MultiGeometry into MultiPoint, MultiPolygon or GeometryCollection', () => {
    const pts = convert(doc('<Placemark><MultiGeometry><Point><coordinates>1,1</coordinates></Point><Point><coordinates>2,2</coordinates></Point></MultiGeometry></Placemark>'), { format: 'kml' });
    expect(pts.output).toContain('"type":"MultiPoint"');
    const mixed = convert(doc('<Placemark><MultiGeometry><Point><coordinates>1,1</coordinates></Point><Polygon><outerBoundaryIs><LinearRing><coordinates>0,0 1,0 1,1 0,0</coordinates></LinearRing></outerBoundaryIs></Polygon></MultiGeometry></Placemark>'), { format: 'kml' });
    expect(mixed.output).toContain('"type":"GeometryCollection"');
  });

  it('refuses document type declarations, so no entity expansion is possible', () => {
    const laughs = '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">]><kml><Placemark><name>&lol2;</name></Placemark></kml>';
    const r = kml(laughs);
    expect(r.issues[0]?.rule).toBe('file-format');
    expect(r.issues[0]?.message).toContain('document type');
    const xxe = '<?xml version="1.0"?><!DOCTYPE kml [<!ENTITY x SYSTEM "file:///etc/passwd">]><kml><Placemark><name>&x;</name></Placemark></kml>';
    expect(kml(xxe).issues[0]?.rule).toBe('file-format');
    const harmless = kml('<!DOCTYPE kml><kml><Placemark><Point><coordinates>1.000001,2.000001</coordinates></Point></Placemark></kml>');
    expect(harmless.issues.map((i) => i.rule)).toEqual(['file-format']);
  });

  it('rejects unknown entities, bare ampersands and malformed markup', () => {
    for (const bad of ['<kml><a>&nbsp;</a></kml>', '<kml><a>a & b</a></kml>', '<kml><a></b></kml>', '<kml><a>', '<kml><a b=c/></kml>', '<kml><a>&#0;</a></kml>', '<kml><a>&#xD800;</a></kml>', '<kml><!-- x', '<kml><![CDATA[x</kml>']) {
      expect(kml(bad).issues[0]?.rule, bad).toBe('file-format');
    }
  });

  it('reads long coordinate lists and indented documents with many placemarks', () => {
    const ring = Array.from({ length: 5000 }, (_, i) => `${(Math.cos((2 * Math.PI * i) / 5000) / 100).toFixed(6)},${(Math.sin((2 * Math.PI * i) / 5000) / 100).toFixed(6)},0`);
    ring.push(ring[0] ?? '');
    const big = doc(`<Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>\n          ${ring.join('\n          ')}\n        </coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`);
    expect(big.length).toBeGreaterThan(100_000);
    expect(kml(big).issues.filter((i) => i.severity === 'error')).toEqual([]);
    const many = doc(Array.from({ length: 3000 }, (_, i) => `\n        <Placemark>\n          <name>p${i}</name>\n          <Point><coordinates>${(i / 1000).toFixed(6)},1.000001</coordinates></Point>\n        </Placemark>`).join(''));
    expect(kml(many).summary.plots).toBe(3000);
  });

  it('limits depth, element count and text length', () => {
    expect(() => parseXml('<a>'.repeat(70) + '</a>'.repeat(70), DEFAULT_LIMITS)).toThrow(/deeper/);
    expect(() => parseXml('<a/>'.repeat(11), { ...DEFAULT_LIMITS, maxValues: 10 })).toThrow(/more than/);
    expect(() => parseXml(`<a>${'x'.repeat(20)}</a>`, { ...DEFAULT_LIMITS, maxStringLength: 10 })).toThrow(/longer/);
    expect(kml('<a>'.repeat(70) + '</a>'.repeat(70)).issues[0]?.rule).toBe('input-limit');
  });

  it('reports placemarks without geometry, unsupported geometry and bad coordinates', () => {
    expect(kml(doc('<Placemark><name>x</name></Placemark>')).issues.map((i) => i.rule)).toContain('geometry-missing');
    expect(kml(doc('<Placemark><LineString><coordinates>0,0 1,1</coordinates></LineString></Placemark>')).issues.map((i) => i.rule)).toContain('geometry-type-not-accepted');
    expect(kml(doc('<Placemark><Point><coordinates>1;2</coordinates></Point></Placemark>')).issues.map((i) => i.rule)).toContain('position-invalid');
    expect(kml(doc('<Placemark><Point><coordinates>1,2 3,4</coordinates></Point></Placemark>')).issues.map((i) => i.rule)).toContain('position-invalid');
    expect(kml(doc('<Placemark><Polygon></Polygon></Placemark>')).issues.map((i) => i.rule)).toContain('geojson-structure');
    expect(kml('<gpx/>').issues[0]?.rule).toBe('file-format');
  });
});
