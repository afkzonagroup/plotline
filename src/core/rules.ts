// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// The catalogue of every check Plotline runs. Each rule cites its source and
// says plainly whether it is a requirement stated in an official text, an
// interpretation of a general official rule, a recommendation, or one of
// Plotline's own safety limits. Quotes are verbatim from the cited text.

import { src, type Source } from './sources.js';

/** How firmly a rule is grounded. */
export type RuleStatus =
  /** Stated by the Regulation, or by the Commission's Information System documentation as required or rejected. */
  | 'requirement'
  /** Plotline's reading of a general official rule (for example "invalid geometry") in a specific case the text does not spell out. */
  | 'interpretation'
  /** Recommended by an official document or by a SHOULD in RFC 7946, or Plotline good practice. Never a legal requirement. */
  | 'recommendation'
  /** Plotline's own protection against hostile or broken input. Not a legal rule. */
  | 'safety';

/** Severity of a finding. */
export type Severity = 'error' | 'warning' | 'info';

/** Identifiers of all rules. */
export type RuleId =
  | 'input-limit'
  | 'json-syntax'
  | 'json-duplicate-key'
  | 'file-format'
  | 'geojson-structure'
  | 'not-feature-collection'
  | 'foreign-member'
  | 'bbox-member'
  | 'crs-member'
  | 'crs-not-wgs84'
  | 'geometry-missing'
  | 'geometry-type-not-accepted'
  | 'geometry-empty'
  | 'nested-geometry-collection'
  | 'single-part-multi'
  | 'position-invalid'
  | 'coordinate-out-of-range'
  | 'altitude-present'
  | 'excess-precision'
  | 'low-precision'
  | 'ring-not-closed'
  | 'ring-too-few-positions'
  | 'duplicate-vertex'
  | 'spike'
  | 'zero-area-ring'
  | 'self-intersection'
  | 'polygon-has-holes'
  | 'multipolygon-parts-intersect'
  | 'winding-order'
  | 'antimeridian-crossing'
  | 'polygon-area-tiny'
  | 'property-name-case'
  | 'property-type'
  | 'producer-country-invalid'
  | 'producer-country-format'
  | 'producer-country-user-assigned'
  | 'producer-country-missing'
  | 'producer-name-too-long'
  | 'production-place-missing'
  | 'unknown-properties'
  | 'area-not-number'
  | 'point-area-missing'
  | 'point-area-below-minimum'
  | 'point-area-above-4ha'
  | 'area-mismatch'
  | 'no-plots'
  | 'file-too-large'
  | 'too-many-producers'
  | 'duplicate-plot'
  | 'overlapping-plots'
  | 'check-limit-reached';

/** A rule and its grounds. */
export interface Rule {
  readonly id: RuleId;
  readonly title: string;
  readonly status: RuleStatus;
  /** Usual severity; a finding may differ where the rule says so. */
  readonly severity: Severity;
  readonly sources: readonly Source[];
  /** Verbatim text from the first source that grounds the rule, where there is one. */
  readonly quote: string | null;
  /** What `plotline fix` does about it, or null when it cannot be repaired automatically. */
  readonly fix: string | null;
}

const GEOJSON_ERRORS = 'Common GeoJSON file errors';

