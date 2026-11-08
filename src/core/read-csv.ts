// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// Reads a CSV table of points (RFC 4180, with comma, semicolon or tab
// separators) into plots. Each row is one point plot, unless a plot-id
// column groups rows: then the rows of one plot, in file order, are the
// corners of its boundary (the ring is closed automatically if the last row
// does not repeat the first). Column names are matched without regard to
// case, spaces, hyphens or underscores.

import { parseCoordinate } from './coords.js';
import type { JsonValue } from './json.js';
import type { Limits } from './limits.js';
import { Findings, pointer, type Plot, type Position } from './model.js';

/** Result of reading CSV. */
export interface CsvReadResult {
  readonly plots: Plot[];
  readonly findings: Findings;
  readonly readable: boolean;
  /** Notes about the conversion (separator, decimal commas, column mapping). */
  readonly notes: string[];
}

const ALIASES: Record<string, string> = {
  longitude: 'lon', lon: 'lon', lng: 'lon', long: 'lon', x: 'lon',
  latitude: 'lat', lat: 'lat', y: 'lat',
  plotid: 'plot', plot: 'plot', polygonid: 'plot', polygon: 'plot',
  producername: 'ProducerName', producer: 'ProducerName',
  producercountry: 'ProducerCountry', country: 'ProducerCountry', countrycode: 'ProducerCountry',
  productionplace: 'ProductionPlace', place: 'ProductionPlace', placename: 'ProductionPlace',
  area: 'Area', areaha: 'Area', hectares: 'Area', ha: 'Area',
};

/** One whitespace character, as String.prototype.trim() removes it. */
const WHITESPACE = /^\s$/;

const normalise = (h: string): string => h.trim().toLowerCase().replace(/[\s_-]+/g, '');

/** Splits CSV text into rows of cells (RFC 4180 quoting), with the line where each row starts. */
export function parseCsv(text: string, delimiter: string, limits: Pick<Limits, 'maxValues' | 'maxStringLength'>): { rows: { cells: string[]; line: number }[] } | { error: string; line: number } {
  const rows: { cells: string[]; line: number }[] = [];
  let cells: string[] = [];
  let cell = '';
  // True while the cell holds only whitespace. Kept as a flag: trimming the
  // cell at every quote character would make hostile input quadratic.
  let blank = true;
  let quoted = false;
  let inQuotes = false;
  let line = 1;
  let rowLine = 1;
  let count = 0;
  const pushCell = (): string | null => {
    count++;
    if (count > limits.maxValues) return `more than ${limits.maxValues} cells`;
    // Cell length is checked while characters are added, below.
    cells.push(quoted ? cell : cell.trim());
    cell = '';
    blank = true;
    quoted = false;
    return null;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (inQuotes) {
      if (c === '"') {
        if (text.charAt(i + 1) === '"') {
          cell += '"';
          blank = false;
          i++;
        } else inQuotes = false;
      } else {
        if (c === '\n') line++;
        cell += c;
        if (blank && !WHITESPACE.test(c)) blank = false;
        if (cell.length > limits.maxStringLength) return { error: `a cell longer than ${limits.maxStringLength} characters`, line };
      }
      continue;
    }
    if (c === '"' && blank) {
      inQuotes = true;
      quoted = true;
      cell = '';
    } else if (c === delimiter) {
      const e = pushCell();
      if (e !== null) return { error: e, line };
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text.charAt(i + 1) === '\n') i++;
      const e = pushCell();
      if (e !== null) return { error: e, line };
      if (!(cells.length === 1 && cells[0] === '')) rows.push({ cells, line: rowLine });
      cells = [];
      line++;
      rowLine = line;
    } else {
      cell += c;
      if (blank && !WHITESPACE.test(c)) blank = false;
      if (cell.length > limits.maxStringLength) return { error: `a cell longer than ${limits.maxStringLength} characters`, line };
    }
  }
  if (inQuotes) return { error: 'a quoted cell is not closed', line };
  if (cell !== '' || cells.length > 0) {
    const e = pushCell();
    if (e !== null) return { error: e, line };
    if (!(cells.length === 1 && cells[0] === '')) rows.push({ cells, line: rowLine });
  }
  return { rows };
}

