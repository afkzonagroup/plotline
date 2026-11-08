// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CliError, compileGlob, listFiles, makeDir, readFileLimited, sameFile, writeFileSafe } from '../src/cli/node-io.js';

const dir = mkdtempSync(join(tmpdir(), 'plotline-io-'));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('file access', () => {
  it('reads regular files within the limit and refuses larger files and directories', async () => {
    const f = join(dir, 'a.txt');
    writeFileSync(f, 'hello');
    expect(new TextDecoder().decode(await readFileLimited(f, 5))).toBe('hello');
    // Refused from the file size, before any content is read.
    await expect(readFileLimited(f, 4)).rejects.toThrow(/is 5 bytes; the limit is 4 bytes/);
    await expect(readFileLimited(dir, 100)).rejects.toThrow(/not a regular file/);
    await expect(readFileLimited(join(dir, 'missing'), 100)).rejects.toThrow(/Cannot open/);
    await expect(readFileLimited('', 100)).rejects.toThrow(/Invalid/);
    await expect(readFileLimited('a\0b', 100)).rejects.toThrow(/Invalid/);
  });

  it('refuses a FIFO without hanging', async () => {
    const fifo = join(dir, 'fifo');
    try {
      execFileSync('mkfifo', [fifo]);
    } catch {
      return; // mkfifo not available on this platform
    }
    await expect(readFileLimited(fifo, 100)).rejects.toThrow(/not a regular file/);
  });

  it('writes with mode 0600, never overwrites without force, and never through a link', async () => {
    const f = join(dir, 'out.geojson');
    await writeFileSafe(f, 'one', false);
    expect(statSync(f).mode & 0o777).toBe(0o600);
    await expect(writeFileSafe(f, 'two', false)).rejects.toThrow(/exists/);
    expect(readFileSync(f, 'utf8')).toBe('one');
    await writeFileSafe(f, 'three', true);
    expect(readFileSync(f, 'utf8')).toBe('three');
    const target = join(dir, 'target.txt');
    writeFileSync(target, 'keep');
    const link = join(dir, 'link.geojson');
    symlinkSync(target, link);
    await expect(writeFileSafe(link, 'evil', true)).rejects.toThrow(CliError);
    await expect(writeFileSafe(link, 'evil', false)).rejects.toThrow(CliError);
    expect(readFileSync(target, 'utf8')).toBe('keep');
  });

  it('creates directories with mode 0700 and refuses links and files', async () => {
    const d = join(dir, 'parts', 'x');
    await makeDir(d);
    expect(statSync(d).mode & 0o777).toBe(0o700);
    await makeDir(d);
    symlinkSync(dir, join(dir, 'dlink'));
    await expect(makeDir(join(dir, 'dlink'))).rejects.toThrow(/symbolic link/);
    await expect(makeDir(join(dir, 'a.txt'))).rejects.toThrow(/not a directory/);
  });

  it('recognises the same file through different paths', async () => {
    expect(await sameFile(join(dir, 'a.txt'), join(dir, '.', 'a.txt'))).toBe(true);
    expect(await sameFile(join(dir, 'a.txt'), join(dir, 'missing'))).toBe(false);
  });
});

describe('glob', () => {
  it.each([
    ['**/*.geojson', 'a.geojson', true],
    ['**/*.geojson', 'x/y/a.geojson', true],
    ['**/*.geojson', 'a.json', false],
    ['data/*.json', 'data/a.json', true],
    ['data/*.json', 'data/x/a.json', false],
    ['plot?.csv', 'plot1.csv', true],
    ['plot?.csv', 'plot12.csv', false],
    ['a/**/b/*.kml', 'a/b/c.kml', true],
    ['a/**/b/*.kml', 'a/x/y/b/c.kml', true],
    ['[ab].kml', '[ab].kml', true],
  ])('%s matches %s: %s', (pattern, path, result) => {
    expect(compileGlob(pattern)(path)).toBe(result);
  });

  it('refuses absolute and parent patterns', () => {
    for (const p of ['', '/etc/*', '../*', 'a/../b', 'x'.repeat(300)]) expect(() => compileGlob(p)).toThrow(CliError);
  });

  it('matches pathological patterns quickly', () => {
    const t0 = Date.now();
    expect(compileGlob('*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*b')('a'.repeat(250))).toBe(false);
    expect(compileGlob('**/**/**/**/**/**/**/**/x')(Array.from({ length: 30 }, () => 'd').join('/'))).toBe(false);
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it('lists matching files inside the root, skipping links, .git and node_modules', async () => {
    const root = join(dir, 'repo');
    mkdirSync(join(root, 'sub'), { recursive: true });
    mkdirSync(join(root, '.git'), { recursive: true });
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    writeFileSync(join(root, 'a.geojson'), '{}');
    writeFileSync(join(root, 'sub', 'b.geojson'), '{}');
    writeFileSync(join(root, '.git', 'c.geojson'), '{}');
    writeFileSync(join(root, 'node_modules', 'd.geojson'), '{}');
    const outside = join(dir, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'e.geojson'), '{}');
    symlinkSync(outside, join(root, 'escape'));
    symlinkSync(join(outside, 'e.geojson'), join(root, 'f.geojson'));
    expect(await listFiles(root, '**/*.geojson', 100)).toEqual(['a.geojson', 'sub/b.geojson']);
    await expect(listFiles(root, '**/*.geojson', 1)).rejects.toThrow(/More than 1/);
  });

  it('refuses a --root that is or passes through a symbolic link', async () => {
    const outside = join(dir, 'secret');
    mkdirSync(join(outside, 'deep'), { recursive: true });
    writeFileSync(join(outside, 'deep', 's.geojson'), '{}');
    const ws = join(dir, 'ws');
    mkdirSync(join(ws, 'real'), { recursive: true });
    writeFileSync(join(ws, 'real', 'ok.geojson'), '{}');
    symlinkSync(outside, join(ws, 'plots'));
    const cwd = process.cwd();
    process.chdir(ws);
    try {
      expect(await listFiles('real', '*.geojson', 10)).toEqual(['ok.geojson']);
      expect(await listFiles('.', 'real/*.geojson', 10)).toEqual(['real/ok.geojson']);
      await expect(listFiles('plots', '*.geojson', 10)).rejects.toThrow(/symbolic link/);
      await expect(listFiles('plots/deep', '*.geojson', 10)).rejects.toThrow(/symbolic link/);
      await expect(listFiles(join(ws, 'plots'), '**/*.geojson', 10)).rejects.toThrow(/symbolic link/);
      await expect(listFiles('missing', '*.geojson', 10)).rejects.toThrow(/Cannot read directory/);
    } finally {
      process.chdir(cwd);
    }
  });
});
