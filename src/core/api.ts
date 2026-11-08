// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// High-level operations used by the CLI, the offline app and library users.

import { GENERATOR } from '../version.js';
import { fixPlots, type FixOptions } from './fix.js';
import { readInput, type InputFormat, type ReadFile, type ReadOptions } from './input.js';
import { SYSTEM_LIMITS } from './limits.js';
import type { Change, Issue, Plot } from './model.js';
import { splitPlots } from './split.js';
import { effectiveProperties, producerKey, validatePlots, type PlotInfo, type ValidateOptions } from './validate.js';
import { utf8Length, writeFeatureCollection } from './write.js';

/** Options for {@link validate}. */
export type CheckOptions = ValidateOptions & ReadOptions;

/** Totals of a report. */
export interface Summary {
  readonly errors: number;
  readonly warnings: number;
  readonly infos: number;
  readonly plots: number;
  readonly points: number;
  readonly polygons: number;
  /** Plots with another geometry type (MultiPoint, GeometryCollection) or none. */
  readonly other: number;
  readonly positions: number;
  /** Distinct ProducerName and ProducerCountry pairs. */
  readonly producers: number;
  /** Sum of polygon areas (computed) and point areas (declared, or the 4 ha default), in hectares. */
  readonly hectares: number;
  /** Plots per ProducerCountry; "" for none. */
  readonly countries: Readonly<Record<string, number>>;
}

/** A validation report. */
export interface Report {
  readonly generator: string;
  readonly format: InputFormat;
  /** Bytes counted against the Information System limit (the GeoJSON that would be uploaded). */
  readonly bytes: number;
  /** True when there are no errors. */
  readonly ok: boolean;
  readonly summary: Summary;
  readonly issues: readonly Issue[];
  readonly plots: readonly PlotInfo[];
  /** Notes about converting KML or CSV. */
  readonly notes: readonly string[];
}

function summarise(plots: readonly Plot[], infos: readonly PlotInfo[], issues: readonly Issue[]): Summary {
  const countries: Record<string, number> = Object.create(null) as Record<string, number>;
  const producers = new Set<string>();
  for (const p of plots) {
    if (p.rawFeature !== null) continue;
    producers.add(producerKey(p.properties));
    const c = p.properties?.get('ProducerCountry');
    const key = c?.kind === 'string' ? c.value.trim().toUpperCase() : '';
    countries[key] = (countries[key] ?? 0) + 1;
  }
  return {
    errors: issues.filter((i) => i.severity === 'error').length,
    warnings: issues.filter((i) => i.severity === 'warning').length,
    infos: issues.filter((i) => i.severity === 'info').length,
    plots: plots.length,
    points: infos.filter((i) => i.type === 'Point').length,
    polygons: infos.filter((i) => i.type === 'Polygon' || i.type === 'MultiPolygon').length,
    other: infos.filter((i) => i.type !== 'Point' && i.type !== 'Polygon' && i.type !== 'MultiPolygon').length,
    positions: infos.reduce((s, i) => s + i.positions, 0),
    producers: producers.size,
    hectares: infos.reduce((s, i) => s + (i.hectares ?? 0), 0),
    countries,
  };
}

function report(format: InputFormat, bytes: number, plots: readonly Plot[], issues: readonly Issue[], infos: readonly PlotInfo[], notes: readonly string[]): Report {
  const summary = summarise(plots, infos, issues);
  return { generator: GENERATOR, format, bytes, ok: summary.errors === 0, summary, issues, plots: infos, notes };
}

/**
 * Validates a plot file (GeoJSON, KML or CSV).
 *
 * @example
 * const r = validate('{"type":"FeatureCollection","features":[]}');
 * r.ok; // false: the file contains no plots
 */
export function validate(input: Uint8Array | string, options: CheckOptions = {}): Report {
  const read = readInput(input, options);
  if (!read.readable) return report(read.format, read.bytes, [], read.findings.issues, [], read.notes);
  const bytes = read.format === 'geojson' ? read.bytes : utf8Length(writeFeatureCollection(read.plots));
  const v = validatePlots(read.plots, bytes, options, read.findings);
  return report(read.format, bytes, read.plots, v.findings.issues, v.plots, read.notes);
}

/** Result of {@link fix}. */
export interface FixOutput {
  /** The repaired GeoJSON, or null when the input could not be read. */
  readonly output: string | null;
  /** Every change made. */
  readonly changes: readonly Change[];
  /** Report on the input. */
  readonly before: Report;
  /** Report on the output (paths refer to the output), or null. */
  readonly after: Report | null;
}

/** Options for {@link fix}. */
export type RepairOptions = CheckOptions & FixOptions;

/**
 * True when no output may be written: the file could not be read, or it
 * declares a coordinate system other than WGS 84 (dropping that declaration
 * would mislabel every coordinate).
 */
function blocked(read: ReadFile): boolean {
  return !read.readable || read.findings.issues.some((i) => i.rule === 'crs-not-wgs84');
}

/**
 * Repairs what can be repaired safely and reports every change, then
 * validates the result.
 *
 * @example
 * const r = fix('{"type":"Point","coordinates":[-49.0046161234,-22.7343229876]}');
 * r.output; // a FeatureCollection with the point truncated to six decimals
 */
export function fix(input: Uint8Array | string, options: RepairOptions = {}): FixOutput {
  const before = validate(input, options);
  const read = readInput(input, options);
  if (blocked(read)) return { output: null, changes: [], before, after: null };
  const fixed = fixPlots(read.plots, read.findings.issues, options);
  const output = writeFeatureCollection(fixed.plots);
  const after = validate(output, { ...options, format: 'geojson', name: undefined });
  return { output, changes: fixed.changes, before, after };
}

