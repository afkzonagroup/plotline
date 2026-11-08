// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// Splits plots into files that each fit the Information System's limits:
// at most `maxBytes` of GeoJSON and at most `maxProducers` producers
// (distinct ProducerName and ProducerCountry). A producer's plots stay in
// one part whenever they fit. Each part becomes its own due diligence
// statement; Article 8a of Implementing Regulation (EU) 2024/3084, as
// amended by (EU) 2026/1565, lets operators then group those statements.

import type { Plot } from './model.js';
import { producerKey } from './validate.js';
import { utf8Length, writeFeature } from './write.js';

/** Options for {@link splitPlots}. */
export interface SplitLimits {
  readonly maxBytes: number;
  readonly maxProducers: number;
}

/** One part. */
export interface SplitPart {
  /** 1-based part number. */
  readonly part: number;
  /** Indexes of the plots (in the list given to the splitter) in this part. */
  readonly plots: readonly number[];
  readonly producers: number;
  /** Exact size of the part's GeoJSON in bytes. */
  readonly bytes: number;
}

/** Result of splitting. */
export interface SplitResult {
  readonly parts: SplitPart[];
  /** Plots too large to fit any part on their own (each is placed alone). */
  readonly oversized: number[];
  /** Producers whose plots had to be spread over more than one part. */
  readonly spreadProducers: number;
}

const HEAD = utf8Length('{"type":"FeatureCollection","features":[\n');
const TAIL = utf8Length('\n]}\n');
const SEP = utf8Length(',\n');
const EMPTY = utf8Length('{"type":"FeatureCollection","features":[]}\n');

/** Splits plots into parts within the limits. */
export function splitPlots(plots: readonly Plot[], limits: SplitLimits): SplitResult {
  if (!Number.isSafeInteger(limits.maxBytes) || limits.maxBytes < EMPTY + 16) throw new RangeError('maxBytes is too small');
  if (!Number.isSafeInteger(limits.maxProducers) || limits.maxProducers < 1) throw new RangeError('maxProducers must be at least 1');
  const sizes = plots.map((p) => utf8Length(writeFeature(p)));
  const groups = new Map<string, number[]>();
  plots.forEach((p, i) => {
    const key = producerKey(p.properties);
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [i]);
    else list.push(i);
  });

  interface Part {
    readonly plots: number[];
    readonly producers: Set<string>;
    bytes: number;
  }
  const parts: Part[] = [];
  const oversized: number[] = [];
  let spread = 0;
  const open = (): Part => {
    const p: Part = { plots: [], producers: new Set(), bytes: HEAD + TAIL };
    parts.push(p);
    return p;
  };
  const add = (part: Part, i: number, key: string): void => {
    part.bytes += (part.plots.length > 0 ? SEP : 0) + (sizes[i] as number);
    part.plots.push(i);
    part.producers.add(key);
  };

  for (const [key, members] of groups) {
    const groupBytes = members.reduce((sum, i) => sum + (sizes[i] as number), 0) + SEP * (members.length - 1);
    let part = parts[parts.length - 1] ?? open();
    const extra = groupBytes + (part.plots.length > 0 ? SEP : 0);
    if ((part.bytes + extra > limits.maxBytes || part.producers.size + 1 > limits.maxProducers) && part.plots.length > 0) part = open();
    if (part.bytes + groupBytes <= limits.maxBytes) {
      for (const i of members) add(part, i, key);
      continue;
    }
    // The producer's plots do not fit in one part: spread them.
    spread++;
    for (const i of members) {
      const size = sizes[i] as number;
      if (HEAD + TAIL + size > limits.maxBytes) {
        oversized.push(i);
        if (part.plots.length > 0) part = open();
        add(part, i, key);
        part = open();
        continue;
      }
      const full = part.bytes + size + (part.plots.length > 0 ? SEP : 0) > limits.maxBytes;
      const tooMany = !part.producers.has(key) && part.producers.size + 1 > limits.maxProducers;
      if (full || tooMany) part = open();
      add(part, i, key);
    }
  }
  const nonEmpty = parts.filter((p) => p.plots.length > 0);
  return {
    parts: nonEmpty.map((p, i) => ({ part: i + 1, plots: p.plots, producers: p.producers.size, bytes: p.bytes })),
    oversized,
    spreadProducers: spread,
  };
}
