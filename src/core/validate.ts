// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// Validates plots against the rules in rules.ts. Pure: takes the model,
// returns findings and per-plot measurements.

import { analyzePolygon, type PolygonAnalysis } from './analyze.js';
import { ISO_3166_ALPHA2, USER_ASSIGNED_KOSOVO } from './countries.js';
import { boxOf, polygonRelation } from './geometry/overlap.js';
import { budget, type Budget } from './geometry/ring.js';
import type { XY } from './geometry/predicates.js';
import { stringifyJson, type JsonValue } from './json.js';
import { SYSTEM_LIMITS } from './limits.js';
import { Findings, forEachPosition, pointer, type Geometry, type Plot, type Position } from './model.js';

/** The seven relevant commodities of Article 2, point (1). */
export const COMMODITIES = ['cattle', 'cocoa', 'coffee', 'oil palm', 'rubber', 'soya', 'wood'] as const;
/** A relevant commodity. */
export type Commodity = (typeof COMMODITIES)[number];

/**
 * File variants of the Commission's GeoJSON file description: Type I (API,
 * and UI import at producer level) and Type II (UI import at commodity level,
 * several producers, ProducerCountry required on every feature).
 */
export type Variant = 'type-i' | 'type-ii';

/** Options for validation. */
export interface ValidateOptions {
  /** The commodity the plots produced. Cattle plots may be points of any area (Article 2, point (28)). */
  readonly commodity?: Commodity | undefined;
  /** File variant; default "type-i". */
  readonly variant?: Variant | undefined;
  /** Largest accepted size in bytes; default 25,000,000 (Information System limit). */
  readonly maxBytes?: number | undefined;
  /** Most producers per commodity entry; default 1000 (Information System limit). */
  readonly maxProducers?: number | undefined;
  /** Look for overlapping plots; default true. */
  readonly checkOverlaps?: boolean | undefined;
  /** Work budget for geometry checks (segment-pair tests). */
  readonly checkBudget?: number | undefined;
}

/** Measurements of one plot. */
export interface PlotInfo {
  readonly feature: number;
  /** Geometry type, or null without a readable geometry. */
  readonly type: Geometry['type'] | null;
  /** Number of positions. */
  readonly positions: number;
  /** Computed geodesic area for polygons, or the declared Area for points, in hectares; null when unknown. */
  readonly hectares: number | null;
  /** Whether `hectares` was computed from the geometry or taken from the Area property. */
  readonly areaSource: 'computed' | 'declared' | 'default' | null;
  /** True when the geometry passed every geometry check. */
  readonly geometryValid: boolean;
  /** Bounding box [west, south, east, north] in degrees, or null. */
  readonly bbox: readonly [number, number, number, number] | null;
}

/** Result of validation. */
export interface Validation {
  readonly findings: Findings;
  readonly plots: readonly PlotInfo[];
}

/** Property names the Information System reads (case-sensitive). */
export const KNOWN_PROPERTIES = ['ProducerName', 'ProducerCountry', 'ProductionPlace', 'Area'] as const;
const KNOWN_LOWER = new Map<string, string>(KNOWN_PROPERTIES.map((k) => [k.toLowerCase(), k]));

/** Smallest Area for a point, in hectares (Information System validation rules). */
export const MIN_POINT_HECTARES = 0.0001;
/** Point plots above this area need a polygon unless the commodity is cattle (Article 2, point (28)). */
export const POINT_MAX_HECTARES = 4;

const DECIMAL_TEXT = /^[0-9]+(?:\.[0-9]+)?$/;

/** True when a position is within ±180°, ±90° after truncation to six decimals. */
export const truncatedInRange = (p: Position): boolean => Math.abs(p.x) <= 180_000_000 && Math.abs(p.y) <= 90_000_000;

/** Up to `n` items of a list, for messages. */
function listSome(items: readonly number[], n = 10): string {
  const head = items.slice(0, n).join(', ');
  return items.length > n ? `${head} and ${items.length - n} more` : head;
}

/** The property map after case repairs would apply (for checking values). */
export function effectiveProperties(props: ReadonlyMap<string, JsonValue> | null): Map<string, JsonValue> {
  const out = new Map<string, JsonValue>();
  if (props === null) return out;
  for (const [k, v] of props) {
    const canonical = KNOWN_LOWER.get(k.toLowerCase());
    if (canonical !== undefined && canonical !== k && !props.has(canonical)) out.set(canonical, v);
    else out.set(k, v);
  }
  return out;
}

