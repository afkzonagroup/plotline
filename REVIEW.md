# Review record

Two self-review passes, as required by the project standards. Each lists what
was checked, what was found and what was fixed. An independent review by the
coordinator follows.

State reviewed: version 0.1.0, 8 November 2026.

## Pass 1: correctness, law, edge cases, API, tests, security checklist

### Checked

**Against the official texts** (read from EUR-Lex and the Commission's EUDR
operator documentation on 8 November 2026; copies in `test-vectors/sources/`):

- Consolidated Regulation (EU) 2023/1115 of 18 September 2026 (M1 2024/3234,
  M2 2025/2650, M3 Delegated Regulation 2026/2102): Article 2 points (27),
  (28), (29), (15a), (15b); Article 4(2) and 4(3); new Article 4a and Annex
  III; Article 9(1)(d); Article 33; Article 38(2) and (3) as replaced by
  2025/2650 (30 December 2026; 30 June 2027 for micro and small operators
  established by 31 December 2024, except EUTR products); Annex II (point 4
  deleted by 2025/2650). Delegated Regulation 2026/2102 adds Annex I entries
  that apply from 30 December 2027; it does not touch geolocation.
- Implementing Regulation (EU) 2024/3084 as amended by 2026/1565: new
  Article 8a (grouping) and Article 15(4) (file-size measures).
- EUDR GeoJSON File Description (updated 17 August 2026), API and UI
  Validation Rules, DDS V4 API reference (DdsProducerType).
- RFC 7946 sections 3–5, 11.2; RFC 8259 section 4; RFC 7493 section 2.

Every quote in `src/core/rules.ts` is compared word for word with those
copies (`test/sources.test.ts`). Every rule says whether it is a requirement,
an interpretation, a recommendation or a safety limit; Plotline-only checks
are never labelled requirements (tested).

**Edge cases tested:** antimeridian (crossing, cut, ring around a pole),
poles, tiny polygons (1 m²) and huge ones (10° × 10°), holes, MultiPolygons
(disjoint, overlapping, sharing a side, touching at a corner), duplicate
vertices (written and created by truncation), spikes, collinear rings,
bow ties, figure eights, a vertex touching a side, rings that become invalid
only after truncation, the 4 ha and 0.0001 ha thresholds on both sides,
cattle, Type I/II, 25,000,000 bytes exactly and one byte more, the
Commission's own example files.

**Area:** compared with GeographicLib for 15 polygons: at most 1.7e-7
relative up to 1° × 1°, 7.2e-6 for 10° × 10°.

**Parity:** 102 shared vector cases run in TypeScript and Python with
identical findings (rule, severity, path, feature), identical repaired
bytes, identical change lists and areas to 1e-9.

**Security checklist (GOAL.md), line by line:** threat model in
SECURITY.md; boundary validation with limits; no eval/Function/dynamic
import/child_process/HTML sinks in `src` (hygiene test); offline page under
strict CSP with Trusted Types; personal data stays local; safe file writes;
zero runtime dependencies; `npm audit --omit=dev` clean; lockfile; files
allow-list; no install scripts; Dependabot; CI on pull_request and
workflow_dispatch only with pinned SHAs and `contents: read`.

### Found and fixed

1. A collinear ring was reported as "too few positions": spike removal
   collapsed it first. Collinearity is now judged before spikes, so
   "Coordinates representing straight lines" is reported as such.
2. A ring that winds around a pole was reported as several unrelated
   errors. It is now one `antimeridian-crossing` error.
3. `fix` dropped a non-WGS 84 `crs` member and wrote the coordinates as if
   they were WGS 84. Files declaring another coordinate system are now never
   rewritten (fix, convert and split return no output).
4. Exact duplicate plots were also reported as overlapping. Duplicates are
   now reported once.
5. The nested GeometryCollection repair was listed twice. Changes are now
   de-duplicated.
6. The low-precision warning fired for a point whose latitude had lost a
   trailing zero after truncation (for example 6.82044). The heuristic now
   looks at the most precise value of the plot, matching its message.
7. Producer counts treated "ci" and "CI" as two producers. Codes are
   compared as they will be written.
8. The map drew plots outside the frame for tall extents (Commission example
   Type II). The projection now fits both dimensions; plots too small to see
   get a marker.
9. The app's attribute allow-list lacked `data-row` (render stopped). Added;
   the allow-list stays strict.
10. A closed pipe (`plotline validate x | head`) crashed with EPIPE. Output
    now ends quietly.
