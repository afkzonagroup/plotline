// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { posix } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CliError } from '../src/cli/node-io.js';
import { githubEscape, parseArgs, run, safeText, type Io } from '../src/cli/run.js';
import { A, PROPS, fc, feature, point, polygon } from './helpers.js';

interface Fake extends Io {
  out: string;
  err: string;
  files: Map<string, string>;
  modes: Map<string, boolean>;
}

function fake(files: Record<string, string> = {}): Fake {
  const io: Fake = {
    out: '',
    err: '',
    files: new Map(Object.entries(files)),
    modes: new Map(),
    stdout: (t) => {
      io.out += t;
    },
    stderr: (t) => {
      io.err += t;
    },
    readFile: (path, max) => {
      const f = io.files.get(path);
      if (f === undefined) return Promise.reject(new CliError(`Cannot open ${JSON.stringify(path)} for reading.`));
      const bytes = new TextEncoder().encode(f);
      if (bytes.length > max) return Promise.reject(new CliError('too large', 1));
      return Promise.resolve(bytes);
    },
    writeFile: (path, content, force) => {
      if (io.files.has(path) && !force) return Promise.reject(new CliError(`${JSON.stringify(path)} exists. Use --force to overwrite it.`));
      io.files.set(path, content);
      return Promise.resolve();
    },
    makeDir: () => Promise.resolve(),
    sameFile: (a, b) => Promise.resolve(a === b),
    listFiles: (_root, pattern) => Promise.resolve([...io.files.keys()].filter((k) => k.startsWith('repo/') && k.endsWith(pattern.replace('**/*', ''))).map((k) => k.slice(5))),
    joinPath: (a, b) => posix.join(a, b),
  };
  return io;
}

const GOOD = fc(feature(point(-5.500001, 6.800001), { ...PROPS, Area: 1 }));
const BAD = fc(feature(polygon(A.slice(0, -1))), feature(point(-5.500001, 6.800001), { ...PROPS, Area: 9 }));