/** Producer grouping key used for limits and splitting: ProducerName and ProducerCountry. */
export function producerKey(props: ReadonlyMap<string, JsonValue> | null): string {
  const p = effectiveProperties(props);
  const name = p.get('ProducerName');
  const country = p.get('ProducerCountry');
  // Country codes are compared as they will be written ("ci " and "CI" are one producer).
  const c = country?.kind === 'string' ? stringifyJson({ kind: 'string', value: country.value.trim().toUpperCase() }) : country === undefined ? '' : stringifyJson(country);
  return `${name === undefined ? '' : stringifyJson(name)}\u0000${c}`;
}

/** Canonical text of a geometry for duplicate detection (rings rotated and oriented consistently). */
export function geometryKey(g: Geometry, analyses: readonly PolygonAnalysis[]): string | null {
  const ringKey = (ring: readonly XY[]): string => {
    const n = ring.length;
    let start = 0;
    for (let i = 1; i < n; i++) {
      const p = ring[i] as XY;
      const s = ring[start] as XY;
      if (p.x < s.x || (p.x === s.x && p.y < s.y)) start = i;
    }
    const fwd: string[] = [];
    const back: string[] = [];
    for (let i = 0; i < n; i++) {
      const f = ring[(start + i) % n] as XY;
      const b = ring[(start - i + n) % n] as XY;
      fwd.push(`${f.x},${f.y}`);
      back.push(`${b.x},${b.y}`);
    }
    const a = fwd.join(' ');
    const b = back.join(' ');
    return a < b ? a : b;
  };
  switch (g.type) {
    case 'Point':
      return `P ${g.position.x},${g.position.y}`;
    case 'MultiPoint':
      return `M ${g.positions.map((p) => `${p.x},${p.y}`).sort().join(' ')}`;
    case 'Polygon':
    case 'MultiPolygon': {
      if (analyses.length === 0 || !analyses.every((a) => a.valid)) return null;
      const polys = analyses.map((a) => a.rings.map((r) => ringKey(r.clean)).join(' | '));
      return `A ${polys.sort().join(' || ')}`;
    }
    default:
      return null;
  }
}

interface PolygonEntry {
  readonly feature: number;
  readonly ring: readonly XY[];
  readonly box: { minX: number; minY: number; maxX: number; maxY: number };
}

