// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The offline app: one HTML file that checks, maps, repairs and splits plot
 * files in the browser. Files are read with the File API and never leave
 * the page; the Content Security Policy blocks every network request.
 */

import { fix, readPlots, split, validate, type Report } from '../core/api.js';
import { DEFAULT_LIMITS, SYSTEM_LIMITS } from '../core/limits.js';
import type { Issue, Plot } from '../core/model.js';
import { rule, type RuleStatus } from '../core/rules.js';
import { COMMODITIES, type Commodity, type Variant } from '../core/validate.js';
import { ATTRIBUTION, ATTRIBUTION_URL, VERSION } from '../version.js';
import { clear, h, link, s } from './dom.js';
import { boundsOf, makeProjection, pointPositions, polygonPath, smallPolygonMarker, viewBoxFor, type Projection } from './map.js';

const PROJECT_URL = 'https://github.com/afkzonagroup/plotline';
const REGULATION_URL = 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R1115-20260918';
const MAP_FEATURE_LIMIT = 5000;
const LIST_LIMIT = 300;

interface State {
  name: string;
  bytes: Uint8Array;
  commodity: Commodity | undefined;
  variant: Variant;
  report: Report | null;
  plots: Plot[];
  selected: number | null;
  urls: string[];
}

const state: State = { name: '', bytes: new Uint8Array(), commodity: undefined, variant: 'type-i', report: null, plots: [], selected: null, urls: [] };

const live = h('p', { class: 'sr-only', 'aria-live': 'polite' });
const result = h('section', { class: 'result', hidden: true, 'aria-label': 'Result' });
const fileInput = h('input', { type: 'file', id: 'file', class: 'sr-only', accept: '.geojson,.json,.kml,.csv,.tsv,.txt' });

function announce(text: string): void {
  live.textContent = text;
}

function revokeUrls(): void {
  for (const u of state.urls) URL.revokeObjectURL(u);
  state.urls = [];
}

/** A download button for generated text. */
function download(label: string, filename: string, text: string, type: string): HTMLAnchorElement {
  const url = URL.createObjectURL(new Blob([text], { type }));
  state.urls.push(url);
  return h('a', { class: 'button', href: url, download: filename }, label);
}

const STATUS_LABEL: Record<RuleStatus, string> = { requirement: 'Requirement', interpretation: 'Interpretation', recommendation: 'Recommendation', safety: 'Safety limit' };

function chipGroup<T extends string>(legend: string, name: string, options: readonly { value: T; label: string }[], current: T, onChange: (v: T) => void): HTMLFieldSetElement {
  return h(
    'fieldset',
    { class: 'chips' },
    h('legend', {}, legend),
    ...options.map((o) => {
      const input = h('input', { type: 'radio', name, value: o.value, id: `${name}-${o.value.replace(/\s/g, '-')}`, class: 'sr-only', checked: o.value === current });
      input.addEventListener('change', () => {
        if (input.checked) onChange(o.value);
      });
      return h('span', { class: 'chip' }, input, h('label', { for: input.id }, o.label));
    }),
  );
}

function intake(): HTMLElement {
  const drop = h(
    'label',
    { class: 'drop', for: 'file' },
    s('svg', { viewBox: '0 0 48 48', 'aria-hidden': 'true', focusable: 'false', class: 'drop-icon' }, s('path', { d: 'M8 34 18 14l9 12 5-6 8 14Z' }), s('circle', { cx: '33', cy: '12', r: '4' })),
    h('span', { class: 'drop-title' }, 'Drop a plot file here, or choose one'),
    h('span', { class: 'drop-hint' }, 'GeoJSON, KML or a CSV of points. It is read on this computer and never uploaded.'),
    h('span', { class: 'button' }, 'Choose file'),
  );
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => {
    drop.classList.remove('over');
  });
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const file = e.dataTransfer?.files[0];
    if (file !== undefined) void load(file);
  });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file !== undefined) void load(file);
  });
  const commodity = chipGroup<string>(
    'Commodity',
    'commodity',
    [{ value: '', label: 'Not set' }, ...COMMODITIES.map((c) => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1) }))],
    '',
    (v) => {
      state.commodity = v === '' ? undefined : (v as Commodity);
      rerun();
    },
  );
  const variant = chipGroup<Variant>(
    'File variant',
    'variant',
    [
      { value: 'type-i', label: 'Type I – one producer' },
      { value: 'type-ii', label: 'Type II – several producers' },
    ],
    'type-i',
    (v) => {
      state.variant = v;
      rerun();
    },
  );
  return h('section', { class: 'intake', 'aria-label': 'Choose a file' }, fileInput, drop, h('div', { class: 'settings' }, commodity, variant));
}

