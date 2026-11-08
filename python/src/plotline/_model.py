# Copyright 2026 MB AFKzona Group
# SPDX-License-Identifier: AGPL-3.0-only
"""The plot model and findings (mirror of src/core/model.ts)."""
import json
import pathlib

_RULES = json.loads((pathlib.Path(__file__).parent / "rules.json").read_text("utf-8"))["rules"]
RULES = {r["id"]: r for r in _RULES}


class Position:
    __slots__ = ("x", "y", "lon", "lat", "decimals", "truncated", "extra")

    def __init__(self, x, y, lon, lat, decimals, truncated, extra):
        self.x = x
        self.y = y
        self.lon = lon
        self.lat = lat
        self.decimals = decimals
        self.truncated = truncated
        self.extra = extra


def grid_position(p):
    return Position(p.x, p.y, p.x / 1_000_000, p.y / 1_000_000, 6, False, 0)


class Plot:
    """One plot. geometry is a dict such as {"type": "Point", "position": Position}."""

    __slots__ = ("path", "geometry_path", "line", "id", "properties", "geometry", "raw_geometry", "raw_feature")

    def __init__(self, path, geometry_path, line=None, id=None, properties=None, geometry=None, raw_geometry=None, raw_feature=None):
        self.path = path
        self.geometry_path = geometry_path
        self.line = line
        self.id = id
        self.properties = properties
        self.geometry = geometry
        self.raw_geometry = raw_geometry
        self.raw_feature = raw_feature

    def replace(self, **changes):
        p = Plot(self.path, self.geometry_path, self.line, self.id, self.properties, self.geometry, self.raw_geometry, self.raw_feature)
        for k, v in changes.items():
            setattr(p, k, v)
        return p


_MISSING = object()


class Findings:
    def __init__(self):
        self.issues = []

    def add(self, rule_id, path, feature, message, severity=None, fixable=None, line=None):
        r = RULES[rule_id]
        self.issues.append(
            {
                "rule": rule_id,
                "severity": severity or r["severity"],
                "path": path,
                "feature": feature,
                "message": message,
                "fixable": (r["fix"] is not None) if fixable is None else fixable,
                "line": line,
            }
        )


def pointer(base, *segments):
    out = base
    for s in segments:
        out += "/" + str(s).replace("~", "~0").replace("/", "~1")
    return out


def for_each_position(g, path, fn):
    t = g["type"]
    if t == "Point":
        fn(g["position"], pointer(path, "coordinates"))
    elif t == "MultiPoint":
        for i, p in enumerate(g["positions"]):
            fn(p, pointer(path, "coordinates", i))
    elif t == "Polygon":
        for r, ring in enumerate(g["rings"]):
            for i, p in enumerate(ring):
                fn(p, pointer(path, "coordinates", r, i))
    elif t == "MultiPolygon":
        for k, rings in enumerate(g["polygons"]):
            for r, ring in enumerate(rings):
                for i, p in enumerate(ring):
                    fn(p, pointer(path, "coordinates", k, r, i))
    else:
        for i, part in enumerate(g["geometries"]):
            for_each_position(part, pointer(path, "geometries", i), fn)
