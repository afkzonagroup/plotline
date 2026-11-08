# Copyright 2026 MB AFKzona Group
# SPDX-License-Identifier: AGPL-3.0-only
"""Readers for GeoJSON, CSV and KML (mirror of src/core/read-*.ts and input.ts)."""
import json as _json
import re

from ._geom import parse_coordinate
from ._json import JNum, JsonError, line_column, parse_json
from ._model import Findings, Plot, Position, pointer

# JavaScript's String.prototype.trim() and regex \s whitespace set, so both languages agree.
_JS_WS = "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
_JS_WS_RE = "[" + re.escape(_JS_WS) + "]"


def js_trim(s):
    return s.strip(_JS_WS)


class _Abort(Exception):
    pass


def _type_of(v):
    if isinstance(v, list):
        return "an array"
    if isinstance(v, dict):
        return "an object"
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "a boolean"
    if isinstance(v, JNum):
        return "a number"
    return "a string"


GEOMETRY_TYPES = {"Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon", "GeometryCollection"}
_FEATURE_MEMBERS = {"type", "id", "geometry", "properties", "bbox"}
_COLLECTION_MEMBERS = {"type", "features", "bbox", "crs"}
_WGS84_CRS = {"urn:ogc:def:crs:OGC:1.3:CRS84", "urn:ogc:def:crs:OGC::CRS84", "urn:ogc:def:crs:EPSG::4326", "EPSG:4326", "CRS84", "http://www.opengis.net/def/crs/OGC/1.3/CRS84"}


