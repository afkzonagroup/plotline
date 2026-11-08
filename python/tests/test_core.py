# Copyright 2026 MB AFKzona Group
# SPDX-License-Identifier: AGPL-3.0-only
"""Unit tests of the Python package beyond the shared vectors."""
import base64
import io
import json
import math
import os
import pathlib
import re
import stat
import tempfile
import time
import unittest
from contextlib import redirect_stdout

import plotline
from plotline import _geom as G
from plotline._json import JNum, JsonError, parse_json, quote_json, stringify_json
from plotline.__main__ import main, safe_text

ROOT = pathlib.Path(__file__).resolve().parents[2]
LIMITS = dict(plotline.DEFAULT_LIMITS)


def fc(*features):
    return json.dumps({"type": "FeatureCollection", "features": list(features)})


def feature(geometry, properties=None):
    return {"type": "Feature", "properties": properties if properties is not None else {"ProductionPlace": "P", "ProducerCountry": "CI"}, "geometry": geometry}


def rules(text, **kw):
    return [i["rule"] for i in plotline.validate(text, **kw)["issues"]]


A = [[0.000001, 0.000001], [0.010001, 0.000001], [0.010001, 0.010001], [0.000001, 0.010001], [0.000001, 0.000001]]


class Json(unittest.TestCase):
    def test_values_and_number_text(self):
        v = parse_json('{"b":[1.50,-0,true,null,"x"],"a":{}}', LIMITS)
        self.assertEqual(stringify_json(v), '{"b":[1.50,-0,true,null,"x"],"a":{}}')
        self.assertEqual(list(v), ["b", "a"])

    def test_rejections(self):
        for text, kind in [("[1,]", "syntax"), ("[NaN]", "syntax"), ("[1e400]", "syntax"), ('"\\ud800"', "syntax"), ('{"a":1,"a":2}', "duplicate-key"), ("[" * 65 + "]" * 65, "limit"), ("", "syntax")]:
            with self.subTest(text[:20]):
                with self.assertRaises(JsonError) as cm:
                    parse_json(text, LIMITS)
                self.assertEqual(cm.exception.kind, kind)

    def test_deep_nesting_does_not_recurse(self):
        with self.assertRaises(JsonError) as cm:
            parse_json("[" * 1_000_000, dict(LIMITS, maxDepth=2_000_000))
        self.assertEqual(cm.exception.kind, "syntax")

    def test_proto_keys_are_data(self):
        v = parse_json('{"__proto__":{"x":1}}', LIMITS)
        self.assertEqual(list(v), ["__proto__"])

    def test_quote_matches_typescript_escaping(self):
        s = 'a"b\\c\n' + chr(1) + chr(0x7F) + chr(0x2028) + "é"
        self.assertEqual(quote_json(s), '"a\\"b\\\\c\\n\\u0001\\u007f\\u2028é"')
        self.assertEqual(json.loads(quote_json(s)), s)


class Coordinates(unittest.TestCase):
    def test_truncation_toward_zero(self):
        self.assertEqual(G.parse_coordinate("-5.8227391234").micro, -5822739)
        self.assertEqual(G.parse_coordinate("144.2567074567").micro, 144256707)
        self.assertEqual(G.parse_coordinate("1.5e-3").micro, 1500)
        self.assertEqual(G.parse_coordinate("17.10022").decimals, 5)
        for bad in ["", "1.", ".5", "+1", "NaN", "10001", "1e5"]:
            self.assertIsNone(G.parse_coordinate(bad), bad)
        self.assertEqual(G.format_micro(-5822739), "-5.822739")
        self.assertEqual(G.format_micro(17100220), "17.10022")


