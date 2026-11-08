// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCoordinate } from '../src/core/coords.js';
import { cutAtAntimeridian } from '../src/core/geometry/antimeridian.js';
import { AUTHALIC_RADIUS, polygonHectares, ringAreaSquareMetres } from '../src/core/geometry/area.js';
import { interiorPoint, polygonRelation } from '../src/core/geometry/overlap.js';
import { locate, orient, segmentRelation, type XY } from '../src/core/geometry/predicates.js';
import { budget, crossesAntimeridian, dedupeCyclic, findSelfIntersection, findSpikes, isCollinear, removeSpikes, ringOrientation, unwrapRing } from '../src/core/geometry/ring.js';

const P = (x: number, y: number): XY => ({ x, y });
const ring = (...pts: [number, number][]): XY[] => pts.map(([x, y]) => P(x, y));
const SQ = ring([0, 0], [10, 0], [10, 10], [0, 10]);

describe('predicates', () => {
  it('orient is exact for large, nearly collinear coordinates', () => {
    // Products near 1e17 lose precision in doubles; the BigInt fallback decides.
    const a = P(-180_000_000, -90_000_000);
    const b = P(180_000_000, 90_000_000);
    expect(orient(a, b, P(0, 0))).toBe(0);
    expect(orient(a, b, P(2, 1))).toBe(0);
    expect(orient(a, b, P(2, 2))).toBe(1);
    expect(orient(a, b, P(2, 0))).toBe(-1);
    // det = −179999999 + 89999999 < 0, which doubles cannot resolve from the products alone.
    expect(orient(P(0, 0), P(179_999_999, 89_999_999), P(179_999_998, 89_999_998))).toBe(-1);
    expect(orient(P(0, 0), P(179_999_998, 89_999_998), P(179_999_999, 89_999_999))).toBe(1);
  });

  it.each([
    [[0, 0], [10, 10], [0, 10], [10, 0], 'cross'],
    [[0, 0], [10, 0], [10, 0], [20, 0], 'touch'],
    [[0, 0], [10, 0], [5, 0], [5, 5], 'touch'],
    [[0, 0], [10, 0], [5, 0], [15, 0], 'overlap'],
    [[0, 0], [10, 0], [11, 0], [15, 0], 'none'],
    [[0, 0], [10, 0], [0, 1], [10, 1], 'none'],
    [[0, 0], [0, 10], [0, 5], [0, 20], 'overlap'],
    [[0, 0], [10, 10], [5, 6], [6, 20], 'none'],
  ] as const)('segment %j-%j vs %j-%j is %s', (a, b, c, d, rel) => {
    const q = (t: readonly [number, number]): XY => P(t[0], t[1]);
    expect(segmentRelation(q(a), q(b), q(c), q(d))).toBe(rel);
  });

  it('locates points inside, outside and on the boundary', () => {
    expect(locate(P(5, 5), SQ)).toBe('inside');
    expect(locate(P(15, 5), SQ)).toBe('outside');
    expect(locate(P(10, 5), SQ)).toBe('boundary');
    expect(locate(P(0, 0), SQ)).toBe('boundary');
    expect(locate(P(-1, 0), SQ)).toBe('outside');
    expect(locate(P(5, 10), [...SQ].reverse())).toBe('boundary');
  });
});

