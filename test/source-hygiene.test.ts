// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// Repository-wide checks: no dangerous APIs, no network code, no hidden
// characters, licence headers, package hygiene.

import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VERSION } from '../src/version.js';

const ROOT = join(import.meta.dirname, '..');

function files(dir: string, ext: RegExp): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if ((name.startsWith('.') && name !== '.github') || ['__pycache__', 'node_modules', 'dist', 'coverage'].includes(name) || name.endsWith('.egg-info')) continue;
    const p = join(dir, name);
    const info = lstatSync(p);
    if (info.isDirectory()) out.push(...files(p, ext));
    else if (info.isFile() && ext.test(name)) out.push(p);
  }
  return out;
}

const files_ = files;
const SOURCES = files(join(ROOT, 'src'), /\.ts$/);
const ALL_CODE = [...SOURCES, ...files(join(ROOT, 'test'), /\.ts$/), ...files(join(ROOT, 'scripts'), /\.mjs$/), ...files(join(ROOT, 'python'), /\.py$/)];

describe('source hygiene', () => {
  it('uses no eval, Function constructor, dynamic import, child processes or HTML sinks', () => {
    const forbidden = [/\beval\s*\(/, /new\s+Function\s*\(/, /\bimport\s*\(/, /child_process/, /\.innerHTML\b/, /\.outerHTML\b/, /insertAdjacentHTML/, /document\.write/, /setAttribute\(\s*['"]on/, /setAttribute\(\s*['"]style/];
    for (const file of SOURCES) {
      const text = readFileSync(file, 'utf8');
      for (const re of forbidden) expect(re.test(text), `${relative(ROOT, file)} matches ${re}`).toBe(false);
    }
  });

  it('contains no network code in the library, CLI or app', () => {
    const network = [
      /\bfetch\s*\(/,
      /XMLHttpRequest/,
      /WebSocket/,
      /sendBeacon/,
      /EventSource/,
      /RTCPeerConnection/,
      /\bnew\s+(Shared)?Worker\s*\(/,
      /window\.open/,
      /\blocation\.(href|assign|replace)\b|\blocation\s*=/,
      /\brequire\s*\(/,
      /process\.binding/,
      /node:https?/,
      /node:net/,
      /node:dgram/,
      /node:tls/,
      /node:child_process/,
      /node:worker_threads/,
    ];
    for (const file of SOURCES) {
      const text = readFileSync(file, 'utf8');
      for (const re of network) expect(re.test(text), `${relative(ROOT, file)} matches ${re}`).toBe(false);
    }
  });

  it('contains no invisible or bidirectional control characters (Trojan Source)', () => {
    for (const file of ALL_CODE) {
      const text = readFileSync(file, 'utf8');
      // eslint-disable-next-line no-control-regex -- detecting control characters is the purpose
      expect(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00a0\u200b-\u200f\u2028-\u202f\u2060-\u2069\ufeff]/.test(text), relative(ROOT, file)).toBe(false);
    }
  });

  it('has no raw bidirectional, zero-width or line-separator characters in any tracked text file', () => {
    // Every text file in the repository, including documentation, data and workflows.
    const text = [
      ...ALL_CODE,
      ...files(ROOT, /\.(md|json|ya?ml|csv|html|css|toml|txt)$/),
    ];
    expect(text.length).toBeGreaterThan(40);
    const forbidden = /[\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2069\ufeff]/;
    for (const file of text) expect(forbidden.test(readFileSync(file, 'utf8')), relative(ROOT, file)).toBe(false);
  });

  it('has a copyright and licence header in every source file', () => {
    for (const file of SOURCES) {
      const text = readFileSync(file, 'utf8');
      expect(text, relative(ROOT, file)).toMatch(/Copyright 2026 MB AFKzona Group\n\/\/ SPDX-License-Identifier: AGPL-3\.0-only/);
    }
  });

  it('has no eslint-disable or ts-ignore without a written reason, and no any', () => {
    // This file is excluded: it necessarily spells out the patterns it looks for.
    for (const file of ALL_CODE.filter((f) => f.endsWith('.ts') && f !== import.meta.filename)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\/[/*]\s*eslint-disable[^\n]*/g)) expect(m[0], relative(ROOT, file)).toMatch(/ -- \S/);
      for (const m of text.matchAll(/\/\/\s*@ts-expect-error[^\n]*/g)) expect(m[0], relative(ROOT, file)).toMatch(/ -- \S/);
      expect(/\/\/\s*@ts-ignore/.test(text), relative(ROOT, file)).toBe(false);
      expect(/:\s*any\s*[,;)=>\]|]|\bas any\b|<any>/.test(text), relative(ROOT, file)).toBe(false);
    }
  });

  it('never names the tools used to write it', () => {
    // The words are assembled at run time so this file does not contain them.
    const words = ['edualc', 'ciporhtna'].map((w) => Array.from(w).reverse().join(''));
    const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter((f) => f !== '');
    expect(tracked.length).toBeGreaterThan(50);
    for (const f of tracked) {
      const lower = f.toLowerCase();
      for (const w of words) expect(lower.includes(w), f).toBe(false);
      const p = join(ROOT, f);
      if (!existsSync(p) || !lstatSync(p).isFile()) continue;
      const text = readFileSync(p, 'latin1').toLowerCase();
      for (const w of words) expect(text.includes(w), f).toBe(false);
    }
    const lowerTracked = tracked.map((t) => t.toLowerCase());
    for (const f of [`${words[0] ?? ''}.md`, 'agents.md']) expect(lowerTracked).not.toContain(f);
  });

  it('pins the Docker base image by digest and runs as an unprivileged user', () => {
    const docker = readFileSync(join(ROOT, 'Dockerfile'), 'utf8');
    for (const m of docker.matchAll(/^FROM\s+(\S+)/gm)) expect(m[1]).toMatch(/@sha256:[0-9a-f]{64}$/);
    expect(docker).toMatch(/^USER plotline$/m);
    expect(docker).not.toMatch(/^USER root/m);
  });

  it('pins every workflow and action step to a commit SHA and runs CI only on pull requests and on demand', () => {
    const files = [...files_(join(ROOT, '.github', 'workflows'), /\.ya?ml$/), join(ROOT, 'action.yml')];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/uses:\s*(\S+)/g)) expect(m[1], f).toMatch(/@[0-9a-f]{40}$|^\.\/$/);
    }
    for (const name of ['ci.yml', 'codeql.yml']) {
      const text = readFileSync(join(ROOT, '.github', 'workflows', name), 'utf8');
      expect(text).toMatch(/^on:\n {2}pull_request:\n {2}workflow_dispatch:\n/m);
      expect(text).not.toMatch(/^\s*(push|schedule):/m);
      expect(text).toMatch(/^permissions:\n {2}contents: read$/m);
    }
  });
});

describe('package', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as Record<string, unknown>;

  it('has zero runtime dependencies and no install scripts', () => {
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.optionalDependencies).toBeUndefined();
    const scripts = pkg.scripts as Record<string, string>;
    for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) expect(scripts[hook]).toBeUndefined();
  });

  it('pins every development dependency exactly', () => {
    for (const [name, version] of Object.entries(pkg.devDependencies as Record<string, string>)) expect(version, name).toMatch(/^[0-9]+\.[0-9]+\.[0-9]+$/);
  });

  it('declares licence, engines, exports and a files allow-list', () => {
    expect(pkg).toMatchObject({ name: '@afkzona/plotline', license: 'AGPL-3.0-only', type: 'module', engines: { node: '>=22' } });
    expect(pkg.files).toContain('dist/');
    expect(pkg.exports).toHaveProperty('.');
    expect(pkg.version).toBe(VERSION);
  });
});
