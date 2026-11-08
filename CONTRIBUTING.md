# Contributing

Thank you for helping. Plotline decides whether supply-chain geolocation is
accepted, so correctness and security come first.

## Before you start

- Open an issue to discuss larger changes.
- Pull requests require the [Contributor Licence Agreement](CLA.md). Add the
  signature line from CLA.md to your first pull request.
- Follow the [Code of Conduct](CODE_OF_CONDUCT.md).
- Never put real farm locations or producer names in issues, tests or
  fixtures. Use synthetic data.

## Development

```sh
npm ci
npm run check        # typecheck + lint + tests with coverage
npm run build        # library, CLI and dist/app/plotline.html
```

Python package:

```sh
cd python
python3 -m venv .venv
.venv/bin/pip install .
cd tests && ../.venv/bin/python -I -m unittest discover -s .
```

## Rules

- TypeScript strict mode, no `any`, no `@ts-ignore`; `eslint-disable` only
  with a written reason.
- No runtime dependencies, in TypeScript or Python.
- Every rule cites its source in `src/core/rules.ts`, with a verbatim quote
  where one exists, and says whether it is a requirement, an interpretation,
  a recommendation or a safety limit. Quote the official text (EUR-Lex, the
  Commission's Information System documentation); do not rely on secondary
  sources for what is required. Anything not officially specified is a
  recommendation.
- Every rule needs a test that triggers it (`test/rules.test.ts`) and a case
  in the shared vectors (`test-vectors/cases-input.json`) that both the
  TypeScript and the Python implementation pass. After a deliberate change,
  regenerate with `npm run build && node scripts/generate-vectors.mjs &&
  node scripts/rules-doc.mjs`, review every changed expectation, and explain
  it in the pull request.
- Repairs must keep each plot's location and area, and must be reported as
  changes. Anything that needs a judgement about the land is reported, not
  repaired.
- Every security control needs a test that fails when the control is
  removed.
- Keep the attribution "Plotline by AFKzona Group" in interfaces and reports
  (LICENSE-ADDITIONAL-TERMS.md).
- Update CHANGELOG.md.
