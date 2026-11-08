// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// The GitHub Action passes inputs only through environment variables, refuses
// roots outside the workspace, and derives its output from the exit code.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const action = readFileSync(join(ROOT, 'action.yml'), 'utf8');
const script = /- name: Check files[\s\S]*?run: \|\n([\s\S]*)$/.exec(action)?.[1] ?? '';
const body = script.split('\n').map((l) => l.replace(/^ {8}/, '')).join('\n');
const tmp = mkdtempSync(join(tmpdir(), 'plotline-action-'));
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function runAction(env: Record<string, string>): { code: number; out: string; output: string } {
  const outputFile = join(tmp, `out-${Math.random().toString(36).slice(2)}`);
  writeFileSync(outputFile, '');
  // A stand-in for dist/cli/main.js that records its arguments and exits with a chosen code.
  const actionPath = join(tmp, 'action');
  mkdirSync(join(actionPath, 'dist', 'cli'), { recursive: true });
  writeFileSync(join(actionPath, 'dist', 'cli', 'main.js'), "const fs = require('node:fs'); fs.writeFileSync(process.env.ARGS_FILE, JSON.stringify(process.argv.slice(2))); process.exit(Number(process.env.FAKE_EXIT));\n");
  writeFileSync(join(actionPath, 'package.json'), '{"type":"commonjs"}');
  let code = 0;
  let out = '';
  try {
    out = execFileSync('bash', ['-c', body], { env: { PATH: process.env.PATH ?? '', GITHUB_WORKSPACE: '/ws', GITHUB_ACTION_PATH: actionPath, GITHUB_OUTPUT: outputFile, ARGS_FILE: join(tmp, 'args.json'), PLOTLINE_GLOB: '**/*.geojson', PLOTLINE_ROOT: '.', PLOTLINE_COMMODITY: '', PLOTLINE_VARIANT: 'type-i', PLOTLINE_FAIL_ON: 'error', PLOTLINE_MAX_BYTES: '25000000', FAKE_EXIT: '0', ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    code = (e as { status: number }).status;
  }
  return { code, out, output: readFileSync(outputFile, 'utf8') };
}

describe('GitHub Action', () => {
  it('passes inputs through the environment only', () => {
    for (const input of ['glob', 'root', 'commodity', 'variant', 'fail-on', 'max-bytes']) expect(action).toContain(`\${{ inputs.${input} }}`);
    expect(script).not.toContain('${{');
  });

  it('passes values as separate arguments, so they cannot inject shell code', () => {
    const r = runAction({ PLOTLINE_GLOB: '$(touch /tmp/pwned) ; *.geojson', PLOTLINE_COMMODITY: 'cocoa' });
    expect(r.code).toBe(0);
    const args = JSON.parse(readFileSync(join(tmp, 'args.json'), 'utf8')) as string[];
    expect(args).toContain('$(touch /tmp/pwned) ; *.geojson');
    expect(args).toEqual(expect.arrayContaining(['--commodity', 'cocoa', '--format', 'github']));
  });

  it('refuses roots outside the workspace', () => {
    for (const root of ['/etc', '..', '../x', 'a/../..', 'a/..', 'a\nb']) expect(runAction({ PLOTLINE_ROOT: root }).code, root).toBe(2);
  });

  it('sets the output from the exit code only', () => {
    expect(runAction({ FAKE_EXIT: '0' }).output).toBe('failed=false\n');
    const failed = runAction({ FAKE_EXIT: '1' });
    expect(failed.code).toBe(1);
    expect(failed.output).toBe('failed=true\n');
    const broken = runAction({ FAKE_EXIT: '2' });
    expect(broken.code).toBe(2);
    expect(broken.output).toBe('');
  });
});
