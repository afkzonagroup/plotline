// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// The in-memory model of a plot file, independent of the input format.

import type { JsonValue } from './json.js';
import { rule, type RuleId, type Severity } from './rules.js';

/** One position. `x` and `y` are longitude and latitude in millionths of a degree, truncated to six decimals. */
export interface Position {
  readonly x: number;
  readonly y: number;
  /** Source longitude as a double (before truncation). */
  readonly lon: number;
  /** Source latitude as a double (before truncation). */
  readonly lat: number;
  /** Decimal places written in the source: the larger of longitude's and latitude's. */
  readonly decimals: number;
  /** True when truncation to six decimals changed longitude or latitude. */
  readonly truncated: boolean;
  /** Number of values after longitude and latitude (for example altitude). */
  readonly extra: number;
}

/** A linear ring as written: positions in order, normally with the first repeated at the end. */
export type Ring = readonly Position[];

/** Geometry types the Information System accepts. */
export type Geometry =
  | { readonly type: 'Point'; readonly position: Position }
  | { readonly type: 'MultiPoint'; readonly positions: readonly Position[] }
  | { readonly type: 'Polygon'; readonly rings: readonly Ring[] }
  | { readonly type: 'MultiPolygon'; readonly polygons: readonly (readonly Ring[])[] }
  | { readonly type: 'GeometryCollection'; readonly geometries: readonly Geometry[] };

/** One plot (a GeoJSON Feature). */
export interface Plot {
  /** Where the feature came from, as a JSON Pointer into the source (for CSV and KML, into the converted FeatureCollection). */
  readonly path: string;
  /** JSON Pointer of the geometry in the source. */
  readonly geometryPath: string;
  /** Source line (CSV) or element line (KML), when known. */
  readonly line: number | null;
  /** The feature's "id" member, if any. */
  readonly id: JsonValue | null;
  /** The feature's properties; null when the member is null or absent. */
  readonly properties: ReadonlyMap<string, JsonValue> | null;
  /** The geometry, or null when it is null, absent or could not be read. */
  readonly geometry: Geometry | null;
  /**
   * The source geometry, kept verbatim when it could not be read (for example
   * a LineString), so output does not silently lose it.
   */
  readonly rawGeometry: JsonValue | null;
  /** The whole source item, kept verbatim when it is not a Feature at all. */
  readonly rawFeature: JsonValue | null;
}

/** A plot file in memory. */
export interface PlotFile {
  readonly plots: readonly Plot[];
}

/** One finding. */
export interface Issue {
  readonly rule: RuleId;
  readonly severity: Severity;
  /** JSON Pointer of the offending value in the source; "" for the whole file. */
  readonly path: string;
  /** Index of the plot in the file, or null for file-level findings. */
  readonly feature: number | null;
  readonly message: string;
  /** True when `plotline fix` repairs it. */
  readonly fixable: boolean;
  /** Source line, when known. */
  readonly line: number | null;
}

/** One change made by `fix`. */
export interface Change {
  readonly rule: RuleId;
  readonly path: string;
  readonly feature: number | null;
  readonly message: string;
}

/** Collects findings in order. */
export class Findings {
  readonly issues: Issue[] = [];

  /** Adds a finding with the rule's usual severity unless one is given. */
  add(id: RuleId, path: string, feature: number | null, message: string, opts: { severity?: Severity; fixable?: boolean; line?: number | null } = {}): void {
    const r = rule(id);
    this.issues.push({
      rule: id,
      severity: opts.severity ?? r.severity,
      path,
      feature,
      message,
      fixable: opts.fixable ?? r.fix !== null,
      line: opts.line ?? null,
    });
  }
}

/** Builds a JSON Pointer from segments (RFC 6901 escaping). */
export function pointer(base: string, ...segments: (string | number)[]): string {
  let out = base;
  for (const s of segments) out += `/${String(s).replace(/~/g, '~0').replace(/\//g, '~1')}`;
  return out;
}

/** Every position of a geometry with its path. */
export function forEachPosition(geometry: Geometry, path: string, fn: (p: Position, path: string) => void): void {
  switch (geometry.type) {
    case 'Point':
      fn(geometry.position, pointer(path, 'coordinates'));
      break;
    case 'MultiPoint':
      geometry.positions.forEach((p, i) => {
        fn(p, pointer(path, 'coordinates', i));
      });
      break;
    case 'Polygon':
      geometry.rings.forEach((ring, r) => {
        ring.forEach((p, i) => {
          fn(p, pointer(path, 'coordinates', r, i));
        });
      });
      break;
    case 'MultiPolygon':
      geometry.polygons.forEach((rings, k) => {
        rings.forEach((ring, r) => {
          ring.forEach((p, i) => {
            fn(p, pointer(path, 'coordinates', k, r, i));
          });
        });
      });
      break;
    case 'GeometryCollection':
      geometry.geometries.forEach((g, i) => {
        forEachPosition(g, pointer(path, 'geometries', i), fn);
      });
      break;
  }
}
