// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { validate, fix, type CheckOptions, type RepairOptions } from '../src/core/api.js';
import type { RuleId } from '../src/core/rules.js';

type Coord = [number, number] | [number, number, number];

/** A FeatureCollection text from features. */
export const fc = (...features: unknown[]): string => JSON.stringify({ type: 'FeatureCollection', features });

/** Default properties of a valid plot. */
export const PROPS = { ProductionPlace: 'Plot', ProducerCountry: 'CI' };

/** A Feature. */
export const feature = (geometry: unknown, properties: Record<string, unknown> | null = PROPS): Record<string, unknown> => ({ type: 'Feature', properties, geometry });

/** A Polygon geometry. */
export const polygon = (...rings: Coord[][]): Record<string, unknown> => ({ type: 'Polygon', coordinates: rings });

/** A Point geometry. */
export const point = (lon: number, lat: number): Record<string, unknown> => ({ type: 'Point', coordinates: [lon, lat] });

/** A closed square ring (counter-clockwise) with six-decimal corners. */
export function square(lon: number, lat: number, size: number): Coord[] {
  const r = (v: number): number => Math.round(v * 1e6) / 1e6;
  return [
    [r(lon), r(lat)],
    [r(lon + size), r(lat)],
    [r(lon + size), r(lat + size)],
    [r(lon), r(lat + size)],
    [r(lon), r(lat)],
  ];
}

/** A valid square plot with six decimals. */
export const A: Coord[] = [
  [0.000001, 0.000001],
  [0.010001, 0.000001],
  [0.010001, 0.010001],
  [0.000001, 0.010001],
  [0.000001, 0.000001],
];

/** Rule ids found for an input. */
export function rules(input: string, options: CheckOptions = {}): RuleId[] {
  return validate(input, options).issues.map((i) => i.rule);
}

/** Rule ids of errors found. */
export function errors(input: string, options: CheckOptions = {}): RuleId[] {
  return validate(input, options).issues.filter((i) => i.severity === 'error').map((i) => i.rule);
}

/** Repairs and returns output, change rules and remaining rules. */
export function repaired(input: string, options: RepairOptions = {}): { output: string; changes: RuleId[]; after: RuleId[] } {
  const r = fix(input, options);
  if (r.output === null || r.after === null) throw new Error('not repaired');
  return { output: r.output, changes: r.changes.map((c) => c.rule), after: r.after.issues.map((i) => i.rule) };
}
