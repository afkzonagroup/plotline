// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// Reads KML 2.2 placemarks into plots with a small, strict XML reader. It
// refuses document type declarations (so no entity expansion or external
// entities are possible), knows only the five predefined entities and
// numeric character references, and enforces depth, element-count and
// text-length limits. KMZ (zipped KML) is not read; unzip it first.
//
// Mapping: <Placemark><name> becomes ProductionPlace (unless ExtendedData
// gives one); ExtendedData <Data name="…"><value> and <SimpleData name="…">
// become properties (Area as a number when it is a plain decimal);
// Point, Polygon (outerBoundaryIs / innerBoundaryIs) and MultiGeometry
// become GeoJSON geometries. KML coordinates are WGS 84 longitude,latitude
// (OGC KML 2.2, section 16.10).

import { parseCoordinate } from './coords.js';
import type { JsonValue } from './json.js';
import type { Limits } from './limits.js';
import { Findings, pointer, type Geometry, type Plot, type Position, type Ring } from './model.js';

/** An XML element. */
interface Element {
  readonly name: string;
  readonly attrs: ReadonlyMap<string, string>;
  readonly children: Element[];
  text: string;
  readonly line: number;
}

/** Result of reading KML. */
export interface KmlReadResult {
  readonly plots: Plot[];
  readonly findings: Findings;
  readonly readable: boolean;
}

class XmlError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message);
  }
}

// Built at run time so the offline app's inline script never contains the comment opener.
const COMMENT_OPEN = ['<', '!--'].join('');

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const NAME = /^[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?/;

function decodeText(s: string, line: number): string {
  if (/&(?![^;&\s]{1,10};)/.test(s)) throw new XmlError('"&" must start an entity such as &amp;', line);
  return s.replace(/&([^;&\s]{1,10});/g, (whole, ref: string) => {
    if (ref.startsWith('#x') || ref.startsWith('#X')) {
      const cp = /^#[xX][0-9a-fA-F]{1,6}$/.test(ref) ? parseInt(ref.slice(2), 16) : NaN;
      if (Number.isNaN(cp) || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) || cp === 0) throw new XmlError(`invalid character reference ${whole}`, line);
      return String.fromCodePoint(cp);
    }
    if (ref.startsWith('#')) {
      const cp = /^#[0-9]{1,7}$/.test(ref) ? parseInt(ref.slice(1), 10) : NaN;
      if (Number.isNaN(cp) || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) || cp === 0) throw new XmlError(`invalid character reference ${whole}`, line);
      return String.fromCodePoint(cp);
    }
    const e = ENTITIES[ref];
    if (e === undefined) throw new XmlError(`unknown entity ${whole}; only &lt; &gt; &amp; &quot; &apos; are allowed`, line);
    return e;
  });
}

const localName = (qname: string): string => {
  const i = qname.indexOf(':');
  return i < 0 ? qname : qname.slice(i + 1);
};

