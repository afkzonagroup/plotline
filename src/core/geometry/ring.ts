// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// Linear-ring analysis on integer coordinates: closure, repeated vertices,
// spikes, collinearity, orientation, self-intersection and antimeridian
// unwrapping. Rings here are vertex lists without the closing repeat
// ("open" form) unless a function says otherwise.

import { MICRO } from '../coords.js';
import { orient, samePoint, segmentRelation, type SegmentRelation, type XY } from './predicates.js';

/** Shared work counter for the quadratic-in-the-worst-case checks. */
export interface Budget {
  remaining: number;
  exhausted: boolean;
}

/** Creates a budget of `n` segment-pair tests. */
export const budget = (n: number): Budget => ({ remaining: n, exhausted: false });

/** True when the last position repeats the first. */
export function isClosed(ring: readonly XY[]): boolean {
  const first = ring[0];
  const last = ring[ring.length - 1];
  return ring.length >= 2 && first !== undefined && last !== undefined && samePoint(first, last);
}

/** Drops the closing repeat if present. */
export function openRing<T extends XY>(ring: readonly T[]): T[] {
  return isClosed(ring) ? ring.slice(0, -1) : ring.slice();
}

/** Appends the first vertex to an open ring. */
export function closeRing<T extends XY>(open: readonly T[]): T[] {
  const first = open[0];
  return first === undefined ? [] : [...open, first];
}

/** Removes consecutive repeated vertices of an open ring, treating it as cyclic. Returns how many were removed. */
export function dedupeCyclic<T extends XY>(open: readonly T[]): { ring: T[]; removed: number } {
  const out: T[] = [];
  for (const p of open) {
    const prev = out[out.length - 1];
    if (prev === undefined || !samePoint(prev, p)) out.push(p);
  }
  while (out.length > 1 && samePoint(out[0] as T, out[out.length - 1] as T)) out.pop();
  return { ring: out, removed: open.length - out.length };
}

/**
 * True when the vertex at `i` is a spike: the ring arrives and leaves along
 * the same line in opposite directions, so two sides overlap.
 */
function isSpike(ring: readonly XY[], i: number): boolean {
  const n = ring.length;
  const p = ring[(i - 1 + n) % n] as XY;
  const v = ring[i] as XY;
  const q = ring[(i + 1) % n] as XY;
  if (orient(p, v, q) !== 0) return false;
  // Collinear: a spike when the direction reverses (dot product negative or the far point repeats).
  const dot = (v.x - p.x) * (q.x - v.x) + (v.y - p.y) * (q.y - v.y);
  return dot < 0 || samePoint(p, q);
}

/** Indexes of spike vertices of a deduplicated open ring. */
export function findSpikes(ring: readonly XY[]): number[] {
  if (ring.length < 3) return [];
  const out: number[] = [];
  for (let i = 0; i < ring.length; i++) if (isSpike(ring, i)) out.push(i);
  return out;
}

/**
 * Removes spike vertices repeatedly (removing one can expose another, or
 * make neighbours repeat). Area is unchanged: a spike encloses nothing.
 */
export function removeSpikes<T extends XY>(open: readonly T[]): { ring: T[]; removed: number } {
  let ring = dedupeCyclic(open).ring;
  let removed = open.length - ring.length;
  for (let guard = 0; guard <= open.length && ring.length >= 3; guard++) {
    const spikes = findSpikes(ring);
    if (spikes.length === 0) break;
    const first = spikes[0] as number;
    const next = dedupeCyclic(ring.filter((_, i) => i !== first)).ring;
    removed += ring.length - next.length;
    ring = next;
  }
  return { ring, removed };
}

/** True when every vertex lies on one line (the ring encloses no area). */
export function isCollinear(open: readonly XY[]): boolean {
  const a = open[0];
  if (a === undefined) return true;
  const b = open.find((p) => !samePoint(p, a));
  if (b === undefined) return true;
  return open.every((c) => orient(a, b, c) === 0);
}

/**
 * Sign of the signed area of an open ring: 1 counter-clockwise, −1 clockwise,
 * 0 none. Computed in floating point relative to the first vertex and
 * recomputed exactly with BigInt when small.
 */
export function ringOrientation(open: readonly XY[]): -1 | 0 | 1 {
  const n = open.length;
  if (n < 3) return 0;
  const o = open[0] as XY;
  let sum = 0;
  let mag = 0;
  for (let i = 0; i < n; i++) {
    const a = open[i] as XY;
    const b = open[(i + 1) % n] as XY;
    const t = (a.x - o.x) * (b.y - o.y) - (b.x - o.x) * (a.y - o.y);
    sum += t;
    mag += Math.abs(t);
  }
  if (Math.abs(sum) > mag * 1e-12 + 1e6) return sum > 0 ? 1 : -1;
  let exact = 0n;
  for (let i = 0; i < n; i++) {
    const a = open[i] as XY;
    const b = open[(i + 1) % n] as XY;
    exact += BigInt(a.x - o.x) * BigInt(b.y - o.y) - BigInt(b.x - o.x) * BigInt(a.y - o.y);
  }
  return exact > 0n ? 1 : exact < 0n ? -1 : 0;
}

/** A place where a ring meets itself: edges i and j (edge k joins vertex k to vertex k+1). */
export interface SelfIntersection {
  readonly i: number;
  readonly j: number;
  readonly relation: SegmentRelation | 'repeated-vertex';
  /** An approximate location (degrees), for messages and maps. */
  readonly at: { readonly lon: number; readonly lat: number };
}