async function load(file: File): Promise<void> {
  revokeUrls();
  if (file.size > DEFAULT_LIMITS.maxInputBytes) {
    showMessage(`${file.name} is ${file.size.toLocaleString('en-US')} bytes. This page reads files up to ${DEFAULT_LIMITS.maxInputBytes.toLocaleString('en-US')} bytes; use the command line tool for larger files.`);
    return;
  }
  showMessage(`Reading ${file.name}…`);
  state.name = file.name;
  state.bytes = new Uint8Array(await file.arrayBuffer());
  rerun();
}

function rerun(): void {
  if (state.name === '') return;
  showMessage(`Checking ${state.name}…`);
  // Let the message paint before the work starts.
  window.setTimeout(() => {
    const report = validate(state.bytes, { name: state.name, commodity: state.commodity, variant: state.variant });
    state.report = report;
    state.plots = readPlots(state.bytes, { name: state.name }).plots;
    state.selected = null;
    render();
    announce(`${state.name}: ${report.summary.errors} errors, ${report.summary.warnings} warnings.`);
  }, 20);
}

function showMessage(text: string): void {
  result.hidden = false;
  clear(result);
  result.append(h('p', { class: 'message' }, text));
  announce(text);
}

function sizeBar(bytes: number): HTMLElement {
  const share = Math.min(bytes / SYSTEM_LIMITS.maxGeolocationBytes, 1);
  const pct = Math.round((bytes / SYSTEM_LIMITS.maxGeolocationBytes) * 1000) / 10;
  const bar = h('span', { class: 'bar-fill' });
  bar.classList.add(share >= 1 ? 'full' : share > 0.8 ? 'high' : 'low');
  // Width is set through a class in steps of 5 % so no inline style is needed (style-src forbids it).
  bar.classList.add(`w${Math.round(share * 20) * 5}`);
  return h(
    'div',
    { class: 'size' },
    h('span', { class: 'size-label' }, `${bytes.toLocaleString('en-US')} bytes – ${pct}% of the 25,000,000-byte limit per due diligence statement`),
    h('span', { class: 'bar', role: 'img', 'aria-label': `${pct} percent of the size limit` }, bar),
  );
}

function render(): void {
  const r = state.report;
  if (r === null) return;
  clear(result);
  result.hidden = false;
  const s1 = r.summary;
  const verdict = r.ok
    ? h('div', { class: 'verdict ok' }, h('strong', {}, 'No errors found.'), ` ${s1.warnings > 0 ? `${s1.warnings} warning(s) to review.` : 'Nothing to review.'} This is a format check, not a check of deforestation or legality.`)
    : h('div', { class: 'verdict bad' }, h('strong', {}, `${s1.errors} error(s) found.`), ` The Information System would reject the file or the rules are not met. ${r.issues.some((i) => i.severity === 'error' && i.fixable) ? 'Some can be repaired below.' : ''}`);
  const facts = h(
    'p',
    { class: 'facts' },
    `${state.name}: ${s1.plots} plot(s) – ${s1.polygons} polygon(s), ${s1.points} point(s)${s1.other > 0 ? `, ${s1.other} other` : ''}; ${s1.hectares.toLocaleString('en-US', { maximumFractionDigits: 2 })} ha; ${s1.producers} producer(s)${Object.keys(s1.countries).length > 0 ? `; ${Object.entries(s1.countries).map(([c, n]) => `${c === '' ? 'no country' : c} ${n}`).join(', ')}` : ''}.`,
  );
  result.append(verdict, facts, sizeBar(r.bytes));
  for (const n of r.notes) result.append(h('p', { class: 'note' }, n));
  const mapPanel = h('div', { class: 'map-panel' });
  renderMap(mapPanel);
  const columns = h('div', { class: 'columns' }, mapPanel, issueList(r.issues));
  result.append(columns, plotTable(r), repairPanel(r));
}