describe('rings', () => {
  it('removes consecutive repeats cyclically', () => {
    expect(dedupeCyclic(ring([0, 0], [0, 0], [1, 0], [1, 1], [0, 0])).ring).toHaveLength(3);
  });

  it('finds and removes spikes without changing the area', () => {
    const spiky = ring([0, 0], [10, 0], [20, 0], [10, 0], [10, 10], [0, 10]);
    expect(findSpikes(dedupeCyclic(spiky).ring)).toContain(2);
    const { ring: clean } = removeSpikes(spiky);
    expect(clean.map((p) => [p.x, p.y])).toEqual([[0, 0], [10, 0], [10, 10], [0, 10]]);
    expect(ringAreaSquareMetres(clean)).toBeCloseTo(ringAreaSquareMetres(SQ), 9);
  });

  it('detects collinear rings and orientation', () => {
    expect(isCollinear(ring([0, 0], [1, 1], [2, 2]))).toBe(true);
    expect(isCollinear(ring([0, 0], [0, 0]))).toBe(true);
    expect(isCollinear(SQ)).toBe(false);
    expect(ringOrientation(SQ)).toBe(1);
    expect(ringOrientation([...SQ].reverse())).toBe(-1);
    expect(ringOrientation(ring([0, 0], [1, 1], [2, 2]))).toBe(0);
    // Large coordinates and a tiny area: the exact path decides.
    expect(ringOrientation(ring([170_000_000, 80_000_000], [170_000_001, 80_000_000], [170_000_001, 80_000_001]))).toBe(1);
  });

  it.each([
    ['bow tie', ring([0, 0], [10, 10], [10, 0], [0, 10]), 'cross'],
    ['figure eight through one vertex', ring([0, 0], [10, 0], [5, 5], [10, 10], [0, 10], [5, 5]), 'repeated-vertex'],
    ['vertex on a side', ring([0, 0], [10, 0], [10, 10], [5, 0], [0, 10]), 'touch'],
  ])('finds the self-intersection of a %s', (_name, r, rel) => {
    expect(findSelfIntersection(r, budget(1e6))?.relation).toBe(rel);
  });

  it('accepts valid concave and many-sided rings', () => {
    expect(findSelfIntersection(ring([0, 0], [20, 0], [20, 20], [10, 5], [0, 20]), budget(1e6))).toBeNull();
    const circle = Array.from({ length: 2000 }, (_, i) => P(Math.round(1e6 * Math.cos((2 * Math.PI * i) / 2000)), Math.round(1e6 * Math.sin((2 * Math.PI * i) / 2000))));
    const work = budget(1e6);
    expect(findSelfIntersection(circle, work)).toBeNull();
    expect(work.exhausted).toBe(false);
  });

  it('stops at the work budget instead of running unbounded', () => {
    // A comb: every tooth overlaps every other in x, the worst case for the sweep.
    const comb: XY[] = [];
    for (let i = 0; i < 400; i++) comb.push(P(i * 2, 0), P(i * 2 + 1, 1000 + i));
    comb.push(P(800, -10), P(-1, -10));
    const work = budget(50);
    expect(findSelfIntersection(comb, work)).toBeNull();
    expect(work.exhausted).toBe(true);
  });

  it('unwraps rings across the antimeridian and refuses rings around a pole', () => {
    const r = ring([179_990_000, 0], [-179_990_000, 0], [-179_990_000, 10_000], [179_990_000, 10_000]);
    expect(crossesAntimeridian(r)).toBe(true);
    const u = unwrapRing(r);
    expect(u?.map((p) => p.x)).toEqual([179_990_000, 180_010_000, 180_010_000, 179_990_000]);
    expect(crossesAntimeridian(SQ)).toBe(false);
    expect(unwrapRing(ring([0, 85_000_000], [120_000_000, 85_000_000], [-120_000_000, 85_000_000]))).toBeNull();
  });

  it('cuts at the antimeridian into two parts that touch only along 180°', () => {
    const r = ring([179_990_000, -17_800_000], [180_010_000, -17_800_000], [180_010_000, -17_790_000], [179_990_000, -17_790_000]);
    const [east, west] = cutAtAntimeridian(r);
    expect(east.every((p) => p.x <= 180_000_000)).toBe(true);
    expect(west.every((p) => p.x >= -180_000_000 && p.x < 0)).toBe(true);
    const whole = ringAreaSquareMetres(r);
    // The cut points sit on the straight line in longitude/latitude (RFC 7946) and are truncated to the grid.
    expect(Math.abs(ringAreaSquareMetres(east) + ringAreaSquareMetres(west) - whole) / whole).toBeLessThan(1e-6);
    // A ring unwrapped below −180° is shifted first.
    const [e2, w2] = cutAtAntimeridian(r.map((p) => P(p.x - 360_000_000, p.y)));
    expect(e2).toEqual(east);
    expect(w2).toEqual(west);
  });
});