class Area(unittest.TestCase):
    def test_against_geographiclib(self):
        cases = json.loads((ROOT / "test-vectors" / "areas.json").read_text("utf-8"))["cases"]
        for c in cases:
            with self.subTest(c["name"]):
                ring = [G.Pt(G.parse_coordinate("%.9f" % x).micro, G.parse_coordinate("%.9f" % y).micro) for x, y in c["ring"][:-1]]
                got = G.ring_area_square_metres(ring)
                tol = 1e-5 if c["squareMetres"] > 1e11 else 1e-6
                self.assertLess(abs(got - c["squareMetres"]) / c["squareMetres"], tol)

    def test_authalic_radius(self):
        self.assertAlmostEqual(G.AUTHALIC_RADIUS, 6_371_007.181, places=3)


class Rules(unittest.TestCase):
    def test_point_area_thresholds(self):
        def with_area(a, **kw):
            return [r for r in rules(fc(feature({"type": "Point", "coordinates": [-5.500001, 6.800001]}, {"ProductionPlace": "P", "ProducerCountry": "CI", "Area": a})), **kw) if r.startswith("point-area")]

        self.assertEqual(with_area(4), [])
        self.assertEqual(with_area(4.0001), ["point-area-above-4ha"])
        self.assertEqual(with_area(4.0001, commodity="cattle"), [])
        self.assertEqual(with_area(0.0001), [])
        self.assertEqual(with_area(0.00009), ["point-area-below-minimum"])

    def test_official_examples_pass(self):
        for e in json.loads((ROOT / "test-vectors" / "official-examples.json").read_text("utf-8"))["examples"]:
            self.assertTrue(plotline.validate(e["text"])["ok"])

    def test_rules_catalogue(self):
        ids = [r["id"] for r in plotline.rules()]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertIn("point-area-above-4ha", ids)

    def test_options_are_checked(self):
        with self.assertRaises(ValueError):
            plotline.validate("{}", commodity="maize")
        with self.assertRaises(TypeError):
            plotline.validate("{}", unknown=1)
        with self.assertRaises(ValueError):
            plotline.validate("{}", limits={"maxDepth": 10**9})
        with self.assertRaises(ValueError):
            plotline.fix(fc(), country="br")