def read_geojson(root, limits):
    findings = Findings()
    plots = []
    state = {"positions": 0}

    def count_position(path):
        state["positions"] += 1
        if state["positions"] > limits["maxPositions"]:
            findings.add("input-limit", path, None, "More than %d positions; raise the limit or split the file first." % limits["maxPositions"])
            raise _Abort()

    def read_position(v, path, feature):
        if not isinstance(v, list) or len(v) < 2:
            findings.add("position-invalid", path, feature, "A position must be an array of at least two numbers [longitude, latitude].")
            return None
        if not all(isinstance(x, JNum) for x in v):
            findings.add("position-invalid", path, feature, 'Every value of a position must be a number. Text such as "12.5" is not a number.')
            return None
        count_position(path)
        lon = parse_coordinate(v[0].raw)
        lat = parse_coordinate(v[1].raw)
        if lon is None or lat is None:
            findings.add("coordinate-out-of-range", path, feature, "Coordinate [%s, %s] is far outside longitude -180..180 and latitude -90..90." % (v[0].raw, v[1].raw))
            return None
        return Position(lon.micro, lat.micro, lon.value, lat.value, max(lon.decimals, lat.decimals), lon.truncated or lat.truncated, len(v) - 2)

    def read_positions(v, path, feature, what):
        if not isinstance(v, list):
            findings.add("geojson-structure", path, feature, "%s must be an array of positions; found %s." % (what, _type_of(v)))
            return None
        out = []
        ok = True
        for i, item in enumerate(v):
            p = read_position(item, pointer(path, i), feature)
            if p is None:
                ok = False
            else:
                out.append(p)
        return out if ok else None

    def read_rings(v, path, feature):
        if not isinstance(v, list):
            findings.add("geojson-structure", path, feature, "Polygon coordinates must be an array of rings; found %s." % _type_of(v))
            return None
        rings = []
        ok = True
        for i, item in enumerate(v):
            ring = read_positions(item, pointer(path, i), feature, "A polygon ring")
            if ring is None:
                ok = False
            else:
                rings.append(ring)
        return rings if ok else None

    def read_geometry(v, path, feature, nested):
        if not isinstance(v, dict):
            findings.add("geojson-structure", path, feature, "A geometry must be an object; found %s." % _type_of(v))
            return None
        t = v.get("type")
        if not isinstance(t, str):
            findings.add("geojson-structure", path, feature, 'A geometry needs a "type" member with a text value.')
            return None
        if t not in GEOMETRY_TYPES:
            findings.add("geometry-type-not-accepted", pointer(path, "type"), feature, '"%s" is not a GeoJSON geometry type.' % t)
            return None
        if t in ("LineString", "MultiLineString"):
            findings.add("geometry-type-not-accepted", pointer(path, "type"), feature, "%s does not describe a plot of land and is not accepted." % t)
            return None
        member = "geometries" if t == "GeometryCollection" else "coordinates"
        for key in v:
            if key == "crs":
                # The root's "crs" is checked once below; a nested one (GeoJSON 2008 allowed it) here.
                if path != "":
                    check_crs(v, path)
                continue
            if key == "bbox":
                findings.add("bbox-member", pointer(path, "bbox"), feature, 'The "bbox" member will be removed; it can be stale after repairs.')
            elif key != "type" and key != member:
                findings.add("foreign-member", pointer(path, key), feature, 'Member "%s" is not part of a %s and will be dropped.' % (key, t))
        if t == "GeometryCollection":
            geometries = v.get("geometries")
            if not isinstance(geometries, list):
                findings.add("geojson-structure", path, feature, 'A GeometryCollection needs a "geometries" array.')
                return None
            if nested:
                findings.add("nested-geometry-collection", path, feature, "This GeometryCollection is inside another one; it will be flattened.")
            parts = []
            ok = True
            for i, g in enumerate(geometries):
                part = read_geometry(g, pointer(path, "geometries", i), feature, True)
                if part is None:
                    ok = False
                else:
                    parts.append(part)
            return {"type": "GeometryCollection", "geometries": parts} if ok else None
        if "coordinates" not in v:
            findings.add("geojson-structure", path, feature, 'A %s needs a "coordinates" member.' % t)
            return None
        coords = v["coordinates"]
        cpath = pointer(path, "coordinates")
        if t == "Point":
            if isinstance(coords, list) and len(coords) == 1 and isinstance(coords[0], list):
                findings.add("position-invalid", cpath, feature, "A Point's coordinates must be one position [longitude, latitude], not an array of positions.")
                return None
            p = read_position(coords, cpath, feature)
            return None if p is None else {"type": "Point", "position": p}
        if t == "MultiPoint":
            ps = read_positions(coords, cpath, feature, "MultiPoint coordinates")
            return None if ps is None else {"type": "MultiPoint", "positions": ps}
        if t == "Polygon":
            rings = read_rings(coords, cpath, feature)
            return None if rings is None else {"type": "Polygon", "rings": rings}
        if not isinstance(coords, list):
            findings.add("geojson-structure", cpath, feature, "MultiPolygon coordinates must be an array of polygons; found %s." % _type_of(coords))
            return None
        polygons = []
        ok = True
        for i, item in enumerate(coords):
            rings = read_rings(item, pointer(cpath, i), feature)
            if rings is None:
                ok = False
            else:
                polygons.append(rings)
        return {"type": "MultiPolygon", "polygons": polygons} if ok else None

    def read_feature(v, path, index):
        if len(plots) >= limits["maxFeatures"]:
            findings.add("input-limit", path, None, "More than %d features; raise the limit or split the file first." % limits["maxFeatures"])
            raise _Abort()
        if not isinstance(v, dict) or v.get("type") != "Feature":
            findings.add("geojson-structure", path, index, 'Every item of "features" must be an object with "type": "Feature". It is kept unchanged.')
            plots.append(Plot(path, pointer(path, "geometry"), raw_feature=_RawItem(v)))
            return
        for key in v:
            if key == "crs":
                # The root's "crs" is checked once below; a nested one (GeoJSON 2008 allowed it) here.
                if path != "":
                    check_crs(v, path)
                continue
            if key == "bbox":
                findings.add("bbox-member", pointer(path, "bbox"), index, 'The "bbox" member will be removed; it can be stale after repairs.')
            elif key not in _FEATURE_MEMBERS:
                findings.add("foreign-member", pointer(path, key), index, 'Member "%s" is not part of a Feature and will be dropped.' % key)
        fid = None
        if "id" in v:
            if isinstance(v["id"], (str, JNum)):
                fid = v["id"]
            else:
                findings.add("geojson-structure", pointer(path, "id"), index, 'A Feature "id" must be a string or a number; it will be dropped.', severity="warning", fixable=True)
        properties = None
        if "properties" in v:
            pv = v["properties"]
            if isinstance(pv, dict):
                properties = dict(pv)
            elif pv is not None:
                findings.add("geojson-structure", pointer(path, "properties"), index, '"properties" must be an object or null; found %s.' % _type_of(pv))
        else:
            findings.add("geojson-structure", path, index, 'A Feature should have a "properties" member (an object or null).', severity="info", fixable=True)
        gpath = pointer(path, "geometry")
        geometry = None
        raw_geometry = None
        if "geometry" not in v:
            findings.add("geometry-missing", path, index, 'This Feature has no "geometry" member. Every plot needs its geolocation.')
        elif v["geometry"] is None:
            findings.add("geometry-missing", gpath, index, "This Feature's geometry is null. Every plot needs its geolocation.")
        else:
            geometry = read_geometry(v["geometry"], gpath, index, False)
            if geometry is None:
                raw_geometry = _RawItem(v["geometry"])
        plots.append(Plot(path, gpath, None, fid, properties, geometry, raw_geometry, None))

    def check_crs(obj, path):
        if "crs" not in obj:
            return
        crs = obj["crs"]
        props = crs.get("properties") if isinstance(crs, dict) else None
        name = props.get("name") if isinstance(props, dict) else None
        if isinstance(name, str) and name in _WGS84_CRS:
            findings.add("crs-member", pointer(path, "crs"), None, '"crs" names %s; RFC 7946 removed the member and it will be dropped.' % name)
        else:
            findings.add("crs-not-wgs84", pointer(path, "crs"), None, "The file declares a coordinate reference system that is not WGS 84 longitude/latitude.")

    try:
        if not isinstance(root, dict):
            findings.add("file-format", "", None, "A GeoJSON file must contain one JSON object; found %s." % _type_of(root))
            return plots, findings, False
        t = root.get("type")
        if not isinstance(t, str):
            findings.add("file-format", "", None, 'The JSON object has no "type" member, so it is not GeoJSON.')
            return plots, findings, False
        check_crs(root, "")
        if t == "FeatureCollection":
            features = root.get("features")
            if not isinstance(features, list):
                findings.add("geojson-structure", "", None, 'A FeatureCollection needs a "features" array.')
                return plots, findings, False
            for key in root:
                if key == "bbox":
                    findings.add("bbox-member", "/bbox", None, 'The "bbox" member will be removed; it can be stale after repairs.')
                elif key not in _COLLECTION_MEMBERS:
                    findings.add("foreign-member", pointer("", key), None, 'Member "%s" is not part of a FeatureCollection and will be dropped.' % key)
            for i, f in enumerate(features):
                read_feature(f, pointer("", "features", i), i)
        elif t == "Feature":
            findings.add("not-feature-collection", "", None, "The file is a single Feature; it will be wrapped in a FeatureCollection.")
            read_feature(root, "", 0)
        elif t in GEOMETRY_TYPES:
            findings.add("not-feature-collection", "", None, "The file is a bare %s; it will be wrapped in a Feature inside a FeatureCollection." % t)
            geometry = read_geometry(root, "", 0, False)
            plots.append(Plot("", "", None, None, None, geometry, _RawItem(root) if geometry is None else None, None))
        else:
            findings.add("file-format", "/type", None, '"%s" is not a GeoJSON type (types are case-sensitive).' % t)
            return plots, findings, False
    except _Abort:
        return [], findings, False
    return plots, findings, True


