// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// Cuts a ring that crosses the antimeridian into an eastern part (ending at
// +180°) and a western part (starting at −180°), as RFC 7946 section 3.1.9
// recommends. The cut points are computed with exact integer arithmetic and
// truncated toward zero to the six-decimal grid. The caller must check both
// parts; a ring that crosses the meridian more than twice produces invalid
// parts and must be repaired by hand.

import { HALF_TURN } from './ring.js';
import type { XY } from './predicates.js';

const TURN = 2 * HALF_TURN;

/** Integer division truncating toward zero, exact for any size. */
function divTrunc(num: bigint, den: bigint): bigint {
  return num / den; // BigInt division truncates toward zero
}

/** Latitude where segment p–q meets the meridian x = X, truncated to the grid. */
function crossingY(p: XY, q: XY, X: number): number {
  const num = BigInt(X - p.x) * BigInt(q.y - p.y);
  const den = BigInt(q.x - p.x);
  return p.y + Number(divTrunc(num, den));
}

/** Clips an open ring to one side of x = X (Sutherland–Hodgman against one half-plane). */
function clip(ring: readonly XY[], X: number, keepWest: boolean): XY[] {
  const inside = (p: XY): boolean => (keepWest ? p.x <= X : p.x >= X);
  const out: XY[] = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const p = ring[i] as XY;
    const q = ring[(i + 1) % n] as XY;
    const pin = inside(p);
    const qin = inside(q);
    if (pin && qin) out.push(q);
    else if (pin && !qin) out.push({ x: X, y: crossingY(p, q, X) });
    else if (!pin && qin) {
      out.push({ x: X, y: crossingY(p, q, X) });
      out.push(q);
    }
  }
  return out;
}

/**
 * Cuts an unwrapped open ring (longitudes continuous, possibly beyond ±180°)
 * at the antimeridian. Returns the two open rings in normal longitudes, the
 * eastern hemisphere part first.
 */
export function cutAtAntimeridian(unwrapped: readonly XY[]): [XY[], XY[]] {
  let minX = Infinity;
  for (const p of unwrapped) minX = Math.min(minX, p.x);
  // Shift so the ring straddles +180°.
  const shift = minX < -HALF_TURN ? TURN : 0;
  const ring = unwrapped.map((p) => ({ x: p.x + shift, y: p.y }));
  const east = clip(ring, HALF_TURN, true);
  const west = clip(ring, HALF_TURN, false).map((p) => ({ x: p.x - TURN, y: p.y }));
  return [east, west];
}