class Hostile(unittest.TestCase):
    def test_limits_and_budget(self):
        self.assertIn("input-limit", rules("[" * 200_000))
        coords = ",".join("[%s,0]" % (i / 1e4) for i in range(2001))
        self.assertIn("input-limit", rules('{"type":"MultiPoint","coordinates":[%s]}' % coords, limits={"maxPositions": 2000}))
        zig = [[i / 1e5, 0 if i % 2 == 0 else 0.5] for i in range(3000)] + [[0.03, 1], [0, 1], [0, 0]]
        t0 = time.time()
        self.assertIn("check-limit-reached", rules(fc(feature({"type": "Polygon", "coordinates": [zig]})), check_budget=1000))
        self.assertLess(time.time() - t0, 10)

    def test_csv_quotes_in_linear_time(self):
        # Each quote used to re-join and trim the cell so far: quadratic in the cell length.
        cell = " " * 30_000 + "a" + '"' * 30_000
        text = "lon,lat,name\n" + ("1.000001,2.000001,%s\n" % cell) * 30
        t0 = time.time()
        self.assertEqual(plotline.validate(text, input_format="csv")["summary"]["plots"], 30)
        self.assertLess(time.time() - t0, 5)

    def test_csv_cells_like_typescript(self):
        from plotline._read import parse_csv
        rows, err = parse_csv(' \t "a,b" ,x"y"z,"""q",  ""', ",", {"maxValues": 99, "maxStringLength": 99})
        self.assertIsNone(err)
        self.assertEqual(rows[0][0], ["a,b ", 'x"y"z', '"q', ""])
        # Cell lengths count UTF-16 code units, as in TypeScript.
        _, err = parse_csv("\U0001F600" * 6, ",", {"maxValues": 9, "maxStringLength": 10})
        self.assertEqual(err[0], "a cell longer than 10 characters")

    def test_kml_text_in_many_pieces_in_linear_time(self):
        # Comments split text into pieces; each piece used to copy and re-measure the text so far.
        kml = "<kml><Placemark><name>" + "a<!---->" * 60_000 + "</name><Point><coordinates>1.000001,2.000001</coordinates></Point></Placemark></kml>"
        t0 = time.time()
        report = plotline.validate(kml, input_format="kml")
        self.assertLess(time.time() - t0, 5)
        self.assertNotIn("input-limit", [i["rule"] for i in report["issues"]])
        fixed = plotline.fix(kml, input_format="kml")
        self.assertIn('"ProductionPlace":"' + "a" * 60_000 + '"', fixed["output"])
        over = "<kml><Placemark><name>" + "a<!---->" * 70_000 + "</name></Placemark></kml>"
        self.assertEqual(rules(over, input_format="kml"), ["input-limit"])
        cdata = "<kml><Placemark><name><![CDATA[" + "a" * 70_000 + "]]></name></Placemark></kml>"
        self.assertEqual(rules(cdata, input_format="kml"), ["input-limit"])

    def test_kml_depth_limit(self):
        deep = "<kml>" + "<Folder>" * 100 + "</Folder>" * 100 + "</kml>"
        self.assertEqual(rules(deep, input_format="kml"), ["input-limit"])
        self.assertEqual(rules(deep, input_format="kml", limits={"maxDepth": 200}), ["no-plots"])

    def test_kml_doctype_refused_even_without_entities(self):
        harmless = '<!DOCTYPE kml><kml><Placemark><Point><coordinates>1.000001,2.000001</coordinates></Point></Placemark></kml>'
        report = plotline.validate(harmless, input_format="kml")
        self.assertEqual([i["rule"] for i in report["issues"]], ["file-format"])
        self.assertIn("document type", report["issues"][0]["message"])

    def test_kml_doctype_refused(self):
        laughs = '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol">]><kml><Placemark><name>&lol;</name></Placemark></kml>'
        self.assertEqual(rules(laughs, input_format="kml"), ["file-format"])

    def test_long_kml_coordinates_and_many_placemarks(self):
        ring = ["%.6f,%.6f,0" % (math.cos(2 * math.pi * i / 5000) / 100, math.sin(2 * math.pi * i / 5000) / 100) for i in range(5000)]
        ring.append(ring[0])
        big = "<kml><Document><Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>\n " + "\n ".join(ring) + "\n</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Document></kml>"
        self.assertEqual([i for i in plotline.validate(big, input_format="kml")["issues"] if i["severity"] == "error"], [])
        many = "<kml><Document>" + "".join("\n  <Placemark>\n    <name>p%d</name>\n    <Point><coordinates>%.6f,1.000001</coordinates></Point>\n  </Placemark>" % (i, i / 1000) for i in range(3000)) + "</Document></kml>"
        self.assertEqual(plotline.validate(many, input_format="kml")["summary"]["plots"], 3000)

    def test_invalid_utf8(self):
        report = plotline.validate(b"\xff\xfe{")
        self.assertEqual([i["rule"] for i in report["issues"]], ["file-format"])
        self.assertIn("UTF-8", report["issues"][0]["message"])


