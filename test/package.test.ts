// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// Consistency between the TypeScript package, the Python package, the
// generated documents and the published schema.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { run, type Io } from '../src/cli/run.js';
import { RULES } from '../src/core/rules.js';
import { VERSION } from '../src/version.js';
// @ts-expect-error -- plain JavaScript script without type declarations
import { rulesMarkdown } from '../scripts/rules-doc.mjs';
import { fc, feature, point, polygon } from './helpers.js';

const ROOT = join(import.meta.dirname, '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

describe('package consistency', () => {
  it('uses one version everywhere', () => {
    expect((JSON.parse(read('package.json')) as { version: string }).version).toBe(VERSION);
    expect(read('python/pyproject.toml')).toContain(`version = "${VERSION}"`);
    expect(read('python/src/plotline/__init__.py')).toContain(`VERSION = "${VERSION}"`);
    expect(read('CHANGELOG.md')).toContain(`## [${VERSION}]`);
  });

  it('gives the Python package the same rule catalogue', () => {
    const py = JSON.parse(read('python/src/plotline/rules.json')) as { rules: unknown };
    expect(py.rules).toEqual(JSON.parse(JSON.stringify(RULES)));
  });

  it('ships the licence files with the Python package', () => {
    expect(read('python/LICENSE')).toBe(read('LICENSE'));
    expect(read('python/LICENSE-ADDITIONAL-TERMS.md')).toBe(read('LICENSE-ADDITIONAL-TERMS.md'));
  });

  it('keeps docs/rules.md generated from the catalogue', () => {
    expect(read('docs/rules.md')).toBe((rulesMarkdown as (r: typeof RULES) => string)(RULES));
  });

  it('writes JSON reports that match the published schema', async () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const check = ajv.compile(JSON.parse(read('schema/report-v1.schema.json')) as object);
    const files: Record<string, string> = {
      'a.geojson': fc(feature(polygon([[0, 0], [1, 0], [1, 1], [0, 0]])), feature(point(1.000001, 1.000001)), feature(null)),
      'b.csv': 'lon,lat\n1,2\n',
      'c.kml': '<kml><Placemark><Point><coordinates>1,2</coordinates></Point></Placemark></kml>',
      'd.geojson': '{',
    };
    let out = '';
    const io: Io = {
      stdout: (t) => {
        out += t;
      },
      stderr: () => undefined,
      readFile: (p) => Promise.resolve(new TextEncoder().encode(files[p] ?? '')),
      writeFile: () => Promise.resolve(),
      makeDir: () => Promise.resolve(),
      sameFile: () => Promise.resolve(false),
      listFiles: () => Promise.resolve([]),
      joinPath: (a, b) => `${a}/${b}`,
    };
    await run(['validate', ...Object.keys(files), '--format', 'json'], io);
    const report: unknown = JSON.parse(out);
    expect(check(report), JSON.stringify(check.errors)).toBe(true);
  });

  it('declares licence, engines, exports, bin and a files allow-list', () => {
    const pkg = JSON.parse(read('package.json')) as Record<string, unknown>;
    expect(pkg).toMatchObject({ name: '@afkzona/plotline', license: 'AGPL-3.0-only', engines: { node: '>=22' }, bin: { plotline: './dist/cli/main.js' } });
    expect((pkg.repository as { url: string }).url).toBe('git+https://github.com/afkzonagroup/plotline.git');
    expect(pkg.files).toEqual(expect.arrayContaining(['dist/', 'schema/', 'LICENSE', 'LICENSE-ADDITIONAL-TERMS.md']));
  });

  // .npmrc sets ignore-scripts=true, so "prepack" never builds: a release that
  // does not build first publishes a package without its compiled code.
  it('builds and checks the tarball before publishing', () => {
    for (const workflow of ['.github/workflows/release.yml', '.github/workflows/ci.yml']) {
      const steps = read(workflow);
      const build = steps.indexOf('npm run build');
      const check = steps.indexOf('node scripts/check-pack.mjs');
      expect(build, workflow).toBeGreaterThan(0);
      expect(check, workflow).toBeGreaterThan(build);
      const publish = steps.indexOf('npm publish');
      if (publish >= 0) expect(publish, workflow).toBeGreaterThan(check);
    }
    expect(read('.npmrc')).toMatch(/^ignore-scripts=true$/m);
  });

  it('refuses a tarball without the compiled entry points', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plotline-pack-'));
    try {
      const listing = (paths: string[]): string => {
        const file = join(dir, 'pack.json');
        writeFileSync(file, JSON.stringify([{ files: paths.map((path) => ({ path })) }]));
        return file;
      };
      const check = (file: string): number => {
        try {
          execFileSync(process.execPath, [join(ROOT, 'scripts/check-pack.mjs'), file], { cwd: ROOT, stdio: 'pipe' });
          return 0;
        } catch (e) {
          return (e as { status: number }).status;
        }
      };
      const unbuilt = ['package.json', 'LICENSE', 'LICENSE-ADDITIONAL-TERMS.md', 'README.md', 'schema/report-v1.schema.json'];
      expect(check(listing(unbuilt))).toBe(1);
      const built = [...unbuilt, 'dist/index.js', 'dist/index.d.ts', 'dist/cli/main.js', 'dist/app/plotline.html'];
      expect(check(listing(built))).toBe(0);
      expect(check(listing(built.filter((p) => p !== 'dist/app/plotline.html')))).toBe(1);
      expect(check(listing([]))).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
