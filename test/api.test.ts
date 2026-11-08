// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { base64Utf8, convert, outputBytes, readPlots, split, toDdsProducers, validate } from '../src/core/api.js';
import { splitPlots } from '../src/core/split.js';
import { GENERATOR } from '../src/version.js';
import { fc, feature, point, polygon, square } from './helpers.js';

const many = (n: number, producers = n): string =>
  fc(...Array.from({ length: n }, (_, i) => feature(polygon(square(0.000001 + 0.02 * (i % 40), 0.000001 + 0.02 * Math.floor(i / 40), 0.01)), { ProductionPlace: `p${i}`, ProducerCountry: 'CI', ProducerName: `n${i % producers}` })));

describe('reports', () => {
  it('carry the generator with the attribution', () => {
    const r = validate(fc(feature(point(1.000001, 1.000001))));
    expect(r.generator).toBe(GENERATOR);
    expect(GENERATOR).toContain('Plotline');
    expect(GENERATOR).toContain('by AFKzona Group');
    expect(GENERATOR).toContain('https://afkzonagroup.lt');
  });

  it('summarise plots, areas, producers and countries', () => {
    const r = validate(many(3, 2));
    expect(r.summary).toMatchObject({ plots: 3, polygons: 3, points: 0, producers: 2, positions: 15, countries: { CI: 3 } });
    expect(r.summary.hectares).toBeCloseTo(3 * 123.0907, 3);
  });

  it('counts the size of converted GeoJSON for KML and CSV', () => {
    const r = validate('lon,lat\n1.000001,1.000001\n', { format: 'csv' });
    expect(r.bytes).toBe(outputBytes(readPlots('lon,lat\n1.000001,1.000001\n', { format: 'csv' }).plots));
  });
});

describe('split', () => {
  it('keeps every part within the byte limit and keeps producers together', () => {
    const r = split(many(60, 6), { maxBytes: 3000 });
    expect(r.parts.length).toBeGreaterThan(1);
    for (const p of r.parts) {
      expect(p.bytes).toBeLessThanOrEqual(3000);
      expect(new TextEncoder().encode(p.text).length).toBe(p.bytes);
      expect(validate(p.text).ok).toBe(true);
    }
    expect(r.parts.reduce((s, p) => s + p.plots, 0)).toBe(60);
    expect(r.parts[0]?.name).toBe('part-001.geojson');
  });

  it('respects the producer limit', () => {
    const r = split(many(10, 10), { maxProducers: 3 });
    expect(r.parts.map((p) => p.producers)).toEqual([3, 3, 3, 1]);
  });

  it('spreads a producer that does not fit and reports plots that never fit', () => {
    const r = split(many(10, 1), { maxBytes: 600 });
    expect(r.spreadProducers).toBe(1);
    expect(r.oversized).toEqual([]);
    const tiny = split(many(2, 1), { maxBytes: 100 });
    expect(tiny.oversized).toEqual([0, 1]);
    expect(() => splitPlots([], { maxBytes: 10, maxProducers: 1 })).toThrow(RangeError);
    expect(() => splitPlots([], { maxBytes: 1000, maxProducers: 0 })).toThrow(RangeError);
  });

  it('returns a single part when everything fits', () => {
    expect(split(many(5)).parts).toHaveLength(1);
  });
});

describe('convert and DDS producers', () => {
  it('base64-encodes UTF-8 exactly like Node', () => {
    for (const s of ['', 'a', 'ab', 'abc', 'Fazenda São João ✓', '{"type":"FeatureCollection"}']) expect(base64Utf8(s)).toBe(Buffer.from(s, 'utf8').toString('base64'));
  });

  it('groups plots per producer with country and name', () => {
    const plots = readPlots(many(4, 2)).plots;
    const producers = toDdsProducers(plots);
    expect(producers).toHaveLength(2);
    expect(producers[0]).toMatchObject({ country: 'CI', name: 'n0', plots: 2 });
    const decoded = Buffer.from(producers[0]?.geometryGeojson ?? '', 'base64').toString('utf8');
    expect(validate(decoded).ok).toBe(true);
    expect(validate(decoded).summary.plots).toBe(2);
  });

  it('writes the country code as the grouping reads it, for unrepaired input too', () => {
    const plots = readPlots(fc(feature(point(1.000001, 2.000001), { producercountry: ' ci ', ProducerName: 'A' }), feature(point(1.000002, 2.000002), { ProducerCountry: 'CI', ProducerName: 'A' }))).plots;
    expect(toDdsProducers(plots)).toMatchObject([{ country: 'CI', name: 'A', plots: 2 }]);
  });

  it('does not repair while converting unless asked', () => {
    const open = fc(feature(polygon(square(0.000001, 0.000001, 0.01).slice(0, -1))));
    expect(convert(open).changes).toEqual([]);
    expect(convert(open, { repair: true }).changes.map((c) => c.rule)).toContain('ring-not-closed');
  });
});
