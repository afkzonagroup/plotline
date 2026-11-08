// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// Runs the TypeScript example in README.md and checks that every
// console.log prints what its comment says, so the documentation stays true.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const TMP = join(import.meta.dirname, '.tmp');
const README = readFileSync(join(ROOT, 'README.md'), 'utf8');

function examples(language: string): [string, string][] {
  const out: [string, string][] = [];
  const re = new RegExp(`<!-- example:([a-z-]+) -->\\n\`\`\`${language}\\n([\\s\\S]*?)\`\`\``, 'g');
  for (const m of README.matchAll(re)) out.push([m[1] ?? '', m[2] ?? '']);
  return out;
}

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('README examples', () => {
  it('has the expected examples', () => {
    expect(examples('ts').map(([name]) => name)).toEqual(['library']);
    expect(examples('python').map(([name]) => name)).toEqual(['python']);
  });

  it.each(examples('ts'))('runs the %s example and prints what the comments say', async (name, code) => {
    const expected = [...code.matchAll(/console\.log\(.*\); \/\/ (.*)$/gm)].map((m) => m[1]);
    expect(expected.length).toBeGreaterThan(0);
    mkdirSync(TMP, { recursive: true });
    const file = join(TMP, `${name}.mts`);
    const prelude = "import { format as __format } from 'node:util';\nconst __out: string[] = ((globalThis as Record<string, unknown>).__readmeOut = []) as string[];\nconst console = { log: (...a: unknown[]) => { __out.push(__format(...a)); } };\n";
    writeFileSync(file, prelude + code.replace(/'@afkzona\/plotline'/g, `'${pathToFileURL(join(ROOT, 'src/index.ts')).href}'`));
    // eslint-disable-next-line no-restricted-syntax -- loads the README example written above, not user input
    await import(pathToFileURL(file).href);
    expect((globalThis as Record<string, unknown>).__readmeOut).toEqual(expected);
  });

  it('documents every CLI command and the attribution', () => {
    for (const c of ['validate', 'fix', 'stats', 'split', 'convert', 'rules']) expect(README).toContain(`plotline ${c}`);
    expect(README).toContain('Plotline by AFKzona Group');
    expect(README).toContain('Not legal advice');
  });
});
