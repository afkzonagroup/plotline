// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Minimal DOM building for the offline app. Text always goes in as text
 * nodes; attribute names are allow-listed and links are checked. There is
 * no path from file data to HTML parsing.
 */

type Child = Node | string | null | undefined | false;
type Attrs = Readonly<Record<string, string | boolean | undefined>>;

const ALLOWED_ATTRIBUTES = new Set([
  'class', 'id', 'type', 'name', 'value', 'for', 'href', 'download', 'target', 'rel', 'role', 'accept',
  'placeholder', 'inputmode', 'autocomplete', 'maxlength', 'tabindex', 'lang', 'hidden', 'disabled', 'checked',
  'spellcheck', 'title', 'referrerpolicy', 'autocapitalize', 'pattern', 'data-row',
  'aria-label', 'aria-live', 'aria-describedby', 'aria-pressed', 'aria-current', 'aria-hidden', 'aria-expanded', 'aria-controls', 'aria-labelledby',
]);

const SVG_ATTRIBUTES = new Set(['viewBox', 'class', 'd', 'cx', 'cy', 'r', 'x', 'y', 'width', 'height', 'role', 'aria-label', 'aria-hidden', 'focusable', 'preserveAspectRatio', 'vector-effect', 'data-feature', 'stroke-width']);

/** Pages the app may link to: official sources, the project and the attribution. */
const LINK_PREFIXES = [
  'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:',
  'https://eur-lex.europa.eu/eli/',
  'https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/',
  'https://www.rfc-editor.org/rfc/rfc',
];
const FIXED_LINKS: ReadonlySet<string> = new Set(['https://afkzonagroup.lt', 'https://github.com/afkzonagroup/plotline', 'https://www.iso.org/iso-3166-country-codes.html', 'https://www.ogc.org/standards/kml/']);

/**
 * Links may only point to fixed official pages or to a local blob: download.
 * The allowed URLs contain no query strings built from data, so no link can
 * carry file content off the machine.
 */
export function isAllowedHref(value: string): boolean {
  if (FIXED_LINKS.has(value)) return true;
  if (value.startsWith('blob:')) return true;
  for (const prefix of LINK_PREFIXES) {
    if (value.startsWith(prefix)) return /^[A-Za-z0-9._/:#=-]*$/.test(value.slice(prefix.length));
  }
  return false;
}

function setAttrs(el: Element, attrs: Attrs, allowed: ReadonlySet<string>): void {
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (!allowed.has(name)) throw new Error(`attribute not allowed: ${name}`);
    if (name === 'href' && (typeof value !== 'string' || !isAllowedHref(value))) throw new Error('link target not allowed');
    el.setAttribute(name, value === true ? '' : value);
  }
}

/** Creates an HTML element with attributes and children. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  setAttrs(el, attrs, ALLOWED_ATTRIBUTES);
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Creates an SVG element. */
export function s(tag: 'svg' | 'g' | 'path' | 'circle' | 'rect' | 'title', attrs: Attrs = {}, ...children: Child[]): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  setAttrs(el, attrs, SVG_ATTRIBUTES);
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

/** An external link that opens in a new tab and sends no referrer. */
export function link(href: string, text: string): HTMLAnchorElement {
  return h('a', { href, target: '_blank', rel: 'noopener noreferrer', referrerpolicy: 'no-referrer' }, text);
}

/** Removes all children of an element. */
export function clear(el: Element): void {
  while (el.firstChild !== null) el.firstChild.remove();
}