class _RawItem:
    """A source JSON value kept verbatim."""

    __slots__ = ("value",)

    def __init__(self, value):
        self.value = value


# ---- CSV ----

_ALIASES = {
    "longitude": "lon", "lon": "lon", "lng": "lon", "long": "lon", "x": "lon",
    "latitude": "lat", "lat": "lat", "y": "lat",
    "plotid": "plot", "plot": "plot", "polygonid": "plot", "polygon": "plot",
    "producername": "ProducerName", "producer": "ProducerName",
    "producercountry": "ProducerCountry", "country": "ProducerCountry", "countrycode": "ProducerCountry",
    "productionplace": "ProductionPlace", "place": "ProductionPlace", "placename": "ProductionPlace",
    "area": "Area", "areaha": "Area", "hectares": "Area", "ha": "Area",
}


def _normalise(h):
    return re.sub("(?:" + _JS_WS_RE + "|[_-])+", "", js_trim(h).lower())


def parse_csv(text, delimiter, limits):
    rows = []
    cells = []
    cell = []
    # True while the cell holds only whitespace (a flag, so a quote character
    # never re-scans the cell: hostile input would be quadratic otherwise).
    blank = True
    quoted = False
    in_quotes = False
    line = 1
    row_line = 1
    count = 0
    max_values = limits["maxValues"]
    max_string = limits["maxStringLength"]

    def push():
        nonlocal count, cell, quoted, blank
        count += 1
        if count > max_values:
            return "more than %d cells" % max_values
        s = "".join(cell)
        cells.append(s if quoted else js_trim(s))
        cell = []
        blank = True
        quoted = False
        return None

    i = 0
    n = len(text)
    clen = 0
    while i < n:
        c = text[i]
        if in_quotes:
            if c == '"':
                if i + 1 < n and text[i + 1] == '"':
                    cell.append('"')
                    clen += 1
                    blank = False
                    i += 1
                else:
                    in_quotes = False
            else:
                if c == "\n":
                    line += 1
                cell.append(c)
                # Lengths count UTF-16 code units, as in TypeScript.
                clen += 2 if ord(c) > 0xFFFF else 1
                if blank and c not in _JS_WS:
                    blank = False
                if clen > max_string:
                    return None, ("a cell longer than %d characters" % max_string, line)
            i += 1
            continue
        if c == '"' and blank:
            in_quotes = True
            quoted = True
            cell = []
            clen = 0
        elif c == delimiter:
            e = push()
            clen = 0
            if e:
                return None, (e, line)
        elif c in "\n\r":
            if c == "\r" and i + 1 < n and text[i + 1] == "\n":
                i += 1
            e = push()
            clen = 0
            if e:
                return None, (e, line)
            if not (len(cells) == 1 and cells[0] == ""):
                rows.append((cells, row_line))
            cells = []
            line += 1
            row_line = line
        else:
            cell.append(c)
            clen += 2 if ord(c) > 0xFFFF else 1
            if blank and c not in _JS_WS:
                blank = False
            if clen > max_string:
                return None, ("a cell longer than %d characters" % max_string, line)
        i += 1
    if in_quotes:
        return None, ("a quoted cell is not closed", line)
    if cell or cells:
        e = push()
        if e:
            return None, (e, line)
        if not (len(cells) == 1 and cells[0] == ""):
            rows.append((cells, row_line))
    return rows, None


