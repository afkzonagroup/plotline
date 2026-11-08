// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { formatMicro, parseCoordinate } from '../src/core/coords.js';

describe('parseCoordinate', () => {
  it('truncates toward zero, as the Information System does (its own example)', () => {
    // GeoJSON File Description, common error 7: both become -5.822739, 144.256707.
    expect(parseCoordinate('-5.8227391234')?.micro).toBe(-5822739);
    expect(parseCoordinate('-5.8227394567')?.micro).toBe(-5822739);
    expect(parseCoordinate('144.2567071234')?.micro).toBe(144256707);
    expect(parseCoordinate('144.2567074567')?.micro).toBe(144256707);
  });

  it.each([
    ['0', 0, 0, false],
    ['-0', 0, 0, false],
    ['17.10022', 17100220, 5, false],
    ['-49.004616', -49004616, 6, false],
    ['1.0000009', 1000000, 7, true],
    ['-1.0000009', -1000000, 7, true],
    ['1.0000000', 1000000, 7, false],
    ['0.0000001', 0, 7, true],
    ['-0.0000001', 0, 7, true],
    ['1e-7', 0, 7, true],
    ['1.5e-3', 1500, 4, false],
    ['15e-4', 1500, 4, false],
    ['1.50e2', 150000000, 0, false],
    ['180', 180000000, 0, false],
    ['-180.000000', -180000000, 6, false],
    ['179.9999999', 179999999, 7, true],
    ['1E+1', 10000000, 0, false],
  ])('reads %s', (raw, micro, decimals, truncated) => {
    const c = parseCoordinate(raw);
    expect(c).not.toBeNull();
    expect(c?.micro).toBe(micro);
    expect(c?.decimals).toBe(decimals);
    expect(c?.truncated).toBe(truncated);
  });

  it('is exact where floating point is not', () => {
    // 0.1 + 0.2 style errors cannot occur: the decimal text is cut, not the double.
    expect(parseCoordinate('2.675')?.micro).toBe(2675000);
    expect(parseCoordinate('0.3000009999999999')?.micro).toBe(300000);
  });

  it.each(['', '-', '1.', '.5', '+1', '1,5', 'NaN', 'Infinity', '0x10', '1e', '12a', '10001', '-10000.5', '1e5'])('rejects %j', (raw) => {
    expect(parseCoordinate(raw)).toBeNull();
  });

  it('handles extreme exponents without huge strings', () => {
    expect(parseCoordinate('1e-99999')).toMatchObject({ micro: 0, truncated: true });
    expect(parseCoordinate('0e99999')).toMatchObject({ micro: 0, truncated: false });
  });
});

describe('formatMicro', () => {
  it.each([
    [0, '0'],
    [-5822739, '-5.822739'],
    [17100220, '17.10022'],
    [180000000, '180'],
    [-1, '-0.000001'],
    [1000000, '1'],
  ])('writes %i as %s', (micro, text) => {
    expect(formatMicro(micro)).toBe(text);
    expect(parseCoordinate(text)?.micro).toBe(micro);
  });

  it('rejects non-integers', () => {
    expect(() => formatMicro(0.5)).toThrow(RangeError);
  });
});
