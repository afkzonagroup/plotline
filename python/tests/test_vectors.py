# Copyright 2026 MB AFKzona Group
# SPDX-License-Identifier: AGPL-3.0-only
"""The shared test vectors: the Python package must reproduce, exactly, the
results the TypeScript package gives (test-vectors/cases.json)."""
import json
import math
import pathlib
import unittest

import plotline

ROOT = pathlib.Path(__file__).resolve().parents[2]
INPUTS = json.loads((ROOT / "test-vectors" / "cases-input.json").read_text("utf-8"))["cases"]
EXPECTED = {c["name"]: c["expected"] for c in json.loads((ROOT / "test-vectors" / "cases.json").read_text("utf-8"))["cases"]}


def brief(issues):
    return [{"rule": i["rule"], "severity": i["severity"], "path": i["path"], "feature": i["feature"]} for i in issues]


class SharedVectors(unittest.TestCase):
    def test_every_input_has_expectations(self):
        self.assertEqual([c["name"] for c in INPUTS], list(EXPECTED))
        self.assertGreater(len(INPUTS), 90)

    def test_cases(self):
        for case in INPUTS:
            with self.subTest(case["name"]):
                exp = EXPECTED[case["name"]]
                opts = dict(case["options"], input_format=case["format"])
                report = plotline.validate(case["input"], **opts)
                self.assertEqual(brief(report["issues"]), exp["issues"])
                self.assertEqual(len(report["plots"]), len(exp["hectares"]))
                for got, want in zip((p["hectares"] for p in report["plots"]), exp["hectares"]):
                    if want is None:
                        self.assertIsNone(got)
                    else:
                        self.assertTrue(math.isclose(got, want, rel_tol=1e-9, abs_tol=1e-12), (got, want))
                fixed = plotline.fix(case["input"], **opts)
                self.assertEqual(fixed["output"], exp["output"])
                self.assertEqual([{"rule": c["rule"], "path": c["path"], "feature": c["feature"]} for c in fixed["changes"]], exp["changes"])
                self.assertEqual(None if fixed["after"] is None else brief(fixed["after"]["issues"]), exp["after"])


if __name__ == "__main__":
    unittest.main()
