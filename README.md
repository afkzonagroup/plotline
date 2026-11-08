# Plotline

Checks, repairs, measures and splits plot geolocation files for the EU
Deforestation Regulation, on your own computer.

Plotline reads the GeoJSON (or KML, or a CSV of points) that you upload to
the EUDR Information System with a due diligence statement. It checks every
plot against the Regulation and the rules the Commission publishes for the
Information System, repairs what can be repaired without changing the land
a plot describes, reports every change, computes plot areas on the WGS 84
ellipsoid, and splits files that are too large. It runs as a command line
tool, a TypeScript library, a Python package, an offline web page, a GitHub
Action and a Docker image. Nothing is uploaded anywhere.

## Why

[Regulation (EU) 2023/1115](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R1115-20260918)
(the EUDR), as amended by Regulations (EU)
[2024/3234](https://eur-lex.europa.eu/eli/reg/2024/3234/oj) and
[2025/2650](https://eur-lex.europa.eu/eli/reg/2025/2650/oj), lets cattle,
cocoa, coffee, oil palm, rubber, soya, wood and products made from them onto
the EU market only with a due diligence statement (Article 4(2)). The
statement contains "the geolocation of all plots of land where the relevant
commodities were produced" (Annex II, point 3; Article 9(1), point (d)).

Article 2, point (28), defines geolocation:

> ‘geolocation’ means the geographical location of a plot of land described
> by means of latitude and longitude coordinates corresponding to at least
> one latitude and one longitude point and using at least six decimal
> digits; for plots of land of more than four hectares used for the
> production of the relevant commodities other than cattle, this shall be
> provided using polygons with sufficient latitude and longitude points to
> describe the perimeter of each plot of land;

The statements go through the Information System (Article 33), which takes
geolocation as GeoJSON and rejects files that break its rules: open or
self-crossing polygons, holes, wrong property names, more than 25 MB per
statement and more.

### Application dates

From Article 38 as replaced by Regulation (EU) 2025/2650:

| Who | Articles 3 to 13, 16 to 24, 26, 31 and 32 apply from |
|---|---|
| Operators and traders in general | **30 December 2026** (Art. 38(2)) |
| Operators that are natural persons or micro or small undertakings (Directive 2013/34/EU, Art. 3(1) and 3(2) first subparagraph) established as such by 31 December 2024, except for products covered by the Annex to Regulation (EU) No 995/2010 | **30 June 2027** (Art. 38(3)) |
| Products added to Annex I by Delegated Regulation (EU) [2026/2102](https://eur-lex.europa.eu/eli/reg_del/2026/2102/oj), where the entry says so | **30 December 2027** |

The Regulation entered into force on 29 June 2023. Regulation (EU) 2025/2650
also added a one-time simplified declaration for micro or small primary
operators in low-risk countries (Article 4a), who may give postal addresses
instead of geolocation (Article 4a(5)), and introduced downstream operators
(Article 2, point (15b); Article 5), who collect statement reference numbers
rather than submit geolocation.

## Quick start

Requires Node.js 22 or later.

```sh
git clone https://github.com/afkzonagroup/plotline.git
cd plotline
npm ci
npm run build
node dist/cli/main.js validate examples/plots.geojson
node dist/cli/main.js fix examples/plots.geojson --out plots.fixed.geojson
```

The example file has eight findings. `fix` repairs six of them, writes
`plots.fixed.geojson` and lists every change; the self-crossing boundary and
the 11.5 ha point need you. Once released on npm, `npx @afkzona/plotline
validate plots.geojson` does the same.

The offline page is `dist/app/plotline.html`: open it in a browser, drop a
file, see the plots on a map, repair and download.

## What it checks

Every rule cites its source and says how firmly it is grounded. The full
list with verbatim quotes is in [docs/rules.md](docs/rules.md); `plotline
rules` prints it.

- **Requirement**: stated in the Regulation, or in the Commission's
  [GeoJSON File Description](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/geojson-description.html)
  or [API and UI Validation Rules](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/validation-rules.html)
  as required or rejected.
- **Interpretation**: Plotline's reading of a general official rule in a case
  the text does not spell out (for example, MultiPolygon parts that overlap
  count as "invalid geometry").
- **Recommendation**: recommended by an official document or a SHOULD in
  [RFC 7946](https://www.rfc-editor.org/rfc/rfc7946), or Plotline good
  practice. Never presented as a legal requirement.
- **Safety limit**: Plotline's own protection against hostile input.

| Check | Status | Source |
|---|---|---|
| WGS 84 longitude, latitude; values within ±180 and ±90 | Requirement | GeoJSON File Description, Introduction and common error 11 |
| At least six decimal digits | Requirement (warning: JSON writers drop trailing zeros, so Plotline flags a plot only when no coordinate has six decimals) | Art. 2, point (28) |
| More than six decimals are truncated by the system | Recommendation; the repair truncates exactly as the system does and re-checks | GeoJSON File Description, important notes |
| Accepted types: Point, MultiPoint, Polygon, MultiPolygon, GeometryCollection; no LineString | Requirement | GeoJSON File Description, Definitions; DDS API |
| Closed rings, at least four positions | Requirement | Common errors 4; Definitions; RFC 7946 §3.1.6 |
| No crossing or touching boundaries, no overlapping sides, no straight-line "polygons" | Requirement | Common errors 1, 2, 6 |
| No repeated positions, including those created by truncation | Requirement | Common error 7 |
| No holes | Requirement | Definitions; common errors 3, 15 |
| Point Area: a number, at least 0.0001 ha, at most 4 ha unless cattle; 4 ha assumed when missing | Requirement | Validation Rules, "Geolocation area for point"; Art. 2, point (28) |
| Property names ProducerName, ProducerCountry, ProductionPlace, Area, case-sensitive | Requirement | Definitions; common error 9 |
| ProducerCountry is an ISO 3166-1 alpha-2 code; required in Type II files | Requirement | Common error 12; Type II description |
| At most 25 MB of geolocation per statement; at most 1,000 producers per commodity | Requirement ("presently set to") | Validation Rules |
| ProductionPlace given | Recommendation | GeoJSON File Description, important notes |
| Right-hand winding; antimeridian crossing cut in two | Recommendation | RFC 7946 §3.1.6, §3.1.9 |
| Duplicate plots, overlapping plots, Area differing from the polygon's area | Recommendation (Plotline) | – |

Geometry checks run on integer millionths of a degree after truncation, the
values the Information System stores, with exact arithmetic. Areas are
geodesic on the WGS 84 ellipsoid and agree with GeographicLib to better than
one part in 100,000 for plot-sized polygons ([docs/area.md](docs/area.md)).

## Repairs

`plotline fix` makes only changes that keep each plot's location and area,
and lists every one. Coordinates it writes lie on the six-decimal grid the
Information System stores, so truncation and the points where an
antimeridian cut meets 180° move by less than a millionth of a degree
(about 0.1 m):

- close open rings; remove repeated positions and spike tips; reverse ring
  winding to the RFC 7946 right-hand rule;
- truncate coordinates to six decimals (as the system does), which also
  brings a value such as 180.0000001 within range; drop altitude;
- rename mis-cased properties (`productionplace` → `ProductionPlace`); write
  numeric text such as `"3"` as a number; upper-case country codes;
- wrap a bare geometry or Feature in a FeatureCollection; drop `bbox`,
  legacy `crs` naming WGS 84, and members GeoJSON does not define;
- unwrap one-part MultiPolygons and GeometryCollections; flatten nested
  GeometryCollections;
- cut polygons that cross the 180° meridian into two, when both parts are
  valid;
- remove exact duplicate plots (same geometry and same properties).

On request: `--country XX` fills a missing ProducerCountry,
`--strip-unknown-properties` removes properties the system ignores,
`--simplify-collinear` removes positions lying exactly on a straight side
(the Commission's advice for files near the size limit).

It never changes a boundary that crosses itself, fills a hole, merges
overlapping plots or invents an area: those need a decision about the land.
A file declaring another coordinate system is never rewritten.

## Command line

```sh
plotline validate <file>... [--commodity cattle] [--variant type-ii] [--format text|json|github] [--fail-on error|warning|never]
plotline validate --root <dir> --glob '**/*.geojson'
plotline fix <file> --out <file> [--country BR] [--strip-unknown-properties] [--simplify-collinear] [--force]
plotline stats <file> [--format json]
plotline split <file> --out-dir <dir> [--max-bytes 25000000] [--max-producers 1000] [--no-repair]
plotline convert <file.kml|file.csv> --out <file> [--to geojson|dds-producers] [--repair]
plotline rules [--format json]
```

Exit codes: 0 passed, 1 a check failed (or nothing could be written), 2 a
usage or file error. `--format json` writes a machine-readable report
([schema/report-v1.schema.json](schema/report-v1.schema.json)).

`split` writes `part-001.geojson`, `part-002.geojson`, … and a
`manifest.json`. Submit each part with its own due diligence statement; the
statements can then be grouped in the Information System (Article 8a of
Implementing Regulation (EU) 2024/3084 as amended by
[(EU) 2026/1565](https://eur-lex.europa.eu/eli/reg_impl/2026/1565/oj)).
A producer's plots stay in one part whenever they fit.

`convert --to dds-producers` writes, per producer, the country, the name and
the base64 GeoJSON that the DDS API's `geometryGeojson` element takes.

### Input formats

- **GeoJSON** (RFC 7946): a FeatureCollection, a Feature or a bare geometry.
- **KML** 2.2: Placemarks with Point, Polygon (with `outerBoundaryIs` /
  `innerBoundaryIs`) or MultiGeometry. `<name>` becomes ProductionPlace;
  `ExtendedData` becomes properties. KMZ is not read: unzip it first.
- **CSV**: one point plot per row, or the corners of a boundary in file
  order when a `plot_id` column groups rows (the ring is closed for you).
  Comma, semicolon or tab; decimal commas with semicolon or tab separators.
  Column names are matched loosely: `longitude`/`lon`/`lng`/`x`,
  `latitude`/`lat`/`y`, `producer`/`producer_name`, `country`,
  `place`/`production_place`, `area`/`area_ha`/`hectares`.

## Library (TypeScript)

<!-- example:library -->
```ts
import { validate, fix } from '@afkzona/plotline';

const text = JSON.stringify({
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    properties: { ProductionPlace: 'Parcel B', ProducerCountry: 'ci' },
    geometry: { type: 'Polygon', coordinates: [[[-5.281402, 6.812301], [-5.270113, 6.812301], [-5.270113, 6.818977], [-5.281402, 6.818977]]] },
  }],
});

const report = validate(text, { commodity: 'cocoa' });
console.log(report.ok, report.issues.map((i) => i.rule)); // false [ 'ring-not-closed', 'producer-country-format' ]

const repaired = fix(text);
console.log(repaired.changes.length, repaired.after?.ok); // 2 true
console.log(repaired.after?.summary.hectares.toFixed(2)); // 92.13
```

Other exports: `split`, `convert`, `toDdsProducers`, `readPlots`, `RULES`,
`validatePlots`, `fixPlots`, `splitPlots`, `polygonHectares`,
`parseCoordinate`. Inputs may be a string or a `Uint8Array` of UTF-8 bytes.
The library has no runtime dependencies and makes no network or file system
calls.

## Python

<!-- example:python -->
```python
import pathlib

import plotline

text = pathlib.Path("examples/plots.geojson").read_text(encoding="utf-8")
report = plotline.validate(text, commodity="cocoa")
print(report["ok"], report["summary"]["errors"])  # False 5

result = plotline.fix(text, country="CI")
print(len(result["changes"]))  # 6
```

`pip install ./python` (Python 3.10 or later, no dependencies). The package
implements the same rules and passes the same shared test vectors
(`test-vectors/`) as the TypeScript package, byte for byte on repaired
output. It also has a small command line: `plotline-py validate|fix|split
<file>`.

## Offline web page

`npm run build` writes `dist/app/plotline.html`, one self-contained file. It
works from `file://`, makes no network connections (its Content Security
Policy blocks them: `default-src 'none'`, `connect-src 'none'`, scripts and
styles allowed only by hash), shows plots on a drawn map without map tiles,
lists findings with their sources, repairs and splits, and offers the
results as downloads. It works at 320 px wide and with a keyboard.

## GitHub Action

Validate geolocation files in a repository on pull requests:

```yaml
on: pull_request
permissions:
  contents: read
jobs:
  plots:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          persist-credentials: false
      - uses: afkzonagroup/plotline@v0.1.0 # pin to a full commit SHA in production
        with:
          glob: 'plots/**/*.geojson'
          commodity: cocoa
```

Inputs: `glob` (default `**/*.geojson`), `root` (default `.`, inside the
workspace), `commodity`, `variant` (`type-i`), `fail-on` (`error`),
`max-bytes`. Findings appear as annotations on the files. Output `failed`
is `true` or `false`.

## Docker

```sh
docker build -t plotline .
docker run --rm --cap-drop=ALL --security-opt no-new-privileges --network none \
  -v "$PWD:/work" plotline validate plots.geojson
```

The image runs as an unprivileged user and contains only Node.js and
Plotline's compiled files. It needs no network.

## Configuration

| Option (CLI / TypeScript / Python) | Default | Meaning |
|---|---|---|
| `--commodity` / `commodity` / `commodity` | not set | One of cattle, cocoa, coffee, oil palm (`oil-palm` on the CLI), rubber, soya, wood. Cattle points may stand for more than 4 ha. Without it, points above 4 ha are errors. |
| `--variant` / `variant` / `variant` | `type-i` | `type-ii` requires ProducerCountry on every feature and counts producers. |
| `--max-bytes` / `maxBytes` / `max_bytes` | 25,000,000 | Size limit per statement. The Commission writes "25Mb"; Plotline uses the smaller reading, 25,000,000 bytes. |
| `--max-producers` / `maxProducers` / `max_producers` | 1,000 | Producers per commodity entry (Type II) or per split part. |
| `--max-input-bytes` / `limits.maxInputBytes` / `limits={"maxInputBytes": …}` | 64 MiB | Largest file Plotline reads. |
| `--check-budget` / `checkBudget` / `check_budget` | 50,000,000 | Work limit for self-intersection and overlap checks; when reached, Plotline says so. |
| `limits` | see `DEFAULT_LIMITS` | Depth 64, 20,000,000 values, strings of 65,536 characters, numbers of 64 characters, 250,000 plots, 5,000,000 positions. Each has a hard maximum. |

## How it maps to the law

| Provision | What Plotline does |
|---|---|
| [Art. 2, point (28)](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R1115-20260918) geolocation | Six-decimal check; polygons for points over 4 ha except cattle; truncation as the system stores it |
| Art. 2, point (27) plot of land | One plot is one Feature; duplicates and overlaps are flagged for review |
| Art. 9(1), point (d) | Every plot needs a geometry; empty files fail |
| Art. 4(2), Annex II point 3 | The geolocation part of the due diligence statement; `dds-producers` output for the API |
| Art. 4a, Annex III | Geolocation for simplified declarations is checked the same way; postal addresses (Art. 4a(5)) are out of scope |
| Art. 33 and Implementing Regulation (EU) 2024/3084 (as amended by 2026/1565), Art. 8a and 15(4) | Information System file rules and limits; `split` for statements that are then grouped |

## Limitations

- Plotline checks the **format and geometry** of geolocation data. It does
  not check whether land was deforested or degraded after 31 December 2020,
  whether production was legal, or anything else in due diligence. It does
  not make anyone compliant.
- The Information System's exact validation code is not public. Plotline
  follows the Commission's published rules; where they are general
  ("invalid geometry"), Plotline's reading is labelled as an interpretation.
  The system may accept or reject a file Plotline judges otherwise.
- The limits the Commission publishes are "presently set to" values and can
  change; they are options.
- Six decimal digits: a JSON number cannot show trailing zeros, so a single
  coordinate such as `17.10022` may be a six-decimal value. Plotline warns
  only when no coordinate of a plot has six decimals, and never pads
  numbers to look more precise.
- Areas use great-circle sides on the authalic sphere of WGS 84; for very
  large polygons (hundreds of kilometres) they differ slightly from exact
  ellipsoidal geodesics and from straight lines in longitude/latitude.
- Overlap detection compares polygons' outer rings and is bounded by the
  work limit; very large files may need to be split first.
- Holes and self-crossing boundaries are reported, not repaired.
- KMZ, Shapefile, GeoPackage and coordinate systems other than WGS 84 are
  not read. Convert them to GeoJSON in WGS 84 first.
- Postal addresses for simplified declarations (Art. 4a(5)) are not checked.
- The ISO 3166-1 list is the 249 officially assigned codes; XK is accepted
  with a warning.

## Dependencies

Runtime: none, in both the TypeScript and the Python package. Geometry,
JSON, XML and CSV parsing are written for this project so that every limit
is under its control. Development only: TypeScript, ESLint, Vitest, esbuild
(to build the offline page). The reference areas in `test-vectors/areas.json`
were computed once with GeographicLib (`scripts/reference-areas.py`); it is
not needed to build or test.

## Security

Input is untrusted: size, depth, count and length limits apply before and
during parsing; KML document type declarations are refused; duplicate JSON
keys and unpaired surrogates are refused; `__proto__` and similar keys are
plain data; geometry checks have a work budget. The CLI writes new files
with mode 0600 and never through symbolic links, and never overwrites without
`--force`. Terminal output escapes control and bidirectional characters. The
offline page runs under a strict Content Security Policy with Trusted Types
and builds the page with DOM calls only. Plot files can identify farmers;
Plotline keeps them on your machine. See [SECURITY.md](SECURITY.md) for the
threat model and how to report a vulnerability.

## Licence and Enterprise

Plotline is free software under the GNU Affero General Public License
version 3 only ([LICENSE](LICENSE)), with an additional term under section
7(b): the notice "Plotline by AFKzona Group" with a link to
https://afkzonagroup.lt stays in user interfaces and generated reports
([LICENSE-ADDITIONAL-TERMS.md](LICENSE-ADDITIONAL-TERMS.md)). Copyright 2026
MB AFKzona Group. "Plotline" is a trademark of MB AFKzona Group; forks must
use another name ([TRADEMARKS.md](TRADEMARKS.md)).

**Enterprise.** MB AFKzona Group offers a commercial licence for
organisations that cannot use the AGPL-3.0 terms (including white-label use
without the attribution notice), integration into your systems, custom
connectors and features, and support agreements. See
[COMMERCIAL.md](COMMERCIAL.md) or contact info@afkzonagroup.lt.

## Contributing

Issues and pull requests are welcome. Pull requests need the
[Contributor Licence Agreement](CLA.md). See [CONTRIBUTING.md](CONTRIBUTING.md).

## Disclaimer

Not legal advice. Plotline is a technical tool provided as is, without
warranty. Check the official texts and, where needed, ask a lawyer or your
competent authority.

Maintained by AFKzona Group.