class Repairs(unittest.TestCase):
    def test_range_fixable_only_when_truncation_suffices(self):
        def ring(south):
            return [[180.0000001, -16.5], [179.9, -16.5], [179.9, south], [180.0000001, -16.4], [180.0000001, -16.5]]

        near = fc(feature({"type": "Polygon", "coordinates": [ring(-16.4)]}))
        issue = [i for i in plotline.validate(near)["issues"] if i["rule"] == "coordinate-out-of-range"][0]
        self.assertTrue(issue["fixable"])
        r = plotline.fix(near)
        self.assertIn("coordinate-out-of-range", [c["rule"] for c in r["changes"]])
        self.assertNotIn("coordinate-out-of-range", [i["rule"] for i in r["after"]["issues"]])
        far = fc(feature({"type": "Polygon", "coordinates": [ring(-90.0000011)]}))
        self.assertFalse([i for i in plotline.validate(far)["issues"] if i["rule"] == "coordinate-out-of-range"][0]["fixable"])
        self.assertNotIn("coordinate-out-of-range", [c["rule"] for c in plotline.fix(far)["changes"]])

    def test_no_repair_promised_for_too_few_positions(self):
        text = fc(feature({"type": "Polygon", "coordinates": [[[1.000001, 1.000001], [1.000001, 1.000001], [1.000002, 1.000002]]]}))
        ring = [i for i in plotline.validate(text)["issues"] if i["rule"] in ("duplicate-vertex", "ring-not-closed")]
        self.assertEqual(sorted(i["rule"] for i in ring), ["duplicate-vertex", "ring-not-closed"])
        self.assertFalse(any(i["fixable"] for i in ring))

    def test_fix_is_idempotent_and_keeps_area(self):
        text = fc(feature({"type": "Polygon", "coordinates": [list(reversed(A))[:-1]]}, {"productionplace": "x", "ProducerCountry": "ci"}))
        once = plotline.fix(text)
        twice = plotline.fix(once["output"])
        self.assertEqual(twice["output"], once["output"])
        self.assertEqual(twice["changes"], [])
        self.assertTrue(math.isclose(once["after"]["summary"]["hectares"], plotline.validate(fc(feature({"type": "Polygon", "coordinates": [A]})))["summary"]["hectares"], rel_tol=1e-12))

    def test_split_within_limits(self):
        feats = [feature({"type": "Polygon", "coordinates": [[[x / 50, 0], [x / 50 + 0.01, 0], [x / 50 + 0.01, 0.01], [x / 50, 0.01], [x / 50, 0]]]}, {"ProductionPlace": "p%d" % x, "ProducerCountry": "CI", "ProducerName": "n%d" % (x % 5)}) for x in range(40)]
        r = plotline.split(fc(*feats), max_bytes=2500)
        self.assertGreater(len(r["parts"]), 1)
        self.assertEqual(sum(p["plots"] for p in r["parts"]), 40)
        for p in r["parts"]:
            self.assertLessEqual(p["bytes"], 2500)
            self.assertEqual(len(p["text"].encode("utf-8")), p["bytes"])

    def test_dds_producers(self):
        plots, _, ok = plotline.read_plots(fc(feature({"type": "Point", "coordinates": [1.000001, 1.000001]}, {"ProducerName": "Ana", "ProducerCountry": "CI"})))
        self.assertTrue(ok)
        p = plotline.to_dds_producers(plots)[0]
        self.assertEqual((p["country"], p["name"], p["plots"]), ("CI", "Ana", 1))
        self.assertIn("FeatureCollection", base64.b64decode(p["geometryGeojson"]).decode("utf-8"))

    def test_dds_country_as_the_grouping_reads_it(self):
        text = fc(feature({"type": "Point", "coordinates": [1.000001, 2.000001]}, {"producercountry": " ci ", "ProducerName": "A"}), feature({"type": "Point", "coordinates": [1.000002, 2.000002]}, {"ProducerCountry": "CI", "ProducerName": "A"}))
        plots, _, _ = plotline.read_plots(text)
        p = plotline.to_dds_producers(plots)
        self.assertEqual([(x["country"], x["name"], x["plots"]) for x in p], [("CI", "A", 2)])

    def test_crs_other_than_wgs84_is_never_rewritten(self):
        text = json.dumps({"type": "FeatureCollection", "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::3857"}}, "features": [feature({"type": "Point", "coordinates": [1, 1]})]})
        self.assertIsNone(plotline.fix(text)["output"])