/** Options for {@link split}. */
export type SplitOptions = RepairOptions & {
  /** Repair before splitting; default true. */
  readonly repair?: boolean | undefined;
  /** Largest part in bytes; default 25,000,000. */
  readonly maxBytes?: number | undefined;
  /** Most producers per part; default 1000. */
  readonly maxProducers?: number | undefined;
};

/** One output part. */
export interface Part {
  readonly name: string;
  readonly text: string;
  readonly bytes: number;
  readonly plots: number;
  readonly producers: number;
}

/** Result of {@link split}. */
export interface SplitOutput {
  readonly parts: readonly Part[];
  readonly changes: readonly Change[];
  /** Report on the input before splitting. */
  readonly before: Report;
  /** Plots (indexes after repair) that are larger than a part may be. */
  readonly oversized: readonly number[];
  readonly spreadProducers: number;
}

/**
 * Splits a plot file into parts within the Information System's size and
 * producer limits (one part per due diligence statement).
 */
export function split(input: Uint8Array | string, options: SplitOptions = {}): SplitOutput {
  const before = validate(input, options);
  const read = readInput(input, options);
  if (blocked(read)) return { parts: [], changes: [], before, oversized: [], spreadProducers: 0 };
  const repaired = options.repair === false ? { plots: read.plots, changes: [] } : fixPlots(read.plots, read.findings.issues, options);
  const result = splitPlots(repaired.plots, {
    maxBytes: options.maxBytes ?? SYSTEM_LIMITS.maxGeolocationBytes,
    maxProducers: options.maxProducers ?? SYSTEM_LIMITS.maxProducersPerCommodity,
  });
  const width = Math.max(3, String(result.parts.length).length);
  const parts = result.parts.map((p) => {
    const text = writeFeatureCollection(p.plots.map((i) => repaired.plots[i] as Plot));
    return { name: `part-${String(p.part).padStart(width, '0')}.geojson`, text, bytes: utf8Length(text), plots: p.plots.length, producers: p.producers };
  });
  return { parts, changes: repaired.changes, before, oversized: result.oversized, spreadProducers: result.spreadProducers };
}

/** Options for {@link convert}. */
export type ConvertOptions = RepairOptions & {
  /** Repair while converting; default false. */
  readonly repair?: boolean | undefined;
};

/** Result of {@link convert}. */
export interface ConvertOutput {
  readonly output: string | null;
  readonly changes: readonly Change[];
  readonly before: Report;
}

/** Converts KML, CSV or GeoJSON to GeoJSON in Plotline's output form. */
export function convert(input: Uint8Array | string, options: ConvertOptions = {}): ConvertOutput {
  const before = validate(input, options);
  const read = readInput(input, options);
  if (blocked(read)) return { output: null, changes: [], before };
  const plots = options.repair === true ? fixPlots(read.plots, read.findings.issues, options) : { plots: read.plots, changes: [] };
  return { output: writeFeatureCollection(plots.plots), changes: plots.changes, before };
}

/** One producer entry for the Information System API (DdsProducerType). */
export interface DdsProducer {
  /** ISO 3166-1 alpha-2 code from ProducerCountry, or null when missing. */
  readonly country: string | null;
  /** ProducerName, or null. */
  readonly name: string | null;
  readonly plots: number;
  /** Base64 of the producer's GeoJSON FeatureCollection (UTF-8), for the "geometryGeojson" element. */
  readonly geometryGeojson: string;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Standard base64 (RFC 4648 section 4) of UTF-8 text, without line breaks. */
export function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8) | (bytes[i + 2] as number);
    out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63) + B64.charAt((n >> 6) & 63) + B64.charAt(n & 63);
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = (bytes[i] as number) << 16;
    out += `${B64.charAt((n >> 18) & 63)}${B64.charAt((n >> 12) & 63)}==`;
  } else if (rest === 2) {
    const n = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8);
    out += `${B64.charAt((n >> 18) & 63)}${B64.charAt((n >> 12) & 63)}${B64.charAt((n >> 6) & 63)}=`;
  }
  return out;
}

/**
 * Groups plots by producer (ProducerName and ProducerCountry) and encodes
 * each producer's plots as the base64 GeoJSON that the DDS API's
 * "geometryGeojson" element takes (a Type I file per producer).
 */
export function toDdsProducers(plots: readonly Plot[]): DdsProducer[] {
  const groups = new Map<string, Plot[]>();
  for (const p of plots) {
    if (p.rawFeature !== null) continue;
    const key = producerKey(p.properties);
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [p]);
    else list.push(p);
  }
  return [...groups.values()].map((list) => {
    // Read as the grouping key reads them: mis-cased names and the country code as it will be written.
    const props = effectiveProperties((list[0] as Plot).properties);
    const c = props.get('ProducerCountry');
    const n = props.get('ProducerName');
    return {
      country: c?.kind === 'string' ? c.value.trim().toUpperCase() : null,
      name: n?.kind === 'string' ? n.value : null,
      plots: list.length,
      geometryGeojson: base64Utf8(writeFeatureCollection(list)),
    };
  });
}

/** Reads input and returns its plots (for library users who need the model). */
export function readPlots(input: Uint8Array | string, options: ReadOptions = {}): { plots: Plot[]; issues: readonly Issue[]; readable: boolean } {
  const r = readInput(input, options);
  return { plots: r.plots, issues: r.findings.issues, readable: r.readable };
}

/** Bytes of the GeoJSON Plotline would write for these plots. */
export const outputBytes = (plots: readonly Plot[]): number => utf8Length(writeFeatureCollection(plots));
