// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// Coordinates are held as integers in millionths of a degree ("micro-degrees"),
// obtained by truncating the exact decimal text of the source toward zero.
// The Commission's GeoJSON file description says the Information System
// "will truncate coordinate points to 6 decimal places before storing", so
// every geometry check runs on the same values the system stores, with exact
// integer arithmetic.

/** Millionths of a degree per degree. */
export const MICRO = 1_000_000;

/** One coordinate value read from source text. */
export interface Coordinate {
  /** Value truncated toward zero to six decimals, in millionths of a degree. */
  readonly micro: number;
  /** The nearest double of the source value, for range checks and messages. */
  readonly value: number;
  /** Decimal places written in the source (exponents taken into account). */
  readonly decimals: number;
  /** True when digits after the sixth decimal were not all zero, so truncation changed the value. */
  readonly truncated: boolean;
}

const DECIMAL = /^(-?)([0-9]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/;

/** Largest absolute value accepted as a coordinate at all; anything larger is not a coordinate. */
export const MAX_ABS_COORDINATE = 10_000;

/**
 * Reads a decimal number text (JSON number syntax, or the same with a
 * leading "+" removed by the caller) as a coordinate. Returns null when the
 * text is not a decimal number or its magnitude exceeds
 * {@link MAX_ABS_COORDINATE}.
 *
 * @example
 * parseCoordinate('-5.8227391234') // { micro: -5822739, decimals: 10, truncated: true, ... }
 */
export function parseCoordinate(raw: string): Coordinate | null {
  const m = DECIMAL.exec(raw);
  if (m === null) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || Math.abs(value) > MAX_ABS_COORDINATE) return null;
  const negative = m[1] === '-';
  const intPart = m[2] ?? '';
  const fracPart = m[3] ?? '';
  const expText = m[4] ?? '0';
  // The exponent is bounded: |value| <= 10000 and the digit strings are bounded by the caller's number-length limit.
  const exp = Math.max(-100_000, Math.min(100_000, parseInt(expText, 10)));
  const digits = intPart + fracPart;
  const point = intPart.length + exp; // decimal point position within `digits`
  const decimals = Math.max(0, digits.length - point);
  const keep = point + 6; // digits before the cut
  let micro = 0;
  let truncated: boolean;
  if (keep <= 0) {
    truncated = /[1-9]/.test(digits);
  } else {
    const head = keep >= digits.length ? digits + '0'.repeat(keep - digits.length) : digits.slice(0, keep);
    truncated = keep < digits.length && /[1-9]/.test(digits.slice(keep));
    micro = parseInt(head.replace(/^0+(?=.)/, ''), 10);
  }
  if (negative && micro !== 0) micro = -micro;
  return { micro, value, decimals, truncated };
}

/** Writes micro-degrees as the shortest exact decimal text, for example -5822739 as "-5.822739" and 17100220 as "17.10022". */
export function formatMicro(micro: number): string {
  if (!Number.isSafeInteger(micro)) throw new RangeError('coordinate must be a safe integer');
  const negative = micro < 0;
  const abs = Math.abs(micro);
  const whole = Math.floor(abs / MICRO);
  const frac = String(abs % MICRO).padStart(6, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${frac === '' ? '' : `.${frac}`}`;
}