/** Validates plots. `bytes` is the size of the file as it would be uploaded. */
export function validatePlots(plots: readonly Plot[], bytes: number, options: ValidateOptions = {}, findings: Findings = new Findings()): Validation {
  const variant = options.variant ?? 'type-i';
  const maxBytes = options.maxBytes ?? SYSTEM_LIMITS.maxGeolocationBytes;
  const maxProducers = options.maxProducers ?? SYSTEM_LIMITS.maxProducersPerCommodity;
  const work: Budget = budget(options.checkBudget ?? 50_000_000);
  const infos: PlotInfo[] = [];

  const aggregate = {
    altitude: [] as number[],
    excess: [] as number[],
    winding: [] as number[],
    lowPrecision: [] as number[],
    pointAreaMissing: [] as number[],
    placeMissing: [] as number[],
    unknown: new Map<string, number>(),
  };
  const polygonsForOverlap: PolygonEntry[] = [];
  const keys = new Map<string, number>();
  const producers = new Set<string>();

  plots.forEach((plot, index) => {
    if (plot.rawFeature === null) producers.add(producerKey(plot.properties));
    const g = plot.geometry;
    const props = effectiveProperties(plot.properties);
    let analyses: PolygonAnalysis[] = [];
    let positions = 0;
    let rangeOk = true;
    let geometryValid = g !== null;
    let hectares: number | null = null;
    let areaSource: PlotInfo['areaSource'] = null;
    let bbox: [number, number, number, number] | null = null;

    if (g !== null) {
      const gpath = plot.geometryPath;
      // Positions: range, altitude, precision.
      const scan = { count: 0, maxDecimals: 0, truncated: false, altitude: false, bad: 0, badAfterTruncation: 0, firstBad: null as { p: Position; path: string } | null, w: Infinity, s: Infinity, e: -Infinity, n: -Infinity };
      forEachPosition(g, gpath, (p, path) => {
        scan.count++;
        scan.maxDecimals = Math.max(scan.maxDecimals, p.decimals);
        if (p.truncated) scan.truncated = true;
        if (p.extra > 0) scan.altitude = true;
        if (p.lon < -180 || p.lon > 180 || p.lat < -90 || p.lat > 90) {
          scan.bad++;
          scan.firstBad ??= { p, path };
          if (!truncatedInRange(p)) scan.badAfterTruncation++;
        }
        scan.w = Math.min(scan.w, p.x);
        scan.e = Math.max(scan.e, p.x);
        scan.s = Math.min(scan.s, p.y);
        scan.n = Math.max(scan.n, p.y);
      });
      positions = scan.count;
      const maxDecimals = scan.maxDecimals;
      const bad = scan.bad;
      if (positions > 0) bbox = [scan.w / 1e6, scan.s / 1e6, scan.e / 1e6, scan.n / 1e6];
      if (scan.firstBad !== null) {
        const { p, path } = scan.firstBad;
        rangeOk = false;
        geometryValid = false;
        const swapped = Math.abs(p.lat) > 90 && Math.abs(p.lat) <= 180 && Math.abs(p.lon) <= 90 ? ' The values look swapped: GeoJSON order is [longitude, latitude].' : '';
        // A value such as 180.0000001 is in range once truncated to six decimals, as the system stores it.
        const byTruncation = scan.badAfterTruncation === 0;
        findings.add('coordinate-out-of-range', path, index, `Longitude must be within −180…180 and latitude within −90…90; found [${p.lon}, ${p.lat}]${bad > 1 ? ` (${bad} positions in this plot are out of range)` : ''}.${swapped}${byTruncation ? ' Truncated to six decimals, as the Information System stores coordinates, the values are within range; fix writes them truncated.' : ''}`, { fixable: byTruncation });
      }
      if (scan.altitude) aggregate.altitude.push(index);
      if (scan.truncated) aggregate.excess.push(index);
      if (positions > 0 && maxDecimals < 6) aggregate.lowPrecision.push(index);

      // Shape checks.
      checkShape(g, gpath, index, false);
      if (rangeOk) analyses = polygonAnalyses(g, gpath, index);
      if (analyses.some((a) => !a.valid)) geometryValid = false;

      if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
        if (analyses.length > 0 && analyses.every((a) => a.hectares !== null)) {
          hectares = analyses.reduce((sum, a) => sum + (a.hectares as number), 0);
          areaSource = 'computed';
          if (hectares < MIN_POINT_HECTARES) findings.add('polygon-area-tiny', gpath, index, `This polygon measures ${hectares.toFixed(6)} ha, less than 0.0001 ha (1 m²). It may have collapsed after truncation to six decimals, or be a drawing error.`);
          const declared = props.get('Area');
          if (declared?.kind === 'number' && hectares > 0) {
            const diff = Math.abs(declared.value - hectares);
            if (diff > 0.01 && diff > 0.05 * hectares) findings.add('area-mismatch', pointer(plot.path, 'properties', 'Area'), index, `Area says ${declared.raw} ha, but the polygon measures ${hectares.toFixed(4)} ha on the WGS 84 ellipsoid. Check which is right; the Information System documents Area for points.`);
          }
        }
      }
      if (geometryValid && rangeOk && analyses.every((a) => a.valid)) {
        const key = geometryKey(g, analyses);
        let duplicate = false;
        if (key !== null) {
          const first = keys.get(key);
          if (first === undefined) keys.set(key, index);
          else {
            duplicate = true;
            const same = plots[first] !== undefined && sameAttributes(plots[first], plot);
            findings.add('duplicate-plot', gpath, index, `This plot has the same geometry as feature ${first}${same ? ' and the same properties; the copy will be removed' : ', with different properties; decide which one to keep'}.`, { fixable: same });
          }
        }
        // A duplicate is reported as such, not also as an overlap.
        if (!duplicate && (g.type === 'Polygon' || g.type === 'MultiPolygon')) {
          for (const a of analyses) {
            const outer = a.rings[0];
            if (outer !== undefined && !outer.antimeridian && outer.unwrapped !== null) polygonsForOverlap.push({ feature: index, ring: outer.unwrapped, box: boxOf(outer.unwrapped) });
          }
        }
      }
    }

    // Properties.
    checkProperties(plot, index, props, g);
    const area = props.get('Area');
    if (g?.type === 'Point') {
      if (area === undefined) {
        aggregate.pointAreaMissing.push(index);
        hectares = 4;
        areaSource = 'default';
      } else if (area.kind === 'number') {
        hectares = area.value;
        areaSource = 'declared';
      }
    }
    if (plot.rawFeature === null && !props.has('ProductionPlace')) aggregate.placeMissing.push(index);
    for (const k of props.keys()) {
      if (!(KNOWN_PROPERTIES as readonly string[]).includes(k) && !KNOWN_LOWER.has(k.toLowerCase())) aggregate.unknown.set(k, (aggregate.unknown.get(k) ?? 0) + 1);
    }
    infos.push({ feature: index, type: g?.type ?? null, positions, hectares, areaSource, geometryValid, bbox });
  });

  // Aggregated notes.
  if (aggregate.lowPrecision.length > 0) findings.add('low-precision', '', null, `In ${aggregate.lowPrecision.length} plot(s) no coordinate has six decimal places: features ${listSome(aggregate.lowPrecision)}. The Regulation requires coordinates "using at least six decimal digits". If your source has more digits, export them. A zero dropped at the end of a number is not a problem when other coordinates of the plot show six decimals.`);
  if (aggregate.altitude.length > 0) findings.add('altitude-present', '', null, `${aggregate.altitude.length} plot(s) have positions with more than two values (for example altitude): features ${listSome(aggregate.altitude)}. Only longitude and latitude will be kept.`);
  if (aggregate.excess.length > 0) findings.add('excess-precision', '', null, `${aggregate.excess.length} plot(s) have coordinates with more than six decimal places: features ${listSome(aggregate.excess)}. The Information System truncates them to six; Plotline checks the truncated shapes.`);
  if (aggregate.pointAreaMissing.length > 0) findings.add('point-area-missing', '', null, `${aggregate.pointAreaMissing.length} point plot(s) have no Area: features ${listSome(aggregate.pointAreaMissing)}. The Information System will assume 4 ha for each. Give the real area in hectares as a number.`);
  if (aggregate.placeMissing.length > 0) findings.add('production-place-missing', '', null, `${aggregate.placeMissing.length} plot(s) have no ProductionPlace: features ${listSome(aggregate.placeMissing)}. The Commission recommends naming each production place.`);
  if (aggregate.unknown.size > 0) {
    const names = [...aggregate.unknown].map(([k, n]) => `${JSON.stringify(k)} (${n})`).slice(0, 20).join(', ');
    findings.add('unknown-properties', '', null, `The Information System reads only ProducerName, ProducerCountry, ProductionPlace and Area and ignores other properties: ${names}${aggregate.unknown.size > 20 ? ', …' : ''}.`);
  }
  if (aggregate.winding.length > 0) findings.add('winding-order', '', null, `${aggregate.winding.length} ring(s) wind clockwise as exterior or counter-clockwise as hole, against RFC 7946's right-hand rule: features ${listSome(aggregate.winding)}. They will be reversed. The Information System does not require an order.`);

  // File level.
  if (plots.length === 0) findings.add('no-plots', '', null, 'The file contains no plots. A due diligence statement needs the geolocation of all plots of land where the commodities were produced.');
  if (bytes > maxBytes) findings.add('file-too-large', '', null, `The file is ${bytes.toLocaleString('en-US')} bytes; the Information System accepts at most ${maxBytes.toLocaleString('en-US')} bytes of geolocation data per due diligence statement. Use "plotline split".`);
  if (variant === 'type-ii' && producers.size > maxProducers) findings.add('too-many-producers', '', null, `The file has ${producers.size} producers (distinct ProducerName and ProducerCountry); one commodity entry accepts at most ${maxProducers}. Use "plotline split --max-producers ${maxProducers}".`);
  if (options.checkOverlaps !== false) findOverlaps(polygonsForOverlap);
  if (work.exhausted) findings.add('check-limit-reached', '', null, 'Some self-intersection or overlap checks stopped at the work limit, so problems may remain unreported. Split the file or raise the limit with --check-budget.');

  return { findings, plots: infos };

  // ---- helpers (closures over findings and work) ----

  function checkShape(geom: Geometry, path: string, index: number, inCollection: boolean): void {
    switch (geom.type) {
      case 'Point':
        break;
      case 'MultiPoint':
        if (geom.positions.length === 0) findings.add('geometry-empty', pointer(path, 'coordinates'), index, 'This MultiPoint has no positions.');
        else if (geom.positions.length === 1) findings.add('single-part-multi', path, index, 'This MultiPoint has one position; it will be written as a Point.');
        break;
      case 'Polygon':
        if (geom.rings.length === 0) findings.add('geometry-empty', pointer(path, 'coordinates'), index, 'This Polygon has no rings.');
        break;
      case 'MultiPolygon':
        if (geom.polygons.length === 0) findings.add('geometry-empty', pointer(path, 'coordinates'), index, 'This MultiPolygon has no polygons.');
        else if (geom.polygons.length === 1) findings.add('single-part-multi', path, index, 'This MultiPolygon has one polygon; it will be written as a Polygon.');
        geom.polygons.forEach((rings, i) => {
          if (rings.length === 0) findings.add('geometry-empty', pointer(path, 'coordinates', i), index, 'This polygon of the MultiPolygon has no rings.');
        });
        break;
      case 'GeometryCollection':
        if (geom.geometries.length === 0) findings.add('geometry-empty', pointer(path, 'geometries'), index, 'This GeometryCollection is empty.');
        else if (geom.geometries.length === 1 && !inCollection) findings.add('single-part-multi', path, index, 'This GeometryCollection has one geometry; it will be written as that geometry.');
        geom.geometries.forEach((part, i) => {
          checkShape(part, pointer(path, 'geometries', i), index, true);
        });
        break;
    }
  }

  function polygonAnalyses(geom: Geometry, path: string, index: number): PolygonAnalysis[] {
    const out: PolygonAnalysis[] = [];
    const visit = (rings: readonly (readonly Position[])[], ppath: string): void => {
      if (rings.length === 0) return;
      const a = analyzePolygon(rings, work);
      out.push(a);
      reportPolygon(a, ppath, index);
    };
    const walk = (g: Geometry, gpath: string): void => {
      if (g.type === 'Polygon') visit(g.rings, pointer(gpath, 'coordinates'));
      else if (g.type === 'MultiPolygon') {
        const parts: PolygonAnalysis[] = [];
        g.polygons.forEach((rings, i) => {
          if (rings.length === 0) return;
          const a = analyzePolygon(rings, work);
          parts.push(a);
          out.push(a);
          reportPolygon(a, pointer(gpath, 'coordinates', i), index);
        });
        checkParts(parts, pointer(gpath, 'coordinates'), index);
      } else if (g.type === 'GeometryCollection') {
        g.geometries.forEach((part, i) => {
          walk(part, pointer(gpath, 'geometries', i));
        });
      }
    };
    walk(geom, path);
    return out;
  }

  function reportPolygon(a: PolygonAnalysis, path: string, index: number): void {
    if (a.rings.length > 1) findings.add('polygon-has-holes', path, index, `This polygon has ${a.rings.length - 1} hole(s). The Information System does not accept holes; describe the plot as two or more polygons without holes (for example two half-rings) in a MultiPolygon.`);
    a.rings.forEach((r, i) => {
      const rpath = pointer(path, i);
      if (!r.closed) findings.add('ring-not-closed', rpath, index, 'The ring is open: its last position differs from the first. The first position will be repeated at the end.', { fixable: !r.tooFew });
      if (r.duplicates > 0) findings.add('duplicate-vertex', rpath, index, `The ring repeats a position ${r.duplicates} time(s) in a row${r.duplicatesFromTruncation ? ', some only after truncation to six decimals' : ''}.${r.tooFew ? '' : ' The repeats will be removed.'}`, { fixable: !r.tooFew });
      if (r.spikes > 0 && !r.tooFew) findings.add('spike', rpath, index, `The ring doubles back on itself at ${r.spikes} vertex(es), so two sides overlap. The spike tips will be removed; the area does not change.`);
      if (r.tooFew) findings.add('ring-too-few-positions', rpath, index, `The ring has only ${r.clean.length} distinct position(s) after removing repeats${r.spikes > 0 ? ' and spikes' : ''}; a polygon needs at least three distinct corners (four positions with the closing one).`);
      else if (r.collinear) findings.add('zero-area-ring', rpath, index, 'All positions of the ring lie on one straight line, so it encloses no area.');
      if (r.unwrapped === null) {
        findings.add('antimeridian-crossing', rpath, index, 'The ring crosses the 180° meridian an odd number of times, so it winds around a pole and cannot describe a plot. Redraw it.', { severity: 'error', fixable: false });
      } else if (r.antimeridian) {
        const fixable = i === 0 && a.antimeridianCut !== null;
        findings.add('antimeridian-crossing', rpath, index, `The ring crosses the 180° meridian. Under RFC 7946 lines are straight in longitude and latitude, so as written the plot wraps around the globe. ${fixable ? 'It will be cut into two polygons at 180°.' : 'Cut it at 180° into two polygons by hand.'}`, { fixable });
      }
      if (r.selfIntersection !== null) {
        const si = r.selfIntersection;
        const what = si.relation === 'repeated-vertex' ? `passes through the same position twice (positions ${si.i} and ${si.j})` : si.relation === 'overlap' ? `has overlapping sides (sides ${si.i} and ${si.j})` : `crosses or touches itself (sides ${si.i} and ${si.j})`;
        findings.add('self-intersection', rpath, index, `The ring ${what} near longitude ${si.at.lon.toFixed(6)}, latitude ${si.at.lat.toFixed(6)}. Redraw the boundary so it does not cross itself, or split the plot into separate polygons.`);
      }
      if (!r.tooFew && !r.collinear && r.orientation !== 0 && (i === 0 ? r.orientation < 0 : r.orientation > 0)) aggregate.winding.push(index);
    });
  }

  function checkParts(parts: readonly PolygonAnalysis[], path: string, index: number): void {
    const outers: { i: number; ring: readonly XY[] }[] = [];
    parts.forEach((p, i) => {
      const o = p.rings[0];
      if (p.valid && o !== undefined && o.unwrapped !== null && !o.antimeridian) outers.push({ i, ring: o.unwrapped });
    });
    for (let x = 0; x < outers.length; x++) {
      for (let y = x + 1; y < outers.length; y++) {
        const a = outers[x] as { i: number; ring: readonly XY[] };
        const b = outers[y] as { i: number; ring: readonly XY[] };
        const rel = polygonRelation(a.ring, b.ring, work);
        if (rel === 'overlap' || rel === 'shared-edge') {
          findings.add('multipolygon-parts-intersect', pointer(path, b.i), index, `Polygons ${a.i} and ${b.i} of this MultiPolygon ${rel === 'overlap' ? 'overlap' : 'share part of a side'}. Merge them into one polygon or separate them.`);
        }
      }
    }
  }

  function checkProperties(plot: Plot, index: number, props: Map<string, JsonValue>, g: Geometry | null): void {
    if (plot.rawFeature !== null) return;
    const ppath = pointer(plot.path, 'properties');
    if (plot.properties !== null) {
      for (const k of plot.properties.keys()) {
        const canonical = KNOWN_LOWER.get(k.toLowerCase());
        if (canonical !== undefined && canonical !== k) {
          const both = plot.properties.has(canonical);
          findings.add('property-name-case', pointer(ppath, k), index, both ? `Property "${k}" differs from "${canonical}" only in letter case, and "${canonical}" is also present. Remove one of them.` : `Property "${k}" must be written exactly "${canonical}" (names are case-sensitive). It will be renamed.`, { fixable: !both });
        }
      }
    }
    const country = props.get('ProducerCountry');
    if (country === undefined) {
      if (variant === 'type-ii') findings.add('producer-country-missing', ppath, index, 'A Type II file needs "ProducerCountry" (ISO 3166-1 alpha-2 code) on every feature. Use --country to fill it in if all plots are in one country.');
    } else if (country.kind !== 'string') {
      findings.add('producer-country-invalid', pointer(ppath, 'ProducerCountry'), index, `ProducerCountry must be a two-letter text code such as "BR"; found ${country.kind}.`);
    } else {
      const code = country.value.trim().toUpperCase();
      if (!ISO_3166_ALPHA2.has(code) && code !== USER_ASSIGNED_KOSOVO) {
        findings.add('producer-country-invalid', pointer(ppath, 'ProducerCountry'), index, `${JSON.stringify(country.value)} is not an ISO 3166-1 alpha-2 country code (for example "BR", "CI", "ID").`);
      } else {
        if (code !== country.value) findings.add('producer-country-format', pointer(ppath, 'ProducerCountry'), index, `ProducerCountry ${JSON.stringify(country.value)} will be written as "${code}".`);
        if (code === USER_ASSIGNED_KOSOVO) findings.add('producer-country-user-assigned', pointer(ppath, 'ProducerCountry'), index, '"XK" is a user-assigned code, not an officially assigned ISO 3166-1 code. Check that the Information System accepts it.');
      }
    }
    const name = props.get('ProducerName');
    if (name !== undefined && name.kind !== 'string') findings.add('property-type', pointer(ppath, 'ProducerName'), index, `ProducerName should be text; found ${name.kind}.`);
    else if (name?.kind === 'string' && codePoints(name.value) > 500) findings.add('producer-name-too-long', pointer(ppath, 'ProducerName'), index, `ProducerName has ${codePoints(name.value)} characters; the Information System API accepts at most 500.`);
    const place = props.get('ProductionPlace');
    if (place !== undefined && place.kind !== 'string') findings.add('property-type', pointer(ppath, 'ProductionPlace'), index, `ProductionPlace should be text; found ${place.kind}.`);
    const area = props.get('Area');
    if (area !== undefined) {
      const apath = pointer(ppath, 'Area');
      if (area.kind === 'string') {
        const fixable = DECIMAL_TEXT.test(area.value.trim());
        findings.add('area-not-number', apath, index, `Area is the text ${JSON.stringify(area.value)}. The Information System reads text as area 0. ${fixable ? 'It will be written as a number.' : 'Write the area in hectares as a number, for example 2.5.'}`, { fixable });
      } else if (area.kind !== 'number') {
        findings.add('area-not-number', apath, index, `Area must be a number of hectares; found ${area.kind}.`, { fixable: false });
      } else if (g?.type === 'Point') {
        if (area.value < MIN_POINT_HECTARES) findings.add('point-area-below-minimum', apath, index, `Area is ${area.raw} ha; for a point it must be at least 0.0001 ha.`);
        else if (area.value > POINT_MAX_HECTARES && options.commodity !== 'cattle') {
          findings.add('point-area-above-4ha', apath, index, `This point stands for a plot of ${area.raw} ha. Plots of more than 4 ha need a polygon of the boundary${options.commodity === undefined ? ' (cattle establishments excepted: if this is cattle, set the commodity to cattle)' : ''}.`);
        }
      } else if (g?.type === 'MultiPoint' && area.value < MIN_POINT_HECTARES) {
        findings.add('point-area-below-minimum', apath, index, `Area is ${area.raw} ha; it must be at least 0.0001 ha.`);
      }
    }
  }

  function findOverlaps(entries: PolygonEntry[]): void {
    const sorted = [...entries].sort((a, b) => a.box.minX - b.box.minX || a.feature - b.feature);
    const reported = new Set<string>();
    let active: PolygonEntry[] = [];
    for (const e of sorted) {
      active = active.filter((o) => o.box.maxX >= e.box.minX);
      for (const o of active) {
        if (o.feature === e.feature) continue;
        if (o.box.maxY < e.box.minY || e.box.maxY < o.box.minY) continue;
        const [lo, hi] = o.feature < e.feature ? [o.feature, e.feature] : [e.feature, o.feature];
        const pair = `${lo}:${hi}`;
        if (reported.has(pair)) continue;
        const rel = polygonRelation(o.ring, e.ring, work);
        if (rel === null) return;
        if (rel === 'overlap') {
          reported.add(pair);
          const later = plots[hi] as Plot;
          findings.add('overlapping-plots', later.geometryPath, hi, `Plots ${lo} and ${hi} overlap. Overlapping plots can mean double-counted land or a drawing error; check both boundaries.`);
        }
      }
      active.push(e);
    }
  }
}

/** Number of Unicode code points in a string. */
function codePoints(s: string): number {
  return s.length - (s.match(/[\uDC00-\uDFFF]/g)?.length ?? 0);
}

/** True when two plots have identical properties and id. */
export function sameAttributes(a: Plot, b: Plot): boolean {
  const text = (p: Plot): string => `${p.id === null ? '' : stringifyJson(p.id)}|${p.properties === null ? 'null' : stringifyJson({ kind: 'object', entries: p.properties })}`;
  return text(a) === text(b);
}