/** Parses XML into an element tree (iteratively). */
export function parseXml(text: string, limits: Pick<Limits, 'maxDepth' | 'maxValues' | 'maxStringLength'>): Element {
  let pos = 0;
  let line = 1;
  let count = 0;
  const n = text.length;
  const root: Element = { name: '#document', attrs: new Map(), children: [], text: '', line: 1 };
  const stack: Element[] = [root];
  const advance = (to: number): void => {
    for (let i = pos; i < to; i++) if (text.charCodeAt(i) === 10) line++;
    pos = to;
  };
  const top = (): Element => stack[stack.length - 1] as Element;
  // Coordinate lists can be long (one ring of 10,000 corners is about 250,000
  // characters); they are bounded by the input size and the position limit.
  // Other text is bounded by maxStringLength.
  const textLimit = (el: Element): number => (el.name === 'coordinates' ? Number.MAX_SAFE_INTEGER : limits.maxStringLength);
  while (pos < n) {
    const lt = text.indexOf('<', pos);
    const end = lt < 0 ? n : lt;
    if (end > pos) {
      const raw = text.slice(pos, end);
      const t = top();
      // Whitespace between elements carries nothing and is not accumulated.
      if (/\S/.test(raw)) {
        if (t.text.length + raw.length > textLimit(t)) throw new XmlError(`text longer than ${limits.maxStringLength} characters`, line);
        t.text += decodeText(raw, line);
      }
      advance(end);
    }
    if (lt < 0) break;
    if (text.startsWith(COMMENT_OPEN, pos)) {
      const close = text.indexOf('-->', pos + 4);
      if (close < 0) throw new XmlError('unterminated comment', line);
      advance(close + 3);
    } else if (text.startsWith('<![CDATA[', pos)) {
      const close = text.indexOf(']]>', pos + 9);
      if (close < 0) throw new XmlError('unterminated CDATA section', line);
      const t = top();
      const raw = text.slice(pos + 9, close);
      if (t.text.length + raw.length > textLimit(t)) throw new XmlError(`text longer than ${limits.maxStringLength} characters`, line);
      t.text += raw;
      advance(close + 3);
    } else if (text.startsWith('<!', pos)) {
      throw new XmlError('document type declarations are not allowed (they can define entities); remove the <!DOCTYPE …> line', line);
    } else if (text.startsWith('<?', pos)) {
      const close = text.indexOf('?>', pos + 2);
      if (close < 0) throw new XmlError('unterminated processing instruction', line);
      advance(close + 2);
    } else if (text.startsWith('</', pos)) {
      const close = text.indexOf('>', pos);
      if (close < 0) throw new XmlError('unterminated end tag', line);
      const name = text.slice(pos + 2, close).trim();
      const open = stack.pop();
      if (open === undefined || open === root || open.name !== localName(name)) throw new XmlError(`end tag </${name}> does not match`, line);
      advance(close + 1);
    } else {
      const startLine = line;
      let i = pos + 1;
      const m = NAME.exec(text.slice(i, i + 200));
      if (m === null) throw new XmlError('invalid element name', line);
      const name = localName(m[0]);
      i += m[0].length;
      const attrs = new Map<string, string>();
      for (;;) {
        while (i < n && /\s/.test(text.charAt(i))) i++;
        if (text.startsWith('/>', i) || text.charAt(i) === '>') break;
        const am = NAME.exec(text.slice(i, i + 200));
        if (am === null) throw new XmlError(`invalid attribute in <${name}>`, line);
        i += am[0].length;
        while (i < n && /\s/.test(text.charAt(i))) i++;
        if (text.charAt(i) !== '=') throw new XmlError(`attribute without value in <${name}>`, line);
        i++;
        while (i < n && /\s/.test(text.charAt(i))) i++;
        const quote = text.charAt(i);
        if (quote !== '"' && quote !== "'") throw new XmlError(`unquoted attribute in <${name}>`, line);
        const close = text.indexOf(quote, i + 1);
        if (close < 0) throw new XmlError(`unterminated attribute in <${name}>`, line);
        const value = text.slice(i + 1, close);
        if (value.includes('<')) throw new XmlError(`"<" in an attribute of <${name}>`, line);
        if (value.length > limits.maxStringLength) throw new XmlError(`attribute longer than ${limits.maxStringLength} characters`, line);
        attrs.set(localName(am[0]), decodeText(value, line));
        i = close + 1;
      }
      const selfClosing = text.startsWith('/>', i);
      count++;
      if (count > limits.maxValues) throw new XmlError(`more than ${limits.maxValues} elements`, line);
      const el: Element = { name, attrs, children: [], text: '', line: startLine };
      top().children.push(el);
      advance(i + (selfClosing ? 2 : 1));
      if (!selfClosing) {
        if (stack.length > limits.maxDepth) throw new XmlError(`elements nested deeper than ${limits.maxDepth} levels`, line);
        stack.push(el);
      }
    }
  }
  if (stack.length > 1) throw new XmlError(`element <${top().name}> is not closed`, line);
  return root;
}

