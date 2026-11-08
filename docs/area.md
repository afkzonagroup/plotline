# Plot area

Plotline computes the area of polygon plots on the WGS 84 ellipsoid. The
Regulation does not prescribe a method; the area matters because a plot of
"more than four hectares" needs a polygon (Article 2, point (28)) and because
point plots carry an `Area` in hectares.

## Method

1. Coordinates are first truncated to six decimals, as the Information System
   stores them.
2. Each latitude is mapped to its **authalic latitude**. This maps the WGS 84
   ellipsoid (a = 6,378,137 m, f = 1/298.257223563) onto a sphere of the same
   total area (radius Rq = 6,371,007.181 m) and preserves area exactly
   (Snyder, *Map Projections: A Working Manual*, USGS Professional Paper
   1395, 1987, equations 3-11 to 3-12).
3. On that sphere, the polygon's sides are great-circle arcs and its area is
   the sum of the signed spherical excesses of the triangles formed by each
   side and the south pole (the half-angle tangent formula), times Rq².
4. Holes are subtracted. The smaller of the two regions a ring bounds is
   taken, so winding order does not change the result.

The TypeScript and Python implementations use the same formula; their
results agree to 1e-9 relative in the shared test vectors. They run on
different platform math libraries, whose last-digit differences the sum
amplifies for very small polygons: for plots of a square metre or more,
away from the poles, the two agree to about 1e-7 relative or better, and
for polygons smaller than a square metre near a pole they can differ by
1e-4 relative (a few square millimetres).

## Accuracy

`test-vectors/areas.json` holds reference areas from GeographicLib 2.1
(C. F. F. Karney, "Algorithms for geodesics", *Journal of Geodesy* 87,
43–55, 2013), which computes the exact area of a polygon whose sides are
geodesics on the ellipsoid. The tests require agreement to 1e-6 relative for
polygons up to 1° × 1° and 1e-5 for a 10° × 10° polygon. Measured
differences are at most 1.7e-7 relative up to 1° × 1° (most cases below
1e-9) and 7.2e-6 for the 10° × 10° polygon: far below the effect of
six-decimal coordinates (about 0.1 m).

| Case | GeographicLib area (m²) |
|---|---|
| 1 m square at the equator | 1.230907 |
| 0.001 degree square at the equator | 12,309.072079 |
| 0.001 degree square at 45 N | 8,762.313488 |
| 0.001 degree square at 60 S | 6,216.899150 |
| 0.001 degree square at 80 S | 2,165.582523 |
| 0.02 degree square (about 4.9 km2) at 6 N | 4,897,285.572717 |
| 1 degree square at the equator | 12,308,778,361.469452 |
| 10 degree square at 30 N | 1,011,502,898,135.279297 |
| L-shaped concave plot | 853,399.583032 |
| thin strip 1 km by 10 m | 9,969.978863 |
| near the north pole | 40,826.106598 |
| across the antimeridian (unwrapped longitudes) | 2,346,965.493765 |
| clockwise ring | 1,230,860.678508 |
| Commission example: FAZENDA TABOAO II | 23,801.359299 |
| Commission example: Cocoa Farm 01 | 206,871,426.676912 |

## What the Information System does

The Commission's documentation does not say how the Information System
computes areas. Its own example files declare `Area` values about 0.5 %
larger than the geodesic area of the example polygons (for example 23.72 ha
declared for a polygon of 23.61 ha). Plotline therefore reports a mismatch
between a declared `Area` and the computed area only above 5 % and 0.01 ha,
and as a note, never as an error.

## Straight lines and great circles

RFC 7946 (section 3.1.1) defines the line between two positions as straight
in longitude and latitude. For plot-sized polygons the difference from a
great-circle side is negligible. For sides hundreds of kilometres long it is
not; such polygons are not plots of land in the sense of the Regulation.
