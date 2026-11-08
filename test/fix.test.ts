// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { fix, validate } from '../src/core/api.js';
import { A, PROPS, fc, feature, point, polygon, repaired, square } from './helpers.js';

const area = (text: string): number => validate(text).summary.hectares;

describe('fix', () => {
  it('closes rings, removes repeats and spikes, keeps the area and reports every change', () => {
    const ring: [number, number][] = [[0.000001, 0.000001], [0.010001, 0.000001], [0.010001, 0.000001], [0.020001, 0.000001], [0.010001, 0.000001], [0.010001, 0.010001], [0.000001, 0.010001]];
    const r = repaired(fc(feature(polygon(ring))));
    expect(r.changes).toEqual(expect.arrayContaining(['ring-not-closed', 'duplicate-vertex', 'spike']));
    expect(r.after.filter((x) => x !== 'production-place-missing')).toEqual([]);
    expect(area(r.output)).toBeCloseTo(area(fc(feature(polygon(A)))), 9);
  });

  it('truncates to six decimals like the Information System, and drops altitude', () => {
    const r = repaired(fc(feature({ type: 'Point', coordinates: [-5.8227391234, 44.2567071234, 312.5] }, { ...PROPS, Area: 1 })));
    expect(r.output).toContain('"coordinates":[-5.822739,44.256707]');
    expect(r.changes).toEqual(expect.arrayContaining(['excess-precision', 'altitude-present']));
  });

  it('marks a range error fixable only when truncation brings every value within range', () => {
    const ring = (south: number): [number, number][] => [[180.0000001, -16.5], [179.9, -16.5], [179.9, south], [180.0000001, -16.4], [180.0000001, -16.5]];
    const near = fc(feature(polygon(ring(-16.4))));
    const issue = validate(near).issues.find((i) => i.rule === 'coordinate-out-of-range');
    expect(issue?.fixable).toBe(true);
    const r = fix(near);
    expect(r.changes.map((c) => c.rule)).toContain('coordinate-out-of-range');
    expect(r.after?.issues.map((i) => i.rule)).not.toContain('coordinate-out-of-range');
    const far = fc(feature(polygon(ring(-90.0000011))));
    expect(validate(far).issues.find((i) => i.rule === 'coordinate-out-of-range')?.fixable).toBe(false);
    expect(fix(far).changes.map((c) => c.rule)).not.toContain('coordinate-out-of-range');
  });

  it('does not promise to repair a ring that has too few positions', () => {
    const r = validate(fc(feature({ type: 'Polygon', coordinates: [[[1.000001, 1.000001], [1.000001, 1.000001], [1.000002, 1.000002]]] })));
    const ring = r.issues.filter((i) => i.rule === 'duplicate-vertex' || i.rule === 'ring-not-closed');
    expect(ring.map((i) => i.rule).sort()).toEqual(['duplicate-vertex', 'ring-not-closed']);
    expect(ring.every((i) => !i.fixable)).toBe(true);
  });

  it('rewinds rings to the RFC 7946 right-hand rule', () => {
    const r = repaired(fc(feature(polygon([...A].reverse()))));
    expect(r.changes).toContain('winding-order');
    expect(r.after).not.toContain('winding-order');
  });

  it('renames mis-cased properties, writes numeric text as numbers and normalises country codes', () => {
    const r = repaired(fc(feature(point(0.000001, 0.000001), { productionplace: 'X', producercountry: ' ci ', area: '007.50' })));
    expect(r.output).toContain('"properties":{"ProductionPlace":"X","ProducerCountry":"CI","Area":7.50}');
    expect(r.changes).toEqual(expect.arrayContaining(['property-name-case', 'area-not-number', 'producer-country-format']));
  });

  it('does not guess: leaves non-numeric Area text, unknown countries and clashing names alone', () => {
    const input = fc(feature(point(0.000001, 0.000001), { ProductionPlace: 'X', productionplace: 'Y', ProducerCountry: 'ZZ', Area: '3,5 ha' }));
    const r = repaired(input);
    expect(r.changes).toEqual([]);
    expect(r.after).toEqual(expect.arrayContaining(['property-name-case', 'producer-country-invalid', 'area-not-number']));
  });

  it('never repairs self-intersections, holes or overlaps, and says so', () => {
    const bow = fc(feature(polygon([[0.000001, 0.000001], [0.010001, 0.010001], [0.010001, 0.000001], [0.000001, 0.010001], [0.000001, 0.000001]])));
    expect(repaired(bow).after).toContain('self-intersection');
    const hole = fc(feature(polygon(square(0.000001, 0.000001, 0.01), square(0.002001, 0.002001, 0.001).reverse())));
    expect(repaired(hole).after).toContain('polygon-has-holes');
  });

  it('cuts a polygon at the antimeridian into a valid MultiPolygon with the same area', () => {
    const input = fc(feature(polygon([[179.990001, -17.800001], [-179.990001, -17.800001], [-179.990001, -17.790001], [179.990001, -17.790001], [179.990001, -17.800001]])));
    const before = validate(input).plots[0]?.hectares ?? 0;
    const r = repaired(input);
    expect(r.output).toContain('"type":"MultiPolygon"');
    expect(r.after.filter((x) => x !== 'production-place-missing')).toEqual([]);
    expect(Math.abs(area(r.output) - before) / before).toBeLessThan(1e-6);
    const kept = repaired(input, { cutAntimeridian: false });
    expect(kept.after).toContain('antimeridian-crossing');
  });

  it('removes only exact duplicates', () => {
    expect(repaired(fc(feature(polygon(A)), feature(polygon(A)))).output.split('\n')).toHaveLength(4);
    const different = repaired(fc(feature(polygon(A), { ...PROPS, ProductionPlace: 'one' }), feature(polygon(A), { ...PROPS, ProductionPlace: 'two' })));
    expect(different.output.split('\n')).toHaveLength(5);
    expect(different.after).toContain('duplicate-plot');
    expect(repaired(fc(feature(polygon(A)), feature(polygon(A))), { removeDuplicates: false }).output.split('\n')).toHaveLength(5);
  });

  it('fills ProducerCountry only when asked, and validates the code', () => {
    expect(repaired(fc(feature(point(0.000001, 0.000001), { ProductionPlace: 'X', Area: 1 })), { country: 'GH' }).output).toContain('"ProducerCountry":"GH"');
    expect(() => fix(fc(feature(point(0, 0))), { country: 'gh' })).toThrow(RangeError);
    expect(() => fix(fc(feature(point(0, 0))), { country: 'ZZ' })).toThrow(RangeError);
  });

  it('strips unknown properties only when asked', () => {
    const input = fc(feature(point(0.000001, 0.000001), { ...PROPS, Area: 1, phone: '+225 01' }));
    expect(repaired(input).output).toContain('phone');
    expect(repaired(input, { stripUnknownProperties: true }).output).not.toContain('phone');
  });

  it('simplifies exactly collinear vertices only when asked, without changing the shape', () => {
    const input = fc(feature(polygon([[0.000001, 0.000001], [0.005001, 0.000001], [0.010001, 0.000001], [0.010001, 0.010001], [0.000001, 0.010001], [0.000001, 0.000001]])));
    expect(repaired(input).output).toContain('0.005001');
    const s = repaired(input, { simplifyCollinear: true });
    expect(s.output).not.toContain('0.005001');
    expect(area(s.output)).toBeCloseTo(area(input), 9);
  });

  it('is idempotent: repairing a repaired file changes nothing', () => {
    const inputs = [
      fc(feature(polygon([...A].reverse().slice(0, -1)), { productionplace: 'x', ProducerCountry: 'ci' })),
      fc(feature({ type: 'MultiPolygon', coordinates: [[A]] }), feature({ type: 'GeometryCollection', geometries: [{ type: 'GeometryCollection', geometries: [point(1.000001, 1.000001)] }] })),
      fc(feature(polygon([[179.990001, -17.800001], [-179.990001, -17.800001], [-179.990001, -17.790001], [179.990001, -17.790001]]))),
    ];
    for (const input of inputs) {
      const once = repaired(input).output;
      const twice = fix(once);
      expect(twice.output).toBe(once);
      expect(twice.changes).toEqual([]);
    }
  });

  it('refuses to write output for a file in another coordinate system', () => {
    const r = fix(JSON.stringify({ type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::3857' } }, features: [feature(point(-612000, 760000))] }));
    expect(r.output).toBeNull();
    expect(r.before.issues.map((i) => i.rule)).toContain('crs-not-wgs84');
  });

  it('keeps unreadable features and geometries verbatim instead of dropping them', () => {
    const input = fc(feature({ type: 'LineString', coordinates: [[0, 0], [1, 1]] }), { type: 'Nope' }, null);
    const r = repaired(input);
    expect(r.output).toContain('"LineString"');
    expect(r.output).toContain('{"type":"Nope"}');
    expect(r.output).toContain('\nnull\n');
  });

  it('writes the Commission\'s examples back unchanged apart from winding', () => {
    const t1 = '{"type":"FeatureCollection","features":[{"type":"Feature","properties":{"ProductionPlace":"A","Area":23.72,"ProducerCountry":"BR"},"geometry":{"type":"Polygon","coordinates":[[[-49.004616,-22.734322],[-49.009249,-22.740009],[-49.004541,-22.734322],[-49.004616,-22.734322]]]}}]}';
    const r = repaired(t1);
    expect(r.output).toContain('"Area":23.72');
  });
});
