// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// Reads an input file (bytes or text) of any supported format into plots.

import { parseJson } from './json.js';
import { resolveLimits, type Limits } from './limits.js';
import { Findings, type Plot } from './model.js';
import { readCsv } from './read-csv.js';
import { readGeoJson } from './read-geojson.js';
import { readKml } from './read-kml.js';

/** Supported input formats. */
export type InputFormat = 'geojson' | 'kml' | 'csv';

/** Options for reading. */
export interface ReadOptions {
  /** Format; detected from the file name or content when absent. */
  readonly format?: InputFormat | undefined;
  /** File name, used to detect the format. */
  readonly name?: string | undefined;
  /** Safety limits. */
  readonly limits?: Partial<Limits> | undefined;
}

/** A file read into plots. */
export interface ReadFile {
  readonly format: InputFormat;
  readonly plots: Plot[];
  readonly findings: Findings;
  /** False when nothing could be read. */
  readonly readable: boolean;
  /** Size of the input in bytes (UTF-8). */
  readonly bytes: number;
  /** Notes about the conversion, for KML and CSV. */
  readonly notes: string[];
}

/** Detects the format from a file name, then from the first non-blank character. */
export function detectFormat(name: string | undefined, text: string): InputFormat {
  const lower = (name ?? '').toLowerCase();
  if (lower.endsWith('.geojson') || lower.endsWith('.json')) return 'geojson';
  if (lower.endsWith('.kml')) return 'kml';
  if (lower.endsWith('.csv') || lower.endsWith('.tsv') || lower.endsWith('.txt')) return 'csv';
  const first = /\S/.exec(text)?.[0];
  if (first === '{' || first === '[') return 'geojson';
  if (first === '<') return 'kml';
  return 'csv';
}

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });

/**
 * Decodes UTF-8 bytes strictly (invalid sequences are an error) and drops a
 * leading byte-order mark. Returns null for invalid UTF-8.
 */
export function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return decoder.decode(bytes);
  } catch {
    return null;
  }
}

/** Reads an input of any supported format. */
export function readInput(input: Uint8Array | string, options: ReadOptions = {}): ReadFile {
  const limits = resolveLimits(options.limits);
  const findings = new Findings();
  const fail = (format: InputFormat, bytes: number): ReadFile => ({ format, plots: [], findings, readable: false, bytes, notes: [] });
  let text: string;
  let bytes: number;
  if (typeof input === 'string') {
    text = input.startsWith('\ufeff') ? input.slice(1) : input;
    bytes = new TextEncoder().encode(input).length;
  } else {
    bytes = input.length;
    if (bytes > limits.maxInputBytes) {
      findings.add('input-limit', '', null, `The file is ${bytes} bytes; Plotline reads at most ${limits.maxInputBytes} bytes (option maxInputBytes).`);
      return fail(options.format ?? 'geojson', bytes);
    }
    const decoded = decodeUtf8(input);
    if (decoded === null) {
      findings.add('file-format', '', null, 'The file is not valid UTF-8 text. Save it as UTF-8 (GeoJSON is UTF-8 by definition, RFC 8259 section 8.1).');
      return fail(options.format ?? 'geojson', bytes);
    }
    text = decoded;
  }
  if (bytes > limits.maxInputBytes) {
    findings.add('input-limit', '', null, `The file is ${bytes} bytes; Plotline reads at most ${limits.maxInputBytes} bytes (option maxInputBytes).`);
    return fail(options.format ?? 'geojson', bytes);
  }
  if (text.trim() === '') {
    findings.add('file-format', '', null, 'The file is empty.');
    return fail(options.format ?? detectFormat(options.name, text), bytes);
  }
  const format = options.format ?? detectFormat(options.name, text);
  if (format === 'kml') {
    const r = readKml(text, limits);
    return { format, plots: r.plots, findings: merge(findings, r.findings), readable: r.readable, bytes, notes: [] };
  }
  if (format === 'csv') {
    const r = readCsv(text, limits);
    return { format, plots: r.plots, findings: merge(findings, r.findings), readable: r.readable, bytes, notes: r.notes };
  }
  const parsed = parseJson(text, limits);
  if (!parsed.ok) {
    const e = parsed.error;
    const id = e.kind === 'limit' ? 'input-limit' : e.kind === 'duplicate-key' ? 'json-duplicate-key' : 'json-syntax';
    findings.add(id, '', null, `${e.kind === 'limit' ? 'Input limit' : 'JSON error'} at line ${e.line}, column ${e.column}: ${e.message}.`, { line: e.line });
    return fail(format, bytes);
  }
  const r = readGeoJson(parsed.value, limits);
  return { format, plots: r.plots, findings: merge(findings, r.findings), readable: r.readable, bytes, notes: [] };
}

function merge(into: Findings, from: Findings): Findings {
  into.issues.push(...from.issues);
  return into;
}
