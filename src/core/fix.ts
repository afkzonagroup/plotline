// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// Safe repairs. Each repair keeps the plot's location and area: closing
// rings, removing repeated positions and spike tips, reversing winding,
// truncating to six decimals, dropping altitude, renaming mis-cased
// properties, writing numeric text as numbers, normalising country codes,
// unwrapping single-part collections, cutting at the antimeridian, and
// removing exact duplicate plots. Every change is reported. Anything that
// would need a judgement about the land itself (self-intersections, holes,
// overlaps, missing data) is left for the user.

import { analyzePolygon, type PolygonAnalysis } from './analyze.js';
import { ISO_3166_ALPHA2, USER_ASSIGNED_KOSOVO } from './countries.js';
import { orient, type XY } from './geometry/predicates.js';
import { budget, closeRing, unwrapRing, type Budget } from './geometry/ring.js';
import { MICRO } from './coords.js';
import type { JsonValue } from './json.js';
import { forEachPosition, pointer, type Change, type Geometry, type Issue, type Plot, type Position, type Ring } from './model.js';
import { effectiveProperties, geometryKey, KNOWN_PROPERTIES, sameAttributes, truncatedInRange } from './validate.js';

/** Options for {@link fixPlots}. */
export interface FixOptions {
  /** ISO 3166-1 alpha-2 code to write as ProducerCountry where it is missing. */
  readonly country?: string | undefined;
  /** Remove properties the Information System ignores. Default false. */
  readonly stripUnknownProperties?: boolean | undefined;
  /** Remove vertices that lie exactly on the straight line between their neighbours (shape unchanged; smaller file). Default false. */
  readonly simplifyCollinear?: boolean | undefined;
  /** Cut polygons that cross the antimeridian. Default true. */
  readonly cutAntimeridian?: boolean | undefined;
  /** Remove exact duplicate plots. Default true. */
  readonly removeDuplicates?: boolean | undefined;
  /** Work budget for geometry checks. */
  readonly checkBudget?: number | undefined;
}

/** Result of {@link fixPlots}. */
export interface FixResult {
  readonly plots: Plot[];
  readonly changes: Change[];
}

const KNOWN_LOWER = new Map<string, string>(KNOWN_PROPERTIES.map((k) => [k.toLowerCase(), k]));
const DECIMAL_TEXT = /^([0-9]+)(\.[0-9]+)?$/;

/** A position on the six-decimal grid with no source detail. */
const gridPosition = (p: XY): Position => ({ x: p.x, y: p.y, lon: p.x / MICRO, lat: p.y / MICRO, decimals: 6, truncated: false, extra: 0 });

/** Writes a plain decimal text as a JSON number text: "007.50" becomes "7.50". */
function decimalToJsonNumber(text: string): string | null {
  const m = DECIMAL_TEXT.exec(text.trim());
  if (m === null) return null;
  const int = (m[1] ?? '').replace(/^0+(?=[0-9])/, '');
  return `${int}${m[2] ?? ''}`;
}

/** Checks a country code given on the command line or in options. */
export function validCountryOption(code: string): boolean {
  return /^[A-Z]{2}$/.test(code) && (ISO_3166_ALPHA2.has(code) || code === USER_ASSIGNED_KOSOVO);
}

/**
 * Repairs plots. `readFindings` are the reader's findings; the fixable ones
 * (wrapping, dropped members) are already reflected in the model and are
 * reported as changes here.
 */
