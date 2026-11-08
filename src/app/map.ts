// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The plot map: an SVG drawing in a simple equirectangular projection
 * (longitude scaled by the cosine of the middle latitude), with no map tiles
 * or any other external resource.
 */

import type { Geometry, Plot, Position } from '../core/model.js';

/** Bounds in millionths of a degree. */
export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** Width of the drawing in SVG units. */
export const VIEW_WIDTH = 1000;

/** Bounds of the plots that have geometry, or null. */
export function boundsOf(plots: readonly Plot[]): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const visit = (p: Position): void => {
    if (p.lon < -180 || p.lon > 180 || p.lat < -90 || p.lat > 90) return;
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  };
  for (const plot of plots) if (plot.geometry !== null) eachPosition(plot.geometry, visit);
  return minX === Infinity ? null : { minX, minY, maxX, maxY };
}

function eachPosition(g: Geometry, fn: (p: Position) => void): void {
  switch (g.type) {
    case 'Point':
      fn(g.position);
      break;
    case 'MultiPoint':
      g.positions.forEach(fn);
      break;
    case 'Polygon':
      for (const r of g.rings) r.forEach(fn);
      break;
    case 'MultiPolygon':
      for (const rs of g.polygons) for (const r of rs) r.forEach(fn);
      break;
    case 'GeometryCollection':
      for (const part of g.geometries) eachPosition(part, fn);
      break;
  }
}

/** A projection from micro-degrees to SVG units. */
export interface Projection {
  readonly width: number;
  readonly height: number;
  project(p: { x: number; y: number }): [number, number];
}

/** Builds a projection that fits the bounds into a drawing VIEW_WIDTH wide, keeping the aspect ratio. */
export function makeProjection(b: Bounds): Projection {
  const midLat = ((b.minY + b.maxY) / 2 / 1e6) * (Math.PI / 180);
  const k = Math.max(0.05, Math.cos(midLat));
  const spanX = Math.max((b.maxX - b.minX) * k, 1);
  const spanY = Math.max(b.maxY - b.minY, 1);
  // Fit within 92 % of a frame at most 1.2 times as tall as wide, so edge points stay visible.
  const maxHeight = VIEW_WIDTH * 1.2;
  const scale = Math.min((VIEW_WIDTH * 0.92) / spanX, (maxHeight * 0.92) / spanY);
  const width = VIEW_WIDTH;
  const height = Math.min(Math.max((spanY * scale) / 0.92, VIEW_WIDTH * 0.35), maxHeight);
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;
  return {
    width,
    height,
    project: (p) => [round(offsetX + (p.x - b.minX) * k * scale), round(offsetY + (b.maxY - p.y) * scale)],
  };
}

const round = (v: number): number => Math.round(v * 100) / 100;

/** SVG path data for the polygons of a geometry (rings closed with Z), or "" when it has none. */
export function polygonPath(g: Geometry, proj: Projection): string {
  const parts: string[] = [];
  const ring = (r: readonly Position[]): void => {
    if (r.length === 0) return;
    parts.push(
      r
        .map((p, i) => {
          const [x, y] = proj.project(p);
          return `${i === 0 ? 'M' : 'L'}${x} ${y}`;
        })
        .join('') + 'Z',
    );
  };
  const visit = (geom: Geometry): void => {
    if (geom.type === 'Polygon') geom.rings.forEach(ring);
    else if (geom.type === 'MultiPolygon') {
      for (const rs of geom.polygons) rs.forEach(ring);
    }
    else if (geom.type === 'GeometryCollection') geom.geometries.forEach(visit);
  };
  visit(g);
  return parts.join('');
}

/** Projected positions of the points of a geometry. */
export function pointPositions(g: Geometry, proj: Projection): [number, number][] {
  const out: [number, number][] = [];
  const visit = (geom: Geometry): void => {
    if (geom.type === 'Point') out.push(proj.project(geom.position));
    else if (geom.type === 'MultiPoint') for (const p of geom.positions) out.push(proj.project(p));
    else if (geom.type === 'GeometryCollection') geom.geometries.forEach(visit);
  };
  visit(g);
  return out;
}

/** A view box around some bounds, with a margin, inside the drawing. */
export function viewBoxFor(b: Bounds, proj: Projection): string {
  const [x0, y1] = proj.project({ x: b.minX, y: b.minY });
  const [x1, y0] = proj.project({ x: b.maxX, y: b.maxY });
  const w = Math.max(x1 - x0, 8);
  const hgt = Math.max(y1 - y0, 8);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const aspect = proj.height / proj.width;
  const vw = Math.max(w, hgt / aspect) * 1.6;
  const vh = vw * aspect;
  return `${round(cx - vw / 2)} ${round(cy - vh / 2)} ${round(vw)} ${round(vh)}`;
}

/** Centre of a polygon geometry whose drawing would be smaller than `minSize` units, so it can get a visible marker; otherwise null. */
export function smallPolygonMarker(g: Geometry, proj: Projection, minSize = 6): [number, number] | null {
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const visit = (geom: Geometry): void => {
    const rings = geom.type === 'Polygon' ? geom.rings : geom.type === 'MultiPolygon' ? geom.polygons.flat() : [];
    for (const r of rings) {
      for (const p of r) {
        const [x, y] = proj.project(p);
        box.x0 = Math.min(box.x0, x);
        box.x1 = Math.max(box.x1, x);
        box.y0 = Math.min(box.y0, y);
        box.y1 = Math.max(box.y1, y);
      }
    }
    if (geom.type === 'GeometryCollection') geom.geometries.forEach(visit);
  };
  visit(g);
  if (box.x0 === Infinity || Math.max(box.x1 - box.x0, box.y1 - box.y0) >= minSize) return null;
  return [round((box.x0 + box.x1) / 2), round((box.y0 + box.y1) / 2)];
}