11. `docs/area.md` overstated the error bound; corrected from measured
    values, and the test tolerances tightened to 1e-6 / 1e-5.
12. README numbers (findings in the example, library output) are now
    checked by running the examples (`test/readme.test.ts`,
    `python/tests/test_core.py`).
13. Dead code removed (unused JSON builders and model helpers).

## Pass 2: security, with the eyes of an attacker or hostile contributor

### Checked

- Every security control was removed temporarily and the test suite run, to
  confirm a test fails (TypeScript: 41 controls; Python: 14). All caught
  except the read loop's "file grew while reading" check, which is defence
  in depth behind the size check on the open descriptor and cannot be
  reached without a concurrent writer.
- Hostile files: deep nesting (1,000,000 levels), huge arrays, NaN and
  Infinity, 1e309, long strings and numbers, duplicate keys, unpaired
  surrogates, `__proto__`/`constructor` keys, invalid UTF-8, billion-laughs
  and XXE KML, unknown entities, bare ampersands, malformed markup,
  adversarial "comb" polygons and many overlapping squares against the work
  budget, 22 malformed GeoJSON shapes through validate, fix and split.
- Hostile repository contents for the GitHub Action: file names with `,`,
  `:`, `%` and newlines; property values containing `::error::`; symbolic
  links to files and directories outside the root; shell metacharacters in
  every input; roots outside the workspace.
- Output paths: overwrite of the input, existing files, symbolic links at
  the target and at the output directory, file and directory modes.
- Terminal output: escape sequences and bidirectional overrides in file
  names and values.
- Regular-expression denial of service: every regular expression applied
  to input was checked for nested or ambiguous repetition; glob matching was
  replaced by a polynomial matcher instead of a regular expression built
  from the pattern.
- The offline page: CSP, no network APIs, no storage, link allow-list, no
  inline styles, hashes of the inlined script and style.
- The Docker image: base pinned by digest, no npm in the runtime image,
  runs as uid 999, works with `--cap-drop=ALL --security-opt
  no-new-privileges --network none --read-only`.

### Found and fixed

1. KML text was limited to 65,536 characters per element, so a legitimate
   ring of a few thousand corners, or the whitespace between thousands of
   placemarks, was refused. Coordinate text is now bounded by the input size
   and position limit, and whitespace between elements is not accumulated.
   Tested with a 5,000-corner ring and 3,000 indented placemarks.
2. With `--root` set to a subdirectory, GitHub annotations named files
   relative to that subdirectory, so they would not attach to the right
   file. Files are now shown relative to the working directory, and the
   action runs from the workspace with a relative root.
3. Three controls were not pinned by a test that fails on removal: the
   pre-decoding byte limit, the size check on the open file and the CSV cell
   length check (a redundant second check was removed). Tests added.
4. Two Python controls (DOCTYPE refusal, strict UTF-8) were masked by later
   errors with the same rule id. Tests now check the specific message.
5. The Python CLI could write split parts through a symbolic link at the
   output directory; it now refuses, like the TypeScript CLI.
6. The offline page's size bar showed a minimum of 5 % for small files; it
   now shows the real share.

### Not changed, with reasons

- Development dependencies: `npm audit` reports a moderate advisory in
  `minimatch` through ESLint's packages (development only, not shipped;
  the fix is a breaking ESLint downgrade). Runtime: no dependencies.
- Memory: a 34 MB file with 1.26 million positions validates in about 4 s
  with about 1.2 GB of memory in Node.js; the Python package takes about
  30 s. Both are bounded by the input and position limits.

## Coordinator review (8 Nov 2026)

No findings. Checked:
- **Application dates** against Art. 38 as replaced by Regulation (EU) 2025/2650: 30 December 2026, and 30 June 2027 for micro and small undertakings.
- **The "six decimal digits" quote** against Art. 2(28).
- **The repair contract:** every repair keeps the location and area and is reported; judgements about the land are left to the user.
- **The KML reader** refuses DOCTYPE and allows only the five predefined entities.
- **Hostile inputs**, run against the built CLI:
  - 200,000-deep arrays and a 100,000-digit number are stopped by `input-limit` in under 0.1 s;
  - a DOCTYPE with an entity is refused;
  - `__proto__` and `constructor` keys in GeoJSON pollute nothing;
  - a spreadsheet formula in a CSV producer name stays text (Plotline writes no CSV).