export function fixPlots(plots: readonly Plot[], readFindings: readonly Issue[], options: FixOptions = {}): FixResult {
  if (options.country !== undefined && !validCountryOption(options.country)) throw new RangeError('country must be an ISO 3166-1 alpha-2 code in upper case');
  const changes: Change[] = [];
  const work: Budget = budget(options.checkBudget ?? 50_000_000);
  for (const f of readFindings) {
    if (f.fixable) changes.push({ rule: f.rule, path: f.path, feature: f.feature, message: f.message });
  }
  let truncated = 0;
  let intoRange = 0;
  let altitude = 0;
  const out: Plot[] = [];

  plots.forEach((plot, index) => {
    if (plot.rawFeature !== null) {
      out.push(plot);
      return;
    }
    const properties = fixProperties(plot, index);
    let geometry = plot.geometry;
    if (geometry !== null) {
      const seen = { truncated: false, altitude: false, intoRange: false, stillOut: false };
      forEachPosition(geometry, '', (p) => {
        if (p.truncated) seen.truncated = true;
        if (p.extra > 0) seen.altitude = true;
        if (Math.abs(p.lon) > 180 || Math.abs(p.lat) > 90) {
          if (truncatedInRange(p)) seen.intoRange = true;
          else seen.stillOut = true;
        }
      });
      if (seen.truncated) truncated++;
      if (seen.intoRange && !seen.stillOut) intoRange++;
      if (seen.altitude) altitude++;
      geometry = fixGeometry(geometry, plot.geometryPath, index, false);
    }
    out.push({ ...plot, properties, geometry });
  });

  if (truncated > 0) changes.push({ rule: 'excess-precision', path: '', feature: null, message: `Truncated coordinates of ${truncated} plot(s) to six decimal places.` });
  if (intoRange > 0) changes.push({ rule: 'coordinate-out-of-range', path: '', feature: null, message: `Truncation to six decimals brought coordinates of ${intoRange} plot(s) within −180…180 and −90…90.` });
  if (altitude > 0) changes.push({ rule: 'altitude-present', path: '', feature: null, message: `Dropped values after longitude and latitude in ${altitude} plot(s).` });

  if (options.removeDuplicates === false) return { plots: out, changes: uniqueChanges(changes) };
  const kept: Plot[] = [];
  const seen = new Map<string, Plot[]>();
  out.forEach((plot, index) => {
    const key = plot.geometry === null ? null : geometryKey(plot.geometry, analysesOf(plot.geometry));
    if (key !== null) {
      const earlier = seen.get(key) ?? [];
      const twin = earlier.find((e) => sameAttributes(e, plot));
      if (twin !== undefined) {
        changes.push({ rule: 'duplicate-plot', path: plot.path, feature: index, message: 'Removed this plot: an earlier plot has the same geometry and properties.' });
        return;
      }
      earlier.push(plot);
      seen.set(key, earlier);
    }
    kept.push(plot);
  });
  return { plots: kept, changes: uniqueChanges(changes) };

  // ---- helpers ----

  function analysesOf(g: Geometry): PolygonAnalysis[] {
    if (g.type === 'Polygon') return [analyzePolygon(g.rings, work)];
    if (g.type === 'MultiPolygon') return g.polygons.map((rs) => analyzePolygon(rs, work));
    return [];
  }

  function fixProperties(plot: Plot, index: number): Map<string, JsonValue> | null {
    const ppath = pointer(plot.path, 'properties');
    if (plot.properties === null && options.country === undefined) return null;
    const props = effectiveProperties(plot.properties);
    if (plot.properties !== null) {
      for (const k of plot.properties.keys()) {
        const canonical = KNOWN_LOWER.get(k.toLowerCase());
        if (canonical !== undefined && canonical !== k && !plot.properties.has(canonical)) changes.push({ rule: 'property-name-case', path: pointer(ppath, k), feature: index, message: `Renamed property "${k}" to "${canonical}".` });
      }
    }
    const area = props.get('Area');
    if (area?.kind === 'string') {
      const raw = decimalToJsonNumber(area.value);
      if (raw !== null) {
        props.set('Area', { kind: 'number', raw, value: Number(raw) });
        changes.push({ rule: 'area-not-number', path: pointer(ppath, 'Area'), feature: index, message: `Wrote Area ${JSON.stringify(area.value)} as the number ${raw}.` });
      }
    }
    const country = props.get('ProducerCountry');
    if (country?.kind === 'string') {
      const code = country.value.trim().toUpperCase();
      if (code !== country.value && (ISO_3166_ALPHA2.has(code) || code === USER_ASSIGNED_KOSOVO)) {
        props.set('ProducerCountry', { kind: 'string', value: code });
        changes.push({ rule: 'producer-country-format', path: pointer(ppath, 'ProducerCountry'), feature: index, message: `Wrote ProducerCountry ${JSON.stringify(country.value)} as "${code}".` });
      }
    } else if (country === undefined && options.country !== undefined) {
      props.set('ProducerCountry', { kind: 'string', value: options.country });
      changes.push({ rule: 'producer-country-missing', path: ppath, feature: index, message: `Set ProducerCountry to "${options.country}" (from --country).` });
    }
    if (options.stripUnknownProperties === true) {
      const removed = [...props.keys()].filter((k) => !(KNOWN_PROPERTIES as readonly string[]).includes(k));
      for (const k of removed) props.delete(k);
      if (removed.length > 0) changes.push({ rule: 'unknown-properties', path: ppath, feature: index, message: `Removed properties the Information System ignores: ${removed.map((k) => JSON.stringify(k)).join(', ')}.` });
    }
    return props;
  }

  function fixGeometry(g: Geometry, path: string, index: number, inCollection: boolean): Geometry {
    switch (g.type) {
      case 'Point':
        return g;
      case 'MultiPoint':
        if (g.positions.length === 1) {
          changes.push({ rule: 'single-part-multi', path, feature: index, message: 'Wrote the one-position MultiPoint as a Point.' });
          return { type: 'Point', position: g.positions[0] as Position };
        }
        return g;
      case 'Polygon': {
        const parts = fixPolygon(g.rings, pointer(path, 'coordinates'), index);
        if (parts.length === 1) return { type: 'Polygon', rings: parts[0] as Ring[] };
        return { type: 'MultiPolygon', polygons: parts };
      }
      case 'MultiPolygon': {
        const polygons: Ring[][] = [];
        g.polygons.forEach((rings, i) => {
          polygons.push(...fixPolygon(rings, pointer(path, 'coordinates', i), index));
        });
        if (polygons.length === 1 && g.polygons.length === 1) {
          changes.push({ rule: 'single-part-multi', path, feature: index, message: 'Wrote the one-polygon MultiPolygon as a Polygon.' });
          return { type: 'Polygon', rings: polygons[0] as Ring[] };
        }
        return { type: 'MultiPolygon', polygons };
      }
      case 'GeometryCollection': {
        const parts: Geometry[] = [];
        g.geometries.forEach((part, i) => {
          const fixed = fixGeometry(part, pointer(path, 'geometries', i), index, true);
          if (fixed.type === 'GeometryCollection') {
            changes.push({ rule: 'nested-geometry-collection', path: pointer(path, 'geometries', i), feature: index, message: 'Moved the geometries of the nested GeometryCollection into its parent.' });
            parts.push(...fixed.geometries);
          } else parts.push(fixed);
        });
        if (parts.length === 1 && !inCollection) {
          changes.push({ rule: 'single-part-multi', path, feature: index, message: 'Wrote the one-geometry GeometryCollection as that geometry.' });
          return parts[0] as Geometry;
        }
        return { type: 'GeometryCollection', geometries: parts };
      }
    }
  }

  /** Repairs one polygon; returns one polygon, or two after an antimeridian cut. */
  function fixPolygon(rings: readonly Ring[], path: string, index: number): Ring[][] {
    if (rings.length === 0) return [[]];
    const a = analyzePolygon(rings, work);
    if (options.cutAntimeridian !== false && a.antimeridianCut !== null) {
      changes.push({ rule: 'antimeridian-crossing', path: pointer(path, 0), feature: index, message: `Cut the polygon at the 180° meridian into ${a.antimeridianCut.length} polygons.` });
      return a.antimeridianCut.map((part) => {
        const ring = part.map(gridPosition);
        return [closeRing(orientRing(ring, true))];
      });
    }
    const fixed = a.rings.map((r, i): Ring => {
      const rpath = pointer(path, i);
      const original = rings[i] as Ring;
      if (r.tooFew) return original;
      let ring: Position[] = [...r.clean];
      if (!r.closed) changes.push({ rule: 'ring-not-closed', path: rpath, feature: index, message: 'Closed the ring by repeating its first position at the end.' });
      if (r.duplicates > 0) changes.push({ rule: 'duplicate-vertex', path: rpath, feature: index, message: `Removed ${r.duplicates} repeated position(s).` });
      if (r.spikes > 0) changes.push({ rule: 'spike', path: rpath, feature: index, message: `Removed ${r.spikes} spike vertex(es).` });
      if (options.simplifyCollinear === true && !r.collinear) {
        const simplified = dropCollinear(ring);
        if (simplified.length < ring.length) {
          changes.push({ rule: 'file-too-large', path: rpath, feature: index, message: `Removed ${ring.length - simplified.length} position(s) lying exactly on a straight side (shape unchanged; smaller file).` });
          ring = simplified;
        }
      }
      if (!r.collinear && r.orientation !== 0 && (i === 0 ? r.orientation < 0 : r.orientation > 0)) {
        ring = ring.reverse();
        changes.push({ rule: 'winding-order', path: rpath, feature: index, message: `Reversed the ${i === 0 ? 'exterior ring to counter-clockwise' : 'hole to clockwise'} (RFC 7946 right-hand rule).` });
      }
      return closeRing(ring);
    });
    return [fixed];
  }
}

