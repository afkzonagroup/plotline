# Copyright 2026 MB AFKzona Group
# SPDX-License-Identifier: AGPL-3.0-only
"""Command line: plotline-py validate|fix|split <file> (python -m plotline)."""
import argparse
import json
import os
import re
import stat
import sys

from . import ATTRIBUTION, ATTRIBUTION_URL, COMMODITIES, DEFAULT_LIMITS, GENERATOR, fix, split, validate

FOOTER = "%s - %s" % (ATTRIBUTION, ATTRIBUTION_URL)
_UNSAFE = re.compile("[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]")


def safe_text(text):
    """Escapes control and bidirectional characters for the terminal."""
    return _UNSAFE.sub(lambda m: "\\u%04x" % ord(m.group(0)), text)


def _read(path, max_bytes):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NONBLOCK", 0))
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode):
            raise SystemExit("plotline: %s is not a regular file." % json.dumps(path))
        if info.st_size > max_bytes:
            raise SystemExit("plotline: %s is larger than %d bytes." % (json.dumps(path), max_bytes))
        chunks = []
        total = 0
        while True:
            b = os.read(fd, 1 << 20)
            if not b:
                break
            total += len(b)
            if total > max_bytes:
                raise SystemExit("plotline: %s is larger than %d bytes." % (json.dumps(path), max_bytes))
            chunks.append(b)
        return b"".join(chunks)
    finally:
        os.close(fd)


def _write(path, text, force):
    flags = os.O_WRONLY | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0) | (os.O_TRUNC if force else os.O_EXCL)
    try:
        fd = os.open(path, flags, 0o600)
    except FileExistsError:
        raise SystemExit("plotline: %s exists. Use --force to overwrite it." % json.dumps(path))
    except OSError:
        raise SystemExit("plotline: cannot write %s." % json.dumps(path))
    with os.fdopen(fd, "w", encoding="utf-8", newline="") as f:
        f.write(text)


def _print_issues(issues, out):
    labels = {"error": "ERROR  ", "warning": "WARNING", "info": "NOTE   "}
    for i in issues:
        where = "file" if i["feature"] is None else "feature %d" % i["feature"]
        out.write(safe_text("  %s %s  %s  %s\n           %s\n" % (labels[i["severity"]], i["rule"], where, i["path"], i["message"])))


def main(argv=None):
    p = argparse.ArgumentParser(prog="plotline-py", description="Geolocation files for the EU Deforestation Regulation (EU) 2023/1115. " + FOOTER)
    p.add_argument("command", choices=["validate", "fix", "split"])
    p.add_argument("file")
    p.add_argument("--out", "-o")
    p.add_argument("--out-dir", "-d")
    p.add_argument("--force", action="store_true")
    p.add_argument("--format", choices=["text", "json"], default="text")
    p.add_argument("--commodity", choices=[c.replace(" ", "-") for c in COMMODITIES])
    p.add_argument("--variant", choices=["type-i", "type-ii"], default="type-i")
    p.add_argument("--country")
    p.add_argument("--max-bytes", type=int)
    p.add_argument("--max-producers", type=int)
    p.add_argument("--max-input-bytes", type=int, default=DEFAULT_LIMITS["maxInputBytes"])
    a = p.parse_args(argv)
    out = sys.stdout
    data = _read(a.file, a.max_input_bytes)
    opts = {
        "name": a.file,
        "commodity": None if a.commodity is None else a.commodity.replace("-", " "),
        "variant": a.variant,
        "max_bytes": a.max_bytes,
        "max_producers": a.max_producers,
        "limits": {"maxInputBytes": a.max_input_bytes},
    }
    if a.command == "validate":
        r = validate(data, **opts)
        if a.format == "json":
            out.write(json.dumps({"generator": GENERATOR, "ok": r["ok"], "files": [{"file": a.file, "report": r}]}, indent=2, ensure_ascii=False) + "\n")
        else:
            s = r["summary"]
            out.write(safe_text("%s: %s - %d error(s), %d warning(s), %d note(s)\n" % (a.file, "OK" if r["ok"] else "FAILED", s["errors"], s["warnings"], s["infos"])))
            _print_issues(r["issues"], out)
            out.write(FOOTER + "\n")
        return 0 if r["ok"] else 1
    if a.command == "fix":
        if not a.out:
            raise SystemExit("plotline: fix needs --out <file>.")
        if os.path.exists(a.out) and os.path.samefile(a.out, a.file):
            raise SystemExit("plotline: --out must not be the input file.")
        try:
            r = fix(data, country=a.country, **opts)
        except ValueError as e:
            raise SystemExit("plotline: %s." % e)
        if r["output"] is None:
            if a.format == "json":
                out.write(json.dumps({"generator": GENERATOR, "file": a.file, "written": None, "changes": [], "before": r["before"], "after": None}, indent=2, ensure_ascii=False) + "\n")
            else:
                out.write(safe_text("%s: cannot be repaired\n" % a.file))
                _print_issues(r["before"]["issues"], out)
                out.write(FOOTER + "\n")
            return 1
        _write(a.out, r["output"], a.force)
        if a.format == "json":
            out.write(json.dumps({"generator": GENERATOR, "file": a.file, "written": a.out, "changes": r["changes"], "before": r["before"], "after": r["after"]}, indent=2, ensure_ascii=False) + "\n")
        else:
            out.write(safe_text("%s -> %s: %d change(s)\n" % (a.file, a.out, len(r["changes"]))))
            for c in r["changes"]:
                out.write(safe_text("  CHANGED %s  %s\n          %s\n" % (c["rule"], c["path"], c["message"])))
            _print_issues(r["after"]["issues"], out)
            out.write(FOOTER + "\n")
        return 0 if r["after"]["ok"] else 1
    if not a.out_dir:
        raise SystemExit("plotline: split needs --out-dir <dir>.")
    r = split(data, **opts)
    if not r["parts"]:
        if a.format == "json":
            out.write(json.dumps({"generator": GENERATOR, "source": a.file, "parts": [], "before": r["before"]}, indent=2, ensure_ascii=False) + "\n")
        else:
            out.write(safe_text("%s: nothing to split\n" % a.file))
            _print_issues(r["before"]["issues"], out)
            out.write(FOOTER + "\n")
        return 1
    if os.path.islink(a.out_dir):
        raise SystemExit("plotline: %s is a symbolic link; Plotline does not write through links." % json.dumps(a.out_dir))
    os.makedirs(a.out_dir, mode=0o700, exist_ok=True)
    for part in r["parts"]:
        _write(os.path.join(a.out_dir, part["name"]), part["text"], a.force)
    manifest = {"generator": GENERATOR, "source": a.file, "parts": [{k: v for k, v in part.items() if k != "text"} for part in r["parts"]], "oversized": r["oversized"], "spreadProducers": r["spread_producers"], "changes": r["changes"]}
    _write(os.path.join(a.out_dir, "manifest.json"), json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", a.force)
    out.write(safe_text("%s -> %s: %d part(s)\n" % (a.file, a.out_dir, len(r["parts"]))))
    out.write(FOOTER + "\n")
    return 1 if r["oversized"] else 0


if __name__ == "__main__":
    sys.exit(main())
