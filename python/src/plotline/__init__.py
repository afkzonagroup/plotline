# Copyright 2026 MB AFKzona Group
# SPDX-License-Identifier: AGPL-3.0-only
"""Plotline: geolocation tooling for the EU Deforestation Regulation
(Regulation (EU) 2023/1115). Validates, repairs, measures and splits plot
geolocation files for the EUDR Information System, offline.

Same rules as the TypeScript package @afkzona/plotline; both pass one shared
set of JSON test vectors. Not legal advice.

Plotline by AFKzona Group - https://afkzonagroup.lt
"""
import base64

from ._fix import fix_plots
from ._model import RULES as _RULES_BY_ID
from ._read import js_trim, read_input
from ._validate import COMMODITIES, effective_properties, producer_key, validate_plots
from ._write import split_plots, utf8_length, write_feature_collection

__all__ = ["VERSION", "GENERATOR", "COMMODITIES", "DEFAULT_LIMITS", "SYSTEM_LIMITS", "rules", "validate", "fix", "split", "convert", "to_dds_producers", "read_plots", "write_feature_collection"]

VERSION = "0.1.0"
ATTRIBUTION = "Plotline by AFKzona Group"
ATTRIBUTION_URL = "https://afkzonagroup.lt"
GENERATOR = "Plotline %s by AFKzona Group (%s)" % (VERSION, ATTRIBUTION_URL)

DEFAULT_LIMITS = {
    "maxInputBytes": 64 * 1024 * 1024,
    "maxDepth": 64,
    "maxValues": 20_000_000,
    "maxStringLength": 65_536,
    "maxNumberLength": 64,
    "maxFeatures": 250_000,
    "maxPositions": 5_000_000,
    "checkBudget": 50_000_000,
}
HARD_LIMITS = {
    "maxInputBytes": 512 * 1024 * 1024,
    "maxDepth": 256,
    "maxValues": 100_000_000,
    "maxStringLength": 1_048_576,
    "maxNumberLength": 400,
    "maxFeatures": 2_000_000,
    "maxPositions": 40_000_000,
    "checkBudget": 2_000_000_000,
}
SYSTEM_LIMITS = {"maxGeolocationBytes": 25_000_000, "maxProducersPerCommodity": 1000, "maxProducersPerStatement": 10_000}

_OPTION_NAMES = {
    "commodity", "variant", "max_bytes", "max_producers", "check_budget", "check_overlaps", "limits", "input_format", "name",
    "country", "strip_unknown_properties", "simplify_collinear", "cut_antimeridian", "remove_duplicates",
}


def resolve_limits(overrides=None):
    out = dict(DEFAULT_LIMITS)
    for key, value in (overrides or {}).items():
        if key not in DEFAULT_LIMITS:
            raise ValueError("unknown limit: %s" % key)
        if value is None:
            continue
        if not isinstance(value, int) or isinstance(value, bool) or value < 1 or value > HARD_LIMITS[key]:
            raise ValueError("limit %s must be an integer from 1 to %d" % (key, HARD_LIMITS[key]))
        out[key] = value
    return out


def _options(kw):
    unknown = set(kw) - _OPTION_NAMES
    if unknown:
        raise TypeError("unknown option(s): %s" % ", ".join(sorted(unknown)))
    commodity = kw.get("commodity")
    if commodity is not None and commodity not in COMMODITIES:
        raise ValueError("commodity must be one of %s" % ", ".join(COMMODITIES))
    variant = kw.get("variant") or "type-i"
    if variant not in ("type-i", "type-ii"):
        raise ValueError('variant must be "type-i" or "type-ii"')
    limits = dict(kw.get("limits") or {})
    if kw.get("check_budget") is not None:
        limits["checkBudget"] = kw["check_budget"]
    return {
        "commodity": commodity,
        "variant": variant,
        "maxBytes": kw.get("max_bytes"),
        "maxProducers": kw.get("max_producers"),
        "checkBudget": kw.get("check_budget"),
        "checkOverlaps": kw.get("check_overlaps", True),
        "limits": resolve_limits(limits),
        "format": kw.get("input_format"),
        "name": kw.get("name"),
        "country": kw.get("country"),
        "stripUnknownProperties": bool(kw.get("strip_unknown_properties")),
        "simplifyCollinear": bool(kw.get("simplify_collinear")),
        "cutAntimeridian": kw.get("cut_antimeridian", True),
        "removeDuplicates": kw.get("remove_duplicates", True),
    }


def rules():
    """Every rule with its status, severity, sources and fix."""
    return list(_RULES_BY_ID.values())


