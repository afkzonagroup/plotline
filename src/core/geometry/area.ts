// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// Area of plots on the WGS 84 ellipsoid.
//
// Method: each vertex's geodetic latitude is mapped to its authalic
// latitude, which maps the ellipsoid onto a sphere of equal surface area
// (the authalic sphere, radius Rq ≈ 6,371,007.2 m) while preserving area.
// The polygon area on that sphere, with great-circle edges, is the sum of
// the signed spherical excesses of the triangles formed by each edge and the
// south pole (the half-angle tangent formula). Plotline's test vectors
// compare this with GeographicLib's exact ellipsoidal geodesic polygon area
// (C. F. F. Karney); see test-vectors/areas.json for the agreement.

import { MICRO } from '../coords.js';
import type { XY } from './predicates.js';

/** WGS 84 semi-major axis in metres. */
export const WGS84_A = 6_378_137;
/** WGS 84 flattening. */
export const WGS84_F = 1 / 298.257223563;

const E2 = WGS84_F * (2 - WGS84_F);
const E = Math.sqrt(E2);

/** q(φ) of the authalic latitude formulas (Snyder, Map Projections: A Working Manual, eq. 3-12). */
function q(sinPhi: number): number {
  const es = E * sinPhi;
  return (1 - E2) * (sinPhi / (1 - E2 * sinPhi * sinPhi) - (1 / (2 * E)) * Math.log((1 - es) / (1 + es)));
}

const QP = q(1);

/** Radius of the sphere with the same surface area as the WGS 84 ellipsoid, in metres. */
export const AUTHALIC_RADIUS = WGS84_A * Math.sqrt(QP / 2);

/** Authalic latitude (radians) of a geodetic latitude (radians). */
export function authalicLatitude(phi: number): number {
  const ratio = q(Math.sin(phi)) / QP;
  return Math.asin(Math.max(-1, Math.min(1, ratio)));
}

const RAD = Math.PI / 180;

/**
 * Unsigned area in square metres enclosed by an open ring of integer
 * micro-degree coordinates, on the WGS 84 ellipsoid. Longitudes may be
 * unwrapped beyond ±180°. The smaller of the two regions bounded by the ring
 * is returned, so winding order does not matter.
 */
export function ringAreaSquareMetres(open: readonly XY[]): number {
  const n = open.length;
  if (n < 3) return 0;
  let sum = 0;
  const last = open[n - 1] as XY;
  let lambda0 = (last.x / MICRO) * RAD;
  const phiLast = authalicLatitude((last.y / MICRO) * RAD) / 2 + Math.PI / 4;
  let cos0 = Math.cos(phiLast);
  let sin0 = Math.sin(phiLast);
  for (let i = 0; i < n; i++) {
    const p = open[i] as XY;
    const lambda = (p.x / MICRO) * RAD;
    const phi = authalicLatitude((p.y / MICRO) * RAD) / 2 + Math.PI / 4;
    let dLambda = lambda - lambda0;
    if (dLambda > Math.PI) dLambda -= 2 * Math.PI;
    else if (dLambda < -Math.PI) dLambda += 2 * Math.PI;
    const sd = dLambda >= 0 ? 1 : -1;
    const ad = sd * dLambda;
    const cos1 = Math.cos(phi);
    const sin1 = Math.sin(phi);
    const k = sin0 * sin1;
    const u = cos0 * cos1 + k * Math.cos(ad);
    const v = k * sd * Math.sin(ad);
    sum += Math.atan2(v, u);
    lambda0 = lambda;
    cos0 = cos1;
    sin0 = sin1;
  }
  const excess = Math.abs(2 * sum);
  const steradians = Math.min(excess, 4 * Math.PI - excess);
  return steradians * AUTHALIC_RADIUS * AUTHALIC_RADIUS;
}

/** Square metres per hectare. */
export const SQUARE_METRES_PER_HECTARE = 10_000;

/** Area in hectares of a polygon given as an exterior ring and holes (all open rings). */
export function polygonHectares(rings: readonly (readonly XY[])[]): number {
  let total = 0;
  rings.forEach((ring, i) => {
    const a = ringAreaSquareMetres(ring);
    total += i === 0 ? a : -a;
  });
  return Math.max(0, total) / SQUARE_METRES_PER_HECTARE;
}