function renderMap(panel: HTMLElement): void {
  clear(panel);
  const bounds = boundsOf(state.plots);
  if (bounds === null) {
    panel.append(h('p', { class: 'muted' }, 'No coordinates to draw.'));
    return;
  }
  const proj: Projection = makeProjection(bounds);
  const errorFeatures = new Set((state.report?.issues ?? []).filter((i) => i.severity === 'error' && i.feature !== null).map((i) => i.feature));
  const svg = s('svg', { viewBox: `0 0 ${proj.width} ${proj.height}`, role: 'img', 'aria-label': `Map of ${state.plots.length} plots. The list of plots below gives the same information.`, preserveAspectRatio: 'xMidYMid meet', class: 'map' });
  const shapes = s('g', { class: 'shapes' });
  const points = s('g', { class: 'points' });
  const dotR = String(Math.max(proj.width / 220, 2));
  state.plots.slice(0, MAP_FEATURE_LIMIT).forEach((plot, i) => {
    if (plot.geometry === null) return;
    const cls = `${errorFeatures.has(i) ? 'has-error' : ''}${state.selected === i ? ' selected' : ''}`.trim();
    const d = polygonPath(plot.geometry, proj);
    if (d !== '') shapes.append(s('path', { d, class: cls === '' ? 'plot' : `plot ${cls}`, 'vector-effect': 'non-scaling-stroke', 'data-feature': String(i) }, s('title', {}, `Plot ${i}`)));
    const marker = smallPolygonMarker(plot.geometry, proj);
    if (marker !== null) points.append(s('circle', { cx: String(marker[0]), cy: String(marker[1]), r: dotR, class: cls === '' ? 'dot ring' : `dot ring ${cls}`, 'data-feature': String(i) }, s('title', {}, `Plot ${i}`)));
    for (const [x, y] of pointPositions(plot.geometry, proj)) points.append(s('circle', { cx: String(x), cy: String(y), r: dotR, class: cls === '' ? 'dot' : `dot ${cls}`, 'data-feature': String(i) }, s('title', {}, `Plot ${i}`)));
  });
  svg.append(shapes, points);
  if (state.selected !== null) {
    const plot = state.plots[state.selected];
    const b = plot === undefined ? null : boundsOf([plot]);
    if (b !== null) svg.setAttribute('viewBox', viewBoxFor(b, proj));
  }
  svg.addEventListener('click', (e) => {
    const target = e.target instanceof Element ? e.target.closest('[data-feature]') : null;
    const f = target?.getAttribute('data-feature');
    if (f !== null && f !== undefined) select(Number(f));
  });
  const reset = h('button', { type: 'button', class: 'link-button' }, 'Show all plots');
  reset.addEventListener('click', () => {
    select(null);
  });
  panel.append(svg, h('div', { class: 'map-foot' }, h('span', { class: 'legend' }, h('span', { class: 'key ok' }), 'plot', h('span', { class: 'key err' }), 'plot with an error', h('span', { class: 'key sel' }), 'selected'), state.selected === null ? null : reset));
  if (state.plots.length > MAP_FEATURE_LIMIT) panel.append(h('p', { class: 'muted' }, `The map shows the first ${MAP_FEATURE_LIMIT} plots.`));
}

function select(feature: number | null): void {
  state.selected = feature;
  const panel = result.querySelector('.map-panel');
  if (panel instanceof HTMLElement) renderMap(panel);
  for (const row of result.querySelectorAll('[data-row]')) row.classList.toggle('current', row.getAttribute('data-row') === String(feature));
  if (feature !== null) announce(`Plot ${feature} selected on the map.`);
}

function issueList(issues: readonly Issue[]): HTMLElement {
  const box = h('div', { class: 'issues' }, h('h2', {}, 'Findings'));
  if (issues.length === 0) {
    box.append(h('p', { class: 'muted' }, 'No findings.'));
    return box;
  }
  const order = ['error', 'warning', 'info'] as const;
  const names = { error: 'Errors', warning: 'Warnings', info: 'Notes' } as const;
  for (const sev of order) {
    const list = issues.filter((i) => i.severity === sev);
    if (list.length === 0) continue;
    box.append(h('h3', { class: `sev ${sev}` }, `${names[sev]} (${list.length})`));
    const ul = h('ul', { class: 'issue-list' });
    for (const i of list.slice(0, LIST_LIMIT)) {
      const r = rule(i.rule);
      const meta = h('p', { class: 'meta' }, h('span', { class: `tag ${r.status}` }, STATUS_LABEL[r.status]));
      if (i.feature !== null) {
        const feature = i.feature;
        const b = h('button', { type: 'button', class: 'link-button' }, `Plot ${feature}`);
        b.addEventListener('click', () => {
          select(feature);
        });
        meta.append(' ', b);
      }
      for (const src of r.sources.slice(0, 2)) meta.append(' ', link(src.url, src.cite));
      ul.append(h('li', { class: sev }, h('p', { class: 'title' }, r.title), h('p', { class: 'msg' }, i.message), meta));
    }
    box.append(ul);
    if (list.length > LIST_LIMIT) box.append(h('p', { class: 'muted' }, `${list.length - LIST_LIMIT} more not shown; download the report for all of them.`));
  }
  return box;
}