class Cli(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.dir.name, "plots.geojson")
        with open(self.path, "w", encoding="utf-8") as f:
            f.write((ROOT / "examples" / "plots.geojson").read_text("utf-8"))

    def tearDown(self):
        self.dir.cleanup()

    def run_cli(self, *args):
        buf = io.StringIO()
        with redirect_stdout(buf):
            code = main(list(args))
        return code, buf.getvalue()

    def test_validate_and_fix(self):
        code, out = self.run_cli("validate", self.path)
        self.assertEqual(code, 1)
        self.assertIn("ring-not-closed", out)
        self.assertIn("Plotline by AFKzona Group", out)
        target = os.path.join(self.dir.name, "fixed.geojson")
        code, out = self.run_cli("fix", self.path, "--out", target)
        self.assertEqual(code, 1)
        self.assertEqual(stat.S_IMODE(os.stat(target).st_mode), 0o600)
        with self.assertRaises(SystemExit):
            self.run_cli("fix", self.path, "--out", target)
        with self.assertRaises(SystemExit):
            self.run_cli("fix", self.path, "--out", self.path, "--force")

    def test_json_output(self):
        code, out = self.run_cli("validate", self.path, "--format", "json")
        self.assertIn("AFKzona Group", json.loads(out)["generator"])

    def test_split(self):
        out_dir = os.path.join(self.dir.name, "parts")
        code, _ = self.run_cli("split", self.path, "--out-dir", out_dir)
        self.assertEqual(code, 0)
        self.assertTrue(os.path.exists(os.path.join(out_dir, "part-001.geojson")))
        self.assertTrue(os.path.exists(os.path.join(out_dir, "manifest.json")))

    def test_failures_end_with_the_attribution(self):
        bad = os.path.join(self.dir.name, "bad.geojson")
        with open(bad, "w", encoding="utf-8") as f:
            f.write("{")
        for args in (("fix", bad, "--out", os.path.join(self.dir.name, "o.geojson")), ("split", bad, "--out-dir", os.path.join(self.dir.name, "p"))):
            code, out = self.run_cli(*args)
            self.assertEqual(code, 1)
            self.assertEqual(out.rstrip("\n").split("\n")[-1], "Plotline by AFKzona Group - https://afkzonagroup.lt")
            code, out = self.run_cli(*args, "--format", "json")
            self.assertIn("AFKzona Group", json.loads(out)["generator"])

    def test_never_writes_through_links(self):
        target = os.path.join(self.dir.name, "elsewhere.geojson")
        with open(target, "w", encoding="utf-8") as f:
            f.write("keep")
        link = os.path.join(self.dir.name, "link.geojson")
        os.symlink(target, link)
        with self.assertRaises(SystemExit):
            self.run_cli("fix", self.path, "--out", link, "--force")
        with open(target, encoding="utf-8") as f:
            self.assertEqual(f.read(), "keep")
        real_dir = os.path.join(self.dir.name, "real")
        os.mkdir(real_dir)
        linked_dir = os.path.join(self.dir.name, "linked")
        os.symlink(real_dir, linked_dir)
        with self.assertRaises(SystemExit):
            self.run_cli("split", self.path, "--out-dir", linked_dir)
        self.assertEqual(os.listdir(real_dir), [])

    def test_safe_text(self):
        self.assertEqual(safe_text("a" + chr(27) + "b" + chr(0x202E) + "c\nd"), "a\\u001bb\\u202ec\nd")


class Readme(unittest.TestCase):
    def test_python_example_prints_what_its_comments_say(self):
        readme = (ROOT / "README.md").read_text("utf-8")
        code = re.search(r"<!-- example:python -->\n```python\n(.*?)```", readme, re.S).group(1)
        expected = re.findall(r"print\(.*\)  # (.*)$", code, re.M)
        self.assertGreater(len(expected), 0)
        buf = io.StringIO()
        cwd = os.getcwd()
        os.chdir(ROOT)
        try:
            with redirect_stdout(buf):
                exec(compile(code, "README.md", "exec"), {})  # noqa: S102 -- runs the README example from this repository, not user input
        finally:
            os.chdir(cwd)
        self.assertEqual(buf.getvalue().splitlines(), expected)


if __name__ == "__main__":
    unittest.main()
