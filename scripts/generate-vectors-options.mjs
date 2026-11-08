// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// Option names of the shared test vectors (Python style) mapped to the
// TypeScript API. Used by scripts/generate-vectors.mjs and test/vectors.test.ts.

/** Maps the case options (Python names) to TypeScript options. */
export function tsOptions(o) {
  const out = {};
  const names = {
    commodity: 'commodity',
    variant: 'variant',
    max_bytes: 'maxBytes',
    max_producers: 'maxProducers',
    check_budget: 'checkBudget',
    country: 'country',
    strip_unknown_properties: 'stripUnknownProperties',
    simplify_collinear: 'simplifyCollinear',
  };
  for (const [k, v] of Object.entries(o)) {
    const name = names[k];
    if (name === undefined) throw new Error(`unknown case option ${k}`);
    out[name] = v;
  }
  if (o.check_budget !== undefined) out.limits = { checkBudget: o.check_budget };
  return out;
}
