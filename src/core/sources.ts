// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// Official sources that rules cite. Legal texts link to EUR-Lex; the
// Information System documentation links to the Commission's EUDR operator
// documentation (production host). Text quoted in rules is verbatim from
// these documents as read on 8 November 2026.

/** A cited source. */
export interface Source {
  /** Short citation, for example "Regulation (EU) 2023/1115, Article 2, point (28)". */
  readonly cite: string;
  /** Link to the official text. */
  readonly url: string;
}

/** Consolidated text of Regulation (EU) 2023/1115 (version of 18 September 2026, including amendments M1–M3). */
export const EUDR_CONSOLIDATED = 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R1115-20260918';
/** Regulation (EU) 2023/1115 as published. */
export const EUDR_ELI = 'https://eur-lex.europa.eu/eli/reg/2023/1115/oj';
/** Regulation (EU) 2024/3234 (first amendment: dates). */
export const AMENDMENT_2024_3234 = 'https://eur-lex.europa.eu/eli/reg/2024/3234/oj';
/** Regulation (EU) 2025/2650 (second amendment: obligations and dates). */
export const AMENDMENT_2025_2650 = 'https://eur-lex.europa.eu/eli/reg/2025/2650/oj';
/** Commission Delegated Regulation (EU) 2026/2102 (Annex I product list). */
export const DELEGATED_2026_2102 = 'https://eur-lex.europa.eu/eli/reg_del/2026/2102/oj';
/** Commission Implementing Regulation (EU) 2024/3084 (functioning of the Information System). */
export const IMPLEMENTING_2024_3084 = 'https://eur-lex.europa.eu/eli/reg_impl/2024/3084/oj';
/** Commission Implementing Regulation (EU) 2026/1565 (amends 2024/3084: grouping, file-size measures). */
export const IMPLEMENTING_2026_1565 = 'https://eur-lex.europa.eu/eli/reg_impl/2026/1565/oj';

const IS_DOCS = 'https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator';
/** EUDR Information System: GeoJSON File Description (updated 17 August 2026). */
export const IS_GEOJSON = `${IS_DOCS}/geojson-description.html`;
/** EUDR Information System: API and UI Validation Rules. */
export const IS_VALIDATION = `${IS_DOCS}/validation-rules.html`;
/** EUDR Information System: Due Diligence Statement V4 API reference. */
export const IS_API_DDS = `${IS_DOCS}/api/due-diligence-statement-v4.html`;

/** RFC 7946, The GeoJSON Format. */
export const RFC7946 = 'https://www.rfc-editor.org/rfc/rfc7946';
/** RFC 8259, The JSON Data Interchange Format. */
export const RFC8259 = 'https://www.rfc-editor.org/rfc/rfc8259';
/** RFC 7493, The I-JSON Message Format. */
export const RFC7493 = 'https://www.rfc-editor.org/rfc/rfc7493';
/** ISO 3166-1 country codes. */
export const ISO3166 = 'https://www.iso.org/iso-3166-country-codes.html';
/** OGC KML 2.2 (OGC 07-147r2). */
export const OGC_KML = 'https://www.ogc.org/standards/kml/';
/** RFC 4180, Common Format and MIME Type for CSV Files. */
export const RFC4180 = 'https://www.rfc-editor.org/rfc/rfc4180';

/** Helpers to build citations. */
export const src = {
  eudr: (where: string): Source => ({ cite: `Regulation (EU) 2023/1115, ${where}`, url: EUDR_CONSOLIDATED }),
  isGeojson: (where: string): Source => ({ cite: `EUDR Information System, GeoJSON File Description, ${where}`, url: IS_GEOJSON }),
  isRules: (rule: string): Source => ({ cite: `EUDR Information System, API and UI Validation Rules, "${rule}"`, url: IS_VALIDATION }),
  isApi: (where: string): Source => ({ cite: `EUDR Information System, DDS V4 API reference, ${where}`, url: IS_API_DDS }),
  rfc7946: (section: string): Source => ({ cite: `RFC 7946, section ${section}`, url: `${RFC7946}#section-${section}` }),
  rfc8259: (section: string): Source => ({ cite: `RFC 8259, section ${section}`, url: `${RFC8259}#section-${section}` }),
  rfc7493: (section: string): Source => ({ cite: `RFC 7493, section ${section}`, url: `${RFC7493}#section-${section}` }),
  iso3166: (): Source => ({ cite: 'ISO 3166-1 alpha-2', url: ISO3166 }),
  implementing: (where: string): Source => ({ cite: `Implementing Regulation (EU) 2024/3084 as amended by (EU) 2026/1565, ${where}`, url: IMPLEMENTING_2026_1565 }),
  kml: (where: string): Source => ({ cite: `OGC KML 2.2, ${where}`, url: OGC_KML }),
  rfc4180: (): Source => ({ cite: 'RFC 4180', url: RFC4180 }),
};