const child = (el: Element, name: string): Element | undefined => el.children.find((c) => c.name === name);
const children = (el: Element, name: string): Element[] => el.children.filter((c) => c.name === name);

/** Finds elements by name in document order, without recursion. */
function findAll(root: Element, name: string): Element[] {
  const out: Element[] = [];
  const work: Element[] = [root];
  while (work.length > 0) {
    const el = work.pop() as Element;
    if (el.name === name) out.push(el);
    else for (let i = el.children.length - 1; i >= 0; i--) work.push(el.children[i] as Element);
  }
  return out;
}

const GEOMETRY_NAMES = new Set(['Point', 'Polygon', 'MultiGeometry', 'LineString', 'LinearRing', 'Model', 'Track', 'MultiTrack']);

/** Reads KML text into plots. */
export function readKml(text: string, limits: Pick<Limits, 'maxDepth' | 'maxValues' | 'maxStringLength' | 'maxFeatures' | 'maxPositions' | 'maxNumberLength'>): KmlReadResult {
  const findings = new Findings();
  let root: Element;
  try {
    root = parseXml(text, limits);
  } catch (e) {
    if (e instanceof XmlError) {
      findings.add(/longer than|more than|deeper than/.test(e.message) ? 'input-limit' : 'file-format', '', null, `The KML file cannot be read: ${e.message} (line ${e.line}).`, { line: e.line });
      return { plots: [], findings, readable: false };
    }
    throw e;
  }
  const kml = root.children.find((c) => c.name === 'kml');
  if (kml === undefined) {
    findings.add('file-format', '', null, 'This XML file has no <kml> root element.');
    return { plots: [], findings, readable: false };
  }
  const placemarks = findAll(kml, 'Placemark');
  if (placemarks.length > limits.maxFeatures) {
    findings.add('input-limit', '', null, `More than ${limits.maxFeatures} placemarks; raise the limit or split the file first.`);
    return { plots: [], findings, readable: false };
  }
  const count = { positions: 0, overLimit: false };

  const readCoordinates = (el: Element | undefined, path: string, index: number): Position[] | null => {
    if (el === undefined) {
      findings.add('geojson-structure', path, index, 'A KML geometry has no <coordinates>.', { line: null });
      return null;
    }
    const out: Position[] = [];
    const tuples = el.text.trim().split(/\s+/).filter((t) => t !== '');
    for (const [i, tuple] of tuples.entries()) {
      const parts = tuple.split(',');
      if (parts.length < 2 || parts.length > 3) {
        findings.add('position-invalid', pointer(path, i), index, `KML coordinates must be "longitude,latitude[,altitude]"; found ${JSON.stringify(tuple.slice(0, 60))} (line ${el.line}).`, { line: el.line });
        return null;
      }
      const [lonT, latT] = parts.map((p) => p.replace(/^\+/, '')) as [string, string];
      const lon = lonT.length <= limits.maxNumberLength ? parseCoordinate(lonT) : null;
      const lat = latT.length <= limits.maxNumberLength ? parseCoordinate(latT) : null;
      if (lon === null || lat === null) {
        findings.add('position-invalid', pointer(path, i), index, `${JSON.stringify(tuple.slice(0, 60))} is not a longitude,latitude pair in decimal degrees (line ${el.line}).`, { line: el.line });
        return null;
      }
      count.positions++;
      if (count.positions > limits.maxPositions) {
        count.overLimit = true;
        return null;
      }
      out.push({ x: lon.micro, y: lat.micro, lon: lon.value, lat: lat.value, decimals: Math.max(lon.decimals, lat.decimals), truncated: lon.truncated || lat.truncated, extra: parts.length - 2 });
    }
    return out;
  };

  const readRing = (boundary: Element | undefined, path: string, index: number): Ring | null => {
    const ring = boundary === undefined ? undefined : child(boundary, 'LinearRing');
    return readCoordinates(ring === undefined ? undefined : child(ring, 'coordinates'), path, index);
  };

  const readGeometry = (el: Element, path: string, index: number): Geometry | null => {
    switch (el.name) {
      case 'Point': {
        const ps = readCoordinates(child(el, 'coordinates'), pointer(path, 'coordinates'), index);
        if (ps === null) return null;
        if (ps.length !== 1) {
          findings.add('position-invalid', pointer(path, 'coordinates'), index, `A KML Point needs exactly one coordinate tuple; found ${ps.length} (line ${el.line}).`, { line: el.line });
          return null;
        }
        return { type: 'Point', position: ps[0] as Position };
      }
      case 'Polygon': {
        const outer = readRing(child(el, 'outerBoundaryIs'), pointer(path, 'coordinates', 0), index);
        if (outer === null) return null;
        const rings: Ring[] = [outer];
        for (const [i, inner] of children(el, 'innerBoundaryIs').entries()) {
          const r = readRing(inner, pointer(path, 'coordinates', i + 1), index);
          if (r === null) return null;
          rings.push(r);
        }
        return { type: 'Polygon', rings };
      }
      case 'MultiGeometry': {
        const parts: Geometry[] = [];
        let i = 0;
        for (const c of el.children) {
          if (!GEOMETRY_NAMES.has(c.name)) continue;
          const g = readGeometry(c, pointer(path, 'geometries', i), index);
          i++;
          if (g === null) return null;
          parts.push(g);
        }
        const polygons = parts.flatMap((p) => (p.type === 'Polygon' ? [p.rings] : []));
        if (parts.length > 0 && polygons.length === parts.length) return { type: 'MultiPolygon', polygons };
        const points = parts.flatMap((p) => (p.type === 'Point' ? [p.position] : []));
        if (parts.length > 0 && points.length === parts.length) return { type: 'MultiPoint', positions: points };
        return { type: 'GeometryCollection', geometries: parts };
      }
      default:
        findings.add('geometry-type-not-accepted', pointer(path, 'type'), index, `KML ${el.name} (line ${el.line}) does not describe a plot of land. Use a Polygon, or a Point.`, { line: el.line });
        return null;
    }
  };

  const plots: Plot[] = placemarks.map((pm, index) => {
    const path = pointer('', 'features', index);
    const gpath = pointer(path, 'geometry');
    const props = new Map<string, JsonValue>();
    const name = child(pm, 'name');
    if (name !== undefined && name.text.trim() !== '') props.set('ProductionPlace', { kind: 'string', value: name.text.trim() });
    const ext = child(pm, 'ExtendedData');
    if (ext !== undefined) {
      const set = (key: string | undefined, value: string): void => {
        if (key === undefined || key === '') return;
        const v = value.trim();
        const m = key === 'Area' ? /^([0-9]+)(\.[0-9]+)?$/.exec(v) : null;
        if (m !== null) {
          const raw = `${(m[1] ?? '').replace(/^0+(?=[0-9])/, '')}${m[2] ?? ''}`;
          props.set(key, { kind: 'number', raw, value: Number(raw) });
        } else props.set(key, { kind: 'string', value: v });
      };
      for (const d of children(ext, 'Data')) set(d.attrs.get('name'), child(d, 'value')?.text ?? '');
      for (const sd of children(ext, 'SchemaData')) for (const s of children(sd, 'SimpleData')) set(s.attrs.get('name'), s.text);
    }
    const geomEl = pm.children.find((c) => GEOMETRY_NAMES.has(c.name));
    let geometry: Geometry | null = null;
    if (geomEl === undefined) findings.add('geometry-missing', gpath, index, `Placemark on line ${pm.line} has no geometry.`, { line: pm.line });
    else geometry = readGeometry(geomEl, gpath, index);
    return { path, geometryPath: gpath, line: pm.line, id: null, properties: props, geometry, rawGeometry: null, rawFeature: null };
  });
  if (count.overLimit) {
    findings.add('input-limit', '', null, `More than ${limits.maxPositions} positions; raise the limit or split the file first.`);
    return { plots: [], findings, readable: false };
  }
  return { plots, findings, readable: true };
}