describe('cli', () => {
  it('prints help with the attribution and exits 2 without a command', async () => {
    const io = fake();
    expect(await run([], io)).toBe(2);
    expect(io.out).toContain('Plotline by AFKzona Group');
    expect(io.out).toContain('Not legal advice');
    const io2 = fake();
    expect(await run(['--help'], io2)).toBe(0);
    expect(await run(['--version'], io2)).toBe(0);
    expect(io2.out).toContain('0.1.0');
  });

  it('validates: exit 0 for a good file, 1 for a bad one, with findings and footer', async () => {
    const io = fake({ 'good.geojson': GOOD, 'bad.geojson': BAD });
    expect(await run(['validate', 'good.geojson'], io)).toBe(0);
    expect(await run(['validate', 'bad.geojson'], io)).toBe(1);
    expect(io.out).toContain('ring-not-closed');
    expect(io.out).toContain('point-area-above-4ha');
    expect(io.out).toContain('Plotline by AFKzona Group – https://afkzonagroup.lt');
  });

  it('ends every text report with the attribution, failures included, and keeps --format json as JSON', async () => {
    const files = { 'x.geojson': '{', 'crs.geojson': '{"type":"FeatureCollection","crs":{"type":"name","properties":{"name":"EPSG:3857"}},"features":[]}' };
    const cases = [
      ['validate', 'x.geojson'],
      ['fix', 'x.geojson', '--out', 'o.geojson'],
      ['split', 'x.geojson', '--out-dir', 'parts'],
      ['convert', 'crs.geojson', '--out', 'o.geojson'],
      ['stats', 'x.geojson'],
    ];
    for (const args of cases) {
      const io = fake(files);
      await run(args, io);
      expect(io.out.trimEnd().split('\n').pop(), args.join(' ')).toBe('Plotline by AFKzona Group – https://afkzonagroup.lt');
      const json = fake(files);
      await run([...args, '--format', 'json'], json);
      expect((JSON.parse(json.out) as { generator: string }).generator, args.join(' ')).toMatch(/^Plotline/);
    }
  });

  it('honours --commodity, --fail-on and --variant', async () => {
    const io = fake({ 'p.geojson': fc(feature(point(-5.500001, 6.800001), { ...PROPS, Area: 9 })), 'w.geojson': fc(feature(point(-5.500001, 6.800001))) });
    expect(await run(['validate', 'p.geojson', '--commodity', 'cattle'], io)).toBe(0);
    expect(await run(['validate', 'p.geojson', '--commodity=oil-palm'], io)).toBe(1);
    expect(await run(['validate', 'w.geojson'], io)).toBe(0);
    expect(await run(['validate', 'w.geojson', '--fail-on', 'warning'], io)).toBe(1);
    expect(await run(['validate', 'p.geojson', '--fail-on', 'never'], io)).toBe(0);
  });

  it('writes JSON reports', async () => {
    const io = fake({ 'bad.geojson': BAD });
    expect(await run(['validate', 'bad.geojson', '--format', 'json'], io)).toBe(1);
    const parsed = JSON.parse(io.out) as { generator: string; ok: boolean; files: { file: string; report: { issues: { rule: string }[] } }[] };
    expect(parsed.ok).toBe(false);
    expect(parsed.generator).toContain('AFKzona Group');
    expect(parsed.files[0]?.report.issues.map((i) => i.rule)).toContain('ring-not-closed');
  });

  it('writes GitHub annotations that file content cannot break out of', async () => {
    const evil = fc(feature(point(-5.500001, 6.800001), { ProductionPlace: 'x', ProducerCountry: 'Z\n::error::injected%0A', Area: 1 }));
    const io = fake({ 'e,v:il.geojson': evil });
    expect(await run(['validate', 'e,v:il.geojson', '--format', 'github'], io)).toBe(1);
    const lines = io.out.split('\n').filter((l) => l.startsWith('::'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^::error file=e%2Cv%3Ail\.geojson,title=Plotline producer-country-invalid::/);
    expect(lines[0]).toContain('%25');
    expect(io.out).not.toContain('\n::error::injected');
  });

  it('repairs into a new file, never over the input, and only with --force over another file', async () => {
    const io = fake({ 'bad.geojson': BAD, 'exists.geojson': 'x' });
    expect(await run(['fix', 'bad.geojson', '--out', 'bad.geojson'], io)).toBe(2);
    expect(io.err).toContain('must not be the input');
    expect(await run(['fix', 'bad.geojson', '-o', 'exists.geojson'], io)).toBe(2);
    expect(io.files.get('exists.geojson')).toBe('x');
    expect(await run(['fix', 'bad.geojson', '-o', 'exists.geojson', '--force'], io)).toBe(1);
    expect(io.files.get('exists.geojson')).toContain('"FeatureCollection"');
    expect(io.out).toContain('CHANGED ring-not-closed');
    expect(io.out).toContain('point-area-above-4ha');
    expect(await run(['fix', 'bad.geojson', '-o', 'json.geojson', '--format', 'json'], io)).toBe(1);
    const report = JSON.parse(io.out.slice(io.out.lastIndexOf('{\n  "generator"'))) as { changes: unknown[] };
    expect(report.changes.length).toBeGreaterThan(0);
  });

  it('does not write output for unreadable files', async () => {
    const io = fake({ 'x.geojson': '{' });
    expect(await run(['fix', 'x.geojson', '-o', 'y.geojson'], io)).toBe(1);
    expect(io.files.has('y.geojson')).toBe(false);
  });

  it('prints statistics', async () => {
    const io = fake({ 'a.geojson': fc(feature(polygon(A)), feature(point(1.000001, 1.000001), { ...PROPS, Area: 2 })) });
    expect(await run(['stats', 'a.geojson'], io)).toBe(0);
    expect(io.out).toContain('2 plot(s): 1 polygon(s), 1 point(s)');
    expect(io.out).toContain('plots of more than 4 ha: 1');
    expect(await run(['stats', 'a.geojson', '--format', 'json'], io)).toBe(0);
  });

  it('splits into parts with a manifest', async () => {
    const plots = Array.from({ length: 30 }, (_, i) => feature(point(0.000001 + i / 1000, 1.000001), { ...PROPS, ProducerName: `n${i}`, Area: 1 }));
    const io = fake({ 'many.geojson': fc(...plots) });
    expect(await run(['split', 'many.geojson', '-d', 'out', '--max-bytes', '2000'], io)).toBe(0);
    const parts = [...io.files.keys()].filter((k) => k.startsWith('out/part-'));
    expect(parts.length).toBeGreaterThan(1);
    const manifest = JSON.parse(io.files.get('out/manifest.json') ?? '{}') as { parts: { bytes: number }[] };
    expect(manifest.parts.every((p) => p.bytes <= 2000)).toBe(true);
    expect(io.out).toContain('Article 8a');
    expect(await run(['split', 'many.geojson'], io)).toBe(2);
  });

  it('converts CSV and KML, and writes DDS producer data', async () => {
    const io = fake({ 'p.csv': 'lon,lat,ProducerName,country\n-5.500001,6.800001,Ana,CI\n' });
    expect(await run(['convert', 'p.csv', '-o', 'p.geojson'], io)).toBe(0);
    expect(io.files.get('p.geojson')).toContain('"ProducerName":"Ana"');
    expect(await run(['convert', 'p.csv', '-o', 'p.json', '--to', 'dds-producers'], io)).toBe(0);
    const dds = JSON.parse(io.files.get('p.json') ?? '{}') as { producers: { country: string; geometryGeojson: string }[] };
    expect(dds.producers[0]?.country).toBe('CI');
    expect(Buffer.from(dds.producers[0]?.geometryGeojson ?? '', 'base64').toString()).toContain('FeatureCollection');
  });

  it('lists rules with sources', async () => {
    const io = fake();
    expect(await run(['rules'], io)).toBe(0);
    expect(io.out).toContain('point-area-above-4ha  [requirement, error]');
    expect(io.out).toContain('Regulation (EU) 2023/1115, Article 2, point (28)');
    const j = fake();
    expect(await run(['rules', '--format', 'json'], j)).toBe(0);
    expect((JSON.parse(j.out) as { rules: unknown[] }).rules.length).toBeGreaterThan(40);
  });

  it('validates files found with --root and --glob', async () => {
    const io = fake({ 'repo/a.geojson': GOOD, 'repo/sub/b.geojson': BAD, 'repo/c.txt': 'x' });
    expect(await run(['validate', '--root', 'repo', '--glob', '**/*.geojson'], io)).toBe(1);
    expect(io.out).toContain('repo/a.geojson: OK');
    expect(io.out).toContain('repo/sub/b.geojson: FAILED');
    const gh = fake({ 'repo/sub/b.geojson': BAD });
    await run(['validate', '--root', 'repo/', '--glob', '**/*.geojson', '--format', 'github'], gh);
    expect(gh.out).toContain('::error file=repo/sub/b.geojson,');
    const dot = fake({ 'repo/a.geojson': GOOD });
    dot.listFiles = () => Promise.resolve(['repo/a.geojson']);
    await run(['validate', '--root', '.', '--glob', '**/*.geojson'], dot);
    expect(dot.out).toMatch(/^repo\/a\.geojson: OK/);
    expect(await run(['validate', '--root', 'repo'], io)).toBe(2);
    expect(await run(['validate', '--root', 'repo', '--glob', '*.none'], io)).toBe(1);
  });

  it('rejects bad arguments with exit 2 and no stack trace', async () => {
    for (const args of [['nope'], ['validate'], ['validate', 'x', '--bogus'], ['validate', 'x', '--format'], ['validate', 'x', '--format', 'xml'], ['validate', 'x', '--commodity', 'maize'], ['fix', 'a', 'b', '-o', 'c'], ['fix', 'x'], ['validate', 'x', '--max-bytes', '12abc'], ['validate', 'x', '--max-bytes', '1'], ['fix', 'x', '--country', 'br'], ['validate', 'x', '--format', 'json', '--format', 'text'], ['stats', 'x', '--format', 'github'], ['validate', 'x', '--force=1']]) {
      const io = fake({ x: GOOD });
      expect(await run(args, io), args.join(' ')).toBe(2);
      expect(io.err).toMatch(/^plotline: /);
      expect(io.err).not.toMatch(/\n\s+at /);
    }
  });

  it('hides internal errors behind a generic message', async () => {
    const io = fake();
    io.readFile = () => Promise.reject(new Error('secret internal detail'));
    expect(await run(['validate', 'x'], io)).toBe(2);
    expect(io.err).not.toContain('secret');
  });

  it('neutralises control and bidirectional characters from file content in terminal output', async () => {
    const esc = String.fromCharCode(27);
    const rlo = String.fromCharCode(0x202e);
    const io = fake({ [`e${esc}[2J.geojson`]: fc(feature(point(1.000001, 1.000001), { ProductionPlace: 'x', ProducerCountry: `${rlo}${esc}[31mZZ`, Area: 1 })) });
    await run(['validate', `e${esc}[2J.geojson`], io);
    expect(io.out).not.toContain(esc);
    expect(io.out).not.toContain(rlo);
    expect(safeText(`a${esc}b${rlo}c\nd`)).toBe('a\\u001bb\\u202ec\nd');
    expect(githubEscape('a%b\r\nc:d,e', true)).toBe('a%25b\\u000d%0Ac%3Ad%2Ce');
  });

  it('parses options strictly', () => {
    expect(parseArgs(['f', '--max-producers=5', '--repair']).maxProducers).toBe(5);
    expect(() => parseArgs(['--max-producers', '0'])).toThrow(CliError);
    expect(() => parseArgs(['--max-input-bytes', '99999999999999'])).toThrow(CliError);
  });
});
