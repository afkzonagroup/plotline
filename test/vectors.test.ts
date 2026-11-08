// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// The shared vectors: the same inputs and expected results as the Python
// tests (python/tests/test_vectors.py). Both implementations must agree.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fix, validate } from '../src/core/api.js';
import { RULES } from '../src/core/rules.js';
// @ts-expect-error -- plain JavaScript script without type declarations
import { tsOptions } from '../scripts/generate-vectors-options.mjs';

interface Case {
  name: string;
  format: 'geojson' | 'kml' | 'csv';
  input: string;
  options: Record<string, unknown>;
}
interface Expected {
  issues: { rule: string; severity: string; path: string; feature: number | null }[];
  hectares: (number | null)[];
  output: string | null;
  changes: { rule: string; path: string; feature: number | null }[];
  after: Expected['issues'] | null;
}

const ROOT = join(import.meta.dirname, '..');
const inputs = (JSON.parse(readFileSync(join(ROOT, 'test-vectors/cases-input.json'), 'utf8')) as { cases: Case[] }).cases;
const expected = new Map((JSON.parse(readFileSync(join(ROOT, 'test-vectors/cases.json'), 'utf8')) as { cases: { name: string; expected: Expected }[] }).cases.map((c) => [c.name, c.expected]));
const brief = (issues: readonly { rule: string; severity: string; path: string; feature: number | null }[]): Expected['issues'] => issues.map((i) => ({ rule: i.rule, severity: i.severity, path: i.path, feature: i.feature }));

describe('shared test vectors', () => {
  it('has expectations for every input', () => {
    expect([...expected.keys()]).toEqual(inputs.map((c) => c.name));
    expect(inputs.length).toBeGreaterThan(90);
  });

  it('exercises every rule at least once', () => {
    const seen = new Set<string>();
    for (const e of expected.values()) for (const i of [...e.issues, ...(e.after ?? [])]) seen.add(i.rule);
    const missing = RULES.map((r) => r.id).filter((id) => !seen.has(id));
    expect(missing).toEqual([]);
  });

  it.each(inputs.map((c) => [c.name, c] as const))('%s', (name, c) => {
    const exp = expected.get(name) as Expected;
    const options = { ...(tsOptions as (o: Record<string, unknown>) => Record<string, unknown>)(c.options), format: c.format };
    const r = validate(c.input, options);
    expect(brief(r.issues)).toEqual(exp.issues);
    expect(r.plots.map((p) => p.hectares)).toHaveLength(exp.hectares.length);
    r.plots.forEach((p, i) => {
      const want = exp.hectares[i];
      if (want === null || want === undefined) expect(p.hectares).toBeNull();
      else expect(Math.abs((p.hectares ?? NaN) - want)).toBeLessThanOrEqual(Math.abs(want) * 1e-9 + 1e-12);
    });
    const f = fix(c.input, options);
    expect(f.output).toBe(exp.output);
    expect(f.changes.map((x) => ({ rule: x.rule, path: x.path, feature: x.feature }))).toEqual(exp.changes);
    expect(f.after === null ? null : brief(f.after.issues)).toEqual(exp.after);
  });
});
