// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// A strict, iterative JSON parser (RFC 8259) for untrusted input. It never
// recurses, so deep nesting cannot overflow the stack; it enforces size,
// depth, value-count, string and number limits; it rejects duplicate object
// keys and lone surrogates (I-JSON, RFC 7493 section 2); it keeps the exact
// text of every number, so decimal places can be checked; and it builds plain
// tagged values in Maps, never JavaScript objects, so keys such as
// "__proto__" or "constructor" are only data.

import type { Limits } from './limits.js';

/** JSON null. */
export interface JsonNull {
  readonly kind: 'null';
}
/** JSON true or false. */
export interface JsonBoolean {
  readonly kind: 'boolean';
  readonly value: boolean;
}
/** A JSON number with its exact source text. */
export interface JsonNumber {
  readonly kind: 'number';
  /** Source text, for example "-49.004616". */
  readonly raw: string;
  /** The nearest double. Always finite. */
  readonly value: number;
}
/** A JSON string. */
export interface JsonString {
  readonly kind: 'string';
  readonly value: string;
}
/** A JSON array. */
export interface JsonArray {
  readonly kind: 'array';
  readonly items: readonly JsonValue[];
}
/** A JSON object; member order is kept. */
export interface JsonObject {
  readonly kind: 'object';
  readonly entries: ReadonlyMap<string, JsonValue>;
}
/** Any JSON value. */
export type JsonValue = JsonNull | JsonBoolean | JsonNumber | JsonString | JsonArray | JsonObject;

/** Why parsing failed. */
export type JsonErrorKind = 'syntax' | 'limit' | 'duplicate-key';

/** A parse failure with its position. */
export interface JsonError {
  readonly kind: JsonErrorKind;
  readonly message: string;
  /** Offset in UTF-16 code units. */
  readonly offset: number;
  /** 1-based line. */
  readonly line: number;
  /** 1-based column. */
  readonly column: number;
}

/** Result of {@link parseJson}. */
export type JsonResult = { readonly ok: true; readonly value: JsonValue } | { readonly ok: false; readonly error: JsonError };

/** Limits that the parser uses. */
export type JsonLimits = Pick<Limits, 'maxDepth' | 'maxValues' | 'maxStringLength' | 'maxNumberLength'>;

class Failure extends Error {
  constructor(
    readonly kind: JsonErrorKind,
    message: string,
    readonly offset: number,
  ) {
    super(message);
  }
}

const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
const LONE_SURROGATE = /[\uD800-\uDFFF]/u;
const NULL: JsonNull = Object.freeze({ kind: 'null' });
const TRUE: JsonBoolean = Object.freeze({ kind: 'boolean', value: true });
const FALSE: JsonBoolean = Object.freeze({ kind: 'boolean', value: false });

interface ArrayFrame {
  readonly kind: 'array';
  readonly items: JsonValue[];
}
interface ObjectFrame {
  readonly kind: 'object';
  readonly entries: Map<string, JsonValue>;
  key: string;
  keyOffset: number;
}

/** Line and column (1-based) of an offset. */
export function lineColumn(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let last = -1;
  const end = Math.min(offset, text.length);
  for (let i = 0; i < end; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      last = i;
    }
  }
  return { line, column: end - last };
}

/**
 * Parses JSON text under the given limits.
 *
 * @example
 * const r = parseJson('{"a":1.50}', DEFAULT_LIMITS);
 * // r.ok === true; the number keeps its text "1.50"
 */
export function parseJson(text: string, limits: JsonLimits): JsonResult {
  try {
    return { ok: true, value: parse(text, limits) };
  } catch (e) {
    if (e instanceof Failure) {
      const { line, column } = lineColumn(text, e.offset);
      return { ok: false, error: { kind: e.kind, message: e.message, offset: e.offset, line, column } };
    }
    throw e;
  }
}

