// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// Hostile and broken input: every case must end quickly with a finding,
// never with an exception, a hang or a polluted prototype.

import { describe, expect, it } from 'vitest';
import { fix, split, validate } from '../src/core/api.js';
import { resolveLimits } from '../src/core/limits.js';
import { fc, feature, point } from './helpers.js';

const first = (input: string | Uint8Array, opts = {}): string | undefined => validate(input, opts).issues[0]?.rule;

describe('hostile input', () => {
  it('stops deep nesting at the depth limit', () => {
    expect(first('['.repeat(200_000))).toBe('input-limit');
    expect(first('{"a":'.repeat(100) + '1' + '}'.repeat(100))).toBe('input-limit');
  });

  it('stops huge coordinate arrays at the position limit', () => {
    const coords = Array.from({ length: 2001 }, (_, i) => `[${i / 1e4},0]`).join(',');
    const text = `{"type":"MultiPoint","coordinates":[${coords}]}`;
    const ids = (opts = {}): string[] => validate(text, opts).issues.map((i) => i.rule);
    expect(ids({ limits: { maxPositions: 2000 } })).toContain('input-limit');
    expect(ids()).not.toContain('input-limit');
  });

  it('stops too many features at the feature limit', () => {
    const text = fc(...Array.from({ length: 11 }, () => feature(point(1.000001, 1.000001))));
    expect(first(text, { limits: { maxFeatures: 10 } })).toBe('input-limit');
  });

  it('rejects NaN, Infinity and numbers out of range', () => {
    for (const t of ['{"type":"Point","coordinates":[NaN,1]}', '{"type":"Point","coordinates":[Infinity,1]}', '{"type":"Point","coordinates":[-Infinity,1]}', '{"type":"Point","coordinates":[1e309,1]}']) expect(first(t)).toBe('json-syntax');
    expect(validate('{"type":"Point","coordinates":[1e300,1]}').issues.map((i) => i.rule)).toContain('coordinate-out-of-range');
  });

  it('treats __proto__, constructor and prototype as data and never pollutes Object.prototype', () => {
    const text = '{"type":"FeatureCollection","__proto__":{"polluted":1},"features":[{"type":"Feature","__proto__":{"polluted":2},"properties":{"__proto__":{"polluted":3},"constructor":{"prototype":{"polluted":4}},"ProductionPlace":"x","ProducerCountry":"CI"},"geometry":{"type":"Point","coordinates":[1.000001,1.000001]}}]}';
    const r = fix(text, { stripUnknownProperties: false });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('polluted');
    expect(r.output).toContain('"__proto__":{"polluted":3}');
    expect(r.before.summary.countries).not.toHaveProperty('__proto__');
    expect(Object.getPrototypeOf(r.before.summary.countries)).toBeNull();
  });

  it('survives a very long string and a very long number within limits and rejects them beyond', () => {
    expect(first(`{"type":"Feature","properties":{"x":"${'a'.repeat(70_000)}"},"geometry":null}`)).toBe('input-limit');
    expect(first(`{"type":"Point","coordinates":[1.${'1'.repeat(100)},1]}`)).toBe('input-limit');
  });

  it('bounds the geometry checks with the work budget', () => {
    // A long zig-zag ring and many overlapping squares: the budget ends the work and says so.
    const zig = Array.from({ length: 3000 }, (_, i) => [i / 1e5, i % 2 === 0 ? 0 : 0.5]);
    const ring = [...zig, [0.03, 1], [0, 1], [0, 0]];
    const r = validate(fc(feature({ type: 'Polygon', coordinates: [ring] })), { checkBudget: 1000 });
    expect(r.issues.map((i) => i.rule)).toContain('check-limit-reached');
    const many = fc(...Array.from({ length: 200 }, (_, i) => feature({ type: 'Polygon', coordinates: [[[0, 0], [1 + i / 1e4, 0], [1, 1], [0, 1], [0, 0]]] })));
    const t0 = Date.now();
    const m = validate(many, { checkBudget: 10_000 });
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(m.issues.map((i) => i.rule)).toContain('check-limit-reached');
  });

  it('reads KML text split into many pieces in linear time', () => {
    const kml = `<kml><Placemark><name>${'a<!---->'.repeat(60_000)}</name><Point><coordinates>1.000001,2.000001</coordinates></Point></Placemark></kml>`;
    const t0 = Date.now();
    expect(validate(kml, { format: 'kml' }).issues.map((i) => i.rule)).not.toContain('input-limit');
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(fix(kml, { format: 'kml' }).output).toContain(`"ProductionPlace":"${'a'.repeat(60_000)}"`);
    expect(first(`<kml><Placemark><name>${'a<!---->'.repeat(70_000)}</name></Placemark></kml>`, { format: 'kml' })).toBe('input-limit');
    expect(first(`<kml><Placemark><name><![CDATA[${'a'.repeat(70_000)}]]></name></Placemark></kml>`, { format: 'kml' })).toBe('input-limit');
  });

  it('reads CSV cells full of quote characters in linear time', () => {
    // Each quote used to trim the cell so far: quadratic in the cell length.
    const cell = `${' '.repeat(30_000)}a${'"'.repeat(30_000)}`;
    const text = `lon,lat,name\n${`1.000001,2.000001,${cell}\n`.repeat(30)}`;
    const t0 = Date.now();
    const r = validate(text, { format: 'csv' });
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(r.summary.plots).toBe(30);
  });

  it('refuses limits beyond the hard maximum or of the wrong type', () => {
    expect(() => resolveLimits({ maxDepth: 1_000_000 })).toThrow(RangeError);
    expect(() => resolveLimits({ maxDepth: 0 })).toThrow(RangeError);
    expect(() => resolveLimits({ maxDepth: 1.5 })).toThrow(RangeError);
    expect(() => resolveLimits({ maxDepth: '10' as unknown as number })).toThrow(RangeError);
    expect(() => resolveLimits({ nope: 1 } as unknown as Record<string, number>)).toThrow(RangeError);
  });

  it('handles every malformed GeoJSON shape without throwing', () => {
    const shapes = [
      '[]', '1', '"x"', 'null', '{"type":1}', '{"type":"FeatureCollection"}', '{"type":"FeatureCollection","features":{}}',
      '{"type":"Feature"}', '{"type":"Feature","geometry":1,"properties":[]}', '{"type":"Feature","geometry":{"type":"Point"},"properties":null}',
      '{"type":"Polygon","coordinates":1}', '{"type":"Polygon","coordinates":[1]}', '{"type":"Polygon","coordinates":[[1]]}', '{"type":"MultiPolygon","coordinates":[[[[1,2,"x"]]]]}',
      '{"type":"GeometryCollection"}', '{"type":"GeometryCollection","geometries":[1]}', '{"type":"MultiPoint","coordinates":{}}', '{"type":"Feature","id":{},"geometry":null}',
      '{"type":"Point","coordinates":[true,false]}', '{"type":"Point","coordinates":[]}', '{"type":"Polygon","coordinates":[[]]}', '{"type":"Polygon","coordinates":[]}',
    ];
    for (const s of shapes) {
      expect(() => validate(s), s).not.toThrow();
      expect(() => fix(s), s).not.toThrow();
      expect(() => split(s), s).not.toThrow();
      expect(validate(s).ok, s).toBe(false);
    }
  });

  it('keeps terminal escape sequences inert in stored values', () => {
    const esc = String.fromCharCode(27);
    const r = fix(fc(feature(point(1.000001, 1.000001), { ProductionPlace: `${esc}[31mred`, ProducerCountry: 'CI', Area: 1 })));
    expect(r.output).toContain('\\u001b[31mred');
    expect(r.output).not.toContain(esc);
  });
});
