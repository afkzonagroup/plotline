# Copyright 2026 MB AFKzona Group
# SPDX-License-Identifier: AGPL-3.0-only
"""Analysis and validation (mirror of src/core/analyze.ts and validate.ts)."""
import json as _json
import re

from . import _geom as G
from ._json import JNum, stringify_json
from ._model import Findings, for_each_position, pointer
from ._read import js_trim

ISO_3166_ALPHA2 = frozenset("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split())
USER_ASSIGNED_KOSOVO = "XK"
COMMODITIES = ("cattle", "cocoa", "coffee", "oil palm", "rubber", "soya", "wood")
KNOWN_PROPERTIES = ("ProducerName", "ProducerCountry", "ProductionPlace", "Area")
KNOWN_LOWER = {k.lower(): k for k in KNOWN_PROPERTIES}
MIN_POINT_HECTARES = 0.0001
POINT_MAX_HECTARES = 4
_DECIMAL_TEXT = re.compile(r"[0-9]+(?:\.[0-9]+)?")


class RingAnalysis:
    __slots__ = ("written", "closed", "duplicates", "duplicates_from_truncation", "spikes", "clean", "too_few", "collinear", "antimeridian", "unwrapped", "orientation", "self_intersection", "checked")


def ring_valid(r):
    return not r.too_few and not r.collinear and r.unwrapped is not None and r.self_intersection is None and r.checked


def analyze_ring(ring, work):
    r = RingAnalysis()
    r.written = len(ring)
    r.closed = G.is_closed(ring)
    open_ = G.open_ring(ring)
    deduped, removed = G.dedupe_cyclic(open_)
    raw_repeats = 0
    for i in range(len(open_)):
        a = open_[i]
        b = open_[(i + 1) % len(open_)]
        if len(open_) > 1 and a.lon == b.lon and a.lat == b.lat:
            raw_repeats += 1
    r.antimeridian = len(deduped) >= 3 and G.crosses_antimeridian(deduped)
    lifted = G.unwrap_ring(deduped)
    r.collinear = lifted is not None and len(lifted) >= 3 and G.is_collinear(lifted)
    spike_free = None if lifted is None or r.collinear else G.remove_spikes(lifted)[0]
    r.clean = deduped if spike_free is None else [u.src for u in spike_free]
    r.spikes = len(deduped) - len(r.clean)
    r.unwrapped = None if lifted is None else lifted if spike_free is None else spike_free
    r.too_few = len(r.clean) < 3
    r.orientation = 0 if (r.too_few or r.collinear or r.unwrapped is None) else G.ring_orientation(r.unwrapped)
    r.self_intersection = None
    r.checked = True
    if not r.too_few and not r.collinear and r.unwrapped is not None:
        r.self_intersection = G.find_self_intersection(r.unwrapped, work)
        r.checked = r.self_intersection is not None or not work.exhausted
    r.duplicates = removed
    r.duplicates_from_truncation = removed > raw_repeats
    return r


class PolygonAnalysis:
    __slots__ = ("rings", "valid", "hectares", "antimeridian_cut")


def analyze_polygon(rings, work):
    a = PolygonAnalysis()
    a.rings = [analyze_ring(r, work) for r in rings]
    a.valid = len(a.rings) > 0 and all(ring_valid(r) for r in a.rings)
    a.hectares = G.polygon_hectares([r.unwrapped for r in a.rings]) if a.valid else None
    a.antimeridian_cut = None
    outer = a.rings[0] if a.rings else None
    if a.valid and outer is not None and outer.antimeridian and len(a.rings) == 1 and outer.unwrapped is not None:
        parts = [G.remove_spikes(p)[0] for p in G.cut_at_antimeridian(outer.unwrapped)]
        ok = True
        for p in parts:
            if len(p) < 3 or G.is_collinear(p) or G.crosses_antimeridian(p):
                ok = False
                break
            if G.find_self_intersection(p, work) is not None or work.exhausted:
                ok = False
                break
        a.antimeridian_cut = parts if ok else None
    return a


def effective_properties(props):
    out = {}
    if props is None:
        return out
    for k, v in props.items():
        canonical = KNOWN_LOWER.get(k.lower())
        if canonical is not None and canonical != k and canonical not in props:
            out[canonical] = v
        else:
            out[k] = v
    return out


def producer_key(props):
    p = effective_properties(props)
    name = p.get("ProducerName", _MISSING)
    country = p.get("ProducerCountry", _MISSING)
    c = stringify_json(js_trim(country).upper()) if isinstance(country, str) else "" if country is _MISSING else stringify_json(country)
    return ("" if name is _MISSING else stringify_json(name)) + "\0" + c


_MISSING = object()


def _ring_key(ring):
    n = len(ring)
    start = 0
    for i in range(1, n):
        p = ring[i]
        s = ring[start]
        if p.x < s.x or (p.x == s.x and p.y < s.y):
            start = i
    fwd = " ".join("%d,%d" % (ring[(start + i) % n].x, ring[(start + i) % n].y) for i in range(n))
    back = " ".join("%d,%d" % (ring[(start - i) % n].x, ring[(start - i) % n].y) for i in range(n))
    return fwd if fwd < back else back


def geometry_key(g, analyses):
    t = g["type"]
    if t == "Point":
        return "P %d,%d" % (g["position"].x, g["position"].y)
    if t == "MultiPoint":
        return "M " + " ".join(sorted("%d,%d" % (p.x, p.y) for p in g["positions"]))
    if t in ("Polygon", "MultiPolygon"):
        if not analyses or not all(a.valid for a in analyses):
            return None
        polys = sorted(" | ".join(_ring_key(r.clean) for r in a.rings) for a in analyses)
        return "A " + " || ".join(polys)
    return None


def same_attributes(a, b):
    def text(p):
        return ("" if p.id is None else stringify_json(p.id)) + "|" + ("null" if p.properties is None else stringify_json(p.properties))

    return text(a) == text(b)


def _kind(v):
    if isinstance(v, JNum):
        return "number"
    if isinstance(v, str):
        return "string"
    if isinstance(v, bool):
        return "boolean"
    if v is None:
        return "null"
    return "array" if isinstance(v, list) else "object"


def truncated_in_range(p):
    """True when a position is within 180, 90 degrees after truncation to six decimals."""
    return abs(p.x) <= 180_000_000 and abs(p.y) <= 90_000_000


def _list_some(items, n=10):
    head = ", ".join(str(i) for i in items[:n])
    return head + (" and %d more" % (len(items) - n) if len(items) > n else "")


def validate_plots(plots, nbytes, options=None, findings=None):
    """Returns (findings, plot_infos)."""
    options = options or {}
    findings = findings or Findings()
    variant = options.get("variant") or "type-i"
    max_bytes = options.get("maxBytes") or 25_000_000
    max_producers = options.get("maxProducers") or 1000
    commodity = options.get("commodity")
    work = G.Budget(options.get("checkBudget") or 50_000_000)
    infos = []
    agg = {"altitude": [], "excess": [], "winding": [], "low": [], "area_missing": [], "place_missing": []}
    unknown = {}
    overlap_entries = []
    keys = {}
    producers = set()

    def check_shape(geom, path, index, in_collection):
        t = geom["type"]
        if t == "MultiPoint":
            if not geom["positions"]:
                findings.add("geometry-empty", pointer(path, "coordinates"), index, "This MultiPoint has no positions.")
            elif len(geom["positions"]) == 1:
                findings.add("single-part-multi", path, index, "This MultiPoint has one position; it will be written as a Point.")
        elif t == "Polygon":
            if not geom["rings"]:
                findings.add("geometry-empty", pointer(path, "coordinates"), index, "This Polygon has no rings.")
        elif t == "MultiPolygon":
            if not geom["polygons"]:
                findings.add("geometry-empty", pointer(path, "coordinates"), index, "This MultiPolygon has no polygons.")
            elif len(geom["polygons"]) == 1:
                findings.add("single-part-multi", path, index, "This MultiPolygon has one polygon; it will be written as a Polygon.")
            for i, rings in enumerate(geom["polygons"]):
                if not rings:
                    findings.add("geometry-empty", pointer(path, "coordinates", i), index, "This polygon of the MultiPolygon has no rings.")
        elif t == "GeometryCollection":
            if not geom["geometries"]:
                findings.add("geometry-empty", pointer(path, "geometries"), index, "This GeometryCollection is empty.")
            elif len(geom["geometries"]) == 1 and not in_collection:
                findings.add("single-part-multi", path, index, "This GeometryCollection has one geometry; it will be written as that geometry.")
            for i, part in enumerate(geom["geometries"]):
                check_shape(part, pointer(path, "geometries", i), index, True)

    def report_polygon(a, path, index):
        if len(a.rings) > 1:
            findings.add("polygon-has-holes", path, index, "This polygon has %d hole(s). The Information System does not accept holes." % (len(a.rings) - 1))
        for i, r in enumerate(a.rings):
            rpath = pointer(path, i)
            if not r.closed:
                findings.add("ring-not-closed", rpath, index, "The ring is open: its last position differs from the first.", fixable=not r.too_few)
            if r.duplicates > 0:
                findings.add("duplicate-vertex", rpath, index, "The ring repeats a position %d time(s) in a row%s." % (r.duplicates, ", some only after truncation to six decimals" if r.duplicates_from_truncation else ""), fixable=not r.too_few)
            if r.spikes > 0 and not r.too_few:
                findings.add("spike", rpath, index, "The ring doubles back on itself at %d vertex(es)." % r.spikes)
            if r.too_few:
                findings.add("ring-too-few-positions", rpath, index, "The ring has only %d distinct position(s)." % len(r.clean))
            elif r.collinear:
                findings.add("zero-area-ring", rpath, index, "All positions of the ring lie on one straight line, so it encloses no area.")
            if r.unwrapped is None:
                findings.add("antimeridian-crossing", rpath, index, "The ring crosses the 180 degree meridian an odd number of times, so it winds around a pole.", severity="error", fixable=False)
            elif r.antimeridian:
                fixable = i == 0 and a.antimeridian_cut is not None
                findings.add("antimeridian-crossing", rpath, index, "The ring crosses the 180 degree meridian.", fixable=fixable)
            if r.self_intersection is not None:
                findings.add("self-intersection", rpath, index, "The ring crosses or touches itself (%s)." % r.self_intersection[2])
            if not r.too_few and not r.collinear and r.orientation != 0 and (r.orientation < 0 if i == 0 else r.orientation > 0):
                agg["winding"].append(index)

    def check_parts(parts, path, index):
        outers = []
        for i, p in enumerate(parts):
            o = p.rings[0] if p.rings else None
            if p.valid and o is not None and o.unwrapped is not None and not o.antimeridian:
                outers.append((i, o.unwrapped))
        for x in range(len(outers)):
            for y in range(x + 1, len(outers)):
                rel = G.polygon_relation(outers[x][1], outers[y][1], work)
                if rel in ("overlap", "shared-edge"):
                    findings.add("multipolygon-parts-intersect", pointer(path, outers[y][0]), index, "Polygons %d and %d of this MultiPolygon %s." % (outers[x][0], outers[y][0], "overlap" if rel == "overlap" else "share part of a side"))

    def polygon_analyses(geom, path, index):
        out = []

        def walk(g, gpath):
            if g["type"] == "Polygon":
                if g["rings"]:
                    a = analyze_polygon(g["rings"], work)
                    out.append(a)
                    report_polygon(a, pointer(gpath, "coordinates"), index)
            elif g["type"] == "MultiPolygon":
                parts = []
                for i, rings in enumerate(g["polygons"]):
                    if not rings:
                        continue
                    a = analyze_polygon(rings, work)
                    parts.append(a)
                    out.append(a)
                    report_polygon(a, pointer(gpath, "coordinates", i), index)
                check_parts(parts, pointer(gpath, "coordinates"), index)
            elif g["type"] == "GeometryCollection":
                for i, part in enumerate(g["geometries"]):
                    walk(part, pointer(gpath, "geometries", i))

        walk(geom, path)
        return out

    def check_properties(plot, index, props, g):
        if plot.raw_feature is not None:
            return
        ppath = pointer(plot.path, "properties")
        if plot.properties is not None:
            for k in plot.properties:
                canonical = KNOWN_LOWER.get(k.lower())
                if canonical is not None and canonical != k:
                    both = canonical in plot.properties
                    findings.add("property-name-case", pointer(ppath, k), index, 'Property "%s" must be written exactly "%s".' % (k, canonical), fixable=not both)
        if "ProducerCountry" not in props:
            if variant == "type-ii":
                findings.add("producer-country-missing", ppath, index, 'A Type II file needs "ProducerCountry" on every feature.')
        else:
            country = props["ProducerCountry"]
            if not isinstance(country, str):
                findings.add("producer-country-invalid", pointer(ppath, "ProducerCountry"), index, "ProducerCountry must be a two-letter text code.")
            else:
                code = js_trim(country).upper()
                if code not in ISO_3166_ALPHA2 and code != USER_ASSIGNED_KOSOVO:
                    findings.add("producer-country-invalid", pointer(ppath, "ProducerCountry"), index, "%s is not an ISO 3166-1 alpha-2 country code." % _json.dumps(country))
                else:
                    if code != country:
                        findings.add("producer-country-format", pointer(ppath, "ProducerCountry"), index, 'ProducerCountry %s will be written as "%s".' % (_json.dumps(country), code))
                    if code == USER_ASSIGNED_KOSOVO:
                        findings.add("producer-country-user-assigned", pointer(ppath, "ProducerCountry"), index, '"XK" is a user-assigned code.')
        if "ProducerName" in props:
            name = props["ProducerName"]
            if not isinstance(name, str):
                findings.add("property-type", pointer(ppath, "ProducerName"), index, "ProducerName should be text; found %s." % _kind(name))
            elif len(name) > 500:
                findings.add("producer-name-too-long", pointer(ppath, "ProducerName"), index, "ProducerName has %d characters; the API accepts at most 500." % len(name))
        if "ProductionPlace" in props and not isinstance(props["ProductionPlace"], str):
            findings.add("property-type", pointer(ppath, "ProductionPlace"), index, "ProductionPlace should be text; found %s." % _kind(props["ProductionPlace"]))
        if "Area" in props:
            area = props["Area"]
            apath = pointer(ppath, "Area")
            if isinstance(area, str):
                fixable = _DECIMAL_TEXT.fullmatch(js_trim(area)) is not None
                findings.add("area-not-number", apath, index, "Area is the text %s. The Information System reads text as area 0." % _json.dumps(area), fixable=fixable)
            elif not isinstance(area, JNum):
                findings.add("area-not-number", apath, index, "Area must be a number of hectares; found %s." % _kind(area), fixable=False)
            elif g is not None and g["type"] == "Point":
                if area.value < MIN_POINT_HECTARES:
                    findings.add("point-area-below-minimum", apath, index, "Area is %s ha; for a point it must be at least 0.0001 ha." % area.raw)
                elif area.value > POINT_MAX_HECTARES and commodity != "cattle":
                    findings.add("point-area-above-4ha", apath, index, "This point stands for a plot of %s ha. Plots of more than 4 ha need a polygon." % area.raw)
            elif g is not None and g["type"] == "MultiPoint" and area.value < MIN_POINT_HECTARES:
                findings.add("point-area-below-minimum", apath, index, "Area is %s ha; it must be at least 0.0001 ha." % area.raw)

    for index, plot in enumerate(plots):
        if plot.raw_feature is None:
            producers.add(producer_key(plot.properties))
        g = plot.geometry
        props = effective_properties(plot.properties)
        analyses = []
        positions = 0
        range_ok = True
        geometry_valid = g is not None
        hectares = None
        area_source = None
        bbox = None
        if g is not None:
            gpath = plot.geometry_path
            scan = {"count": 0, "max_dec": 0, "trunc": False, "alt": False, "bad": 0, "bad_after_truncation": 0, "first": None, "w": None, "s": None, "e": None, "n": None}

            def visit(p, path):
                scan["count"] += 1
                scan["max_dec"] = max(scan["max_dec"], p.decimals)
                if p.truncated:
                    scan["trunc"] = True
                if p.extra > 0:
                    scan["alt"] = True
                if p.lon < -180 or p.lon > 180 or p.lat < -90 or p.lat > 90:
                    scan["bad"] += 1
                    if scan["first"] is None:
                        scan["first"] = (p, path)
                    if not truncated_in_range(p):
                        scan["bad_after_truncation"] += 1
                scan["w"] = p.x if scan["w"] is None else min(scan["w"], p.x)
                scan["e"] = p.x if scan["e"] is None else max(scan["e"], p.x)
                scan["s"] = p.y if scan["s"] is None else min(scan["s"], p.y)
                scan["n"] = p.y if scan["n"] is None else max(scan["n"], p.y)

            for_each_position(g, gpath, visit)
            positions = scan["count"]
            if positions > 0:
                bbox = [scan["w"] / 1e6, scan["s"] / 1e6, scan["e"] / 1e6, scan["n"] / 1e6]
            if scan["first"] is not None:
                p, path = scan["first"]
                range_ok = False
                geometry_valid = False
                # A value such as 180.0000001 is in range once truncated to six decimals, as the system stores it.
                by_truncation = scan["bad_after_truncation"] == 0
                findings.add(
                    "coordinate-out-of-range",
                    path,
                    index,
                    "Longitude must be within -180..180 and latitude within -90..90; found [%r, %r].%s" % (p.lon, p.lat, " Truncated to six decimals, as the Information System stores coordinates, the values are within range; fix writes them truncated." if by_truncation else ""),
                    fixable=by_truncation,
                )
            if scan["alt"]:
                agg["altitude"].append(index)
            if scan["trunc"]:
                agg["excess"].append(index)
            if positions > 0 and scan["max_dec"] < 6:
                agg["low"].append(index)
            check_shape(g, gpath, index, False)
            if range_ok:
                analyses = polygon_analyses(g, gpath, index)
            if any(not a.valid for a in analyses):
                geometry_valid = False
            if g["type"] in ("Polygon", "MultiPolygon"):
                if analyses and all(a.hectares is not None for a in analyses):
                    hectares = 0.0
                    for a in analyses:
                        hectares += a.hectares
                    area_source = "computed"
                    if hectares < MIN_POINT_HECTARES:
                        findings.add("polygon-area-tiny", gpath, index, "This polygon measures %.6f ha, less than 0.0001 ha." % hectares)
                    declared = props.get("Area")
                    if isinstance(declared, JNum) and hectares > 0:
                        diff = abs(declared.value - hectares)
                        if diff > 0.01 and diff > 0.05 * hectares:
                            findings.add("area-mismatch", pointer(plot.path, "properties", "Area"), index, "Area says %s ha, but the polygon measures %.4f ha." % (declared.raw, hectares))
            if geometry_valid and range_ok and all(a.valid for a in analyses):
                key = geometry_key(g, analyses)
                duplicate = False
                if key is not None:
                    first = keys.get(key)
                    if first is None:
                        keys[key] = index
                    else:
                        duplicate = True
                        same = same_attributes(plots[first], plot)
                        findings.add("duplicate-plot", gpath, index, "This plot has the same geometry as feature %d." % first, fixable=same)
                if not duplicate and g["type"] in ("Polygon", "MultiPolygon"):
                    for a in analyses:
                        outer = a.rings[0] if a.rings else None
                        if outer is not None and not outer.antimeridian and outer.unwrapped is not None:
                            overlap_entries.append((index, outer.unwrapped, G.box_of(outer.unwrapped)))
        check_properties(plot, index, props, g)
        area = props.get("Area", _MISSING)
        if g is not None and g["type"] == "Point":
            if area is _MISSING:
                agg["area_missing"].append(index)
                hectares = 4
                area_source = "default"
            elif isinstance(area, JNum):
                hectares = area.value
                area_source = "declared"
        if plot.raw_feature is None and "ProductionPlace" not in props:
            agg["place_missing"].append(index)
        for k in props:
            if k not in KNOWN_PROPERTIES and k.lower() not in KNOWN_LOWER:
                unknown[k] = unknown.get(k, 0) + 1
        infos.append({"feature": index, "type": None if g is None else g["type"], "positions": positions, "hectares": hectares, "areaSource": area_source, "geometryValid": geometry_valid, "bbox": bbox})

    if agg["low"]:
        findings.add("low-precision", "", None, "In %d plot(s) no coordinate has six decimal places: features %s." % (len(agg["low"]), _list_some(agg["low"])))
    if agg["altitude"]:
        findings.add("altitude-present", "", None, "%d plot(s) have positions with more than two values: features %s." % (len(agg["altitude"]), _list_some(agg["altitude"])))
    if agg["excess"]:
        findings.add("excess-precision", "", None, "%d plot(s) have coordinates with more than six decimal places: features %s." % (len(agg["excess"]), _list_some(agg["excess"])))
    if agg["area_missing"]:
        findings.add("point-area-missing", "", None, "%d point plot(s) have no Area: features %s. The Information System will assume 4 ha for each." % (len(agg["area_missing"]), _list_some(agg["area_missing"])))
    if agg["place_missing"]:
        findings.add("production-place-missing", "", None, "%d plot(s) have no ProductionPlace: features %s." % (len(agg["place_missing"]), _list_some(agg["place_missing"])))
    if unknown:
        findings.add("unknown-properties", "", None, "The Information System ignores these properties: %s." % ", ".join("%s (%d)" % (_json.dumps(k), n) for k, n in list(unknown.items())[:20]))
    if agg["winding"]:
        findings.add("winding-order", "", None, "%d ring(s) wind against RFC 7946's right-hand rule: features %s." % (len(agg["winding"]), _list_some(agg["winding"])))
    if not plots:
        findings.add("no-plots", "", None, "The file contains no plots.")
    if nbytes > max_bytes:
        findings.add("file-too-large", "", None, "The file is %d bytes; the Information System accepts at most %d bytes per due diligence statement." % (nbytes, max_bytes))
    if variant == "type-ii" and len(producers) > max_producers:
        findings.add("too-many-producers", "", None, "The file has %d producers; one commodity entry accepts at most %d." % (len(producers), max_producers))
    if options.get("checkOverlaps", True) is not False:
        _find_overlaps(overlap_entries, plots, findings, work)
    if work.exhausted:
        findings.add("check-limit-reached", "", None, "Some self-intersection or overlap checks stopped at the work limit.")
    return findings, infos


def _find_overlaps(entries, plots, findings, work):
    entries = sorted(entries, key=lambda e: (e[2][0], e[0]))
    reported = set()
    active = []
    for e in entries:
        active = [o for o in active if o[2][2] >= e[2][0]]
        for o in active:
            if o[0] == e[0]:
                continue
            if o[2][3] < e[2][1] or e[2][3] < o[2][1]:
                continue
            lo, hi = (o[0], e[0]) if o[0] < e[0] else (e[0], o[0])
            if (lo, hi) in reported:
                continue
            rel = G.polygon_relation(o[1], e[1], work)
            if rel is None:
                return
            if rel == "overlap":
                reported.add((lo, hi))
                findings.add("overlapping-plots", plots[hi].geometry_path, hi, "Plots %d and %d overlap." % (lo, hi))
        active.append(e)
