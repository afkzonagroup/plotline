// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// Reads a parsed GeoJSON value (RFC 7946) into the plot model. Reports
// structural problems; value checks (ranges, rings, properties) belong to
// the validator.

import { parseCoordinate } from './coords.js';
import type { JsonObject, JsonValue } from './json.js';
import type { Limits } from './limits.js';
import { Findings, pointer, type Geometry, type Plot, type Position, type Ring } from './model.js';

/** Result of reading GeoJSON. */
export interface ReadResult {
  readonly plots: Plot[];
  readonly findings: Findings;
  /** False when the file could not be read as GeoJSON at all. */
  readonly readable: boolean;
}

const GEOMETRY_TYPES = new Set(['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection']);
const FEATURE_MEMBERS = new Set(['type', 'id', 'geometry', 'properties', 'bbox']);
const COLLECTION_MEMBERS = new Set(['type', 'features', 'bbox', 'crs']);

/** "crs" values that name WGS 84 longitude/latitude (GeoJSON 2008 style). */
const WGS84_CRS_NAMES = new Set(['urn:ogc:def:crs:OGC:1.3:CRS84', 'urn:ogc:def:crs:OGC::CRS84', 'urn:ogc:def:crs:EPSG::4326', 'EPSG:4326', 'CRS84', 'http://www.opengis.net/def/crs/OGC/1.3/CRS84']);

class Abort extends Error {}

const typeOf = (v: JsonValue): string => (v.kind === 'array' ? 'an array' : v.kind === 'object' ? 'an object' : v.kind === 'null' ? 'null' : `a ${v.kind}`);

