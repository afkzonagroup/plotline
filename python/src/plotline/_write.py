# Copyright 2026 MB AFKzona Group
# SPDX-License-Identifier: AGPL-3.0-only
"""Writing GeoJSON and splitting (mirror of src/core/write.ts and split.ts)."""
from ._geom import format_micro
from ._json import quote_json, stringify_json
from ._validate import producer_key


def _pos(p):
    return "[%s,%s]" % (format_micro(p.x), format_micro(p.y))


def _ring(r):
    return "[" + ",".join(_pos(p) for p in r) + "]"


def _rings(rs):
    return "[" + ",".join(_ring(r) for r in rs) + "]"


def write_geometry(g):
    t = g["type"]
    if t == "Point":
        return '{"type":"Point","coordinates":%s}' % _pos(g["position"])
    if t == "MultiPoint":
        return '{"type":"MultiPoint","coordinates":[%s]}' % ",".join(_pos(p) for p in g["positions"])
    if t == "Polygon":
        return '{"type":"Polygon","coordinates":%s}' % _rings(g["rings"])
    if t == "MultiPolygon":
        return '{"type":"MultiPolygon","coordinates":[%s]}' % ",".join(_rings(rs) for rs in g["polygons"])
    return '{"type":"GeometryCollection","geometries":[%s]}' % ",".join(write_geometry(x) for x in g["geometries"])


def write_feature(plot):
    if plot.raw_feature is not None:
        return stringify_json(plot.raw_feature.value)
    fid = "" if plot.id is None else '"id":%s,' % stringify_json(plot.id)
    if plot.properties is None:
        props = "null"
    else:
        props = "{" + ",".join("%s:%s" % (quote_json(k), stringify_json(v)) for k, v in plot.properties.items()) + "}"
    if plot.geometry is not None:
        geometry = write_geometry(plot.geometry)
    elif plot.raw_geometry is not None:
        geometry = stringify_json(plot.raw_geometry.value)
    else:
        geometry = "null"
    return '{"type":"Feature",%s"properties":%s,"geometry":%s}' % (fid, props, geometry)


def write_feature_collection(plots):
    if not plots:
        return '{"type":"FeatureCollection","features":[]}\n'
    return '{"type":"FeatureCollection","features":[\n' + ",\n".join(write_feature(p) for p in plots) + "\n]}\n"


def utf8_length(text):
    return len(text.encode("utf-8", "surrogatepass"))


_HEAD = utf8_length('{"type":"FeatureCollection","features":[\n')
_TAIL = utf8_length("\n]}\n")
_SEP = utf8_length(",\n")
_EMPTY = utf8_length('{"type":"FeatureCollection","features":[]}\n')


def split_plots(plots, max_bytes, max_producers):
    """Returns (parts, oversized, spread) where parts are dicts with plots (indexes), producers, bytes."""
    if max_bytes < _EMPTY + 16:
        raise ValueError("max_bytes is too small")
    if max_producers < 1:
        raise ValueError("max_producers must be at least 1")
    sizes = [utf8_length(write_feature(p)) for p in plots]
    groups = {}
    for i, p in enumerate(plots):
        groups.setdefault(producer_key(p.properties), []).append(i)
    parts = []
    oversized = []
    spread = 0

    def open_part():
        part = {"plots": [], "producers": set(), "bytes": _HEAD + _TAIL}
        parts.append(part)
        return part

    def add(part, i, key):
        part["bytes"] += (_SEP if part["plots"] else 0) + sizes[i]
        part["plots"].append(i)
        part["producers"].add(key)

    for key, members in groups.items():
        group_bytes = sum(sizes[i] for i in members) + _SEP * (len(members) - 1)
        part = parts[-1] if parts else open_part()
        extra = group_bytes + (_SEP if part["plots"] else 0)
        if (part["bytes"] + extra > max_bytes or len(part["producers"]) + 1 > max_producers) and part["plots"]:
            part = open_part()
        if part["bytes"] + group_bytes <= max_bytes:
            for i in members:
                add(part, i, key)
            continue
        spread += 1
        for i in members:
            size = sizes[i]
            if _HEAD + _TAIL + size > max_bytes:
                oversized.append(i)
                if part["plots"]:
                    part = open_part()
                add(part, i, key)
                part = open_part()
                continue
            full = part["bytes"] + size + (_SEP if part["plots"] else 0) > max_bytes
            too_many = key not in part["producers"] and len(part["producers"]) + 1 > max_producers
            if full or too_many:
                part = open_part()
            add(part, i, key)
    out = [p for p in parts if p["plots"]]
    return [{"part": i + 1, "plots": p["plots"], "producers": len(p["producers"]), "bytes": p["bytes"]} for i, p in enumerate(out)], oversized, spread