/** Picks the separator used most in the header line (comma on a tie). */
export function detectDelimiter(text: string): string {
  const header = text.split(/\r?\n/, 1)[0] ?? '';
  let best = ',';
  let bestCount = -1;
  for (const d of [',', ';', '\t']) {
    let n = 0;
    let q = false;
    for (const ch of header) {
      if (ch === '"') q = !q;
      else if (!q && ch === d) n++;
    }
    if (n > bestCount) {
      best = d;
      bestCount = n;
    }
  }
  return best;
}

/** Reads CSV text into plots. */
export function readCsv(text: string, limits: Pick<Limits, 'maxValues' | 'maxStringLength' | 'maxFeatures' | 'maxPositions' | 'maxNumberLength'>): CsvReadResult {
  const findings = new Findings();
  const notes: string[] = [];
  const delimiter = detectDelimiter(text);
  const parsed = parseCsv(text, delimiter, limits);
  if ('error' in parsed) {
    findings.add('file-format', '', null, `The CSV file cannot be read: ${parsed.error} (line ${parsed.line}).`, { line: parsed.line });
    return { plots: [], findings, readable: false, notes };
  }
  const [header, ...rows] = parsed.rows;
  // An empty table is reported as "no-plots" by the validator.
  if (header === undefined) return { plots: [], findings, readable: true, notes };
  notes.push(`Separator: ${delimiter === '\t' ? 'tab' : `"${delimiter}"`}.`);
  const roles = header.cells.map((h) => ALIASES[normalise(h)] ?? null);
  const seen = new Map<string, number>();
  for (let i = 0; i < header.cells.length; i++) {
    const key = roles[i] ?? `raw:${header.cells[i] ?? ''}`;
    if (seen.has(key)) {
      findings.add('file-format', '', null, `The CSV header has two columns for ${JSON.stringify(roles[i] ?? header.cells[i])}: columns ${(seen.get(key) ?? 0) + 1} and ${i + 1}.`, { line: header.line });
      return { plots: [], findings, readable: false, notes };
    }
    seen.set(key, i);
  }
  const lonCol = roles.indexOf('lon');
  const latCol = roles.indexOf('lat');
  if (lonCol < 0 || latCol < 0) {
    findings.add('file-format', '', null, 'The CSV header needs a longitude column (longitude, lon, lng or x) and a latitude column (latitude, lat or y).', { line: header.line });
    return { plots: [], findings, readable: false, notes };
  }
  const plotCol = roles.indexOf('plot');
  notes.push(`Longitude from column "${header.cells[lonCol] ?? ''}", latitude from column "${header.cells[latCol] ?? ''}"${plotCol >= 0 ? `, plot boundaries grouped by column "${header.cells[plotCol] ?? ''}"` : ', one point plot per row'}.`);

  let decimalCommas = 0;
  const coordinate = (raw: string): { text: string; ok: boolean } => {
    let t = raw.trim().replace(/^\+/, '');
    if (delimiter !== ',' && /^-?[0-9]+,[0-9]+$/.test(t)) {
      t = t.replace(',', '.');
      decimalCommas++;
    }
    return { text: t, ok: t.length <= limits.maxNumberLength && parseCoordinate(t) !== null };
  };

  interface Group {
    readonly index: number;
    readonly key: string | null;
    readonly line: number;
    readonly props: Map<string, JsonValue>;
    readonly positions: Position[];
    bad: boolean;
  }
  const groups: Group[] = [];
  const byKey = new Map<string, Group>();
  let positions = 0;

  for (const row of rows) {
    const plotId = plotCol >= 0 ? (row.cells[plotCol] ?? '').trim() : '';
    let group = plotId !== '' ? byKey.get(plotId) : undefined;
    if (group === undefined) {
      if (groups.length >= limits.maxFeatures) {
        findings.add('input-limit', '', null, `More than ${limits.maxFeatures} plots; raise the limit or split the file first.`, { line: row.line });
        return { plots: [], findings, readable: false, notes };
      }
      const props = new Map<string, JsonValue>();
      header.cells.forEach((h, i) => {
        const role = roles[i] ?? null;
        if (role === 'lon' || role === 'lat') return;
        const value = (row.cells[i] ?? '').trim();
        if (value === '') return;
        const name = role === null || role === 'plot' ? h.trim() : role;
        if (name === 'Area') {
          const t = delimiter !== ',' && /^[0-9]+,[0-9]+$/.test(value) ? value.replace(',', '.') : value;
          const m = /^([0-9]+)(\.[0-9]+)?$/.exec(t);
          if (m !== null) {
            const raw = `${(m[1] ?? '').replace(/^0+(?=[0-9])/, '')}${m[2] ?? ''}`;
            props.set('Area', { kind: 'number', raw, value: Number(raw) });
            return;
          }
        }
        props.set(name, { kind: 'string', value });
      });
      group = { index: groups.length, key: plotId === '' ? null : plotId, line: row.line, props, positions: [], bad: false };
      groups.push(group);
      if (plotId !== '') byKey.set(plotId, group);
    }
    const index = group.index;
    const lon = coordinate(row.cells[lonCol] ?? '');
    const lat = coordinate(row.cells[latCol] ?? '');
    const path = pointer('', 'features', index, 'geometry', 'coordinates');
    if (!lon.ok || !lat.ok) {
      const cellText = !lon.ok ? row.cells[lonCol] ?? '' : row.cells[latCol] ?? '';
      const t = !lon.ok ? lon.text : lat.text;
      const numeric = /^-?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(t);
      findings.add(numeric ? 'coordinate-out-of-range' : 'position-invalid', path, index, `Line ${row.line}: ${JSON.stringify(cellText)} is not a usable ${!lon.ok ? 'longitude' : 'latitude'} in decimal degrees.`, { line: row.line });
      group.bad = true;
      continue;
    }
    positions++;
    if (positions > limits.maxPositions) {
      findings.add('input-limit', '', null, `More than ${limits.maxPositions} positions; raise the limit or split the file first.`, { line: row.line });
      return { plots: [], findings, readable: false, notes };
    }
    const x = parseCoordinate(lon.text);
    const y = parseCoordinate(lat.text);
    if (x === null || y === null) continue;
    group.positions.push({ x: x.micro, y: y.micro, lon: x.value, lat: y.value, decimals: Math.max(x.decimals, y.decimals), truncated: x.truncated || y.truncated, extra: 0 });
  }
  if (decimalCommas > 0) notes.push(`Read ${decimalCommas} coordinate(s) written with a decimal comma.`);

  const plots: Plot[] = groups.map((g, i) => {
    const path = pointer('', 'features', i);
    const gpath = pointer(path, 'geometry');
    let geometry: Plot['geometry'] = null;
    if (!g.bad && g.positions.length > 0) {
      if (g.key === null || g.positions.length === 1) geometry = { type: 'Point', position: g.positions[0] as Position };
      else {
        const ring = [...g.positions];
        const first = ring[0] as Position;
        const last = ring[ring.length - 1] as Position;
        if (first.x !== last.x || first.y !== last.y) ring.push(first);
        geometry = { type: 'Polygon', rings: [ring] };
      }
    }
    if (geometry === null && !g.bad) findings.add('geometry-missing', gpath, i, `Plot on line ${g.line} has no coordinates.`, { line: g.line });
    return { path, geometryPath: gpath, line: g.line, id: null, properties: g.props, geometry, rawGeometry: null, rawFeature: null };
  });
  return { plots, findings, readable: true, notes };
}
