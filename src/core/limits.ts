// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Resource limits applied to every input before and while it is read. They
 * protect the process from hostile or broken files (huge inputs, deep
 * nesting, very long strings, quadratic geometry checks). The limits are
 * Plotline's own safety controls, not rules of the Regulation; the
 * Information System's limits are in {@link SYSTEM_LIMITS}.
 */
export interface Limits {
  /** Largest input file in bytes. */
  readonly maxInputBytes: number;
  /** Deepest nesting of JSON arrays and objects, or XML elements. */
  readonly maxDepth: number;
  /** Most JSON values (or XML elements, or CSV cells) in one input. */
  readonly maxValues: number;
  /** Longest string, in UTF-16 code units. */
  readonly maxStringLength: number;
  /** Longest number token, in characters. */
  readonly maxNumberLength: number;
  /** Most features (plots) in one input. */
  readonly maxFeatures: number;
  /** Most positions (coordinate pairs) in one input. */
  readonly maxPositions: number;
  /** Most segment-pair tests for the self-intersection and overlap checks of one input. */
  readonly checkBudget: number;
}

/** Default limits: generous for real plot files, small enough to keep a laptop responsive. */
export const DEFAULT_LIMITS: Limits = Object.freeze({
  maxInputBytes: 64 * 1024 * 1024,
  maxDepth: 64,
  maxValues: 20_000_000,
  maxStringLength: 65_536,
  maxNumberLength: 64,
  maxFeatures: 250_000,
  maxPositions: 5_000_000,
  checkBudget: 50_000_000,
});

/** Upper bounds that options may not exceed, so a caller cannot switch the protection off by accident. */
export const HARD_LIMITS: Limits = Object.freeze({
  maxInputBytes: 512 * 1024 * 1024,
  maxDepth: 256,
  maxValues: 100_000_000,
  maxStringLength: 1_048_576,
  maxNumberLength: 400,
  maxFeatures: 2_000_000,
  maxPositions: 40_000_000,
  checkBudget: 2_000_000_000,
});

/**
 * Limits of the EUDR Information System, as published by the Commission in
 * "API and UI Validation Rules" of the EUDR Information System operator
 * documentation. The Commission describes each as "presently set to", so
 * they can change; they are options, not constants of the law.
 */
export const SYSTEM_LIMITS = Object.freeze({
  /**
   * "The total size of geolocation data per DDS cannot exceed a certain amount (presently set to 25Mb)."
   * The documentation does not say whether "Mb" means 10^6 or 2^20 bytes;
   * Plotline uses the smaller value, 25,000,000 bytes.
   */
  maxGeolocationBytes: 25_000_000,
  /** "The total number of producers data per commodity cannot exceed a certain amount (presently set to 1000)." */
  maxProducersPerCommodity: 1000,
  /** "The total number of producers data per DDS cannot exceed a certain amount (presently set to 10,000)." */
  maxProducersPerStatement: 10_000,
});

/**
 * Merges caller limits over the defaults. Every value must be a positive
 * safe integer no larger than {@link HARD_LIMITS}.
 *
 * @throws RangeError for an invalid value.
 */
export function resolveLimits(overrides: Partial<Limits> = {}): Limits {
  const out: Record<string, number> = { ...DEFAULT_LIMITS };
  for (const [key, given] of Object.entries(overrides)) {
    if (!Object.hasOwn(DEFAULT_LIMITS, key)) throw new RangeError(`unknown limit: ${key}`);
    // Callers may be plain JavaScript, so the type is checked at run time too.
    const value: unknown = given;
    if (value === undefined) continue;
    const hard = HARD_LIMITS[key as keyof Limits];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > hard) {
      throw new RangeError(`limit ${key} must be an integer from 1 to ${hard}`);
    }
    out[key] = value;
  }
  return Object.freeze(out) as unknown as Limits;
}