function parse(text: string, limits: JsonLimits): JsonValue {
  const n = text.length;
  let pos = 0;
  let count = 0;
  const stack: (ArrayFrame | ObjectFrame)[] = [];

  const skipWs = (): void => {
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09) pos++;
      else break;
    }
  };

  const describe = (): string => (pos >= n ? 'end of input' : `character ${JSON.stringify(text.charAt(pos))}`);

  const readString = (): string => {
    // pos is at the opening quote.
    const start = pos;
    pos++;
    let out = '';
    let chunk = pos;
    for (;;) {
      if (pos >= n) throw new Failure('syntax', 'unterminated string', start);
      const c = text.charCodeAt(pos);
      if (c === 0x22) {
        out += text.slice(chunk, pos);
        pos++;
        break;
      }
      if (c < 0x20) throw new Failure('syntax', 'control character in string', pos);
      if (c === 0x5c) {
        out += text.slice(chunk, pos);
        const e = text.charCodeAt(pos + 1);
        switch (e) {
          case 0x22: out += '"'; pos += 2; break;
          case 0x5c: out += '\\'; pos += 2; break;
          case 0x2f: out += '/'; pos += 2; break;
          case 0x62: out += '\b'; pos += 2; break;
          case 0x66: out += '\f'; pos += 2; break;
          case 0x6e: out += '\n'; pos += 2; break;
          case 0x72: out += '\r'; pos += 2; break;
          case 0x74: out += '\t'; pos += 2; break;
          case 0x75: {
            const hex = text.slice(pos + 2, pos + 6);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Failure('syntax', 'invalid \\u escape', pos);
            out += String.fromCharCode(parseInt(hex, 16));
            pos += 6;
            break;
          }
          default:
            throw new Failure('syntax', 'invalid escape in string', pos);
        }
        chunk = pos;
      } else {
        pos++;
      }
      if (pos - start > limits.maxStringLength * 6 + 2) throw new Failure('limit', `string longer than ${limits.maxStringLength} characters`, start);
    }
    if (out.length > limits.maxStringLength) throw new Failure('limit', `string longer than ${limits.maxStringLength} characters`, start);
    if (LONE_SURROGATE.test(out)) throw new Failure('syntax', 'string contains an unpaired surrogate (not allowed by I-JSON, RFC 7493)', start);
    return out;
  };

  const readKey = (frame: ObjectFrame): void => {
    skipWs();
    if (text.charCodeAt(pos) !== 0x22) throw new Failure('syntax', `expected a member name, found ${describe()}`, pos);
    frame.keyOffset = pos;
    frame.key = readString();
    skipWs();
    if (text.charCodeAt(pos) !== 0x3a) throw new Failure('syntax', `expected ":", found ${describe()}`, pos);
    pos++;
  };

  const enter = (): void => {
    if (stack.length + 1 > limits.maxDepth) throw new Failure('limit', `nesting deeper than ${limits.maxDepth} levels`, pos);
  };

  const countValue = (): void => {
    count++;
    if (count > limits.maxValues) throw new Failure('limit', `more than ${limits.maxValues} values`, pos);
  };

  for (;;) {
    skipWs();
    let value: JsonValue;
    const c = text.charCodeAt(pos);
    if (c === 0x7b) {
      enter();
      countValue();
      pos++;
      skipWs();
      if (text.charCodeAt(pos) === 0x7d) {
        pos++;
        value = { kind: 'object', entries: new Map() };
      } else {
        const frame: ObjectFrame = { kind: 'object', entries: new Map(), key: '', keyOffset: pos };
        stack.push(frame);
        readKey(frame);
        continue;
      }
    } else if (c === 0x5b) {
      enter();
      countValue();
      pos++;
      skipWs();
      if (text.charCodeAt(pos) === 0x5d) {
        pos++;
        value = { kind: 'array', items: [] };
      } else {
        stack.push({ kind: 'array', items: [] });
        continue;
      }
    } else if (c === 0x22) {
      countValue();
      value = { kind: 'string', value: readString() };
    } else if (c === 0x2d || (c >= 0x30 && c <= 0x39)) {
      countValue();
      NUMBER.lastIndex = pos;
      const m = NUMBER.exec(text);
      if (m === null) throw new Failure('syntax', 'invalid number', pos);
      const raw = m[0];
      if (raw.length > limits.maxNumberLength) throw new Failure('limit', `number longer than ${limits.maxNumberLength} characters`, pos);
      const num = Number(raw);
      if (!Number.isFinite(num)) throw new Failure('syntax', 'number out of range', pos);
      pos += raw.length;
      value = { kind: 'number', raw, value: num };
    } else if (text.startsWith('true', pos)) {
      countValue();
      pos += 4;
      value = TRUE;
    } else if (text.startsWith('false', pos)) {
      countValue();
      pos += 5;
      value = FALSE;
    } else if (text.startsWith('null', pos)) {
      countValue();
      pos += 4;
      value = NULL;
    } else {
      throw new Failure('syntax', `expected a value, found ${describe()}`, pos);
    }

    // Attach the finished value to its parent, closing containers as needed.
    for (;;) {
      const top = stack[stack.length - 1];
      if (top === undefined) {
        skipWs();
        if (pos !== n) throw new Failure('syntax', `unexpected ${describe()} after the JSON value`, pos);
        return value;
      }
      if (top.kind === 'array') {
        top.items.push(value);
        skipWs();
        const d = text.charCodeAt(pos);
        if (d === 0x2c) {
          pos++;
          break;
        }
        if (d === 0x5d) {
          pos++;
          stack.pop();
          value = { kind: 'array', items: top.items };
          continue;
        }
        throw new Failure('syntax', `expected "," or "]", found ${describe()}`, pos);
      }
      if (top.entries.has(top.key)) throw new Failure('duplicate-key', `duplicate member name ${JSON.stringify(top.key)}`, top.keyOffset);
      top.entries.set(top.key, value);
      skipWs();
      const d = text.charCodeAt(pos);
      if (d === 0x2c) {
        pos++;
        readKey(top);
        break;
      }
      if (d === 0x7d) {
        pos++;
        stack.pop();
        value = { kind: 'object', entries: top.entries };
        continue;
      }
      throw new Failure('syntax', `expected "," or "}", found ${describe()}`, pos);
    }
  }
}

