// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { h, isAllowedHref, link, s } from '../src/app/dom.js';
import { boundsOf, makeProjection, pointPositions, polygonPath, smallPolygonMarker, viewBoxFor, VIEW_WIDTH } from '../src/app/map.js';
import { readPlots } from '../src/core/api.js';
import { RULES } from '../src/core/rules.js';
import { fc, feature, point, polygon, square } from './helpers.js';

describe('offline app link allow-list', () => {
  it('allows every cited source, the project, the attribution and blob downloads', () => {
    for (const r of RULES) for (const s of r.sources) expect(isAllowedHref(s.url), s.url).toBe(true);
    for (const ok of ['https://afkzonagroup.lt', 'https://github.com/afkzonagroup/plotline', 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R1115-20260918', 'blob:null/1234']) expect(isAllowedHref(ok), ok).toBe(true);
  });

  it('rejects every other target, so no link can carry data off the machine', () => {
    for (const bad of ['https://evil.example/', 'https://afkzonagroup.lt/?plot=1', 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R1115?x=1&y=2', 'https://eur-lex.europa.eu/search?q=farm', 'https://www.rfc-editor.org/rfc/rfc7946?farm=x', 'javascript:alert(1)', 'data:text/html,x', 'http://afkzonagroup.lt', '//evil.example', '#top', 'https://eudr.webcloud.ec.europa.eu/tracesnt/login?u=1']) {
      expect(isAllowedHref(bad), bad).toBe(false);
    }
  });
});

describe('offline app element builder', () => {
  // A minimal stand-in for the DOM: the builder only creates elements, sets attributes and appends.
  interface FakeElement {
    readonly attrs: Record<string, string>;
    setAttribute: (name: string, value: string) => void;
    append: (...nodes: unknown[]) => void;
  }
  const make = (): FakeElement => {
    const attrs: Record<string, string> = {};
    return {
      attrs,
      setAttribute: (name, value) => {
        attrs[name] = value;
      },
      append: () => undefined,
    };
  };
  const saved = (globalThis as { document?: unknown }).document;
  beforeAll(() => {
    (globalThis as { document?: unknown }).document = { createElement: make, createElementNS: make, createTextNode: (t: string) => ({ t }) };
  });
  afterAll(() => {
    (globalThis as { document?: unknown }).document = saved;
  });

  it('refuses attributes outside the allow-list, such as event handlers and inline styles', () => {
    expect(() => h('div', { onclick: 'alert(1)' })).toThrow(/attribute not allowed/);
    expect(() => h('div', { style: 'color:red' })).toThrow(/attribute not allowed/);
    expect(() => h('a', { srcdoc: 'x' })).toThrow(/attribute not allowed/);
    expect(() => s('svg', { onload: 'alert(1)' })).toThrow(/attribute not allowed/);
    expect((h('div', { class: 'ok', 'data-row': '3' }) as unknown as FakeElement).attrs).toEqual({ class: 'ok', 'data-row': '3' });
  });

  it('refuses links to anywhere but the allowed pages and blob downloads', () => {
    expect(() => h('a', { href: 'https://evil.example/?plot=1' })).toThrow(/link target not allowed/);
    expect(() => link('javascript:alert(1)', 'x')).toThrow(/link target not allowed/);
    expect((link('https://afkzonagroup.lt', 'Plotline by AFKzona Group') as unknown as FakeElement).attrs.href).toBe('https://afkzonagroup.lt');
  });
});

describe('map projection', () => {
  const plots = readPlots(fc(feature(polygon(square(10.000001, 50.000001, 0.01))), feature(point(10.020001, 50.020001)), feature(polygon(square(30, 89, 0.01))), feature(point(200, 1)))).plots;

  it('fits all plots with a margin and ignores coordinates out of range', () => {
    const b = boundsOf(plots);
    expect(b).toEqual({ minX: 10_000_001, minY: 50_000_001, maxX: 30_010_000, maxY: 89_010_000 });
    const proj = makeProjection(b ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 });
    expect(proj.width).toBe(VIEW_WIDTH);
    for (const p of plots.slice(0, 3)) {
      const g = p.geometry;
      if (g === null) continue;
      for (const [x, y] of pointPositions(g, proj)) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(proj.width);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(proj.height);
      }
      const d = polygonPath(g, proj);
      for (const m of d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)) {
        expect(Number(m[1])).toBeGreaterThanOrEqual(0);
        expect(Number(m[1])).toBeLessThanOrEqual(proj.width);
        expect(Number(m[2])).toBeGreaterThanOrEqual(0);
        expect(Number(m[2])).toBeLessThanOrEqual(proj.height);
      }
    }
  });

  it('draws closed paths, a marker for plots too small to see, and zooms to a plot', () => {
    const g = plots[0]?.geometry;
    if (g === null || g === undefined) throw new Error('geometry expected');
    const proj = makeProjection(boundsOf(plots) ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 });
    expect(polygonPath(g, proj)).toMatch(/^M[\d.]+ [\d.]+(L[\d.]+ [\d.]+){4}Z$/);
    expect(smallPolygonMarker(g, proj)).not.toBeNull();
    const own = makeProjection(boundsOf([plots[0] as (typeof plots)[number]]) ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 });
    expect(smallPolygonMarker(g, own)).toBeNull();
    expect(viewBoxFor(boundsOf([plots[0] as (typeof plots)[number]]) ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 }, proj).split(' ')).toHaveLength(4);
    expect(boundsOf([])).toBeNull();
  });
});
