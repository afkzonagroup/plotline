// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// Geometry analysis shared by the validator and the fixer: what is wrong
// with each ring, what the cleaned ring looks like, and the plot's area.

import { cutAtAntimeridian } from './geometry/antimeridian.js';
import { polygonHectares } from './geometry/area.js';
import type { XY } from './geometry/predicates.js';
import { crossesAntimeridian, dedupeCyclic, findSelfIntersection, isClosed, isCollinear, openRing, removeSpikes, ringOrientation, unwrapRing, type Budget, type SelfIntersection } from './geometry/ring.js';
import type { Position, Ring } from './model.js';

/** Findings for one ring. */
export interface RingAnalysis {
  /** Positions as written. */
  readonly written: number;
  readonly closed: boolean;
  /** Consecutive repeats removed (closing repeat not counted). */
  readonly duplicates: number;
  /** True when some repeat exists only because of truncation to six decimals. */
  readonly duplicatesFromTruncation: boolean;
  /** Vertices removed as spike tips. */
  readonly spikes: number;
  /** Open ring of source positions after closing, removing repeats and removing spikes. */
  readonly clean: readonly Position[];
  /** True when fewer than three distinct positions remain. */
  readonly tooFew: boolean;
  readonly collinear: boolean;
  readonly antimeridian: boolean;
  /** `clean` with longitudes unwrapped across the antimeridian (unchanged when it does not cross), or null when that is impossible. */
  readonly unwrapped: readonly XY[] | null;
  /** 1 counter-clockwise, −1 clockwise, 0 degenerate. */
  readonly orientation: -1 | 0 | 1;
  readonly selfIntersection: SelfIntersection | null;
  /** False when the self-intersection check ran out of budget. */
  readonly checked: boolean;
}

/** True when a ring is usable as a polygon boundary. */
export const ringValid = (r: RingAnalysis): boolean => !r.tooFew && !r.collinear && r.unwrapped !== null && r.selfIntersection === null && r.checked;

/** Analyses one ring. */
export function analyzeRing(ring: Ring, work: Budget): RingAnalysis {
  const closed = isClosed(ring);
  const open = openRing(ring);
  const deduped = dedupeCyclic(open);
  // Repeats in the source values themselves (before truncation).
  let rawRepeats = 0;
  for (let i = 0; i < open.length; i++) {
    const a = open[i] as Position;
    const b = open[(i + 1) % open.length] as Position;
    if (open.length > 1 && a.lon === b.lon && a.lat === b.lat) rawRepeats++;
  }
  const antimeridian = deduped.ring.length >= 3 && crossesAntimeridian(deduped.ring);
  const lifted = unwrapRing(deduped.ring);
  // Collinearity, spikes and orientation are judged on unwrapped longitudes.
  // A ring on one line is reported as such (every such ring would also look
  // like spikes); a ring that winds around a pole is not judged further.
  const collinear = lifted !== null && lifted.length >= 3 && isCollinear(lifted);
  const spikeFree = lifted === null || collinear ? null : removeSpikes(lifted);
  const clean = spikeFree === null ? deduped.ring : spikeFree.ring.map((u) => u.src);
  const spikes = deduped.ring.length - clean.length;
  const unwrapped = lifted === null ? null : spikeFree === null ? lifted : spikeFree.ring;
  const tooFew = clean.length < 3;
  const orientation = tooFew || collinear || unwrapped === null ? 0 : ringOrientation(unwrapped);
  let selfIntersection: SelfIntersection | null = null;
  let checked = true;
  if (!tooFew && !collinear && unwrapped !== null) {
    selfIntersection = findSelfIntersection(unwrapped, work);
    checked = selfIntersection !== null || !work.exhausted;
  }
  return {
    written: ring.length,
    closed,
    duplicates: deduped.removed,
    duplicatesFromTruncation: deduped.removed > rawRepeats,
    spikes,
    clean,
    tooFew,
    collinear,
    antimeridian,
    unwrapped,
    orientation,
    selfIntersection,
    checked,
  };
}

/** Findings for one polygon. */
export interface PolygonAnalysis {
  readonly rings: readonly RingAnalysis[];
  /** True when every ring is usable. */
  readonly valid: boolean;
  /** Geodesic area in hectares (exterior minus holes), or null when the polygon is not valid. */
  readonly hectares: number | null;
  /** The parts after cutting at the antimeridian, when the exterior crosses it and both parts are valid; otherwise null. */
  readonly antimeridianCut: readonly (readonly XY[])[] | null;
}

/** Analyses a polygon. */
export function analyzePolygon(rings: readonly Ring[], work: Budget): PolygonAnalysis {
  const analyses = rings.map((r) => analyzeRing(r, work));
  const valid = analyses.length > 0 && analyses.every(ringValid);
  const hectares = valid ? polygonHectares(analyses.map((a) => a.unwrapped as readonly XY[])) : null;
  let antimeridianCut: XY[][] | null = null;
  const outer = analyses[0];
  if (valid && outer?.antimeridian === true && analyses.length === 1 && outer.unwrapped !== null) {
    const parts = cutAtAntimeridian(outer.unwrapped).map((p) => removeSpikes(p).ring);
    const ok = parts.every((p) => {
      if (p.length < 3 || isCollinear(p) || crossesAntimeridian(p)) return false;
      return findSelfIntersection(p, work) === null && !work.exhausted;
    });
    antimeridianCut = ok ? parts : null;
  }
  return { rings: analyses, valid, hectares, antimeridianCut };
}