function plotTable(r: Report): HTMLElement {
  const issuesBy = new Map<number, number>();
  for (const i of r.issues) if (i.feature !== null && i.severity !== 'info') issuesBy.set(i.feature, (issuesBy.get(i.feature) ?? 0) + 1);
  const rows = r.plots.slice(0, LIST_LIMIT).map((p) => {
    const b = h('button', { type: 'button', class: 'link-button' }, `Plot ${p.feature}`);
    b.addEventListener('click', () => {
      select(p.feature);
    });
    const area = p.hectares === null ? '–' : `${p.hectares.toLocaleString('en-US', { maximumFractionDigits: 4 })} ha${p.areaSource === 'default' ? ' (assumed)' : p.areaSource === 'declared' ? ' (declared)' : ''}`;
    return h('tr', { 'data-row': String(p.feature) }, h('td', {}, b), h('td', {}, p.type ?? 'none'), h('td', { class: 'num' }, area), h('td', { class: 'num' }, String(issuesBy.get(p.feature) ?? 0)));
  });
  const details = h(
    'details',
    { class: 'plots' },
    h('summary', {}, `Plots (${r.plots.length})`),
    h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Plot'), h('th', {}, 'Geometry'), h('th', { class: 'num' }, 'Area'), h('th', { class: 'num' }, 'Problems'))), h('tbody', {}, ...rows))),
    r.plots.length > LIST_LIMIT ? h('p', { class: 'muted' }, `First ${LIST_LIMIT} plots shown.`) : null,
  );
  return details;
}