/** Reads GeoJSON into plots. */
export function readGeoJson(root: JsonValue, limits: Pick<Limits, 'maxFeatures' | 'maxPositions'>): ReadResult {
  const findings = new Findings();
  const plots: Plot[] = [];
  let positions = 0;

  const countPosition = (path: string): void => {
    positions++;
    if (positions > limits.maxPositions) {
      findings.add('input-limit', path, null, `More than ${limits.maxPositions} positions; raise the limit or split the file first.`);
      throw new Abort();
    }
  };

  const readPosition = (v: JsonValue, path: string, feature: number): Position | null => {
    if (v.kind !== 'array' || v.items.length < 2) {
      findings.add('position-invalid', path, feature, `A position must be an array of at least two numbers [longitude, latitude]; found ${typeOf(v)}${v.kind === 'array' ? ` with ${v.items.length} value(s)` : ''}.`);
      return null;
    }
    if (!v.items.every((x) => x.kind === 'number')) {
      findings.add('position-invalid', path, feature, 'Every value of a position must be a number. Text such as "12.5" is not a number.');
      return null;
    }
    countPosition(path);
    const [lonV, latV] = v.items as [JsonValue & { kind: 'number' }, JsonValue & { kind: 'number' }];
    const lon = parseCoordinate(lonV.raw);
    const lat = parseCoordinate(latV.raw);
    if (lon === null || lat === null) {
      findings.add('coordinate-out-of-range', path, feature, `Coordinate [${lonV.raw}, ${latV.raw}] is far outside longitude −180…180 and latitude −90…90.`);
      return null;
    }
    return {
      x: lon.micro,
      y: lat.micro,
      lon: lon.value,
      lat: lat.value,
      decimals: Math.max(lon.decimals, lat.decimals),
      truncated: lon.truncated || lat.truncated,
      extra: v.items.length - 2,
    };
  };

  const readPositions = (v: JsonValue, path: string, feature: number, what: string): Position[] | null => {
    if (v.kind !== 'array') {
      findings.add('geojson-structure', path, feature, `${what} must be an array of positions; found ${typeOf(v)}.`);
      return null;
    }
    const out: Position[] = [];
    let ok = true;
    for (const [i, item] of v.items.entries()) {
      const p = readPosition(item, pointer(path, i), feature);
      if (p === null) ok = false;
      else out.push(p);
    }
    return ok ? out : null;
  };

  const readRings = (v: JsonValue, path: string, feature: number): Ring[] | null => {
    if (v.kind !== 'array') {
      findings.add('geojson-structure', path, feature, `Polygon coordinates must be an array of rings; found ${typeOf(v)}.`);
      return null;
    }
    const rings: Ring[] = [];
    let ok = true;
    for (const [i, item] of v.items.entries()) {
      const ring = readPositions(item, pointer(path, i), feature, 'A polygon ring');
      if (ring === null) ok = false;
      else rings.push(ring);
    }
    return ok ? rings : null;
  };

  const readGeometry = (v: JsonValue, path: string, feature: number, nested: boolean): Geometry | null => {
    if (v.kind !== 'object') {
      findings.add('geojson-structure', path, feature, `A geometry must be an object; found ${typeOf(v)}.`);
      return null;
    }
    const type = v.entries.get('type');
    if (type?.kind !== 'string') {
      findings.add('geojson-structure', path, feature, 'A geometry needs a "type" member with a text value.');
      return null;
    }
    const t = type.value;
    if (!GEOMETRY_TYPES.has(t)) {
      findings.add('geometry-type-not-accepted', pointer(path, 'type'), feature, `"${t}" is not a GeoJSON geometry type. Use Point, MultiPoint, Polygon, MultiPolygon or GeometryCollection (type names are case-sensitive).`);
      return null;
    }
    if (t === 'LineString' || t === 'MultiLineString') {
      findings.add('geometry-type-not-accepted', pointer(path, 'type'), feature, `${t} does not describe a plot of land and is not accepted. Draw the plot as a Polygon, or give a Point.`);
      return null;
    }
    for (const key of v.entries.keys()) {
      if (key === 'crs') {
        // The root's "crs" is checked once below; a nested one (GeoJSON 2008 allowed it) here.
        if (path !== '') checkCrs(v, path);
        continue;
      }
      if (key === 'bbox') findings.add('bbox-member', pointer(path, 'bbox'), feature, 'The "bbox" member will be removed; it can be stale after repairs.');
      else if (key !== 'type' && key !== (t === 'GeometryCollection' ? 'geometries' : 'coordinates')) findings.add('foreign-member', pointer(path, key), feature, `Member "${key}" is not part of a ${t} and will be dropped.`);
    }
    if (t === 'GeometryCollection') {
      const geometries = v.entries.get('geometries');
      if (geometries?.kind !== 'array') {
        findings.add('geojson-structure', path, feature, 'A GeometryCollection needs a "geometries" array.');
        return null;
      }
      if (nested) findings.add('nested-geometry-collection', path, feature, 'This GeometryCollection is inside another one; it will be flattened.');
      const parts: Geometry[] = [];
      let ok = true;
      for (const [i, g] of geometries.items.entries()) {
        const part = readGeometry(g, pointer(path, 'geometries', i), feature, true);
        if (part === null) ok = false;
        else parts.push(part);
      }
      return ok ? { type: 'GeometryCollection', geometries: parts } : null;
    }
    const coords = v.entries.get('coordinates');
    if (coords === undefined) {
      findings.add('geojson-structure', path, feature, `A ${t} needs a "coordinates" member.`);
      return null;
    }
    const cpath = pointer(path, 'coordinates');
    switch (t) {
      case 'Point': {
        // The Commission's own example writes a Point as [[lon, lat]]; RFC 7946 requires [lon, lat].
        if (coords.kind === 'array' && coords.items.length === 1 && coords.items[0]?.kind === 'array') {
          findings.add('position-invalid', cpath, feature, 'A Point\'s coordinates must be one position [longitude, latitude], not an array of positions. Write it as a MultiPoint or remove the extra brackets.');
          return null;
        }
        const p = readPosition(coords, cpath, feature);
        return p === null ? null : { type: 'Point', position: p };
      }
      case 'MultiPoint': {
        const ps = readPositions(coords, cpath, feature, 'MultiPoint coordinates');
        return ps === null ? null : { type: 'MultiPoint', positions: ps };
      }
      case 'Polygon': {
        const rings = readRings(coords, cpath, feature);
        return rings === null ? null : { type: 'Polygon', rings };
      }
      default: {
        // MultiPolygon
        if (coords.kind !== 'array') {
          findings.add('geojson-structure', cpath, feature, `MultiPolygon coordinates must be an array of polygons; found ${typeOf(coords)}.`);
          return null;
        }
        const polygons: Ring[][] = [];
        let ok = true;
        for (const [i, item] of coords.items.entries()) {
          const rings = readRings(item, pointer(cpath, i), feature);
          if (rings === null) ok = false;
          else polygons.push(rings);
        }
        return ok ? { type: 'MultiPolygon', polygons } : null;
      }
    }
  };

  const readFeature = (v: JsonValue, path: string, index: number): void => {
    if (plots.length >= limits.maxFeatures) {
      findings.add('input-limit', path, null, `More than ${limits.maxFeatures} features; raise the limit or split the file first.`);
      throw new Abort();
    }
    const ft = v.kind === 'object' ? v.entries.get('type') : undefined;
    if (v.kind !== 'object' || ft?.kind !== 'string' || ft.value !== 'Feature') {
      findings.add('geojson-structure', path, index, 'Every item of "features" must be an object with "type": "Feature". It is kept unchanged.');
      plots.push({ path, geometryPath: pointer(path, 'geometry'), line: null, id: null, properties: null, geometry: null, rawGeometry: null, rawFeature: v });
      return;
    }
    for (const key of v.entries.keys()) {
      if (key === 'crs') {
        // The root's "crs" is checked once below; a nested one (GeoJSON 2008 allowed it) here.
        if (path !== '') checkCrs(v, path);
        continue;
      }
      if (key === 'bbox') findings.add('bbox-member', pointer(path, 'bbox'), index, 'The "bbox" member will be removed; it can be stale after repairs.');
      else if (!FEATURE_MEMBERS.has(key)) findings.add('foreign-member', pointer(path, key), index, `Member "${key}" is not part of a Feature and will be dropped. Put data you want to keep in "properties".`);
    }
    const idV = v.entries.get('id');
    let id: JsonValue | null = null;
    if (idV !== undefined) {
      if (idV.kind === 'string' || idV.kind === 'number') id = idV;
      else findings.add('geojson-structure', pointer(path, 'id'), index, 'A Feature "id" must be a string or a number; it will be dropped.', { severity: 'warning', fixable: true });
    }
    const propsV = v.entries.get('properties');
    let properties: Map<string, JsonValue> | null = null;
    if (propsV?.kind === 'object') properties = new Map(propsV.entries);
    else if (propsV !== undefined && propsV.kind !== 'null') {
      findings.add('geojson-structure', pointer(path, 'properties'), index, `"properties" must be an object or null; found ${typeOf(propsV)}. Its content will be lost unless you correct it.`);
    } else if (propsV === undefined) {
      findings.add('geojson-structure', path, index, 'A Feature should have a "properties" member (an object or null); an empty one will be written.', { severity: 'info', fixable: true });
    }
    const gpath = pointer(path, 'geometry');
    const g = v.entries.get('geometry');
    let geometry: Geometry | null = null;
    let rawGeometry: JsonValue | null = null;
    if (g === undefined) {
      findings.add('geometry-missing', path, index, 'This Feature has no "geometry" member. Every plot needs its geolocation.');
    } else if (g.kind === 'null') {
      findings.add('geometry-missing', gpath, index, 'This Feature\'s geometry is null. Every plot needs its geolocation.');
    } else {
      geometry = readGeometry(g, gpath, index, false);
      if (geometry === null) rawGeometry = g;
    }
    plots.push({ path, geometryPath: gpath, line: null, id, properties, geometry, rawGeometry, rawFeature: null });
  };

  const checkCrs = (obj: JsonObject, path: string): void => {
    const crs = obj.entries.get('crs');
    if (crs === undefined) return;
    const name = crs.kind === 'object' ? crs.entries.get('properties') : undefined;
    const value = name?.kind === 'object' ? name.entries.get('name') : undefined;
    if (value?.kind === 'string' && WGS84_CRS_NAMES.has(value.value)) {
      findings.add('crs-member', pointer(path, 'crs'), null, `"crs" names ${value.value}; RFC 7946 removed the member and it will be dropped.`);
    } else {
      findings.add('crs-not-wgs84', pointer(path, 'crs'), null, 'The file declares a coordinate reference system that is not WGS 84 longitude/latitude. Convert the coordinates to WGS 84 (EPSG:4326) decimal degrees first.');
    }
  };

  try {
    if (root.kind !== 'object') {
      findings.add('file-format', '', null, `A GeoJSON file must contain one JSON object; found ${typeOf(root)}.`);
      return { plots, findings, readable: false };
    }
    const type = root.entries.get('type');
    if (type?.kind !== 'string') {
      findings.add('file-format', '', null, 'The JSON object has no "type" member, so it is not GeoJSON.');
      return { plots, findings, readable: false };
    }
    checkCrs(root, '');
    if (type.value === 'FeatureCollection') {
      const features = root.entries.get('features');
      if (features?.kind !== 'array') {
        findings.add('geojson-structure', '', null, 'A FeatureCollection needs a "features" array.');
        return { plots, findings, readable: false };
      }
      for (const key of root.entries.keys()) {
        if (key === 'bbox') findings.add('bbox-member', '/bbox', null, 'The "bbox" member will be removed; it can be stale after repairs.');
        else if (!COLLECTION_MEMBERS.has(key)) findings.add('foreign-member', pointer('', key), null, `Member "${key}" is not part of a FeatureCollection and will be dropped.`);
      }
      features.items.forEach((f, i) => {
        readFeature(f, pointer('', 'features', i), i);
      });
    } else if (type.value === 'Feature') {
      findings.add('not-feature-collection', '', null, 'The file is a single Feature; it will be wrapped in a FeatureCollection.');
      readFeature(root, '', 0);
    } else if (GEOMETRY_TYPES.has(type.value)) {
      findings.add('not-feature-collection', '', null, `The file is a bare ${type.value}; it will be wrapped in a Feature inside a FeatureCollection.`);
      const geometry = readGeometry(root, '', 0, false);
      plots.push({ path: '', geometryPath: '', line: null, id: null, properties: null, geometry, rawGeometry: geometry === null ? root : null, rawFeature: null });
    } else {
      findings.add('file-format', '/type', null, `"${type.value}" is not a GeoJSON type (types are case-sensitive).`);
      return { plots, findings, readable: false };
    }
  } catch (e) {
    if (e instanceof Abort) return { plots: [], findings, readable: false };
    throw e;
  }
  return { plots, findings, readable: true };
}
