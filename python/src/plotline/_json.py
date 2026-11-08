# Copyright 2026 MB AFKzona Group
# SPDX-License-Identifier: AGPL-3.0-only
"""Strict JSON parsing for untrusted input (mirror of src/core/json.ts).

Values: None, True, False, JNum (exact source text + float), str, list and
dict (insertion order kept). Duplicate member names, lone surrogates,
NaN/Infinity and numbers out of range are rejected; depth, value count,
string and number lengths are limited. Parsing is iterative, so deep
nesting cannot exhaust the stack.
"""
import json as _json
import re

__all__ = ["JNum", "JsonError", "parse_json", "quote_json", "stringify_json"]


class JNum:
    """A JSON number with its exact source text."""

    __slots__ = ("raw", "value")

    def __init__(self, raw, value):
        self.raw = raw
        self.value = value

    def __eq__(self, other):
        return isinstance(other, JNum) and other.raw == self.raw

    def __hash__(self):
        return hash(self.raw)

    def __repr__(self):
        return "JNum(%s)" % self.raw


class JsonError(Exception):
    """kind is "syntax", "limit" or "duplicate-key"."""

    def __init__(self, kind, message, offset):
        super().__init__(message)
        self.kind = kind
        self.message = message
        self.offset = offset


_TOKEN = re.compile(
    r'[ \t\n\r]*(?:'
    r'(?P<str>"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*")'
    r'|(?P<num>-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)'
    r'|(?P<lit>true|false|null)'
    r'|(?P<punct>[{}\[\],:])'
    r')'
)
_WS = re.compile(r"[ \t\n\r]*")
_SURROGATE = re.compile("[\ud800-\udfff]")


def _utf16_len(s):
    return len(s) + sum(1 for c in s if ord(c) > 0xFFFF)


def line_column(text, offset):
    end = min(offset, len(text))
    line = text.count("\n", 0, end) + 1
    last = text.rfind("\n", 0, end)
    return line, end - last