function repairPanel(r: Report): HTMLElement {
  const strip = h('input', { type: 'checkbox', id: 'opt-strip' });
  const simplify = h('input', { type: 'checkbox', id: 'opt-simplify' });
  const keep = h('input', { type: 'checkbox', id: 'opt-keep' });
  const country = h('input', { type: 'text', id: 'opt-country', maxlength: '2', autocomplete: 'off', spellcheck: false, autocapitalize: 'characters', inputmode: 'text', pattern: '[A-Za-z]{2}', placeholder: 'Country for plots without one (BR)', 'aria-label': 'ProducerCountry for plots without one (ISO 3166-1 alpha-2)' });
  const out = h('div', { class: 'repair-out', 'aria-live': 'polite' });
  const run = h('button', { type: 'button', class: 'button primary' }, 'Repair');
  run.addEventListener('click', () => {
    const code = country.value.trim().toUpperCase();
    if (code !== '' && !/^[A-Z]{2}$/.test(code)) {
      clear(out);
      out.append(h('p', { class: 'warn' }, 'The country code must be two letters, for example BR.'));
      return;
    }
    let fixed;
    try {
      fixed = fix(state.bytes, { name: state.name, commodity: state.commodity, variant: state.variant, stripUnknownProperties: strip.checked, simplifyCollinear: simplify.checked, removeDuplicates: !keep.checked, country: code === '' ? undefined : code });
    } catch {
      clear(out);
      out.append(h('p', { class: 'warn' }, `${code} is not an ISO 3166-1 alpha-2 country code.`));
      return;
    }
    clear(out);
    if (fixed.output === null || fixed.after === null) {
      out.append(h('p', { class: 'warn' }, 'The file cannot be read, so it cannot be repaired. See the errors above.'));
      return;
    }
    const base = state.name.replace(/\.[A-Za-z0-9]{1,8}$/, '');
    out.append(h('p', {}, h('strong', {}, `${fixed.changes.length} change(s).`), ` After repair: ${fixed.after.summary.errors} error(s), ${fixed.after.summary.warnings} warning(s).`));
    if (fixed.changes.length > 0) out.append(h('ul', { class: 'changes' }, ...fixed.changes.slice(0, LIST_LIMIT).map((c) => h('li', {}, c.feature === null ? '' : `Plot ${c.feature}: `, c.message))));
    out.append(
      h('div', { class: 'actions' }, download('Download repaired GeoJSON', `${base}.fixed.geojson`, fixed.output, 'application/geo+json'), download('Download report (JSON)', `${base}.report.json`, `${JSON.stringify({ changes: fixed.changes, before: fixed.before, after: fixed.after }, null, 2)}\n`, 'application/json')),
    );
    if (fixed.after.issues.some((i) => i.severity === 'error')) out.append(h('p', { class: 'warn' }, 'Some errors need a decision about the land itself (for example a boundary that crosses itself) and are left for you to correct.'));
    state.plots = readPlots(fixed.output, { format: 'geojson' }).plots;
    state.selected = null;
    const panel = result.querySelector('.map-panel');
    if (panel instanceof HTMLElement) renderMap(panel);
    announce(`Repaired: ${fixed.changes.length} changes.`);
  });
  const panel = h(
    'section',
    { class: 'repair', 'aria-label': 'Repair' },
    h('h2', {}, 'Repair'),
    h('p', {}, 'Repairs keep each plot\'s location and area: closing rings, removing repeated positions and spikes, truncating to six decimals, fixing property names and number formats. Every change is listed.'),
    h('div', { class: 'options' }, h('span', { class: 'check' }, strip, h('label', { for: 'opt-strip' }, 'Remove properties the Information System ignores')), h('span', { class: 'check' }, simplify, h('label', { for: 'opt-simplify' }, 'Remove positions lying exactly on a straight side (smaller file)')), h('span', { class: 'check' }, keep, h('label', { for: 'opt-keep' }, 'Keep exact duplicate plots')), h('label', { class: 'sr-only', for: 'opt-country' }, 'Country code'), country),
    h('div', { class: 'actions' }, run, download('Download report of this check (JSON)', `${state.name.replace(/\.[A-Za-z0-9]{1,8}$/, '')}.check.json`, `${JSON.stringify(r, null, 2)}\n`, 'application/json')),
    out,
  );
  const tooBig = r.bytes > SYSTEM_LIMITS.maxGeolocationBytes || (state.variant === 'type-ii' && r.summary.producers > SYSTEM_LIMITS.maxProducersPerCommodity);
  if (tooBig) {
    const splitOut = h('div', { class: 'repair-out' });
    const go = h('button', { type: 'button', class: 'button' }, 'Repair and split');
    go.addEventListener('click', () => {
      const parts = split(state.bytes, { name: state.name, commodity: state.commodity, variant: state.variant });
      clear(splitOut);
      splitOut.append(h('p', {}, `${parts.parts.length} part(s). Submit each with its own due diligence statement; the statements can then be grouped in the Information System.`), h('div', { class: 'actions' }, ...parts.parts.map((p) => download(`${p.name} (${p.plots} plots)`, p.name, p.text, 'application/geo+json'))));
    });
    panel.append(h('h3', {}, 'Split'), h('p', {}, 'The file is over the Information System\'s limit for one statement. Split it into parts that fit.'), go, splitOut);
  }
  return panel;
}

function app(): void {
  const header = h(
    'header',
    { class: 'top' },
    h('p', { class: 'brand' }, s('svg', { viewBox: '0 0 32 32', 'aria-hidden': 'true', focusable: 'false', class: 'mark' }, s('path', { d: 'M5 25 12 8l6 10 3-4 6 11Z' })), h('span', {}, 'Plotline')),
    h('h1', {}, 'Check plot geolocation for the EU Deforestation Regulation'),
    h('p', { class: 'lede' }, 'Validate, map and repair the GeoJSON you upload to the EUDR Information System, against the Regulation and the Commission\'s published file rules.'),
    h('p', { class: 'privacy' }, 'Your data stays on this computer. This page makes no network connections.'),
  );
  const footer = h(
    'footer',
    {},
    h('p', {}, link(ATTRIBUTION_URL, ATTRIBUTION), ` · version ${VERSION} · `, link(PROJECT_URL, 'source code'), ' · ', link(REGULATION_URL, 'Regulation (EU) 2023/1115')),
    h('p', { class: 'muted' }, 'Not legal advice. Plotline checks the format of geolocation files; it does not check whether land was deforested and does not make anyone compliant.'),
  );
  document.body.append(h('main', {}, header, intake(), live, result, footer));
}

app();