- **`npm run check`:** 458 tests pass.

## Independent review (8 Nov 2026)

A fresh review that did not rely on this file, the README or
docs/legal-basis.md. Every fix below is its own commit with tests, and every
new or touched security control was removed once to confirm that a test
fails.

### Checked

- **Sources, fetched again on 8 November 2026.** The Commission's GeoJSON File
  Description (updated 17 August 2026), the API and UI Validation Rules and
  the DDS V4 API reference were fetched from eudr.webcloud.ec.europa.eu. Every
  quote in `src/core/rules.ts` from these documents appears word for word in
  the live pages. Every quote in docs/legal-basis.md appears in the EUR-Lex
  consolidated text of 18 September 2026. That covers Article 2(27)–(29),
  Article 4(2), Article 4a(5), Article 9(1)(d), Annex II point 3 (point 4
  deleted), Annex III point 3, Article 33(1) and Article 38(2)–(3)
  (30 December 2026 and 30 June 2027). The new Article 8a and Article 15(4)
  of Implementing Regulation (EU) 2026/1565 were checked against EUR-Lex.
- **Rules and severities.** Each rule was checked against those texts. The
  remaining judgement calls are listed under "Open" below.
- **Area against GeographicLib 2.1.** About 160 polygons were tested, from 1 m² to
  20° squares, at the equator, at 30–89.9° north and south, and across the
  antimeridian. Plot-sized polygons (up to 1°) agree to at most 1.8e-7
  relative. Squares of 1 m² and larger near the poles agree to about 1e-6. A
  20° square differs by 4.7e-5. Below 1 m², GeographicLib itself varies by
  up to 1e-3 relative.
- **Geometry probes through validate and fix.** The probes covered:
  - bow tie, vertex touching a side, spike, spike returning past its base;
  - collinear rings, and rings that collapse or straighten under truncation;
  - holes, clockwise exteriors, repeated positions;
  - antimeridian crossing (on and off the six-decimal grid), a ring around
    a pole, vertices at latitude 90;
  - coordinates out of range by less than one millionth of a degree.
- **Parity of TypeScript and Python.** About 4,500 random GeoJSON, CSV and
  KML cases were compared on rules, severities, paths, fixable flags,
  repaired bytes and change lists. They were identical except for areas of
  sub-square-metre polygons near the poles (documented in docs/area.md).
  There are 14 new shared vectors, 116 in all.
- **Hostile input.** The following were timed in both languages: deep
  nesting, many keys, long and escaped strings, KML with 200,000 attributes,
  entity floods, comment-split text, quote-filled CSV cells and 100,000
  features.
- **Packaging.**
  - Tested from a clean `git clone` with `npm ci --ignore-scripts`, following
    the release steps exactly.
  - `npm pack` from the built tree gives 64 files, including
    `dist/app/plotline.html`.
  - The README quick start was run from the packed tarball in an empty
    directory: 8 findings, 6 changes, and the library example prints
    `false [ 'ring-not-closed', 'producer-country-format' ]`, `2 true`,
    `92.13`.
  - The Python wheel holds the package, rules.json and both licence files.
    It installs in a clean venv, and the README Python example prints `False
    5` and `6`.
- **Docker.** The image builds, runs as uid 999 without npm, and validates
  with `--cap-drop=ALL --security-opt no-new-privileges --network none
  --read-only`.
- **Hygiene.**
  - No tracked file names an AI tool or its vendor (the hygiene test).
  - No tracked file has bidi, zero-width or BOM characters.
  - Every author and committer is antonmacius-droid.
  - LICENSE, LICENSE-ADDITIONAL-TERMS.md (7(b) "Plotline by AFKzona Group")
    and their copies in python/ match.
  - `npm audit --omit=dev` finds 0 vulnerabilities.

### Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | High | The release workflow would have published a package without `dist/`. `.npmrc` sets `ignore-scripts=true`, so `prepack` never ran, and release.yml did not build. Reproduced from a clean clone: the tarball held only docs, package.json and the schema. | Fixed: release and CI build, then `scripts/check-pack.mjs` (from the family's shared script, plus the additional terms and the offline page) refuses a tarball missing any entry point. Tests pin the workflow order and the script. |
| 2 | Medium | CSV: every quote character trimmed (TypeScript) or joined and trimmed (Python) the cell read so far. That is quadratic: 0.65 MB took 9 s in TypeScript and 104 s in Python, so the 64 MB default limit allowed hours of work. | Fixed in both with a whitespace flag (now 0.04 s and 0.12 s). Timing tests fail on the old code. |
| 3 | Medium | Python KML: each piece of element text (split by comments or CDATA) was appended to a string attribute and re-measured. A 3 MB file took more than 90 s. | Fixed (1.2 s). Both languages are tested with 60,000 pieces. |
| 4 | Medium | `--root` (and so the action's `root` input) followed a symbolic link at the root or in any path component. A repository directory could point anywhere on the runner, and values from those files appeared in annotations. | Fixed: a root that is or passes through a link below the working directory is refused. Tested. |
| 5 | Low | A coordinate such as 180.0000001 was reported as an error that could not be fixed. `fix` then wrote it truncated (180), the result passed, and no change said so. | Fixed in both. The finding is fixable exactly when truncation brings every out-of-range value of the plot within range, and `fix` lists the change. |
| 6 | Low | `ring-not-closed` and `duplicate-vertex` were marked fixable on rings with fewer than three distinct corners, which `fix` leaves unchanged. | Fixed in both. |
| 7 | Low | A `crs` member on a Feature or geometry (allowed by GeoJSON 2008) was dropped as a foreign member, and the coordinates were rewritten as WGS 84 even when it named another system. | Fixed in both: it is checked like the top-level `crs`, so `crs-not-wgs84` blocks rewriting. |
| 8 | Low | `toDdsProducers` grouped by the normalised country code but exported the first plot's raw value. The result could be `" ci "` (refused by the DDS CountryType `[a-zA-Z]{2}`), or `null` for a mis-cased property name. | Fixed in both. |
| 9 | Low | The 7(b) attribution was missing from the last line of the text output of failed `split`/`convert` (TypeScript) and failed `fix`/`split` (Python). `--format json` printed text there. | Fixed in both. Tested. |
| 10 | Low | The Python CSV reader measured cell length in code points and TypeScript in UTF-16 units, so astral characters gave different results. | Fixed (UTF-16 in both). |
| 11 | Low | Several security controls had no test that failed when they were removed. In TypeScript: the offline page's attribute and link allow-lists in `h()`, and the KML CDATA text limit. In Python: the KML depth limit, `O_NOFOLLOW` on writes, and the split out-dir link check. | Tests added. Each fails with its control removed. Mutation sweep: 31 TypeScript controls and 9 Python controls, all caught. |
| 12 | Low | README: "Today the tools that check this are paid services" has no source. | Removed. |
| 13 | Low | README said repairs never move a plot. Truncation, and the points where an antimeridian cut meets 180°, move coordinates by less than 1e-6° (about 0.1 m). For a 0.25 m² plot cut at 180° that is a 0.02 m² area change. | Documented. |
| 14 | Low | docs/area.md implied 1e-9 parity between TypeScript and Python in general. Platform math libraries give up to about 1e-7 for real plots, and up to 1e-4 for sub-m² polygons near the poles. | Documented. |
| 15 | Low | The Commission's documents say both "truncate" (twice) and "rounding" (common error 7). The choice was not recorded. | Recorded in docs/legal-basis.md. Plotline truncates. |

### Open (judgement calls, not changed)

- `single-part-multi` is labelled a recommendation. The GeoJSON File
  Description defines MultiPoint, MultiPolygon and GeometryCollection as "two
  or more"; whether the system rejects one part is not documented. The repair
  is lossless either way.
- A Point written `[[lon, lat]]`, as in the Commission's own Definitions
  example, is refused as `position-invalid`. Whether the system accepts it is
  not documented.
- The 25 Mb limit is measured on GeoJSON bytes. The API carries the GeoJSON
  base64-encoded (a third larger). The documents speak of the size of the
  uploaded GeoJSON files, so this follows them, but it cannot be verified.
- `producer-name-too-long` comes from the DDS API (`name`, max 500). Its
  mapping to the GeoJSON `ProducerName` property is not documented.
- Vertices at latitude ±90 with different longitudes are one point on the
  ground but are not treated as repeated. Plots do not lie there.
- The Python sdist includes tests that need the repository's
  `test-vectors/`. The wheel is correct.
- `--force` truncates an existing regular file through a hard link. Symbolic
  links are refused.

### Result

`npm run check` passes: typecheck, lint, 483 tests in 18 files. The Python
suite passes 37 tests, including the 116 shared vectors. Build output,
coverage, the review venv, the Docker image and temporary files were
removed.
