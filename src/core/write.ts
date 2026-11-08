// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// Writes plots as a GeoJSON FeatureCollection in the shape of the
// Commission's examples: "type", "properties", "geometry" for each feature,
// longitude and latitude only, six decimal places at most, one feature per
// line. The Python package writes the same bytes.

import { formatMicro } from './coords.js';
import { quoteJson, stringifyJson, type JsonValue } from './json.js';
import type { Geometry, Plot, Position, Ring } from './model.js';

const pos = (p: Position): string => `[${formatMicro(p.x)},${formatMicro(p.y)}]`;
const ring = (r: Ring): string => `[${r.map(pos).join(',')}]`;
const rings = (rs: readonly Ring[]): string => `[${rs.map(ring).join(',')}]`;

/** Serialises a geometry. */
export function writeGeometry(g: Geometry): string {
  switch (g.type) {
    case 'Point':
      return `{"type":"Point","coordinates":${pos(g.position)}}`;
    case 'MultiPoint':
      return `{"type":"MultiPoint","coordinates":[${g.positions.map(pos).join(',')}]}`;
    case 'Polygon':
      return `{"type":"Polygon","coordinates":${rings(g.rings)}}`;
    case 'MultiPolygon':
      return `{"type":"MultiPolygon","coordinates":[${g.polygons.map(rings).join(',')}]}`;
    case 'GeometryCollection':
      return `{"type":"GeometryCollection","geometries":[${g.geometries.map(writeGeometry).join(',')}]}`;
  }
}

function writeProperties(props: ReadonlyMap<string, JsonValue> | null): string {
  if (props === null) return 'null';
  const parts: string[] = [];
  for (const [k, v] of props) parts.push(`${quoteJson(k)}:${stringifyJson(v)}`);
  return `{${parts.join(',')}}`;
}

/** Serialises one plot as a Feature. */
export function writeFeature(plot: Plot): string {
  if (plot.rawFeature !== null) return stringifyJson(plot.rawFeature);
  const id = plot.id === null ? '' : `"id":${stringifyJson(plot.id)},`;
  const geometry = plot.geometry !== null ? writeGeometry(plot.geometry) : plot.rawGeometry !== null ? stringifyJson(plot.rawGeometry) : 'null';
  return `{"type":"Feature",${id}"properties":${writeProperties(plot.properties)},"geometry":${geometry}}`;
}

/** Serialises plots as a FeatureCollection, one feature per line, ending with a newline. */
export function writeFeatureCollection(plots: readonly Plot[]): string {
  if (plots.length === 0) return '{"type":"FeatureCollection","features":[]}\n';
  return `{"type":"FeatureCollection","features":[\n${plots.map(writeFeature).join(',\n')}\n]}\n`;
}

/** Size in bytes of the UTF-8 encoding of a text. */
export function utf8Length(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}