def detect_delimiter(text):
    header = re.split(r"\r?\n", text, maxsplit=1)[0]
    best = ","
    best_count = -1
    for d in (",", ";", "\t"):
        n = 0
        q = False
        for ch in header:
            if ch == '"':
                q = not q
            elif not q and ch == d:
                n += 1
        if n > best_count:
            best = d
            best_count = n
    return best


def _number_from_decimal(m):
    raw = re.sub(r"^0+(?=[0-9])", "", m.group(1)) + (m.group(2) or "")
    return JNum(raw, float(raw))


def read_csv(text, limits):
    findings = Findings()
    notes = []
    delimiter = detect_delimiter(text)
    rows, err = parse_csv(text, delimiter, limits)
    if err is not None:
        findings.add("file-format", "", None, "The CSV file cannot be read: %s (line %d)." % err, line=err[1])
        return [], findings, False, notes
    if not rows:
        return [], findings, True, notes
    header, header_line = rows[0]
    body = rows[1:]
    notes.append("Separator: %s." % ("tab" if delimiter == "\t" else '"%s"' % delimiter))
    roles = [_ALIASES.get(_normalise(h)) for h in header]
    seen = {}
    for i, h in enumerate(header):
        key = roles[i] if roles[i] is not None else "raw:" + h
        if key in seen:
            findings.add("file-format", "", None, "The CSV header has two columns for %s." % _json.dumps(roles[i] or h), line=header_line)
            return [], findings, False, notes
        seen[key] = i
    if "lon" not in roles or "lat" not in roles:
        findings.add("file-format", "", None, "The CSV header needs a longitude column (longitude, lon, lng or x) and a latitude column (latitude, lat or y).", line=header_line)
        return [], findings, False, notes
    lon_col = roles.index("lon")
    lat_col = roles.index("lat")
    plot_col = roles.index("plot") if "plot" in roles else -1
    notes.append(
        'Longitude from column "%s", latitude from column "%s"%s.'
        % (header[lon_col], header[lat_col], ', plot boundaries grouped by column "%s"' % header[plot_col] if plot_col >= 0 else ", one point plot per row")
    )
    state = {"decimal_commas": 0}

    def coordinate(raw):
        t = re.sub(r"^\+", "", js_trim(raw))
        if delimiter != "," and re.fullmatch(r"-?[0-9]+,[0-9]+", t):
            t = t.replace(",", ".", 1)
            state["decimal_commas"] += 1
        return t, len(t) <= limits["maxNumberLength"] and parse_coordinate(t) is not None

    groups = []
    by_key = {}
    positions = 0
    for cells, line in body:
        plot_id = js_trim(cells[plot_col] if plot_col < len(cells) else "") if plot_col >= 0 else ""
        group = by_key.get(plot_id) if plot_id != "" else None
        if group is None:
            if len(groups) >= limits["maxFeatures"]:
                findings.add("input-limit", "", None, "More than %d plots; raise the limit or split the file first." % limits["maxFeatures"], line=line)
                return [], findings, False, notes
            props = {}
            for i, h in enumerate(header):
                role = roles[i]
                if role in ("lon", "lat"):
                    continue
                value = js_trim(cells[i] if i < len(cells) else "")
                if value == "":
                    continue
                name = js_trim(h) if role is None or role == "plot" else role
                if name == "Area":
                    t = value.replace(",", ".", 1) if delimiter != "," and re.fullmatch(r"[0-9]+,[0-9]+", value) else value
                    m = re.fullmatch(r"([0-9]+)(\.[0-9]+)?", t)
                    if m is not None:
                        props["Area"] = _number_from_decimal(m)
                        continue
                props[name] = value
            group = {"index": len(groups), "key": plot_id or None, "line": line, "props": props, "positions": [], "bad": False}
            groups.append(group)
            if plot_id != "":
                by_key[plot_id] = group
        index = group["index"]
        lon_t, lon_ok = coordinate(cells[lon_col] if lon_col < len(cells) else "")
        lat_t, lat_ok = coordinate(cells[lat_col] if lat_col < len(cells) else "")
        path = pointer("", "features", index, "geometry", "coordinates")
        if not lon_ok or not lat_ok:
            t = lon_t if not lon_ok else lat_t
            numeric = re.fullmatch(r"-?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?", t) is not None
            findings.add("coordinate-out-of-range" if numeric else "position-invalid", path, index, "Line %d: not a usable coordinate in decimal degrees." % line, line=line)
            group["bad"] = True
            continue
        positions += 1
        if positions > limits["maxPositions"]:
            findings.add("input-limit", "", None, "More than %d positions; raise the limit or split the file first." % limits["maxPositions"], line=line)
            return [], findings, False, notes
        x = parse_coordinate(lon_t)
        y = parse_coordinate(lat_t)
        group["positions"].append(Position(x.micro, y.micro, x.value, y.value, max(x.decimals, y.decimals), x.truncated or y.truncated, 0))
    if state["decimal_commas"] > 0:
        notes.append("Read %d coordinate(s) written with a decimal comma." % state["decimal_commas"])
    plots = []
    for i, g in enumerate(groups):
        path = pointer("", "features", i)
        gpath = pointer(path, "geometry")
        geometry = None
        if not g["bad"] and g["positions"]:
            if g["key"] is None or len(g["positions"]) == 1:
                geometry = {"type": "Point", "position": g["positions"][0]}
            else:
                ring = list(g["positions"])
                if ring[0].x != ring[-1].x or ring[0].y != ring[-1].y:
                    ring.append(ring[0])
                geometry = {"type": "Polygon", "rings": [ring]}
        if geometry is None and not g["bad"]:
            findings.add("geometry-missing", gpath, i, "Plot on line %d has no coordinates." % g["line"], line=g["line"])
        plots.append(Plot(path, gpath, g["line"], None, g["props"], geometry, None, None))
    return plots, findings, True, notes


