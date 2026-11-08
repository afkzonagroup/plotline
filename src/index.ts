// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Plotline: geolocation tooling for the EU Deforestation Regulation
 * (Regulation (EU) 2023/1115). Validates, repairs, measures, splits and
 * converts plot geolocation files for the EUDR Information System, offline.
 *
 * @packageDocumentation
 */

export { VERSION, ATTRIBUTION, ATTRIBUTION_URL, GENERATOR } from './version.js';
export {
  validate,
  fix,
  split,
  convert,
  toDdsProducers,
  readPlots,
  outputBytes,
  base64Utf8,
  type CheckOptions,
  type RepairOptions,
  type SplitOptions,
  type ConvertOptions,
  type Report,
  type Summary,
  type FixOutput,
  type SplitOutput,
  type ConvertOutput,
  type Part,
  type DdsProducer,
} from './core/api.js';
export { RULES, rule, type Rule, type RuleId, type RuleStatus, type Severity } from './core/rules.js';
export type { Source } from './core/sources.js';
export { COMMODITIES, KNOWN_PROPERTIES, MIN_POINT_HECTARES, POINT_MAX_HECTARES, validatePlots, type Commodity, type Variant, type ValidateOptions, type PlotInfo, type Validation } from './core/validate.js';
export { fixPlots, type FixOptions, type FixResult } from './core/fix.js';
export { splitPlots, type SplitLimits, type SplitPart, type SplitResult } from './core/split.js';
export { writeFeatureCollection, writeFeature, writeGeometry } from './core/write.js';
export { readInput, detectFormat, type InputFormat, type ReadOptions, type ReadFile } from './core/input.js';
export { DEFAULT_LIMITS, HARD_LIMITS, SYSTEM_LIMITS, resolveLimits, type Limits } from './core/limits.js';
export { parseJson, type JsonValue, type JsonResult } from './core/json.js';
export { parseCoordinate, formatMicro, MICRO, type Coordinate } from './core/coords.js';
export { polygonHectares, ringAreaSquareMetres, AUTHALIC_RADIUS } from './core/geometry/area.js';
export type { Plot, Position, Geometry, Ring, Issue, Change } from './core/model.js';
