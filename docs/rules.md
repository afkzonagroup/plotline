# Rules

Every check Plotline runs, generated from `src/core/rules.ts`. Status:

- **Requirement**: stated in Regulation (EU) 2023/1115 or in the Commission's EUDR Information System documentation as required or rejected.
- **Interpretation**: Plotline's reading of a general official rule (for example "invalid geometry") in a case the text does not spell out.
- **Recommendation**: recommended by an official document, a SHOULD in RFC 7946, or Plotline good practice. Never a legal requirement.
- **Safety limit**: Plotline's own protection against hostile or broken input.

Quotes are verbatim from the cited text (checked by `test/sources.test.ts` against copies in `test-vectors/sources/`).

| Rule | Status | Severity | Repair | Sources |
|---|---|---|---|---|
| `input-limit`<br>Input exceeds a Plotline safety limit | Safety limit | error | no | Plotline |
| `json-syntax`<br>File is not valid JSON | Requirement | error | no | [EUDR Information System, GeoJSON File Description, Common GeoJSON file errors, item 8](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/geojson-description.html)<br>[RFC 8259, section 2](https://www.rfc-editor.org/rfc/rfc8259#section-2) |
| `json-duplicate-key`<br>Object has the same member name twice | Safety limit | error | no | [RFC 8259, section 4](https://www.rfc-editor.org/rfc/rfc8259#section-4)<br>[RFC 7493, section 2.3](https://www.rfc-editor.org/rfc/rfc7493#section-2.3) |
| `file-format`<br>File is not GeoJSON (or KML or CSV that Plotline can convert) | Requirement | error | no | [EUDR Information System, GeoJSON File Description, Common GeoJSON file errors, item 10](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/geojson-description.html) |
| `geojson-structure`<br>GeoJSON object is malformed | Requirement | error | no | [EUDR Information System, GeoJSON File Description, Definitions](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/geojson-description.html)<br>[RFC 7946, section 3](https://www.rfc-editor.org/rfc/rfc7946#section-3) |
| `not-feature-collection`<br>Top level is not a FeatureCollection | Recommendation | info | yes | [EUDR Information System, GeoJSON File Description, Examples](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/geojson-description.html) |
| `foreign-member`<br>Member not defined by GeoJSON | Recommendation | info | yes | [RFC 7946, section 6.1](https://www.rfc-editor.org/rfc/rfc7946#section-6.1) |
| `bbox-member`<br>Bounding box member present | Recommendation | info | yes | [RFC 7946, section 5](https://www.rfc-editor.org/rfc/rfc7946#section-5) |
| `crs-member`<br>Legacy "crs" member naming WGS 84 | Recommendation | info | yes | [RFC 7946, section 4](https://www.rfc-editor.org/rfc/rfc7946#section-4) |
| `crs-not-wgs84`<br>Coordinates declared in a reference system other than WGS 84 | Requirement | error | no | [EUDR Information System, GeoJSON File Description, Introduction](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/geojson-description.html)<br>[RFC 7946, section 4](https://www.rfc-editor.org/rfc/rfc7946#section-4) |
| `geometry-missing`<br>Plot has no geometry | Requirement | error | no | [Regulation (EU) 2023/1115, Article 9(1), point (d)](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R1115-20260918)<br>[Regulation (EU) 2023/1115, Annex II, point 3](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R1115-20260918) |
| `geometry-type-not-accepted`<br>Geometry type is not accepted | Requirement | error | no | [EUDR Information System, GeoJSON File Description, Definitions](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/geojson-description.html)<br>[EUDR Information System, GeoJSON File Description, Common GeoJSON file errors, item 5](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/geojson-description.html)<br>[EUDR Information System, DDS V4 API reference, DdsProducerType, geometryGeojson](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/api/due-diligence-statement-v4.html) |
| `geometry-empty`<br>Geometry has no positions | Requirement | error | no | [EUDR Information System, GeoJSON File Description, Definitions](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/geojson-description.html)<br>[Regulation (EU) 2023/1115, Article 2, point (28)](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R1115-20260918) |
| `nested-geometry-collection`<br>GeometryCollection inside a GeometryCollection | Recommendation | warning | yes | [RFC 7946, section 3.1.8](https://www.rfc-editor.org/rfc/rfc7946#section-3.1.8) |
| `single-part-multi`<br>Multi-part geometry with one part | Recommendation | info | yes | [EUDR Information System, GeoJSON File Description, Definitions](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/geojson-description.html)<br>[RFC 7946, section 3.1.8](https://www.rfc-editor.org/rfc/rfc7946#section-3.1.8) |
| `position-invalid`<br>Position is not an array of at least two numbers | Requirement | error | no | [EUDR Information System, GeoJSON File Description, Definitions](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/geojson-description.html)<br>[RFC 7946, section 3.1.1](https://www.rfc-editor.org/rfc/rfc7946#section-3.1.1) |
| `coordinate-out-of-range`<br>Longitude or latitude out of range | Requirement | error | no | [EUDR Information System, GeoJSON File Description, Common GeoJSON file errors, item 11](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/geojson-description.html)<br>[EUDR Information System, API and UI Validation Rules, "Geolocation invalid coordinates"](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/validation-rules.html) |
| `altitude-present`<br>Position has more than two values | Recommendation | info | yes | [EUDR Information System, GeoJSON File Description, Definitions](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/geojson-description.html)<br>[RFC 7946, section 11.2](https://www.rfc-editor.org/rfc/rfc7946#section-11.2) |
| `excess-precision`<br>More than six decimal places | Recommendation | info | yes | [EUDR Information System, GeoJSON File Description, Important notes for users of the EUDR IS](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/geojson-description.html)<br>[EUDR Information System, API and UI Validation Rules, "Geolocation invalid coordinates"](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/validation-rules.html) |
| `low-precision`<br>Fewer than six decimal places | Requirement | warning | no | [Regulation (EU) 2023/1115, Article 2, point (28)](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R1115-20260918) |
| `ring-not-closed`<br>Polygon ring is not closed | Requirement | error | yes | [EUDR Information System, GeoJSON File Description, Common GeoJSON file errors, item 4](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/geojson-description.html)<br>[RFC 7946, section 3.1.6](https://www.rfc-editor.org/rfc/rfc7946#section-3.1.6) |
| `ring-too-few-positions`<br>Polygon ring has fewer than four positions | Requirement | error | no | [EUDR Information System, GeoJSON File Description, Definitions](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/geojson-description.html)<br>[RFC 7946, section 3.1.6](https://www.rfc-editor.org/rfc/rfc7946#section-3.1.6) |
| `duplicate-vertex`<br>Same position twice in a row | Requirement | error | yes | [EUDR Information System, GeoJSON File Description, Common GeoJSON file errors, item 7](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/geojson-description.html) |
| `spike`<br>Ring doubles back on itself (overlapping sides) | Requirement | error | yes | [EUDR Information System, GeoJSON File Description, Common GeoJSON file errors, item 2](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/geojson-description.html) |
| `zero-area-ring`<br>Ring encloses no area (all positions on one line) | Requirement | error | no | [EUDR Information System, GeoJSON File Description, Common GeoJSON file errors, item 6](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/geojson-description.html) |
| `self-intersection`<br>Ring crosses or touches itself | Requirement | error | no | [EUDR Information System, GeoJSON File Description, Definitions](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/geojson-description.html)<br>[EUDR Information System, GeoJSON File Description, Common GeoJSON file errors, item 1](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/geojson-description.html)<br>[EUDR Information System, API and UI Validation Rules, "Geolocation invalid geometry"](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/validation-rules.html) |
| `polygon-has-holes`<br>Polygon has a hole | Requirement | error | no | [EUDR Information System, GeoJSON File Description, Definitions](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/geojson-description.html)<br>[EUDR Information System, GeoJSON File Description, Common GeoJSON file errors, items 3 and 15](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/geojson-description.html) |
| `multipolygon-parts-intersect`<br>Parts of a MultiPolygon overlap or share a side | Interpretation | error | no | [EUDR Information System, API and UI Validation Rules, "Geolocation invalid geometry"](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/validation-rules.html) |
| `winding-order`<br>Ring winding differs from the right-hand rule | Recommendation | info | yes | [RFC 7946, section 3.1.6](https://www.rfc-editor.org/rfc/rfc7946#section-3.1.6) |
| `antimeridian-crossing`<br>Polygon crosses the 180th meridian | Recommendation | warning | yes | [RFC 7946, section 3.1.9](https://www.rfc-editor.org/rfc/rfc7946#section-3.1.9)<br>[RFC 7946, section 3.1.1](https://www.rfc-editor.org/rfc/rfc7946#section-3.1.1) |
| `polygon-area-tiny`<br>Polygon smaller than 0.0001 ha | Recommendation | warning | no | [EUDR Information System, API and UI Validation Rules, "Geolocation area for point"](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/validation-rules.html) |
| `property-name-case`<br>Property name in the wrong letter case | Requirement | error | yes | [EUDR Information System, GeoJSON File Description, Common GeoJSON file errors, item 9](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/geojson-description.html) |
| `property-type`<br>Property value has the wrong type | Interpretation | warning | no | [EUDR Information System, GeoJSON File Description, Definitions](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/geojson-description.html)<br>[EUDR Information System, DDS V4 API reference, DdsProducerType](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/api/due-diligence-statement-v4.html) |
| `producer-country-invalid`<br>ProducerCountry is not an ISO 3166-1 alpha-2 code | Requirement | error | no | [EUDR Information System, GeoJSON File Description, Common GeoJSON file errors, item 12](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/geojson-description.html)<br>[EUDR Information System, API and UI Validation Rules, "Production country"](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/validation-rules.html)<br>[EUDR Information System, DDS V4 API reference, DdsProducerType, country](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/api/due-diligence-statement-v4.html)<br>[ISO 3166-1 alpha-2](https://www.iso.org/iso-3166-country-codes.html) |
| `producer-country-format`<br>ProducerCountry in lower case or with spaces | Recommendation | warning | yes | [ISO 3166-1 alpha-2](https://www.iso.org/iso-3166-country-codes.html) |
| `producer-country-user-assigned`<br>ProducerCountry uses the user-assigned code XK | Interpretation | warning | no | [ISO 3166-1 alpha-2](https://www.iso.org/iso-3166-country-codes.html) |
| `producer-country-missing`<br>ProducerCountry missing | Requirement | error | yes | [EUDR Information System, GeoJSON File Description, File Variants Description, Type II](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/geojson-description.html)<br>[EUDR Information System, API and UI Validation Rules, "Production country"](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/validation-rules.html) |
| `producer-name-too-long`<br>ProducerName longer than 500 characters | Requirement | warning | no | [EUDR Information System, DDS V4 API reference, DdsProducerType, name (string, max 500)](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/api/due-diligence-statement-v4.html) |
| `production-place-missing`<br>ProductionPlace missing | Recommendation | info | no | [EUDR Information System, GeoJSON File Description, Important notes for users of the EUDR IS](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/geojson-description.html) |
| `unknown-properties`<br>Properties the Information System ignores | Recommendation | info | yes | [EUDR Information System, GeoJSON File Description, Definitions](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/geojson-description.html) |
| `area-not-number`<br>Area is not a number | Requirement | error | yes | [EUDR Information System, GeoJSON File Description, Common GeoJSON file errors, item 14](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/geojson-description.html) |
| `point-area-missing`<br>Point plot without Area | Requirement | warning | no | [EUDR Information System, API and UI Validation Rules, "Geolocation area for point"](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/validation-rules.html)<br>[EUDR Information System, GeoJSON File Description, Important notes for users of the EUDR IS](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/geojson-description.html) |
| `point-area-below-minimum`<br>Point Area below 0.0001 ha | Requirement | error | no | [EUDR Information System, API and UI Validation Rules, "Geolocation area for point"](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/validation-rules.html) |
| `point-area-above-4ha`<br>Point used for a plot of more than 4 ha | Requirement | error | no | [EUDR Information System, API and UI Validation Rules, "Geolocation area for point"](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/validation-rules.html)<br>[Regulation (EU) 2023/1115, Article 2, point (28)](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R1115-20260918) |
| `area-mismatch`<br>Area property differs from the polygon's computed area | Recommendation | info | no | Plotline |
| `no-plots`<br>File contains no plots | Interpretation | error | no | [Regulation (EU) 2023/1115, Article 9(1), point (d)](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R1115-20260918) |
| `file-too-large`<br>Geolocation data larger than the Information System accepts | Requirement | error | yes | [EUDR Information System, API and UI Validation Rules, "Geolocation data size"](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/validation-rules.html)<br>[EUDR Information System, GeoJSON File Description, Common GeoJSON file errors, item 16](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/geojson-description.html)<br>[Implementing Regulation (EU) 2024/3084 as amended by (EU) 2026/1565, Article 8a (grouping)](https://eur-lex.europa.eu/eli/reg_impl/2026/1565/oj) |
| `too-many-producers`<br>More producers than one commodity entry accepts | Requirement | error | yes | [EUDR Information System, API and UI Validation Rules, "Geolocation Producers information"](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/validation-rules.html) |
| `duplicate-plot`<br>Same geometry appears more than once | Recommendation | warning | yes | Plotline |
| `overlapping-plots`<br>Two plots overlap | Recommendation | warning | no | Plotline |
| `check-limit-reached`<br>A geometry check stopped at its work limit | Safety limit | warning | no | Plotline |

## Quotes and repairs

### `input-limit`

Input exceeds a Plotline safety limit.

### `json-syntax`

File is not valid JSON.

> File syntax errors (e.g. missing ")" or "}").

— EUDR Information System, GeoJSON File Description, Common GeoJSON file errors, item 8

### `json-duplicate-key`

Object has the same member name twice.

> The names within an object SHOULD be unique.

— RFC 8259, section 4

### `file-format`

File is not GeoJSON (or KML or CSV that Plotline can convert).

> Invalid file format (e.g. PDF, txt).

— EUDR Information System, GeoJSON File Description, Common GeoJSON file errors, item 10

### `geojson-structure`

GeoJSON object is malformed.

> A GeoJSON geometry object of any type other than "GeometryCollection" must have a member with the name "coordinates".

— EUDR Information System, GeoJSON File Description, Definitions

### `not-feature-collection`

Top level is not a FeatureCollection.

Repair: Wraps the geometry or Feature in a FeatureCollection, as in the Commission's examples.

### `foreign-member`

Member not defined by GeoJSON.

Repair: Drops the member from the output; properties are kept.

### `bbox-member`

Bounding box member present.

Repair: Drops "bbox", which would be stale after repairs.

### `crs-member`

Legacy "crs" member naming WGS 84.

Repair: Drops the member; RFC 7946 coordinates are always WGS 84 longitude, latitude.

### `crs-not-wgs84`

Coordinates declared in a reference system other than WGS 84.

> If the geocoordinates available to the Economic Operator are in another coordinates system, these must be converted to the WGS84 (EPSG:4326) coordinate system with longitude and latitude units of decimal degrees.

— EUDR Information System, GeoJSON File Description, Introduction

### `geometry-missing`

Plot has no geometry.

> the geolocation of all plots of land where the relevant commodities that the relevant product contains, or has been made using, were produced

— Regulation (EU) 2023/1115, Article 9(1), point (d)

### `geometry-type-not-accepted`

Geometry type is not accepted.

> Please note that geometry types of "LineString" and "MultiLineString" do not represent valid geocoordinate shapes for declaring production places and will not be accepted/processed.

— EUDR Information System, GeoJSON File Description, Definitions

### `geometry-empty`

Geometry has no positions.

> MultiPoint geometry types consist of two or more points (coordinate pairs).

— EUDR Information System, GeoJSON File Description, Definitions

### `nested-geometry-collection`

GeometryCollection inside a GeometryCollection.

> To maximize interoperability, implementations SHOULD avoid nested GeometryCollections.

— RFC 7946, section 3.1.8

Repair: Flattens the nested collection into its parent.

### `single-part-multi`

Multi-part geometry with one part.

> MultiPolygon: MultiPolygon geometry types contain two or more polygon definitions.

— EUDR Information System, GeoJSON File Description, Definitions

Repair: Replaces it with the single Point, Polygon or geometry it contains.

### `position-invalid`

Position is not an array of at least two numbers.

> A position is represented by an array of numbers. There must be at least two elements and may be more. The order of elements must follow longitude, latitude

— EUDR Information System, GeoJSON File Description, Definitions

### `coordinate-out-of-range`

Longitude or latitude out of range.

> Invalid coordinate range (outside the value ranges 90/-90 or 180/-180).

— EUDR Information System, GeoJSON File Description, Common GeoJSON file errors, item 11

### `altitude-present`

Position has more than two values.

Repair: Keeps longitude and latitude and drops the extra values, which the plot location does not need.

### `excess-precision`

More than six decimal places.

> The information system will truncate coordinate points to 6 decimal places before storing. It is superfluous/wasteful to send a higher resolution, and may, in extreme cases, even result in invalid geometries where the original is valid.

— EUDR Information System, GeoJSON File Description, Important notes for users of the EUDR IS

Repair: Truncates every coordinate to six decimal places, exactly as the Information System does, and checks the result.

### `low-precision`

Fewer than six decimal places.

> ‘geolocation’ means the geographical location of a plot of land described by means of latitude and longitude coordinates corresponding to at least one latitude and one longitude point and using at least six decimal digits

— Regulation (EU) 2023/1115, Article 2, point (28)

### `ring-not-closed`

Polygon ring is not closed.

> "Open" polygons. All polygons must represent closed shapes (i.e. the 1st coordinate pair same as the last)

— EUDR Information System, GeoJSON File Description, Common GeoJSON file errors, item 4

Repair: Appends the first position to close the ring.

### `ring-too-few-positions`

Polygon ring has fewer than four positions.

> Polygon: Polygon geometry types consist of at least four pairs of coordinates and represent an enclosed area by these coordinate points.

— EUDR Information System, GeoJSON File Description, Definitions

### `duplicate-vertex`

Same position twice in a row.

> Duplicate coordinates due to 6 decimals rounding in the system

— EUDR Information System, GeoJSON File Description, Common GeoJSON file errors, item 7

Repair: Removes the repeated position.

### `spike`

Ring doubles back on itself (overlapping sides).

> Overlapping sides

— EUDR Information System, GeoJSON File Description, Common GeoJSON file errors, item 2

Repair: Removes the vertex at the tip of the spike; the enclosed area does not change.

### `zero-area-ring`

Ring encloses no area (all positions on one line).

> Coordinates representing straight lines.

— EUDR Information System, GeoJSON File Description, Common GeoJSON file errors, item 6

### `self-intersection`

Ring crosses or touches itself.

> Important note: Polygons with holes (i.e., doughnut shapes) and shapes with crossing lines (like a figure eight for example) are not supported and will not be processed.

— EUDR Information System, GeoJSON File Description, Definitions

### `polygon-has-holes`

Polygon has a hole.

> If a doughnut shape is needed, it can be defined by combining two half-doughnut shaped polygons.

— EUDR Information System, GeoJSON File Description, Definitions

### `multipolygon-parts-intersect`

Parts of a MultiPolygon overlap or share a side.

> The geolocation data cannot contain invalid geometry (for ex, invalid polygons).

— EUDR Information System, API and UI Validation Rules, "Geolocation invalid geometry"

### `winding-order`

Ring winding differs from the right-hand rule.

> A linear ring MUST follow the right-hand rule with respect to the area it bounds, i.e., exterior rings are counterclockwise, and holes are clockwise.

— RFC 7946, section 3.1.6

Repair: Reverses the ring. RFC 7946 also says parsers SHOULD NOT reject the other order, and the Commission's documents do not require one.

### `antimeridian-crossing`

Polygon crosses the 180th meridian.

> Any geometry that crosses the antimeridian SHOULD be represented by cutting it in two such that neither part's representation crosses the antimeridian.

— RFC 7946, section 3.1.9

Repair: Cuts the polygon at 180° into a MultiPolygon when both parts are valid; otherwise leaves it for manual repair.

### `polygon-area-tiny`

Polygon smaller than 0.0001 ha.

### `property-name-case`

Property name in the wrong letter case.

> Invalid property names (e.g. "geometry" or incorrect property keyword case – "productionplace" instead of "ProductionPlace").

— EUDR Information System, GeoJSON File Description, Common GeoJSON file errors, item 9

Repair: Renames the property to the exact name, when that name is not already used.

### `property-type`

Property value has the wrong type.

### `producer-country-invalid`

ProducerCountry is not an ISO 3166-1 alpha-2 code.

> Invalid producer country ISO2 code.

— EUDR Information System, GeoJSON File Description, Common GeoJSON file errors, item 12

### `producer-country-format`

ProducerCountry in lower case or with spaces.

Repair: Trims spaces and converts the code to upper case.

### `producer-country-user-assigned`

ProducerCountry uses the user-assigned code XK.

### `producer-country-missing`

ProducerCountry missing.

> Includes the "ProducerCountry" property per "Feature".

— EUDR Information System, GeoJSON File Description, File Variants Description, Type II

Repair: With --country, fills in the given code.

### `producer-name-too-long`

ProducerName longer than 500 characters.

### `production-place-missing`

ProductionPlace missing.

> It is recommended to provide the optional GeoJSON property "ProductionPlace" in the generated geocoordinates files for importing into the system.

— EUDR Information System, GeoJSON File Description, Important notes for users of the EUDR IS

### `unknown-properties`

Properties the Information System ignores.

> Any other properties that are syntactically valid but not included in the optional properties list above, will be ignored.

— EUDR Information System, GeoJSON File Description, Definitions

Repair: With --strip-unknown-properties, removes them.

### `area-not-number`

Area is not a number.

> For example, "Area": "3" instead of "Area": 3 will result in area = 0 because the value 3 in quotes is not recognized as a number which is what is expected.

— EUDR Information System, GeoJSON File Description, Common GeoJSON file errors, item 14

Repair: Converts a text value that is a plain decimal number (for example "3" or "2.5") to a number.

### `point-area-missing`

Point plot without Area.

> In case a point is provided for a geolocation, the area is mandatory. If the user provided no data, the value 4 (ha) is introduced by default for the area.

— EUDR Information System, API and UI Validation Rules, "Geolocation area for point"

### `point-area-below-minimum`

Point Area below 0.0001 ha.

> When provided, the area must also be higher or equal to 0.0001ha.

— EUDR Information System, API and UI Validation Rules, "Geolocation area for point"

### `point-area-above-4ha`

Point used for a plot of more than 4 ha.

> If the commodity is not cattle and the user provided a value higher than 4ha then the system will raise an error.

— EUDR Information System, API and UI Validation Rules, "Geolocation area for point"

### `area-mismatch`

Area property differs from the polygon's computed area.

### `no-plots`

File contains no plots.

### `file-too-large`

Geolocation data larger than the Information System accepts.

> The total size of geolocation data per DDS cannot exceed a certain amount (presently set to 25Mb).

— EUDR Information System, API and UI Validation Rules, "Geolocation data size"

Repair: `plotline split` divides the file into parts within the limit, one per statement; the statements can then be grouped.

### `too-many-producers`

More producers than one commodity entry accepts.

> The total number of producers data per commodity cannot exceed a certain amount (presently set to 1000). The total number of producers data per DDS cannot exceed a certain amount (presently set to 10,000).

— EUDR Information System, API and UI Validation Rules, "Geolocation Producers information"

Repair: `plotline split --max-producers` divides the file by producer.

### `duplicate-plot`

Same geometry appears more than once.

Repair: Removes later copies whose geometry and properties are both identical; copies with different properties are left for you to decide.

### `overlapping-plots`

Two plots overlap.

### `check-limit-reached`

A geometry check stopped at its work limit.