# ---- KML ----

_ENTITIES = {"lt": "<", "gt": ">", "amp": "&", "quot": '"', "apos": "'"}
_NAME = re.compile(r"[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?", re.ASCII)


class XmlError(Exception):
    def __init__(self, message, line):
        super().__init__(message)
        self.message = message
        self.line = line


class _El:
    __slots__ = ("name", "attrs", "children", "text", "line", "parts", "tlen")

    def __init__(self, name, attrs, line):
        self.name = name
        self.attrs = attrs
        self.children = []
        self.text = ""
        self.line = line
        # Text is collected in pieces with a running UTF-16 length and joined
        # when the element closes: appending to a string attribute and
        # re-measuring it for every piece would be quadratic.
        self.parts = []
        self.tlen = 0

    def add_text(self, s, limit, max_string, line):
        n = _utf16(s)
        if self.tlen + n > limit:
            raise XmlError("text longer than %d characters" % max_string, line)
        self.parts.append(s)
        self.tlen += n

    def close(self):
        self.text = "".join(self.parts)
        self.parts = []


def _decode_text(s, line):
    if re.search(r"&(?![^;&" + re.escape(_JS_WS) + r"]{1,10};)", s):
        raise XmlError('"&" must start an entity such as &amp;', line)

    def rep(m):
        ref = m.group(1)
        if ref[:2] in ("#x", "#X"):
            if not re.fullmatch(r"#[xX][0-9a-fA-F]{1,6}", ref):
                raise XmlError("invalid character reference", line)
            cp = int(ref[2:], 16)
        elif ref.startswith("#"):
            if not re.fullmatch(r"#[0-9]{1,7}", ref):
                raise XmlError("invalid character reference", line)
            cp = int(ref[1:])
        else:
            if ref not in _ENTITIES:
                raise XmlError("unknown entity &%s;" % ref, line)
            return _ENTITIES[ref]
        if cp > 0x10FFFF or 0xD800 <= cp <= 0xDFFF or cp == 0:
            raise XmlError("invalid character reference", line)
        return chr(cp)

    return re.sub(r"&([^;&" + re.escape(_JS_WS) + r"]{1,10});", rep, s)