def _summary(plots, infos, issues):
    countries = {}
    producers = set()
    for p in plots:
        if p.raw_feature is not None:
            continue
        producers.add(producer_key(p.properties))
        c = (p.properties or {}).get("ProducerCountry")
        key = js_trim(c).upper() if isinstance(c, str) else ""
        countries[key] = countries.get(key, 0) + 1
    return {
        "errors": sum(1 for i in issues if i["severity"] == "error"),
        "warnings": sum(1 for i in issues if i["severity"] == "warning"),
        "infos": sum(1 for i in issues if i["severity"] == "info"),
        "plots": len(plots),
        "points": sum(1 for i in infos if i["type"] == "Point"),
        "polygons": sum(1 for i in infos if i["type"] in ("Polygon", "MultiPolygon")),
        "other": sum(1 for i in infos if i["type"] not in ("Point", "Polygon", "MultiPolygon")),
        "positions": sum(i["positions"] for i in infos),
        "producers": len(producers),
        "hectares": sum((i["hectares"] or 0) for i in infos),
        "countries": countries,
    }


def _report(fmt, nbytes, plots, issues, infos, notes):
    s = _summary(plots, infos, issues)
    return {"generator": GENERATOR, "format": fmt, "bytes": nbytes, "ok": s["errors"] == 0, "summary": s, "issues": issues, "plots": infos, "notes": notes}


def _read(data, o):
    return read_input(data, o["limits"], o["format"], o["name"])


def _blocked(r):
    return not r["readable"] or any(i["rule"] == "crs-not-wgs84" for i in r["findings"].issues)


def _validate(data, o):
    r = _read(data, o)
    if not r["readable"]:
        return _report(r["format"], r["bytes"], [], r["findings"].issues, [], r["notes"])
    nbytes = r["bytes"] if r["format"] == "geojson" else utf8_length(write_feature_collection(r["plots"]))
    findings, infos = validate_plots(r["plots"], nbytes, o, r["findings"])
    return _report(r["format"], nbytes, r["plots"], findings.issues, infos, r["notes"])


def validate(data, **options):
    """Validates a plot file (bytes or str; GeoJSON, KML or CSV). Returns a report dict.

    >>> validate('{"type":"FeatureCollection","features":[]}')["ok"]
    False
    """
    return _validate(data, _options(options))


def fix(data, **options):
    """Repairs what can be repaired safely. Returns dict(output, changes, before, after)."""
    o = _options(options)
    before = _validate(data, o)
    r = _read(data, o)
    if _blocked(r):
        return {"output": None, "changes": [], "before": before, "after": None}
    plots, changes = fix_plots(r["plots"], r["findings"].issues, o)
    output = write_feature_collection(plots)
    after = _validate(output, dict(o, format="geojson", name=None))
    return {"output": output, "changes": changes, "before": before, "after": after}


def split(data, repair=True, **options):
    """Splits into parts within the Information System limits. Returns dict(parts, changes, before, oversized, spread_producers)."""
    o = _options(options)
    before = _validate(data, o)
    r = _read(data, o)
    if _blocked(r):
        return {"parts": [], "changes": [], "before": before, "oversized": [], "spread_producers": 0}
    plots, changes = fix_plots(r["plots"], r["findings"].issues, o) if repair else (r["plots"], [])
    parts, oversized, spread = split_plots(plots, o["maxBytes"] or SYSTEM_LIMITS["maxGeolocationBytes"], o["maxProducers"] or SYSTEM_LIMITS["maxProducersPerCommodity"])
    width = max(3, len(str(len(parts))))
    out = []
    for p in parts:
        text = write_feature_collection([plots[i] for i in p["plots"]])
        out.append({"name": "part-%s.geojson" % str(p["part"]).zfill(width), "text": text, "bytes": utf8_length(text), "plots": len(p["plots"]), "producers": p["producers"]})
    return {"parts": out, "changes": changes, "before": before, "oversized": oversized, "spread_producers": spread}


def convert(data, repair=False, **options):
    """Converts KML, CSV or GeoJSON to GeoJSON. Returns dict(output, changes, before)."""
    o = _options(options)
    before = _validate(data, o)
    r = _read(data, o)
    if _blocked(r):
        return {"output": None, "changes": [], "before": before}
    plots, changes = fix_plots(r["plots"], r["findings"].issues, o) if repair else (r["plots"], [])
    return {"output": write_feature_collection(plots), "changes": changes, "before": before}


def read_plots(data, **options):
    o = _options(options)
    r = _read(data, o)
    return r["plots"], r["findings"].issues, r["readable"]


def to_dds_producers(plots):
    """Groups plots by producer; each producer's GeoJSON is base64-encoded for the DDS API "geometryGeojson" element."""
    groups = {}
    for p in plots:
        if p.raw_feature is not None:
            continue
        groups.setdefault(producer_key(p.properties), []).append(p)
    out = []
    for members in groups.values():
        # Read as the grouping key reads them: mis-cased names and the country code as it will be written.
        props = effective_properties(members[0].properties)
        c = props.get("ProducerCountry")
        n = props.get("ProducerName")
        out.append(
            {
                "country": js_trim(c).upper() if isinstance(c, str) else None,
                "name": n if isinstance(n, str) else None,
                "plots": len(members),
                "geometryGeojson": base64.b64encode(write_feature_collection(members).encode("utf-8")).decode("ascii"),
            }
        )
    return out

