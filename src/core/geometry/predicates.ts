// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// Exact geometric predicates on integer coordinates. Inputs are integers
// (millionths of a degree, sometimes scaled by a small factor), so the
// orientation test is computed in floating point with an error bound and
// recomputed with BigInt when the result is too close to zero to trust.
// The Python package uses exact integers throughout; both give the same answer.

/** A point with integer coordinates. */
export interface XY {
  readonly x: number;
  readonly y: number;
}

/** Sign of the cross product (b − a) × (c − a): 1 counter-clockwise, −1 clockwise, 0 collinear. */
export function orient(a: XY, b: XY, c: XY): -1 | 0 | 1 {
  const dx1 = b.x - a.x;
  const dy1 = b.y - a.y;
  const dx2 = c.x - a.x;
  const dy2 = c.y - a.y;
  const t1 = dx1 * dy2;
  const t2 = dy1 * dx2;
  const det = t1 - t2;
  // Each product and the difference carry at most a few ulps of error.
  const bound = (Math.abs(t1) + Math.abs(t2)) * 1e-15;
  if (det > bound) return 1;
  if (det < -bound) return -1;
  const exact = BigInt(dx1) * BigInt(dy2) - BigInt(dy1) * BigInt(dx2);
  return exact > 0n ? 1 : exact < 0n ? -1 : 0;
}

/** True when c lies within the axis-aligned box of segment a–b (used only for collinear points). */
function within(a: XY, b: XY, c: XY): boolean {
  return Math.min(a.x, b.x) <= c.x && c.x <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= c.y && c.y <= Math.max(a.y, b.y);
}

/** Same point. */
export const samePoint = (a: XY, b: XY): boolean => a.x === b.x && a.y === b.y;

/**
 * How two closed segments a–b and c–d meet:
 * - "none": they do not meet;
 * - "cross": they cross at a single point inside both;
 * - "touch": they meet at a single point that is an end of at least one;
 * - "overlap": they are collinear and share more than one point.
 */
export type SegmentRelation = 'none' | 'cross' | 'touch' | 'overlap';

/** Classifies how two segments meet. Degenerate (zero-length) segments are treated as points. */
export function segmentRelation(a: XY, b: XY, c: XY, d: XY): SegmentRelation {
  if (Math.max(a.x, b.x) < Math.min(c.x, d.x) || Math.max(c.x, d.x) < Math.min(a.x, b.x)) return 'none';
  if (Math.max(a.y, b.y) < Math.min(c.y, d.y) || Math.max(c.y, d.y) < Math.min(a.y, b.y)) return 'none';
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0) {
    return o1 !== o2 && o3 !== o4 ? 'cross' : 'none';
  }
  if (o1 === 0 && o2 === 0) {
    // Collinear (or degenerate): compare the overlap along the dominant axis.
    const useX = a.x !== b.x || c.x !== d.x;
    const [a0, a1] = useX ? [Math.min(a.x, b.x), Math.max(a.x, b.x)] : [Math.min(a.y, b.y), Math.max(a.y, b.y)];
    const [c0, c1] = useX ? [Math.min(c.x, d.x), Math.max(c.x, d.x)] : [Math.min(c.y, d.y), Math.max(c.y, d.y)];
    const lo = Math.max(a0, c0);
    const hi = Math.min(a1, c1);
    if (lo > hi) return 'none';
    if (lo < hi) return 'overlap';
    return 'touch';
  }
  // Exactly one endpoint lies on the other segment's line.
  if (o1 === 0 && within(a, b, c)) return 'touch';
  if (o2 === 0 && within(a, b, d)) return 'touch';
  if (o3 === 0 && within(c, d, a)) return 'touch';
  if (o4 === 0 && within(c, d, b)) return 'touch';
  return 'none';
}

/** Where a point lies relative to a closed ring. */
export type Location = 'inside' | 'outside' | 'boundary';

/**
 * Locates a point relative to a ring (first vertex not repeated at the end)
 * with the crossing-number rule and exact orientation tests.
 */
export function locate(p: XY, ring: readonly XY[]): Location {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = ring[j] as XY;
    const b = ring[i] as XY;
    if (orient(a, b, p) === 0 && within(a, b, p)) return 'boundary';
    if (a.y > p.y !== b.y > p.y) {
      // Edge straddles the horizontal line through p: is the crossing to the right of p?
      const o = orient(a, b, p);
      if (b.y > a.y ? o > 0 : o < 0) inside = !inside;
    }
  }
  return inside ? 'inside' : 'outside';
}