def _local(q):
    i = q.find(":")
    return q if i < 0 else q[i + 1:]


def _utf16(s):
    return len(s) + sum(1 for c in s if ord(c) > 0xFFFF)


def parse_xml(text, limits):
    max_string = limits["maxStringLength"]
    pos = 0
    line = 1
    count = 0
    n = len(text)
    root = _El("#document", {}, 1)
    stack = [root]

    def advance(to):
        nonlocal pos, line
        line += text.count("\n", pos, to)
        pos = to

    comment_open = "<" + "!--"

    def text_limit(el):
        return float("inf") if el.name == "coordinates" else max_string

    while pos < n:
        lt = text.find("<", pos)
        end = n if lt < 0 else lt
        if end > pos:
            raw = text[pos:end]
            top = stack[-1]
            if re.search("[^" + re.escape(_JS_WS) + "]", raw):
                if top.tlen + _utf16(raw) > text_limit(top):
                    raise XmlError("text longer than %d characters" % max_string, line)
                top.add_text(_decode_text(raw, line), float("inf"), max_string, line)
            advance(end)
        if lt < 0:
            break
        if text.startswith(comment_open, pos):
            close = text.find("-->", pos + 4)
            if close < 0:
                raise XmlError("unterminated comment", line)
            advance(close + 3)
        elif text.startswith("<![CDATA[", pos):
            close = text.find("]]>", pos + 9)
            if close < 0:
                raise XmlError("unterminated CDATA section", line)
            raw = text[pos + 9:close]
            stack[-1].add_text(raw, text_limit(stack[-1]), max_string, line)
            advance(close + 3)
        elif text.startswith("<!", pos):
            raise XmlError("document type declarations are not allowed", line)
        elif text.startswith("<?", pos):
            close = text.find("?>", pos + 2)
            if close < 0:
                raise XmlError("unterminated processing instruction", line)
            advance(close + 2)
        elif text.startswith("</", pos):
            close = text.find(">", pos)
            if close < 0:
                raise XmlError("unterminated end tag", line)
            name = js_trim(text[pos + 2:close])
            if len(stack) <= 1 or stack[-1].name != _local(name):
                raise XmlError("end tag does not match", line)
            stack.pop().close()
            advance(close + 1)
        else:
            start_line = line
            i = pos + 1
            m = _NAME.match(text[i:i + 200])
            if m is None:
                raise XmlError("invalid element name", line)
            name = _local(m.group(0))
            i += len(m.group(0))
            attrs = {}
            while True:
                while i < n and re.match(_JS_WS_RE, text[i]):
                    i += 1
                if text.startswith("/>", i) or (i < n and text[i] == ">"):
                    break
                am = _NAME.match(text[i:i + 200])
                if am is None:
                    raise XmlError("invalid attribute", line)
                i += len(am.group(0))
                while i < n and re.match(_JS_WS_RE, text[i]):
                    i += 1
                if i >= n or text[i] != "=":
                    raise XmlError("attribute without value", line)
                i += 1
                while i < n and re.match(_JS_WS_RE, text[i]):
                    i += 1
                quote = text[i] if i < n else ""
                if quote not in ('"', "'"):
                    raise XmlError("unquoted attribute", line)
                close = text.find(quote, i + 1)
                if close < 0:
                    raise XmlError("unterminated attribute", line)
                value = text[i + 1:close]
                if "<" in value:
                    raise XmlError('"<" in an attribute', line)
                if _utf16(value) > max_string:
                    raise XmlError("attribute longer than %d characters" % max_string, line)
                attrs[_local(am.group(0))] = _decode_text(value, line)
                i = close + 1
            self_closing = text.startswith("/>", i)
            count += 1
            if count > limits["maxValues"]:
                raise XmlError("more than %d elements" % limits["maxValues"], line)
            el = _El(name, attrs, start_line)
            stack[-1].children.append(el)
            advance(i + (2 if self_closing else 1))
            if not self_closing:
                if len(stack) > limits["maxDepth"]:
                    raise XmlError("elements nested deeper than %d levels" % limits["maxDepth"], line)
                stack.append(el)
    if len(stack) > 1:
        raise XmlError("element is not closed", line)
    root.close()
    return root


def _child(el, name):
    for c in el.children:
        if c.name == name:
            return c
    return None


def _children(el, name):
    return [c for c in el.children if c.name == name]


