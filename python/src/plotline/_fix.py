# Copyright 2026 MB AFKzona Group
# SPDX-License-Identifier: AGPL-3.0-only
"""Safe repairs (mirror of src/core/fix.ts)."""
import json as _json
import re

from . import _geom as G
from ._json import JNum
from ._model import for_each_position, grid_position, pointer
from ._read import js_trim
from ._validate import ISO_3166_ALPHA2, KNOWN_LOWER, KNOWN_PROPERTIES, USER_ASSIGNED_KOSOVO, analyze_polygon, effective_properties, geometry_key, same_attributes, truncated_in_range

_DECIMAL_TEXT = re.compile(r"([0-9]+)(\.[0-9]+)?")


def valid_country_option(code):
    return re.fullmatch(r"[A-Z]{2}", code or "") is not None and (code in ISO_3166_ALPHA2 or code == USER_ASSIGNED_KOSOVO)


def _decimal_to_json_number(text):
    m = _DECIMAL_TEXT.fullmatch(js_trim(text))
    if m is None:
        return None
    return re.sub(r"^0+(?=[0-9])", "", m.group(1)) + (m.group(2) or "")


def _orient_ring(ring, ccw):
    lifted = G.unwrap_ring(ring)
    if lifted is None:
        return ring
    n = len(lifted)
    s = 0
    for i in range(n):
        p = lifted[i]
        q = lifted[(i + 1) % n]
        s += p.x * q.y - q.x * p.y
    return ring if (s > 0) == ccw else list(reversed(ring))


def _drop_collinear(ring):
    lifted = G.unwrap_ring(ring)
    if lifted is None:
        return list(ring)
    n = len(lifted)
    keep = [ring[i] for i in range(n) if G.orient(lifted[(i - 1) % n], lifted[i], lifted[(i + 1) % n]) != 0]
    return keep if len(keep) >= 3 else list(ring)