describe('geodesic area', () => {
  it('uses the authalic radius of WGS 84', () => {
    expect(AUTHALIC_RADIUS).toBeCloseTo(6_371_007.181, 3);
  });

  const refs = (JSON.parse(readFileSync(join(import.meta.dirname, '..', 'test-vectors', 'areas.json'), 'utf8')) as { cases: { name: string; ring: number[][]; squareMetres: number }[] }).cases;
  it.each(refs.map((c) => [c.name, c] as const))('matches GeographicLib for %s', (_n, c) => {
    const pts = c.ring.slice(0, -1).map(([x, y]) => P(parseCoordinate((x as number).toFixed(9))?.micro ?? NaN, parseCoordinate((y as number).toFixed(9))?.micro ?? NaN));
    const area = ringAreaSquareMetres(pts);
    // Polygons up to 1° × 1° agree to better than 1e-6 relative; the 10° square to 1e-5.
    const tol = c.squareMetres > 1e11 ? 1e-5 : 1e-6;
    expect(Math.abs(area - c.squareMetres) / c.squareMetres).toBeLessThan(tol);
  });

  it('does not depend on winding or start vertex', () => {
    const a = ringAreaSquareMetres(SQ);
    expect(ringAreaSquareMetres([...SQ].reverse())).toBeCloseTo(a, 9);
    expect(ringAreaSquareMetres([...SQ.slice(2), ...SQ.slice(0, 2)])).toBeCloseTo(a, 9);
  });

  it('subtracts holes and returns zero for degenerate rings', () => {
    const outer = ring([0, 0], [1000, 0], [1000, 1000], [0, 1000]);
    const hole = ring([250, 250], [750, 250], [750, 750], [250, 750]);
    const ha = polygonHectares([outer, hole]);
    expect(ha).toBeCloseTo((polygonHectares([outer]) * 3) / 4, 4);
    expect(ringAreaSquareMetres(ring([0, 0], [1, 1]))).toBe(0);
  });

  it('handles polygons touching the poles', () => {
    const cap = ring([0, 89_000_000], [120_000_000, 89_000_000], [-120_000_000, 89_000_000]);
    expect(ringAreaSquareMetres(cap)).toBeGreaterThan(0);
    expect(Number.isFinite(ringAreaSquareMetres(ring([0, 90_000_000], [1_000_000, 89_000_000], [0, 89_000_000])))).toBe(true);
  });
});

describe('polygon relations', () => {
  const sq = (x: number, y: number, s: number): XY[] => ring([x, y], [x + s, y], [x + s, y + s], [x, y + s]);
  it.each([
    ['disjoint', sq(0, 0, 10), sq(20, 0, 10), 'disjoint'],
    ['touching at a corner', sq(0, 0, 10), sq(10, 10, 10), 'touch'],
    ['sharing a side', sq(0, 0, 10), sq(10, 0, 10), 'shared-edge'],
    ['sharing part of a side', sq(0, 0, 10), sq(10, 5, 10), 'shared-edge'],
    ['crossing', sq(0, 0, 10), sq(5, 5, 10), 'overlap'],
    ['containing', sq(0, 0, 30), sq(10, 10, 5), 'overlap'],
    ['identical', sq(0, 0, 10), sq(0, 0, 10), 'overlap'],
    ['same corners, other start', sq(0, 0, 10), ring([10, 0], [10, 10], [0, 10], [0, 0]), 'overlap'],
    ['triangle on the square\'s corners', sq(0, 0, 10), ring([0, 0], [10, 0], [10, 10]), 'overlap'],
    ['inside touching the boundary', sq(0, 0, 10), ring([0, 0], [5, 0], [5, 5], [0, 5]), 'overlap'],
    ['square with an extra collinear corner', sq(0, 0, 10), ring([0, 0], [5, 0], [10, 0], [10, 10], [0, 10]), 'overlap'],
  ])('%s', (_name, a, b, rel) => {
    expect(polygonRelation(a, b, budget(1e6))).toBe(rel);
    expect(polygonRelation(b, a, budget(1e6))).toBe(rel);
  });

  it('finds a point strictly inside any simple polygon', () => {
    const shapes = [sq(0, 0, 10), ring([0, 0], [20, 0], [20, 20], [10, 1], [0, 20]), ring([0, 0], [10, 0], [1, 1], [0, 10]), ring([0, 0], [3, 0], [3, 1], [1, 1], [1, 3], [0, 3])];
    for (const s of shapes) {
      const p = interiorPoint(s);
      expect(locate(p, s.map((q) => P(q.x * 6, q.y * 6)))).toBe('inside');
    }
  });

  it('stops at the work budget', () => {
    const work = budget(1);
    expect(polygonRelation(sq(0, 0, 10), sq(5, 5, 10), work)).toBeNull();
    expect(work.exhausted).toBe(true);
  });
});