def _find_all(root, name):
    out = []
    work = [root]
    while work:
        el = work.pop()
        if el.name == name:
            out.append(el)
        else:
            work.extend(reversed(el.children))
    return out


_GEOMETRY_NAMES = {"Point", "Polygon", "MultiGeometry", "LineString", "LinearRing", "Model", "Track", "MultiTrack"}


def read_kml(text, limits):
    findings = Findings()
    try:
        root = parse_xml(text, limits)
    except XmlError as e:
        rid = "input-limit" if re.search("longer than|more than|deeper than", e.message) else "file-format"
        findings.add(rid, "", None, "The KML file cannot be read: %s (line %d)." % (e.message, e.line), line=e.line)
        return [], findings, False
    kml = next((c for c in root.children if c.name == "kml"), None)
    if kml is None:
        findings.add("file-format", "", None, "This XML file has no <kml> root element.")
        return [], findings, False
    placemarks = _find_all(kml, "Placemark")
    if len(placemarks) > limits["maxFeatures"]:
        findings.add("input-limit", "", None, "More than %d placemarks; raise the limit or split the file first." % limits["maxFeatures"])
        return [], findings, False
    state = {"positions": 0, "over": False}

    def read_coordinates(el, path, index):
        if el is None:
            findings.add("geojson-structure", path, index, "A KML geometry has no <coordinates>.")
            return None
        out = []
        tuples = [t for t in re.split(_JS_WS_RE + "+", js_trim(el.text)) if t != ""]
        for i, tup in enumerate(tuples):
            parts = tup.split(",")
            if len(parts) < 2 or len(parts) > 3:
                findings.add("position-invalid", pointer(path, i), index, 'KML coordinates must be "longitude,latitude[,altitude]" (line %d).' % el.line, line=el.line)
                return None
            lon_t = re.sub(r"^\+", "", parts[0])
            lat_t = re.sub(r"^\+", "", parts[1])
            lon = parse_coordinate(lon_t) if len(lon_t) <= limits["maxNumberLength"] else None
            lat = parse_coordinate(lat_t) if len(lat_t) <= limits["maxNumberLength"] else None
            if lon is None or lat is None:
                findings.add("position-invalid", pointer(path, i), index, "Not a longitude,latitude pair in decimal degrees (line %d)." % el.line, line=el.line)
                return None
            state["positions"] += 1
            if state["positions"] > limits["maxPositions"]:
                state["over"] = True
                return None
            out.append(Position(lon.micro, lat.micro, lon.value, lat.value, max(lon.decimals, lat.decimals), lon.truncated or lat.truncated, len(parts) - 2))
        return out

    def read_ring(boundary, path, index):
        ring = None if boundary is None else _child(boundary, "LinearRing")
        return read_coordinates(None if ring is None else _child(ring, "coordinates"), path, index)

    def read_geometry(el, path, index):
        if el.name == "Point":
            ps = read_coordinates(_child(el, "coordinates"), pointer(path, "coordinates"), index)
            if ps is None:
                return None
            if len(ps) != 1:
                findings.add("position-invalid", pointer(path, "coordinates"), index, "A KML Point needs exactly one coordinate tuple (line %d)." % el.line, line=el.line)
                return None
            return {"type": "Point", "position": ps[0]}
        if el.name == "Polygon":
            outer = read_ring(_child(el, "outerBoundaryIs"), pointer(path, "coordinates", 0), index)
            if outer is None:
                return None
            rings = [outer]
            for i, inner in enumerate(_children(el, "innerBoundaryIs")):
                r = read_ring(inner, pointer(path, "coordinates", i + 1), index)
                if r is None:
                    return None
                rings.append(r)
            return {"type": "Polygon", "rings": rings}
        if el.name == "MultiGeometry":
            parts = []
            i = 0
            for c in el.children:
                if c.name not in _GEOMETRY_NAMES:
                    continue
                g = read_geometry(c, pointer(path, "geometries", i), index)
                i += 1
                if g is None:
                    return None
                parts.append(g)
            if parts and all(p["type"] == "Polygon" for p in parts):
                return {"type": "MultiPolygon", "polygons": [p["rings"] for p in parts]}
            if parts and all(p["type"] == "Point" for p in parts):
                return {"type": "MultiPoint", "positions": [p["position"] for p in parts]}
            return {"type": "GeometryCollection", "geometries": parts}
        findings.add("geometry-type-not-accepted", pointer(path, "type"), index, "KML %s (line %d) does not describe a plot of land." % (el.name, el.line), line=el.line)
        return None

    plots = []
    for index, pm in enumerate(placemarks):
        path = pointer("", "features", index)
        gpath = pointer(path, "geometry")
        props = {}
        name = _child(pm, "name")
        if name is not None and js_trim(name.text) != "":
            props["ProductionPlace"] = js_trim(name.text)
        ext = _child(pm, "ExtendedData")
        if ext is not None:

            def put(key, value):
                if not key:
                    return
                v = js_trim(value)
                m = re.fullmatch(r"([0-9]+)(\.[0-9]+)?", v) if key == "Area" else None
                if m is not None:
                    props[key] = _number_from_decimal(m)
                else:
                    props[key] = v

            for d in _children(ext, "Data"):
                val = _child(d, "value")
                put(d.attrs.get("name"), "" if val is None else val.text)
            for sd in _children(ext, "SchemaData"):
                for s in _children(sd, "SimpleData"):
                    put(s.attrs.get("name"), s.text)
        geom_el = next((c for c in pm.children if c.name in _GEOMETRY_NAMES), None)
        geometry = None
        if geom_el is None:
            findings.add("geometry-missing", gpath, index, "Placemark on line %d has no geometry." % pm.line, line=pm.line)
        else:
            geometry = read_geometry(geom_el, gpath, index)
        plots.append(Plot(path, gpath, pm.line, None, props, geometry, None, None))
    if state["over"]:
        findings.add("input-limit", "", None, "More than %d positions; raise the limit or split the file first." % limits["maxPositions"])
        return [], findings, False
    return plots, findings, True