/** Drops repeated reports of the same change (the reader and the fixer can both describe one repair). */
function uniqueChanges(changes: readonly Change[]): Change[] {
  const seen = new Set<string>();
  return changes.filter((c) => {
    const key = `${c.rule}\u0000${c.feature ?? ''}\u0000${c.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Orients an open ring counter-clockwise (exterior) or clockwise. */
function orientRing(ring: Position[], ccw: boolean): Position[] {
  const lifted = unwrapRing(ring);
  if (lifted === null) return ring;
  let sum = 0n;
  const n = lifted.length;
  for (let i = 0; i < n; i++) {
    const p = lifted[i] as XY;
    const q = lifted[(i + 1) % n] as XY;
    sum += BigInt(p.x) * BigInt(q.y) - BigInt(q.x) * BigInt(p.y);
  }
  return (sum > 0n) === ccw ? ring : [...ring].reverse();
}

/** Removes vertices exactly on the straight line between their neighbours (open ring, no spikes). */
function dropCollinear(ring: readonly Position[]): Position[] {
  const lifted = unwrapRing(ring);
  if (lifted === null) return [...ring];
  const n = lifted.length;
  const keep: Position[] = [];
  for (let i = 0; i < n; i++) {
    const p = lifted[(i - 1 + n) % n] as XY;
    const v = lifted[i] as XY;
    const q = lifted[(i + 1) % n] as XY;
    if (orient(p, v, q) !== 0) keep.push(ring[i] as Position);
  }
  return keep.length >= 3 ? keep : [...ring];
}
