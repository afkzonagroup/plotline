// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { lineColumn, parseJson, quoteJson, stringifyJson, type JsonValue } from '../src/core/json.js';
import { DEFAULT_LIMITS } from '../src/core/limits.js';

const ok = (text: string, limits = DEFAULT_LIMITS): JsonValue => {
  const r = parseJson(text, limits);
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};
const fail = (text: string, limits = DEFAULT_LIMITS): { kind: string; message: string; line: number; column: number } => {
  const r = parseJson(text, limits);
  if (r.ok) throw new Error(`accepted ${text}`);
  return r.error;
};

describe('parseJson', () => {
  it('parses every value type and keeps number text and member order', () => {
    const v = ok(' {"b":[1.50,-0,1e-7,true,false,null,"x\\u00e9\\n"],"a":{}} ');
    expect(stringifyJson(v)).toBe('{"b":[1.50,-0,1e-7,true,false,null,"xé\\n"],"a":{}}');
    if (v.kind !== 'object') throw new Error('object expected');
    expect([...v.entries.keys()]).toEqual(['b', 'a']);
  });

  it('decodes surrogate pairs and rejects unpaired surrogates (RFC 7493)', () => {
    expect(ok('"\\ud83c\\udf31"')).toEqual({ kind: 'string', value: '\u{1F331}' });
    expect(fail('"\\ud800"').kind).toBe('syntax');
    expect(fail('"\\udc00x"').kind).toBe('syntax');
  });

  it.each([
    ['', 'syntax'],
    ['{', 'syntax'],
    ['[1,]', 'syntax'],
    ['[1 2]', 'syntax'],
    ['{"a" 1}', 'syntax'],
    ['{"a":1,}', 'syntax'],
    ['{a:1}', 'syntax'],
    ['[01]', 'syntax'],
    ['[1.]', 'syntax'],
    ['[.5]', 'syntax'],
    ['[-]', 'syntax'],
    ['[+1]', 'syntax'],
    ['[NaN]', 'syntax'],
    ['[Infinity]', 'syntax'],
    ['[1e400]', 'syntax'],
    ['[-1e400]', 'syntax'],
    ["['a']", 'syntax'],
    ['"a\tb"', 'syntax'],
    ['"\\x41"', 'syntax'],
    ['"\\u12"', 'syntax'],
    ['[1]x', 'syntax'],
    ['[1] [2]', 'syntax'],
    ['tru', 'syntax'],
    ['{"a":1,"a":2}', 'duplicate-key'],
  ])('rejects %j (%s)', (text, kind) => {
    expect(fail(text).kind).toBe(kind);
  });

  it('reports line and column', () => {
    const e = fail('{\n  "a": [1,\n  ]\n}');
    expect(e.line).toBe(3);
    expect(e.column).toBe(3);
    expect(lineColumn('ab\ncd', 4)).toEqual({ line: 2, column: 2 });
  });

  it('enforces the depth limit without recursion, even for a million levels', () => {
    expect(fail('['.repeat(65) + ']'.repeat(65)).kind).toBe('limit');
    expect(ok('['.repeat(64) + ']'.repeat(64)).kind).toBe('array');
    const deep = '['.repeat(1_000_000);
    expect(fail(deep, { ...DEFAULT_LIMITS, maxDepth: 2_000_000 }).kind).toBe('syntax');
    expect(fail(deep).kind).toBe('limit');
  });

  it('enforces value, string and number length limits', () => {
    const limits = { ...DEFAULT_LIMITS, maxValues: 4, maxStringLength: 5, maxNumberLength: 6 };
    expect(ok('[1,2,3]', limits).kind).toBe('array');
    expect(fail('[1,2,3,4]', limits).kind).toBe('limit');
    expect(ok('"abcde"', limits).kind).toBe('string');
    expect(fail('"abcdef"', limits).kind).toBe('limit');
    expect(fail(`"${'\\u0041'.repeat(6)}"`, limits).kind).toBe('limit');
    expect(ok('1.2345', limits).kind).toBe('number');
    expect(fail('1.23456', limits).kind).toBe('limit');
  });

  it('keeps "__proto__" and "constructor" as plain data', () => {
    const v = ok('{"__proto__":{"polluted":true},"constructor":{"prototype":{"x":1}}}');
    if (v.kind !== 'object') throw new Error('object expected');
    expect([...v.entries.keys()]).toEqual(['__proto__', 'constructor']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('polluted');
  });
});

describe('quoteJson', () => {
  it('escapes quotes, backslashes, control characters and line separators', () => {
    const s = ['a"b\\c\n\r\t\b\f', String.fromCharCode(1), String.fromCharCode(0x7f), String.fromCharCode(0x85), String.fromCharCode(0x2028), String.fromCharCode(0x2029), 'é'].join('');
    expect(quoteJson(s)).toBe('"a\\"b\\\\c\\n\\r\\t\\b\\f\\u0001\\u007f\\u0085\\u2028\\u2029é"');
    expect(JSON.parse(quoteJson(s))).toBe(s);
  });

  it('round-trips through the parser', () => {
    const s = 'x</script><!--\u{1F331}';
    expect(ok(quoteJson(s))).toEqual({ kind: 'string', value: s });
  });
});