# ---- input ----


def detect_format(name, text):
    lower = (name or "").lower()
    if lower.endswith(".geojson") or lower.endswith(".json"):
        return "geojson"
    if lower.endswith(".kml"):
        return "kml"
    if lower.endswith(".csv") or lower.endswith(".tsv") or lower.endswith(".txt"):
        return "csv"
    m = re.search(r"\S", text)
    first = m.group(0) if m else None
    if first in ("{", "["):
        return "geojson"
    if first == "<":
        return "kml"
    return "csv"


def read_input(data, limits, fmt=None, name=None):
    """Returns dict(format, plots, findings, readable, bytes, notes)."""
    findings = Findings()

    def fail(f, n):
        return {"format": f, "plots": [], "findings": findings, "readable": False, "bytes": n, "notes": []}

    if isinstance(data, str):
        text = data[1:] if data.startswith("\ufeff") else data
        nbytes = len(data.encode("utf-8", "surrogatepass"))
    else:
        nbytes = len(data)
        if nbytes > limits["maxInputBytes"]:
            findings.add("input-limit", "", None, "The file is %d bytes; Plotline reads at most %d bytes." % (nbytes, limits["maxInputBytes"]))
            return fail(fmt or "geojson", nbytes)
        try:
            text = bytes(data).decode("utf-8")
        except UnicodeDecodeError:
            findings.add("file-format", "", None, "The file is not valid UTF-8 text.")
            return fail(fmt or "geojson", nbytes)
        if text.startswith("\ufeff"):
            text = text[1:]
    if nbytes > limits["maxInputBytes"]:
        findings.add("input-limit", "", None, "The file is %d bytes; Plotline reads at most %d bytes." % (nbytes, limits["maxInputBytes"]))
        return fail(fmt or "geojson", nbytes)
    if js_trim(text) == "":
        findings.add("file-format", "", None, "The file is empty.")
        return fail(fmt or detect_format(name, text), nbytes)
    f = fmt or detect_format(name, text)
    if f == "kml":
        plots, fnd, ok = read_kml(text, limits)
        findings.issues.extend(fnd.issues)
        return {"format": f, "plots": plots, "findings": findings, "readable": ok, "bytes": nbytes, "notes": []}
    if f == "csv":
        plots, fnd, ok, notes = read_csv(text, limits)
        findings.issues.extend(fnd.issues)
        return {"format": f, "plots": plots, "findings": findings, "readable": ok, "bytes": nbytes, "notes": notes}
    try:
        root = parse_json(text, limits)
    except JsonError as e:
        rid = "input-limit" if e.kind == "limit" else "json-duplicate-key" if e.kind == "duplicate-key" else "json-syntax"
        line, column = line_column(text, e.offset)
        findings.add(rid, "", None, "JSON error at line %d, column %d: %s." % (line, column, e.message), line=line)
        return fail(f, nbytes)
    plots, fnd, ok = read_geojson(root, limits)
    findings.issues.extend(fnd.issues)
    return {"format": f, "plots": plots, "findings": findings, "readable": ok, "bytes": nbytes, "notes": []}