/**
 * Serialises a string as JSON. Escapes the characters JSON requires plus
 * U+007F–U+009F, U+2028 and U+2029, so output is safe to embed in
 * JavaScript and to show in terminals. The Python package uses the same
 * rules, so both write identical bytes.
 */
export function quoteJson(s: string): string {
  let out = '"';
  let chunk = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    let rep: string | null = null;
    if (c === 0x22) rep = '\\"';
    else if (c === 0x5c) rep = '\\\\';
    else if (c === 0x0a) rep = '\\n';
    else if (c === 0x0d) rep = '\\r';
    else if (c === 0x09) rep = '\\t';
    else if (c === 0x08) rep = '\\b';
    else if (c === 0x0c) rep = '\\f';
    else if (c < 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029) rep = `\\u${c.toString(16).padStart(4, '0')}`;
    if (rep !== null) {
      out += s.slice(chunk, i) + rep;
      chunk = i + 1;
    }
  }
  return `${out}${s.slice(chunk)}"`;
}

/** Serialises a parsed value compactly, keeping number text and member order. */
export function stringifyJson(value: JsonValue): string {
  const parts: string[] = [];
  // Iterative, mirroring the parser: deep values cannot overflow the stack.
  const work: (JsonValue | string)[] = [value];
  while (work.length > 0) {
    const item = work.pop();
    if (item === undefined) break;
    if (typeof item === 'string') {
      parts.push(item);
      continue;
    }
    switch (item.kind) {
      case 'null':
        parts.push('null');
        break;
      case 'boolean':
        parts.push(item.value ? 'true' : 'false');
        break;
      case 'number':
        parts.push(item.raw);
        break;
      case 'string':
        parts.push(quoteJson(item.value));
        break;
      case 'array': {
        parts.push('[');
        work.push(']');
        for (let i = item.items.length - 1; i >= 0; i--) {
          work.push(item.items[i] as JsonValue);
          if (i > 0) work.push(',');
        }
        break;
      }
      case 'object': {
        parts.push('{');
        work.push('}');
        const entries = [...item.entries];
        for (let i = entries.length - 1; i >= 0; i--) {
          const [k, v] = entries[i] as [string, JsonValue];
          work.push(v);
          work.push(`${quoteJson(k)}:`);
          if (i > 0) work.push(',');
        }
        break;
      }
    }
  }
  return parts.join('');
}