def fix_plots(plots, read_issues, options=None):
    """Returns (plots, changes)."""
    options = options or {}
    country = options.get("country")
    if country is not None and not valid_country_option(country):
        raise ValueError("country must be an ISO 3166-1 alpha-2 code in upper case")
    changes = []
    work = G.Budget(options.get("checkBudget") or 50_000_000)

    def change(rule, path, feature, message):
        changes.append({"rule": rule, "path": path, "feature": feature, "message": message})

    for f in read_issues:
        if f["fixable"]:
            change(f["rule"], f["path"], f["feature"], f["message"])

    def fix_properties(plot, index):
        ppath = pointer(plot.path, "properties")
        if plot.properties is None and country is None:
            return None
        props = effective_properties(plot.properties)
        if plot.properties is not None:
            for k in plot.properties:
                canonical = KNOWN_LOWER.get(k.lower())
                if canonical is not None and canonical != k and canonical not in plot.properties:
                    change("property-name-case", pointer(ppath, k), index, 'Renamed property "%s" to "%s".' % (k, canonical))
        area = props.get("Area")
        if isinstance(area, str):
            raw = _decimal_to_json_number(area)
            if raw is not None:
                props["Area"] = JNum(raw, float(raw))
                change("area-not-number", pointer(ppath, "Area"), index, "Wrote Area %s as the number %s." % (_json.dumps(area), raw))
        if "ProducerCountry" in props:
            c = props["ProducerCountry"]
            if isinstance(c, str):
                code = js_trim(c).upper()
                if code != c and (code in ISO_3166_ALPHA2 or code == USER_ASSIGNED_KOSOVO):
                    props["ProducerCountry"] = code
                    change("producer-country-format", pointer(ppath, "ProducerCountry"), index, 'Wrote ProducerCountry %s as "%s".' % (_json.dumps(c), code))
        elif country is not None:
            props["ProducerCountry"] = country
            change("producer-country-missing", ppath, index, 'Set ProducerCountry to "%s" (from --country).' % country)
        if options.get("stripUnknownProperties"):
            removed = [k for k in props if k not in KNOWN_PROPERTIES]
            for k in removed:
                del props[k]
            if removed:
                change("unknown-properties", ppath, index, "Removed properties the Information System ignores: %s." % ", ".join(_json.dumps(k) for k in removed))
        return props

    def fix_polygon(rings, path, index):
        if not rings:
            return [[]]
        a = analyze_polygon(rings, work)
        if options.get("cutAntimeridian", True) is not False and a.antimeridian_cut is not None:
            change("antimeridian-crossing", pointer(path, 0), index, "Cut the polygon at the 180 degree meridian into %d polygons." % len(a.antimeridian_cut))
            return [[G.close_ring(_orient_ring([grid_position(p) for p in part], True))] for part in a.antimeridian_cut]
        fixed = []
        for i, r in enumerate(a.rings):
            rpath = pointer(path, i)
            if r.too_few:
                fixed.append(rings[i])
                continue
            ring = list(r.clean)
            if not r.closed:
                change("ring-not-closed", rpath, index, "Closed the ring by repeating its first position at the end.")
            if r.duplicates > 0:
                change("duplicate-vertex", rpath, index, "Removed %d repeated position(s)." % r.duplicates)
            if r.spikes > 0:
                change("spike", rpath, index, "Removed %d spike vertex(es)." % r.spikes)
            if options.get("simplifyCollinear") and not r.collinear:
                simplified = _drop_collinear(ring)
                if len(simplified) < len(ring):
                    change("file-too-large", rpath, index, "Removed %d position(s) lying exactly on a straight side." % (len(ring) - len(simplified)))
                    ring = simplified
            if not r.collinear and r.orientation != 0 and (r.orientation < 0 if i == 0 else r.orientation > 0):
                ring = list(reversed(ring))
                change("winding-order", rpath, index, "Reversed the ring (RFC 7946 right-hand rule).")
            fixed.append(G.close_ring(ring))
        return [fixed]

    def fix_geometry(g, path, index, in_collection):
        t = g["type"]
        if t == "Point":
            return g
        if t == "MultiPoint":
            if len(g["positions"]) == 1:
                change("single-part-multi", path, index, "Wrote the one-position MultiPoint as a Point.")
                return {"type": "Point", "position": g["positions"][0]}
            return g
        if t == "Polygon":
            parts = fix_polygon(g["rings"], pointer(path, "coordinates"), index)
            if len(parts) == 1:
                return {"type": "Polygon", "rings": parts[0]}
            return {"type": "MultiPolygon", "polygons": parts}
        if t == "MultiPolygon":
            polygons = []
            for i, rings in enumerate(g["polygons"]):
                polygons.extend(fix_polygon(rings, pointer(path, "coordinates", i), index))
            if len(polygons) == 1 and len(g["polygons"]) == 1:
                change("single-part-multi", path, index, "Wrote the one-polygon MultiPolygon as a Polygon.")
                return {"type": "Polygon", "rings": polygons[0]}
            return {"type": "MultiPolygon", "polygons": polygons}
        parts = []
        for i, part in enumerate(g["geometries"]):
            fixed = fix_geometry(part, pointer(path, "geometries", i), index, True)
            if fixed["type"] == "GeometryCollection":
                change("nested-geometry-collection", pointer(path, "geometries", i), index, "Moved the geometries of the nested GeometryCollection into its parent.")
                parts.extend(fixed["geometries"])
            else:
                parts.append(fixed)
        if len(parts) == 1 and not in_collection:
            change("single-part-multi", path, index, "Wrote the one-geometry GeometryCollection as that geometry.")
            return parts[0]
        return {"type": "GeometryCollection", "geometries": parts}

    truncated = 0
    into_range = 0
    altitude = 0
    out = []
    for index, plot in enumerate(plots):
        if plot.raw_feature is not None:
            out.append(plot)
            continue
        properties = fix_properties(plot, index)
        geometry = plot.geometry
        if geometry is not None:
            seen = {"t": False, "a": False, "r": False, "out": False}

            def visit(p, _path):
                if p.truncated:
                    seen["t"] = True
                if p.extra > 0:
                    seen["a"] = True
                if abs(p.lon) > 180 or abs(p.lat) > 90:
                    if truncated_in_range(p):
                        seen["r"] = True
                    else:
                        seen["out"] = True

            for_each_position(geometry, "", visit)
            truncated += 1 if seen["t"] else 0
            into_range += 1 if seen["r"] and not seen["out"] else 0
            altitude += 1 if seen["a"] else 0
            geometry = fix_geometry(geometry, plot.geometry_path, index, False)
        out.append(plot.replace(properties=properties, geometry=geometry))
    if truncated:
        change("excess-precision", "", None, "Truncated coordinates of %d plot(s) to six decimal places." % truncated)
    if into_range:
        change("coordinate-out-of-range", "", None, "Truncation to six decimals brought coordinates of %d plot(s) within -180..180 and -90..90." % into_range)
    if altitude:
        change("altitude-present", "", None, "Dropped values after longitude and latitude in %d plot(s)." % altitude)
    if options.get("removeDuplicates", True) is False:
        return out, _unique(changes)
    kept = []
    seen_keys = {}
    for index, plot in enumerate(out):
        key = None
        if plot.geometry is not None:
            g = plot.geometry
            analyses = [analyze_polygon(g["rings"], work)] if g["type"] == "Polygon" else [analyze_polygon(rs, work) for rs in g["polygons"]] if g["type"] == "MultiPolygon" else []
            key = geometry_key(g, analyses)
        if key is not None:
            earlier = seen_keys.setdefault(key, [])
            if any(same_attributes(e, plot) for e in earlier):
                change("duplicate-plot", plot.path, index, "Removed this plot: an earlier plot has the same geometry and properties.")
                continue
            earlier.append(plot)
        kept.append(plot)
    return kept, _unique(changes)


def _unique(changes):
    seen = set()
    out = []
    for c in changes:
        key = (c["rule"], c["feature"], c["path"])
        if key in seen:
            continue
        seen.add(key)
        out.append(c)
    return out
