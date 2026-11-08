// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// Relation between two valid simple polygons (exterior rings, open form),
// decided exactly on the integer grid:
//
// - "overlap": their interiors share area;
// - "shared-edge": they share part of a side but no area (neighbouring plots);
// - "touch": they meet only at points;
// - "disjoint": they do not meet.
//
// Interiors overlap exactly when two sides cross properly, or when a vertex,
// a side's midpoint or a guaranteed interior point of one ring lies strictly
// inside the other. All points are tested on the grid scaled by 6, so the
// midpoints (halves) and triangle centroids (thirds) stay integers.

import { locate, segmentRelation, type XY } from './predicates.js';
import type { Budget } from './ring.js';

/** Relation between two polygons. */
export type PolygonRelation = 'overlap' | 'shared-edge' | 'touch' | 'disjoint';

const SCALE = 6;

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Bounding box of a ring. */
export function boxOf(ring: readonly XY[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

const scaled = (ring: readonly XY[]): XY[] => ring.map((p) => ({ x: p.x * SCALE, y: p.y * SCALE }));

/**
 * A point strictly inside a valid simple ring, on the grid scaled by 6
 * (O'Rourke, Computational Geometry in C, section 1.6: a diagonal from a
 * convex vertex).
 */
export function interiorPoint(ring: readonly XY[]): XY {
  const n = ring.length;
  let v = 0;
  for (let i = 1; i < n; i++) {
    const p = ring[i] as XY;
    const best = ring[v] as XY;
    if (p.x < best.x || (p.x === best.x && p.y < best.y)) v = i;
  }
  const a = ring[(v - 1 + n) % n] as XY;
  const b = ring[(v + 1) % n] as XY;
  const c = ring[v] as XY;
  const triangle = [a, c, b];
  let q: XY | null = null;
  let qDist = -1n;
  for (let i = 0; i < n; i++) {
    if (i === v || i === (v - 1 + n) % n || i === (v + 1) % n) continue;
    const p = ring[i] as XY;
    if (locate(p, triangle) === 'outside') continue;
    const d = BigInt(b.x - a.x) * BigInt(p.y - a.y) - BigInt(b.y - a.y) * BigInt(p.x - a.x);
    const dist = d < 0n ? -d : d;
    if (dist > qDist) {
      qDist = dist;
      q = p;
    }
  }
  if (q === null) return { x: 2 * (a.x + b.x + c.x), y: 2 * (a.y + b.y + c.y) };
  return { x: 3 * (c.x + q.x), y: 3 * (c.y + q.y) };
}

/**
 * Relation between two valid simple rings. Every segment-pair and
 * point-in-ring test is charged to `work`; returns null when it runs out.
 */
export function polygonRelation(a: readonly XY[], b: readonly XY[], work: Budget): PolygonRelation | null {
  const ba = boxOf(a);
  const bb = boxOf(b);
  if (ba.maxX < bb.minX || bb.maxX < ba.minX || ba.maxY < bb.minY || bb.maxY < ba.minY) return 'disjoint';

  // 1. Sides: a proper crossing means overlap; collinear overlap means a shared side.
  let shared = false;
  let touch = false;
  const na = a.length;
  const nb = b.length;
  const edges: { ring: 0 | 1; i: number; minX: number; maxX: number; minY: number; maxY: number }[] = [];
  for (let i = 0; i < na; i++) {
    const p = a[i] as XY;
    const q = a[(i + 1) % na] as XY;
    edges.push({ ring: 0, i, minX: Math.min(p.x, q.x), maxX: Math.max(p.x, q.x), minY: Math.min(p.y, q.y), maxY: Math.max(p.y, q.y) });
  }
  for (let i = 0; i < nb; i++) {
    const p = b[i] as XY;
    const q = b[(i + 1) % nb] as XY;
    edges.push({ ring: 1, i, minX: Math.min(p.x, q.x), maxX: Math.max(p.x, q.x), minY: Math.min(p.y, q.y), maxY: Math.max(p.y, q.y) });
  }
  edges.sort((p, q) => p.minX - q.minX || p.ring - q.ring || p.i - q.i);
  let active: typeof edges = [];
  for (const e of edges) {
    active = active.filter((x) => x.maxX >= e.minX);
    for (const o of active) {
      if (o.ring === e.ring) continue;
      work.remaining--;
      if (work.remaining < 0) {
        work.exhausted = true;
        return null;
      }
      if (o.maxY < e.minY || e.maxY < o.minY) continue;
      const [ea, eb] = e.ring === 0 ? [a, na] : [b, nb];
      const [oa, ob] = o.ring === 0 ? [a, na] : [b, nb];
      const rel = segmentRelation(ea[e.i] as XY, ea[(e.i + 1) % eb] as XY, oa[o.i] as XY, oa[(o.i + 1) % ob] as XY);
      if (rel === 'cross') return 'overlap';
      if (rel === 'overlap') shared = true;
      else if (rel === 'touch') touch = true;
    }
    active.push(e);
  }

  // 2. Points of one ring strictly inside the other.
  const sa = scaled(a);
  const sb = scaled(b);
  const probes = (ring: readonly XY[], s: readonly XY[]): XY[] => {
    const out: XY[] = [...s];
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i] as XY;
      const q = ring[(i + 1) % ring.length] as XY;
      out.push({ x: (p.x + q.x) * (SCALE / 2), y: (p.y + q.y) * (SCALE / 2) });
    }
    out.push(interiorPoint(ring));
    return out;
  };
  for (const [probesOf, target] of [
    [probes(a, sa), sb],
    [probes(b, sb), sa],
  ] as const) {
    for (const p of probesOf) {
      work.remaining -= target.length;
      if (work.remaining < 0) {
        work.exhausted = true;
        return null;
      }
      const loc = locate(p, target);
      if (loc === 'inside') return 'overlap';
      if (loc === 'boundary') touch = true;
    }
  }
  return shared ? 'shared-edge' : touch ? 'touch' : 'disjoint';
}