def parse_json(text, limits):
    """Parses text; raises JsonError. limits: dict with maxDepth, maxValues, maxStringLength, maxNumberLength."""
    max_depth = limits["maxDepth"]
    max_values = limits["maxValues"]
    max_string = limits["maxStringLength"]
    max_number = limits["maxNumberLength"]
    n = len(text)
    pos = 0
    count = 0
    stack = []  # entries: [list] or [dict, key, key_offset]

    def token(expect_value):
        nonlocal pos
        m = _TOKEN.match(text, pos)
        if m is None or m.end() == m.start() and pos < n:
            ws = _WS.match(text, pos).end()
            if ws >= n:
                raise JsonError("syntax", "unexpected end of input", ws)
            ch = text[ws]
            if ch == '"':
                raise JsonError("syntax", "invalid or unterminated string", ws)
            raise JsonError("syntax", "unexpected character %s" % _json.dumps(ch), ws)
        if m.lastgroup is None:
            raise JsonError("syntax", "unexpected end of input", m.end())
        start = m.start(m.lastgroup)
        pos = m.end()
        return m.lastgroup, m.group(m.lastgroup), start

    def read_string(raw, start):
        if len(raw) > max_string * 6 + 2:
            raise JsonError("limit", "string longer than %d characters" % max_string, start)
        s = _json.loads(raw)
        if _utf16_len(s) > max_string:
            raise JsonError("limit", "string longer than %d characters" % max_string, start)
        if _SURROGATE.search(s):
            raise JsonError("syntax", "string contains an unpaired surrogate (not allowed by I-JSON, RFC 7493)", start)
        return s

    def count_value(at):
        nonlocal count
        count += 1
        if count > max_values:
            raise JsonError("limit", "more than %d values" % max_values, at)

    def read_key(frame):
        kind, raw, start = token(False)
        if kind != "str":
            raise JsonError("syntax", "expected a member name", start)
        frame[1] = read_string(raw, start)
        frame[2] = start
        kind, raw, start = token(False)
        if raw != ":":
            raise JsonError("syntax", 'expected ":"', start)

    while True:
        kind, raw, start = token(True)
        if kind == "punct" and raw in "{[":
            if len(stack) + 1 > max_depth:
                raise JsonError("limit", "nesting deeper than %d levels" % max_depth, start)
            count_value(start)
            close = "}" if raw == "{" else "]"
            m = _WS.match(text, pos)
            if m.end() < n and text[m.end()] == close:
                pos = m.end() + 1
                value = {} if raw == "{" else []
            elif raw == "{":
                frame = [{}, "", 0]
                stack.append(frame)
                read_key(frame)
                continue
            else:
                stack.append([[]])
                continue
        elif kind == "str":
            count_value(start)
            value = read_string(raw, start)
        elif kind == "num":
            count_value(start)
            if len(raw) > max_number:
                raise JsonError("limit", "number longer than %d characters" % max_number, start)
            try:
                f = float(raw)
            except (OverflowError, ValueError):
                f = float("inf")
            if f != f or f in (float("inf"), float("-inf")):
                raise JsonError("syntax", "number out of range", start)
            # The regex can stop inside a longer token such as "1x": the next token check catches it.
            value = JNum(raw, f)
        elif kind == "lit":
            count_value(start)
            value = True if raw == "true" else False if raw == "false" else None
        else:
            raise JsonError("syntax", "expected a value", start)

        while True:
            if not stack:
                m = _WS.match(text, pos)
                if m.end() != n:
                    raise JsonError("syntax", "unexpected character after the JSON value", m.end())
                return value
            top = stack[-1]
            if len(top) == 1:
                top[0].append(value)
                kind2, raw2, start2 = token(False)
                if raw2 == ",":
                    break
                if raw2 == "]":
                    stack.pop()
                    value = top[0]
                    continue
                raise JsonError("syntax", 'expected "," or "]"', start2)
            obj, key, key_offset = top
            if key in obj:
                raise JsonError("duplicate-key", "duplicate member name %s" % _json.dumps(key), key_offset)
            obj[key] = value
            kind2, raw2, start2 = token(False)
            if raw2 == ",":
                read_key(top)
                break
            if raw2 == "}":
                stack.pop()
                value = obj
                continue
            raise JsonError("syntax", 'expected "," or "}"', start2)


def quote_json(s):
    """JSON string text, escaping as the TypeScript implementation does."""
    out = ['"']
    for c in s:
        o = ord(c)
        if c == '"':
            out.append('\\"')
        elif c == "\\":
            out.append("\\\\")
        elif c == "\n":
            out.append("\\n")
        elif c == "\r":
            out.append("\\r")
        elif c == "\t":
            out.append("\\t")
        elif c == "\b":
            out.append("\\b")
        elif c == "\f":
            out.append("\\f")
        elif o < 0x20 or 0x7F <= o <= 0x9F or o in (0x2028, 0x2029):
            out.append("\\u%04x" % o)
        else:
            out.append(c)
    out.append('"')
    return "".join(out)


def stringify_json(value):
    """Compact JSON text keeping number text and member order (iterative)."""
    parts = []
    work = [value]
    while work:
        item = work.pop()
        if isinstance(item, _Raw):
            parts.append(item.text)
        elif item is None:
            parts.append("null")
        elif item is True:
            parts.append("true")
        elif item is False:
            parts.append("false")
        elif isinstance(item, JNum):
            parts.append(item.raw)
        elif isinstance(item, str):
            parts.append(quote_json(item))
        elif isinstance(item, list):
            parts.append("[")
            work.append(_Raw("]"))
            for i in range(len(item) - 1, -1, -1):
                work.append(item[i])
                if i > 0:
                    work.append(_Raw(","))
        elif isinstance(item, dict):
            parts.append("{")
            work.append(_Raw("}"))
            entries = list(item.items())
            for i in range(len(entries) - 1, -1, -1):
                k, v = entries[i]
                work.append(v)
                work.append(_Raw(quote_json(k) + ":"))
                if i > 0:
                    work.append(_Raw(","))
        else:
            raise TypeError("not a JSON value")
    return "".join(parts)


class _Raw:
    __slots__ = ("text",)

    def __init__(self, text):
        self.text = text
