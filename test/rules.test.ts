// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// One trigger per rule, with its severity, plus the inputs that must not
// trigger it. Thresholds are tested on both sides.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validate } from '../src/core/api.js';
import { RULES, type RuleId } from '../src/core/rules.js';
import { A, PROPS, errors, fc, feature, point, polygon, rules, square } from './helpers.js';

const P6 = point(-5.500001, 6.800001);
const withArea = (area: unknown): string => fc(feature(P6, { ...PROPS, Area: area }));

/** Inputs that trigger each rule, with the options needed. */
const TRIGGERS: Record<RuleId, [string, Record<string, unknown>?]> = {
  'input-limit': ['['.repeat(100) + ']'.repeat(100)],
  'json-syntax': ['{"type":"FeatureCollection","features":[}'],
  'json-duplicate-key': ['{"type":"Feature","type":"Feature"}'],
  'file-format': ['{"hello":"world"}'],
  'geojson-structure': [fc({ type: 'Point', coordinates: [1, 2] })],
  'not-feature-collection': [JSON.stringify(feature(P6, { ...PROPS, Area: 1 }))],
  'foreign-member': [JSON.stringify({ type: 'FeatureCollection', name: 'x', features: [feature(P6, { ...PROPS, Area: 1 })] })],
  'bbox-member': [JSON.stringify({ type: 'FeatureCollection', bbox: [0, 0, 1, 1], features: [feature(P6, { ...PROPS, Area: 1 })] })],
  'crs-member': [JSON.stringify({ type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } }, features: [feature(P6, { ...PROPS, Area: 1 })] })],
  'crs-not-wgs84': [JSON.stringify({ type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::3857' } }, features: [feature(P6, { ...PROPS, Area: 1 })] })],
  'geometry-missing': [fc(feature(null))],
  'geometry-type-not-accepted': [fc(feature({ type: 'LineString', coordinates: [[0, 0], [1, 1]] }))],
  'geometry-empty': [fc(feature({ type: 'MultiPoint', coordinates: [] }))],
  'nested-geometry-collection': [fc(feature({ type: 'GeometryCollection', geometries: [{ type: 'GeometryCollection', geometries: [P6, point(-5.4, 6.7)] }] }))],
  'single-part-multi': [fc(feature({ type: 'MultiPolygon', coordinates: [[A]] }))],
  'position-invalid': [fc(feature({ type: 'Point', coordinates: [1] }))],
  'coordinate-out-of-range': [fc(feature(point(200.000001, 6.000001), { ...PROPS, Area: 1 }))],
  'altitude-present': [fc(feature({ type: 'Point', coordinates: [-5.500001, 6.800001, 120] }, { ...PROPS, Area: 1 }))],
  'excess-precision': [fc(feature(point(-5.5000011, 6.8000011), { ...PROPS, Area: 1 }))],
  'low-precision': [fc(feature(point(-5.5, 6.8), { ...PROPS, Area: 1 }))],
  'ring-not-closed': [fc(feature(polygon(A.slice(0, -1))))],
  'ring-too-few-positions': [fc(feature(polygon([A[0], A[1], A[0]] as [number, number][])))],
  'duplicate-vertex': [fc(feature(polygon([A[0], A[1], A[1], A[2], A[3], A[4]] as [number, number][])))],
  'spike': [fc(feature(polygon([[0.000001, 0.000001], [0.010001, 0.000001], [0.020001, 0.000001], [0.010001, 0.000001], [0.010001, 0.010001], [0.000001, 0.010001], [0.000001, 0.000001]])))],
  'zero-area-ring': [fc(feature(polygon([[0.000001, 0.000001], [0.010001, 0.000001], [0.020001, 0.000001], [0.000001, 0.000001]])))],
  'self-intersection': [fc(feature(polygon([[0.000001, 0.000001], [0.010001, 0.010001], [0.010001, 0.000001], [0.000001, 0.010001], [0.000001, 0.000001]])))],
  'polygon-has-holes': [fc(feature(polygon(square(0.000001, 0.000001, 0.01), square(0.002001, 0.002001, 0.001).reverse())))],
  'multipolygon-parts-intersect': [fc(feature({ type: 'MultiPolygon', coordinates: [[square(0.000001, 0.000001, 0.01)], [square(0.005001, 0.005001, 0.01)]] }))],
  'winding-order': [fc(feature(polygon([...A].reverse())))],
  'antimeridian-crossing': [fc(feature(polygon([[179.990001, -17.800001], [-179.990001, -17.800001], [-179.990001, -17.790001], [179.990001, -17.790001], [179.990001, -17.800001]])))],
  'polygon-area-tiny': [fc(feature(polygon(square(0.000001, 0.000001, 0.000005))))],
  'property-name-case': [fc(feature(P6, { productionplace: 'X', ProducerCountry: 'CI', Area: 1 }))],
  'property-type': [fc(feature(P6, { ...PROPS, ProducerName: 7, Area: 1 }))],
  'producer-country-invalid': [fc(feature(P6, { ProductionPlace: 'X', ProducerCountry: 'ZZ', Area: 1 }))],
  'producer-country-format': [fc(feature(P6, { ProductionPlace: 'X', ProducerCountry: 'ci', Area: 1 }))],
  'producer-country-user-assigned': [fc(feature(P6, { ProductionPlace: 'X', ProducerCountry: 'XK', Area: 1 }))],
  'producer-country-missing': [fc(feature(P6, { ProductionPlace: 'X', Area: 1 })), { variant: 'type-ii' }],
  'producer-name-too-long': [fc(feature(P6, { ...PROPS, ProducerName: 'x'.repeat(501), Area: 1 }))],
  'production-place-missing': [fc(feature(P6, { ProducerCountry: 'CI', Area: 1 }))],
  'unknown-properties': [fc(feature(P6, { ...PROPS, Area: 1, phone: '1' }))],
  'area-not-number': [withArea('3')],
  'point-area-missing': [fc(feature(P6))],
  'point-area-below-minimum': [withArea(0.00009)],
  'point-area-above-4ha': [withArea(4.5)],
  'area-mismatch': [fc(feature(polygon(A), { ...PROPS, Area: 1 }))],
  'no-plots': [fc()],
  'file-too-large': [fc(feature(P6, { ...PROPS, Area: 1 })), { maxBytes: 50 }],
  'too-many-producers': [fc(feature(P6, { ...PROPS, ProducerName: 'a', Area: 1 }), feature(point(-5.400001, 6.800001), { ...PROPS, ProducerName: 'b', Area: 1 })), { variant: 'type-ii', maxProducers: 1 }],
  'duplicate-plot': [fc(feature(polygon(A)), feature(polygon(A)))],
  'overlapping-plots': [fc(feature(polygon(square(0.000001, 0.000001, 0.01))), feature(polygon(square(0.005001, 0.005001, 0.01))))],
  'check-limit-reached': [fc(feature(polygon(square(0.000001, 0.000001, 0.01)))), { checkBudget: 1 }],
};

describe('every rule has a trigger', () => {
  it('covers the whole catalogue', () => {
    expect(Object.keys(TRIGGERS).sort()).toEqual(RULES.map((r) => r.id).sort());
  });

  it.each(RULES.map((r) => [r.id, r] as const))('%s', (id, r) => {
    const [input, options] = TRIGGERS[id];
    const found = validate(input, options ?? {}).issues.filter((i) => i.rule === id);
    expect(found.length, id).toBeGreaterThan(0);
    // The usual severity applies unless the rule documents otherwise.
    if (id !== 'antimeridian-crossing' && id !== 'geojson-structure') expect(found[0]?.severity, id).toBe(r.severity);
    expect(found.every((f) => f.message.length > 10)).toBe(true);
  });
});

describe('thresholds and exceptions', () => {
  it('requires Area of at least 0.0001 ha for a point', () => {
    expect(errors(withArea(0.0001))).toEqual([]);
    expect(errors(withArea(0.000099))).toEqual(['point-area-below-minimum']);
    expect(errors(withArea(0))).toEqual(['point-area-below-minimum']);
    expect(errors(withArea(-1))).toEqual(['point-area-below-minimum']);
  });

  it('allows a point up to exactly 4 ha, and above that only for cattle (Article 2, point (28))', () => {
    expect(errors(withArea(4))).toEqual([]);
    expect(errors(withArea(4.0001))).toEqual(['point-area-above-4ha']);
    expect(errors(withArea(4.0001), { commodity: 'cocoa' })).toEqual(['point-area-above-4ha']);
    expect(errors(withArea(4.0001), { commodity: 'cattle' })).toEqual([]);
    expect(errors(withArea(5000), { commodity: 'cattle' })).toEqual([]);
  });

  it('tells the user the Information System assumes 4 ha when Area is missing', () => {
    const r = validate(fc(feature(P6)));
    expect(r.plots[0]).toMatchObject({ hectares: 4, areaSource: 'default' });
    expect(r.issues.find((i) => i.rule === 'point-area-missing')?.message).toContain('4 ha');
  });

  it('accepts all accepted geometry types', () => {
    const all = [P6, { type: 'MultiPoint', coordinates: [[-5.500001, 6.800001], [-5.400001, 6.700001]] }, polygon(A), { type: 'MultiPolygon', coordinates: [[A], [square(0.020001, 0.000001, 0.01)]] }, { type: 'GeometryCollection', geometries: [P6, polygon(A)] }];
    for (const g of all) expect(errors(fc(feature(g, { ...PROPS, Area: 1 }))), JSON.stringify(g).slice(0, 40)).toEqual([]);
  });

  it('rejects MultiLineString and unknown or mis-cased types', () => {
    for (const t of ['MultiLineString', 'polygon', 'Circle']) expect(errors(fc(feature({ type: t, coordinates: [] })))).toEqual(['geometry-type-not-accepted']);
  });

  it('checks ranges at the edges', () => {
    for (const [x, y] of [[180, 90], [-180, -90], [0.000001, 0.000001]] as const) expect(errors(fc(feature(point(x, y), { ...PROPS, Area: 1 })))).toEqual([]);
    for (const [x, y] of [[180.000001, 0], [-180.0000001, 0], [0, 90.000001], [0, -90.5]] as const) expect(errors(fc(feature(point(x, y), { ...PROPS, Area: 1 })))).toEqual(['coordinate-out-of-range']);
  });

  it('hints at swapped coordinates', () => {
    const msg = validate(fc(feature(point(6.000001, 120.000001)))).issues.find((i) => i.rule === 'coordinate-out-of-range')?.message;
    expect(msg).toContain('swapped');
  });

  it('flags low precision only when no coordinate of a plot has six decimals', () => {
    // 17.10022 is the Commission's own example: a dropped trailing zero.
    expect(rules(fc(feature(polygon([[17.10022, -12.364149], [17.065887, -12.427189], [17.133179, -12.487532], [17.10022, -12.364149]]))))).not.toContain('low-precision');
    expect(rules(fc(feature(polygon([[17.1, -12.3], [17.2, -12.4], [17.3, -12.5], [17.1, -12.3]]))))).toContain('low-precision');
  });

  it('detects duplicates created only by truncation to six decimals', () => {
    const ring = [[0.0000011234, 0.0000011234], [0.0100011234, 0.0000011234], [0.0100015678, 0.0000015678], [0.0100011234, 0.0100011234], [0.0000011234, 0.0100011234], [0.0000011234, 0.0000011234]];
    const r = validate(fc(feature(polygon(ring as [number, number][]))));
    expect(r.issues.find((i) => i.rule === 'duplicate-vertex')?.message).toContain('truncation');
  });

  it('detects a ring that becomes invalid only after truncation', () => {
    // Valid with 7 decimals; after truncation two corners coincide and the ring touches itself.
    const ring: [number, number][] = [[0, 0], [0.0010001, 0], [0.0005, 0.0005], [0.0010009, 0.001], [0, 0.001], [0.0005004, 0.0005004], [0, 0]];
    expect(errors(fc(feature(polygon(ring))))).toContain('self-intersection');
  });

  it('accepts neighbouring plots that share a side, and MultiPolygon parts that touch at a corner', () => {
    expect(rules(fc(feature(polygon(square(0.000001, 0.000001, 0.01))), feature(polygon(square(0.010001, 0.000001, 0.01)))))).not.toContain('overlapping-plots');
    expect(errors(fc(feature({ type: 'MultiPolygon', coordinates: [[square(0.000001, 0.000001, 0.01)], [square(0.010001, 0.010001, 0.01)]] })))).toEqual([]);
  });

  it('reports a duplicate once, not also as an overlap', () => {
    const r = rules(fc(feature(polygon(A)), feature(polygon(A))));
    expect(r).toContain('duplicate-plot');
    expect(r).not.toContain('overlapping-plots');
  });

  it('counts producers by ProducerName and ProducerCountry for Type II files only', () => {
    const two = fc(feature(P6, { ...PROPS, ProducerName: 'a', Area: 1 }), feature(point(-5.400001, 6.800001), { ...PROPS, ProducerName: 'b', Area: 1 }));
    expect(rules(two, { maxProducers: 1 })).not.toContain('too-many-producers');
    expect(rules(two, { variant: 'type-ii', maxProducers: 2 })).not.toContain('too-many-producers');
  });

  it('uses 25,000,000 bytes as the default size limit', () => {
    expect(rules(fc(feature(P6, { ...PROPS, Area: 1 })))).not.toContain('file-too-large');
    const json = fc(feature(P6, { ...PROPS, Area: 1 }));
    expect(rules(' '.repeat(25_000_000 - json.length) + json)).not.toContain('file-too-large');
    expect(rules(' '.repeat(25_000_001 - json.length) + json)).toContain('file-too-large');
  });

  it('passes the Commission\'s own example files', () => {
    for (const e of (JSON.parse(readFileSyncUtf8('test-vectors/official-examples.json')) as { examples: { text: string }[] }).examples) {
      expect(errors(e.text)).toEqual([]);
      expect(errors(e.text, { variant: 'type-ii' })).toEqual([]);
    }
  });
});

function readFileSyncUtf8(rel: string): string {
  return readFileSync(join(import.meta.dirname, '..', rel), 'utf8');
}