const toDeg = (p: XY): { lon: number; lat: number } => ({ lon: p.x / MICRO, lat: p.y / MICRO });

/**
 * Finds a place where a deduplicated, spike-free open ring touches or crosses
 * itself, or returns null. Uses a sweep over x so typical rings cost about
 * n log n; every segment-pair test is charged to the budget, and when the
 * budget runs out the search stops with `budget.exhausted` set.
 */
export function findSelfIntersection(open: readonly XY[], work: Budget): SelfIntersection | null {
  const n = open.length;
  if (n < 3) return null;
  const seen = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const p = open[i] as XY;
    const key = `${p.x},${p.y}`;
    const prev = seen.get(key);
    if (prev !== undefined) return { i: prev, j: i, relation: 'repeated-vertex', at: toDeg(p) };
    seen.set(key, i);
  }
  const minX = new Float64Array(n);
  const maxX = new Float64Array(n);
  const minY = new Float64Array(n);
  const maxY = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = open[i] as XY;
    const b = open[(i + 1) % n] as XY;
    minX[i] = Math.min(a.x, b.x);
    maxX[i] = Math.max(a.x, b.x);
    minY[i] = Math.min(a.y, b.y);
    maxY[i] = Math.max(a.y, b.y);
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((p, q) => (minX[p] as number) - (minX[q] as number) || p - q);
  let active: number[] = [];
  for (const e of order) {
    const ex = minX[e] as number;
    active = active.filter((a) => (maxX[a] as number) >= ex);
    for (const a of active) {
      work.remaining--;
      if (work.remaining < 0) {
        work.exhausted = true;
        return null;
      }
      if ((maxY[a] as number) < (minY[e] as number) || (maxY[e] as number) < (minY[a] as number)) continue;
      const adjacent = Math.abs(a - e) === 1 || Math.abs(a - e) === n - 1;
      const pa = open[a] as XY;
      const pb = open[(a + 1) % n] as XY;
      const pc = open[e] as XY;
      const pd = open[(e + 1) % n] as XY;
      const rel = segmentRelation(pa, pb, pc, pd);
      if (adjacent) {
        // Neighbouring edges share a vertex; only a collinear overlap is a fault.
        if (rel === 'overlap') return { i: Math.min(a, e), j: Math.max(a, e), relation: rel, at: toDeg(Math.abs(a - e) === 1 ? (open[Math.max(a, e)] as XY) : (open[0] as XY)) };
        continue;
      }
      if (rel !== 'none') return { i: Math.min(a, e), j: Math.max(a, e), relation: rel, at: intersectionPoint(pa, pb, pc, pd) };
    }
    active.push(e);
  }
  return null;
}

/** Approximate meeting point of two segments, in degrees (for messages only). */
function intersectionPoint(a: XY, b: XY, c: XY, d: XY): { lon: number; lat: number } {
  const den = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
  if (den === 0) {
    // Collinear: report the start of the overlap.
    for (const p of [c, d, a, b]) {
      if (Math.min(a.x, b.x) <= p.x && p.x <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= p.y && p.y <= Math.max(a.y, b.y) && Math.min(c.x, d.x) <= p.x && p.x <= Math.max(c.x, d.x) && Math.min(c.y, d.y) <= p.y && p.y <= Math.max(c.y, d.y)) return toDeg(p);
    }
    return toDeg(a);
  }
  const t = ((a.x - c.x) * (c.y - d.y) - (a.y - c.y) * (c.x - d.x)) / den;
  return { lon: Math.round((a.x + t * (b.x - a.x))) / MICRO, lat: Math.round((a.y + t * (b.y - a.y))) / MICRO };
}

/** Half a turn of longitude in millionths of a degree. */
export const HALF_TURN = 180 * MICRO;

/** True when some edge spans more than 180 degrees of longitude, which almost always means the ring crosses the antimeridian. */
export function crossesAntimeridian(open: readonly XY[]): boolean {
  const n = open.length;
  for (let i = 0; i < n; i++) {
    const a = open[i] as XY;
    const b = open[(i + 1) % n] as XY;
    if (Math.abs(b.x - a.x) > HALF_TURN) return true;
  }
  return false;
}

/** A vertex with its longitude unwrapped, pointing back to the source vertex. */
export interface Unwrapped<T> extends XY {
  readonly src: T;
}

/**
 * Shifts longitudes by whole turns so that no edge spans more than 180
 * degrees. Returns null when the ring cannot be unwrapped consistently
 * (it winds around a pole).
 */
export function unwrapRing<T extends XY>(open: readonly T[]): Unwrapped<T>[] | null {
  const n = open.length;
  if (n === 0) return [];
  const out: Unwrapped<T>[] = [];
  let shift = 0;
  let prevX = (open[0] as T).x;
  for (let i = 0; i < n; i++) {
    const p = open[i] as T;
    if (i > 0) {
      const dx = p.x - prevX;
      if (dx > HALF_TURN) shift -= 2 * HALF_TURN;
      else if (dx < -HALF_TURN) shift += 2 * HALF_TURN;
    }
    prevX = p.x;
    out.push({ x: p.x + shift, y: p.y, src: p });
  }
  // The closing edge must not need a further shift.
  const last = out[n - 1] as XY;
  const first = out[0] as XY;
  if (Math.abs(first.x - last.x) > HALF_TURN) return null;
  return out;
}