/** Every rule, in report order. */
export const RULES: readonly Rule[] = Object.freeze([
  {
    id: 'input-limit',
    title: 'Input exceeds a Plotline safety limit',
    status: 'safety',
    severity: 'error',
    sources: [],
    quote: null,
    fix: null,
  },
  {
    id: 'json-syntax',
    title: 'File is not valid JSON',
    status: 'requirement',
    severity: 'error',
    sources: [src.isGeojson(`${GEOJSON_ERRORS}, item 8`), src.rfc8259('2')],
    quote: 'File syntax errors (e.g. missing ")" or "}").',
    fix: null,
  },
  {
    id: 'json-duplicate-key',
    title: 'Object has the same member name twice',
    status: 'safety',
    severity: 'error',
    sources: [src.rfc8259('4'), src.rfc7493('2.3')],
    quote: 'The names within an object SHOULD be unique.',
    fix: null,
  },
  {
    id: 'file-format',
    title: 'File is not GeoJSON (or KML or CSV that Plotline can convert)',
    status: 'requirement',
    severity: 'error',
    sources: [src.isGeojson(`${GEOJSON_ERRORS}, item 10`)],
    quote: 'Invalid file format (e.g. PDF, txt).',
    fix: null,
  },
  {
    id: 'geojson-structure',
    title: 'GeoJSON object is malformed',
    status: 'requirement',
    severity: 'error',
    sources: [src.isGeojson('Definitions'), src.rfc7946('3')],
    quote: 'A GeoJSON geometry object of any type other than "GeometryCollection" must have a member with the name "coordinates".',
    fix: null,
  },
  {
    id: 'not-feature-collection',
    title: 'Top level is not a FeatureCollection',
    status: 'recommendation',
    severity: 'info',
    sources: [src.isGeojson('Examples')],
    quote: null,
    fix: 'Wraps the geometry or Feature in a FeatureCollection, as in the Commission\'s examples.',
  },
  {
    id: 'foreign-member',
    title: 'Member not defined by GeoJSON',
    status: 'recommendation',
    severity: 'info',
    sources: [src.rfc7946('6.1')],
    quote: null,
    fix: 'Drops the member from the output; properties are kept.',
  },
  {
    id: 'bbox-member',
    title: 'Bounding box member present',
    status: 'recommendation',
    severity: 'info',
    sources: [src.rfc7946('5')],
    quote: null,
    fix: 'Drops "bbox", which would be stale after repairs.',
  },
  {
    id: 'crs-member',
    title: 'Legacy "crs" member naming WGS 84',
    status: 'recommendation',
    severity: 'info',
    sources: [src.rfc7946('4')],
    quote: null,
    fix: 'Drops the member; RFC 7946 coordinates are always WGS 84 longitude, latitude.',
  },
  {
    id: 'crs-not-wgs84',
    title: 'Coordinates declared in a reference system other than WGS 84',
    status: 'requirement',
    severity: 'error',
    sources: [src.isGeojson('Introduction'), src.rfc7946('4')],
    quote: 'If the geocoordinates available to the Economic Operator are in another coordinates system, these must be converted to the WGS84 (EPSG:4326) coordinate system with longitude and latitude units of decimal degrees.',
    fix: null,
  },
  {
    id: 'geometry-missing',
    title: 'Plot has no geometry',
    status: 'requirement',
    severity: 'error',
    sources: [src.eudr('Article 9(1), point (d)'), src.eudr('Annex II, point 3')],
    quote: 'the geolocation of all plots of land where the relevant commodities that the relevant product contains, or has been made using, were produced',
    fix: null,
  },
  {
    id: 'geometry-type-not-accepted',
    title: 'Geometry type is not accepted',
    status: 'requirement',
    severity: 'error',
    sources: [src.isGeojson('Definitions'), src.isGeojson(`${GEOJSON_ERRORS}, item 5`), src.isApi('DdsProducerType, geometryGeojson')],
    quote: 'Please note that geometry types of "LineString" and "MultiLineString" do not represent valid geocoordinate shapes for declaring production places and will not be accepted/processed.',
    fix: null,
  },
  {
    id: 'geometry-empty',
    title: 'Geometry has no positions',
    status: 'requirement',
    severity: 'error',
    sources: [src.isGeojson('Definitions'), src.eudr('Article 2, point (28)')],
    quote: 'MultiPoint geometry types consist of two or more points (coordinate pairs).',
    fix: null,
  },
  {
    id: 'nested-geometry-collection',
    title: 'GeometryCollection inside a GeometryCollection',
    status: 'recommendation',
    severity: 'warning',
    sources: [src.rfc7946('3.1.8')],
    quote: 'To maximize interoperability, implementations SHOULD avoid nested GeometryCollections.',
    fix: 'Flattens the nested collection into its parent.',
  },
  {
    id: 'single-part-multi',
    title: 'Multi-part geometry with one part',
    status: 'recommendation',
    severity: 'info',
    sources: [src.isGeojson('Definitions'), src.rfc7946('3.1.8')],
    quote: 'MultiPolygon: MultiPolygon geometry types contain two or more polygon definitions.',
    fix: 'Replaces it with the single Point, Polygon or geometry it contains.',
  },
  {
    id: 'position-invalid',
    title: 'Position is not an array of at least two numbers',
    status: 'requirement',
    severity: 'error',
    sources: [src.isGeojson('Definitions'), src.rfc7946('3.1.1')],
    quote: 'A position is represented by an array of numbers. There must be at least two elements and may be more. The order of elements must follow longitude, latitude',
    fix: null,
  },
  {
    id: 'coordinate-out-of-range',
    title: 'Longitude or latitude out of range',
    status: 'requirement',
    severity: 'error',
    sources: [src.isGeojson(`${GEOJSON_ERRORS}, item 11`), src.isRules('Geolocation invalid coordinates')],
    quote: 'Invalid coordinate range (outside the value ranges 90/-90 or 180/-180).',
    fix: null,
  },
  {
    id: 'altitude-present',
    title: 'Position has more than two values',
    status: 'recommendation',
    severity: 'info',
    sources: [src.isGeojson('Definitions'), src.rfc7946('11.2')],
    quote: null,
    fix: 'Keeps longitude and latitude and drops the extra values, which the plot location does not need.',
  },
  {
    id: 'excess-precision',
    title: 'More than six decimal places',
    status: 'recommendation',
    severity: 'info',
    sources: [src.isGeojson('Important notes for users of the EUDR IS'), src.isRules('Geolocation invalid coordinates')],
    quote: 'The information system will truncate coordinate points to 6 decimal places before storing. It is superfluous/wasteful to send a higher resolution, and may, in extreme cases, even result in invalid geometries where the original is valid.',
    fix: 'Truncates every coordinate to six decimal places, exactly as the Information System does, and checks the result.',
  },
  {
    id: 'low-precision',
    title: 'Fewer than six decimal places',
    status: 'requirement',
    severity: 'warning',
    sources: [src.eudr('Article 2, point (28)')],
    quote: '‘geolocation’ means the geographical location of a plot of land described by means of latitude and longitude coordinates corresponding to at least one latitude and one longitude point and using at least six decimal digits',
    fix: null,
  },
  {
    id: 'ring-not-closed',
    title: 'Polygon ring is not closed',
    status: 'requirement',
    severity: 'error',
    sources: [src.isGeojson(`${GEOJSON_ERRORS}, item 4`), src.rfc7946('3.1.6')],
    quote: '"Open" polygons. All polygons must represent closed shapes (i.e. the 1st coordinate pair same as the last)',
    fix: 'Appends the first position to close the ring.',
  },
  {
    id: 'ring-too-few-positions',
    title: 'Polygon ring has fewer than four positions',
    status: 'requirement',
    severity: 'error',
    sources: [src.isGeojson('Definitions'), src.rfc7946('3.1.6')],
    quote: 'Polygon: Polygon geometry types consist of at least four pairs of coordinates and represent an enclosed area by these coordinate points.',
    fix: null,
  },
  {
    id: 'duplicate-vertex',
    title: 'Same position twice in a row',
    status: 'requirement',
    severity: 'error',
    sources: [src.isGeojson(`${GEOJSON_ERRORS}, item 7`)],
    quote: 'Duplicate coordinates due to 6 decimals rounding in the system',
    fix: 'Removes the repeated position.',
  },
  {
    id: 'spike',
    title: 'Ring doubles back on itself (overlapping sides)',
    status: 'requirement',
    severity: 'error',
    sources: [src.isGeojson(`${GEOJSON_ERRORS}, item 2`)],
    quote: 'Overlapping sides',
    fix: 'Removes the vertex at the tip of the spike; the enclosed area does not change.',
  },
  {
    id: 'zero-area-ring',
    title: 'Ring encloses no area (all positions on one line)',
    status: 'requirement',
    severity: 'error',
    sources: [src.isGeojson(`${GEOJSON_ERRORS}, item 6`)],
    quote: 'Coordinates representing straight lines.',
    fix: null,
  },
  {
    id: 'self-intersection',
    title: 'Ring crosses or touches itself',
    status: 'requirement',
    severity: 'error',
    sources: [src.isGeojson('Definitions'), src.isGeojson(`${GEOJSON_ERRORS}, item 1`), src.isRules('Geolocation invalid geometry')],
    quote: 'Important note: Polygons with holes (i.e., doughnut shapes) and shapes with crossing lines (like a figure eight for example) are not supported and will not be processed.',
    fix: null,
  },
  {
    id: 'polygon-has-holes',
    title: 'Polygon has a hole',
    status: 'requirement',
    severity: 'error',
    sources: [src.isGeojson('Definitions'), src.isGeojson(`${GEOJSON_ERRORS}, items 3 and 15`)],
    quote: 'If a doughnut shape is needed, it can be defined by combining two half-doughnut shaped polygons.',
    fix: null,
  },
  {
    id: 'multipolygon-parts-intersect',
    title: 'Parts of a MultiPolygon overlap or share a side',
    status: 'interpretation',
    severity: 'error',
    sources: [src.isRules('Geolocation invalid geometry')],
    quote: 'The geolocation data cannot contain invalid geometry (for ex, invalid polygons).',
    fix: null,
  },
  {
    id: 'winding-order',
    title: 'Ring winding differs from the right-hand rule',
    status: 'recommendation',
    severity: 'info',
    sources: [src.rfc7946('3.1.6')],
    quote: 'A linear ring MUST follow the right-hand rule with respect to the area it bounds, i.e., exterior rings are counterclockwise, and holes are clockwise.',
    fix: 'Reverses the ring. RFC 7946 also says parsers SHOULD NOT reject the other order, and the Commission\'s documents do not require one.',
  },
  {
    id: 'antimeridian-crossing',
    title: 'Polygon crosses the 180th meridian',
    status: 'recommendation',
    severity: 'warning',
    sources: [src.rfc7946('3.1.9'), src.rfc7946('3.1.1')],
    quote: 'Any geometry that crosses the antimeridian SHOULD be represented by cutting it in two such that neither part\'s representation crosses the antimeridian.',
    fix: 'Cuts the polygon at 180° into a MultiPolygon when both parts are valid; otherwise leaves it for manual repair.',
  },
  {
    id: 'polygon-area-tiny',
    title: 'Polygon smaller than 0.0001 ha',
    status: 'recommendation',
    severity: 'warning',
    sources: [src.isRules('Geolocation area for point')],
    quote: null,
    fix: null,
  },
  {
    id: 'property-name-case',
    title: 'Property name in the wrong letter case',
    status: 'requirement',
    severity: 'error',
    sources: [src.isGeojson(`${GEOJSON_ERRORS}, item 9`)],
    quote: 'Invalid property names (e.g. "geometry" or incorrect property keyword case – "productionplace" instead of "ProductionPlace").',
    fix: 'Renames the property to the exact name, when that name is not already used.',
  },
  {
    id: 'property-type',
    title: 'Property value has the wrong type',
    status: 'interpretation',
    severity: 'warning',
    sources: [src.isGeojson('Definitions'), src.isApi('DdsProducerType')],
    quote: null,
    fix: null,
  },
  {
    id: 'producer-country-invalid',
    title: 'ProducerCountry is not an ISO 3166-1 alpha-2 code',
    status: 'requirement',
    severity: 'error',
    sources: [src.isGeojson(`${GEOJSON_ERRORS}, item 12`), src.isRules('Production country'), src.isApi('DdsProducerType, country'), src.iso3166()],
    quote: 'Invalid producer country ISO2 code.',
    fix: null,
  },
  {
    id: 'producer-country-format',
    title: 'ProducerCountry in lower case or with spaces',
    status: 'recommendation',
    severity: 'warning',
    sources: [src.iso3166()],
    quote: null,
    fix: 'Trims spaces and converts the code to upper case.',
  },
  {
    id: 'producer-country-user-assigned',
    title: 'ProducerCountry uses the user-assigned code XK',
    status: 'interpretation',
    severity: 'warning',
    sources: [src.iso3166()],
    quote: null,
    fix: null,
  },
  {
    id: 'producer-country-missing',
    title: 'ProducerCountry missing',
    status: 'requirement',
    severity: 'error',
    sources: [src.isGeojson('File Variants Description, Type II'), src.isRules('Production country')],
    quote: 'Includes the "ProducerCountry" property per "Feature".',
    fix: 'With --country, fills in the given code.',
  },
  {
    id: 'producer-name-too-long',
    title: 'ProducerName longer than 500 characters',
    status: 'requirement',
    severity: 'warning',
    sources: [src.isApi('DdsProducerType, name (string, max 500)')],
    quote: null,
    fix: null,
  },
  {
    id: 'production-place-missing',
    title: 'ProductionPlace missing',
    status: 'recommendation',
    severity: 'info',
    sources: [src.isGeojson('Important notes for users of the EUDR IS')],
    quote: 'It is recommended to provide the optional GeoJSON property "ProductionPlace" in the generated geocoordinates files for importing into the system.',
    fix: null,
  },
  {
    id: 'unknown-properties',
    title: 'Properties the Information System ignores',
    status: 'recommendation',
    severity: 'info',
    sources: [src.isGeojson('Definitions')],
    quote: 'Any other properties that are syntactically valid but not included in the optional properties list above, will be ignored.',
    fix: 'With --strip-unknown-properties, removes them.',
  },
  {
    id: 'area-not-number',
    title: 'Area is not a number',
    status: 'requirement',
    severity: 'error',
    sources: [src.isGeojson(`${GEOJSON_ERRORS}, item 14`)],
    quote: 'For example, "Area": "3" instead of "Area": 3 will result in area = 0 because the value 3 in quotes is not recognized as a number which is what is expected.',
    fix: 'Converts a text value that is a plain decimal number (for example "3" or "2.5") to a number.',
  },
  {
    id: 'point-area-missing',
    title: 'Point plot without Area',
    status: 'requirement',
    severity: 'warning',
    sources: [src.isRules('Geolocation area for point'), src.isGeojson('Important notes for users of the EUDR IS')],
    quote: 'In case a point is provided for a geolocation, the area is mandatory. If the user provided no data, the value 4 (ha) is introduced by default for the area.',
    fix: null,
  },
  {
    id: 'point-area-below-minimum',
    title: 'Point Area below 0.0001 ha',
    status: 'requirement',
    severity: 'error',
    sources: [src.isRules('Geolocation area for point')],
    quote: 'When provided, the area must also be higher or equal to 0.0001ha.',
    fix: null,
  },
  {
    id: 'point-area-above-4ha',
    title: 'Point used for a plot of more than 4 ha',
    status: 'requirement',
    severity: 'error',
    sources: [src.isRules('Geolocation area for point'), src.eudr('Article 2, point (28)')],
    quote: 'If the commodity is not cattle and the user provided a value higher than 4ha then the system will raise an error.',
    fix: null,
  },
  {
    id: 'area-mismatch',
    title: 'Area property differs from the polygon\'s computed area',
    status: 'recommendation',
    severity: 'info',
    sources: [],
    quote: null,
    fix: null,
  },
  {
    id: 'no-plots',
    title: 'File contains no plots',
    status: 'interpretation',
    severity: 'error',
    sources: [src.eudr('Article 9(1), point (d)')],
    quote: null,
    fix: null,
  },
  {
    id: 'file-too-large',
    title: 'Geolocation data larger than the Information System accepts',
    status: 'requirement',
    severity: 'error',
    sources: [src.isRules('Geolocation data size'), src.isGeojson(`${GEOJSON_ERRORS}, item 16`), src.implementing('Article 8a (grouping)')],
    quote: 'The total size of geolocation data per DDS cannot exceed a certain amount (presently set to 25Mb).',
    fix: '`plotline split` divides the file into parts within the limit, one per statement; the statements can then be grouped.',
  },
  {
    id: 'too-many-producers',
    title: 'More producers than one commodity entry accepts',
    status: 'requirement',
    severity: 'error',
    sources: [src.isRules('Geolocation Producers information')],
    quote: 'The total number of producers data per commodity cannot exceed a certain amount (presently set to 1000). The total number of producers data per DDS cannot exceed a certain amount (presently set to 10,000).',
    fix: '`plotline split --max-producers` divides the file by producer.',
  },
  {
    id: 'duplicate-plot',
    title: 'Same geometry appears more than once',
    status: 'recommendation',
    severity: 'warning',
    sources: [],
    quote: null,
    fix: 'Removes later copies whose geometry and properties are both identical; copies with different properties are left for you to decide.',
  },
  {
    id: 'overlapping-plots',
    title: 'Two plots overlap',
    status: 'recommendation',
    severity: 'warning',
    sources: [],
    quote: null,
    fix: null,
  },
  {
    id: 'check-limit-reached',
    title: 'A geometry check stopped at its work limit',
    status: 'safety',
    severity: 'warning',
    sources: [],
    quote: null,
    fix: null,
  },
] satisfies Rule[]);

const BY_ID = new Map<RuleId, Rule>(RULES.map((r) => [r.id, r]));

/** Looks up a rule. */
export function rule(id: RuleId): Rule {
  const r = BY_ID.get(id);
  if (r === undefined) throw new Error(`unknown rule ${id}`);
  return r;
}
