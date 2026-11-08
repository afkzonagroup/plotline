// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// Every rule is grounded in a cited text, and every quote in the rule
// catalogue appears word for word in the fixture copy of that official text
// (test-vectors/sources). Recommendations and safety limits are labelled as
// such and never presented as requirements.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RULES } from '../src/core/rules.js';
import * as S from '../src/core/sources.js';

const DIR = join(import.meta.dirname, '..', 'test-vectors', 'sources');
const read = (name: string): string => readFileSync(join(DIR, name), 'utf8');
const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** The fixture that holds each source document. */
function fixtureFor(url: string): string | null {
  if (url === S.EUDR_CONSOLIDATED) return read('eudr-2023-1115-consolidated-2026-09-18.txt');
  if (url === S.IS_GEOJSON) return read('is-geojson-file-description.txt');
  if (url === S.IS_VALIDATION) return read('is-validation-rules.txt');
  if (url === S.IS_API_DDS) return read('is-api-dds-v4.txt');
  if (url === S.IMPLEMENTING_2026_1565) return read('implementing-2026-1565-excerpt.txt');
  if (url.startsWith(S.RFC7946)) return read('rfc7946.txt');
  if (url.startsWith(S.RFC8259)) return read('rfc8259.txt');
  if (url.startsWith(S.RFC7493)) return read('rfc7493.txt');
  return null;
}

describe('rule sources', () => {
  it('has unique rule ids', () => {
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
  });

  it.each(RULES.filter((r) => r.quote !== null).map((r) => [r.id, r] as const))('quotes %s verbatim from its first source', (_id, r) => {
    const first = r.sources[0];
    expect(first).toBeDefined();
    const text = fixtureFor(first?.url ?? '');
    expect(text, `no fixture for ${first?.url ?? ''}`).not.toBeNull();
    expect(norm(text ?? '')).toContain(norm(r.quote ?? ''));
  });

  it('grounds every requirement and interpretation in an official source', () => {
    for (const r of RULES.filter((x) => x.status === 'requirement' || x.status === 'interpretation')) {
      expect(r.sources.length, r.id).toBeGreaterThan(0);
      const official = r.sources.some((s) => s.url.startsWith('https://eur-lex.europa.eu/') || s.url.startsWith('https://eudr.webcloud.ec.europa.eu/') || s.url.startsWith(S.RFC7946) || s.url === S.ISO3166);
      expect(official, r.id).toBe(true);
    }
  });

  it('labels Plotline-only checks as recommendations or safety limits, never as requirements', () => {
    for (const id of ['duplicate-plot', 'overlapping-plots', 'area-mismatch', 'polygon-area-tiny', 'winding-order', 'antimeridian-crossing', 'production-place-missing', 'nested-geometry-collection'] as const) {
      expect(RULES.find((r) => r.id === id)?.status, id).toBe('recommendation');
    }
    for (const id of ['input-limit', 'json-duplicate-key', 'check-limit-reached'] as const) {
      expect(RULES.find((r) => r.id === id)?.status, id).toBe('safety');
    }
  });

  it('uses only official hosts for links', () => {
    for (const r of RULES) {
      for (const s of r.sources) expect(s.url).toMatch(/^https:\/\/(eur-lex\.europa\.eu|eudr\.webcloud\.ec\.europa\.eu|www\.rfc-editor\.org|www\.iso\.org|www\.ogc\.org)\//);
    }
  });

  it('states the application dates as the consolidated Article 38 does', () => {
    const t = norm(read('eudr-2023-1115-consolidated-2026-09-18.txt'));
    expect(t).toContain('Articles 3 to 13, Articles 16 to 24 and Articles 26, 31 and 32 shall apply from 30 December 2026.');
    expect(t).toContain('who were established as such by 31 December 2024, the Articles referred to in paragraph 2 of this Article shall apply from 30 June 2027.');
    const readme = norm(readFileSync(join(import.meta.dirname, '..', 'README.md'), 'utf8'));
    expect(readme).toContain('30 December 2026');
    expect(readme).toContain('30 June 2027');
  });

  it('keeps the system limits the Commission publishes', () => {
    const t = norm(read('is-validation-rules.txt'));
    expect(t).toContain('presently set to 25Mb');
    expect(t).toContain('presently set to 1000');
    expect(t).toContain('presently set to 10,000');
    expect(t).toContain('the area must also be higher or equal to 0.0001ha');
    const g = norm(read('is-geojson-file-description.txt'));
    expect(g).toContain('The information system will truncate coordinate points to 6 decimal places before storing.');
    expect(g).toContain('If it is not provided, then it will be set by default to "4" (four) hectares');
  });
});
