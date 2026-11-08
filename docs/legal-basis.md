# Legal basis

Quotes are from the consolidated text of Regulation (EU) 2023/1115 of
18 September 2026, which includes the amendments by Regulation (EU)
2024/3234, Regulation (EU) 2025/2650 and Delegated Regulation (EU) 2026/2102:
<https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R1115-20260918>.
A copy of the quoted articles is in
`test-vectors/sources/eudr-2023-1115-consolidated-2026-09-18.txt`; tests check
that the rule catalogue quotes them word for word. The consolidated text is
for documentation only; the authentic texts are those published in the
Official Journal.

## Definitions (Article 2)

Point (27):

> ‘plot of land’ means land within a single real-estate property, as recognised by the law of the country of production, which enjoys sufficiently homogeneous conditions to allow an evaluation of the aggregate level of risk of deforestation and forest degradation associated with relevant commodities produced on that land;

Point (28):

> ‘geolocation’ means the geographical location of a plot of land described by means of latitude and longitude coordinates corresponding to at least one latitude and one longitude point and using at least six decimal digits; for plots of land of more than four hectares used for the production of the relevant commodities other than cattle, this shall be provided using polygons with sufficient latitude and longitude points to describe the perimeter of each plot of land;

Point (29):

> ‘establishment’ means any premises, structure, or, in the case of open-air farming, any environment or place, where livestock are kept, on a temporary or permanent basis;

## The due diligence statement

Article 4(2):

> Operators shall not place relevant products on the market or export them without prior submission of a due diligence statement. Operators who, on the basis of the due diligence exercised in accordance with Article 8, conclude that the relevant products comply with Article 3 shall, before placing the relevant products on the market or exporting them, make available a due diligence statement to the competent authorities through the information system referred to in Article 33. Such electronically available and transmittable due diligence statement shall contain the information set out in Annex II for the relevant products and a declaration by the operator that the operator exercised due diligence and that no or only a negligible risk was found.

Article 9(1), point (d):

> (d) the geolocation of all plots of land where the relevant commodities that the relevant product contains, or has been made using, were produced, as well as the date or time range of production; where a relevant product contains or has been made with relevant commodities produced on different plots of land, the geolocation of all different plots of land shall be included; any deforestation or forest degradation on the given plots of land shall automatically disqualify all relevant commodities and relevant products from those plots of land from being placed or made available on the market or exported; for relevant products that contain or have been made using cattle, and for such relevant products that have been fed with relevant products, the geolocation shall refer to all the establishments where the cattle were kept; for all other relevant products of Annex I, the geolocation shall refer to the plots of land;

Annex II, point 3:

> Country of production and the geolocation of all plots of land where the relevant commodities were produced. For relevant products that contain or have been made using cattle, and for such relevant products that have been fed with relevant products, the geolocation shall refer to all the establishments where the cattle were kept. Where the relevant product contains or has been made using commodities produced in different plots of land, the geolocation of all plots of land shall be included in accordance with Article 9(1), point (d).

## Simplified declaration (Article 4a, Annex III; added by Regulation (EU) 2025/2650)

Article 4a(5):

> For micro or small primary operators, the geolocation referred to in Article 9(1), point (d), may be replaced by the postal address of all plots of land or the postal address of the establishment from which the relevant commodities that the relevant product contains, or has been made using, were produced.

Annex III, point 3:

> Country of production and the geolocation of all plots of land, or the postal address of the establishment or of all plots of land on which the micro or small primary operator produces relevant commodities. For relevant products that contain or have been made using cattle, and for such relevant products that have been fed with relevant products, the postal address or the geolocation shall refer to all the establishments where the cattle are kept. Where the relevant products are produced on different plots of land, the postal address or the geolocation of all plots of land shall be included in accordance with Article 9(1), point (d).

Plotline checks geolocation given in a simplified declaration the same way.
It does not check postal addresses.

## Information System (Article 33)

Article 33(1):

> By 30 December 2024, the Commission shall establish and subsequently shall maintain an information system which shall contain the due diligence statements made available pursuant to Article 4(2).

The Commission's operator documentation for the Information System sets the
file rules Plotline applies: the
[GeoJSON File Description](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/geojson-description.html)
(updated 17 August 2026) and the
[API and UI Validation Rules](https://eudr.webcloud.ec.europa.eu/tracesnt/help/eudr-documentation/operator/validation-rules.html).
Copies of both, as read on 8 November 2026, are in `test-vectors/sources/`.
Commission Implementing Regulation (EU) 2024/3084, as amended by
Implementing Regulation (EU) 2026/1565, lets operators group statements
(Article 8a) and lets the Commission set technical file-size limits
(Article 15(4)).

## Dates (Article 38, as replaced by Regulation (EU) 2025/2650)

Article 38(2):

> Subject to paragraph 3 of this Article, Articles 3 to 13, Articles 16 to 24 and Articles 26, 31 and 32 shall apply from 30 December 2026.

Article 38(3):

> Except as regards the products covered by the Annex to Regulation (EU) No 995/2010, for operators, whether natural persons or micro- or small undertakings within the meaning of Article 3(1) or Article 3(2), first subparagraph, respectively, of Directive 2013/34/EU, irrespective of their legal form, who were established as such by 31 December 2024, the Articles referred to in paragraph 2 of this Article shall apply from 30 June 2027.

- Regulation (EU) 2023/1115 entered into force on 29 June 2023 (twentieth day
  after publication in OJ L 150 of 9 June 2023).
- Regulation (EU) 2024/3234 (OJ L, 23.12.2024) and Regulation (EU) 2025/2650
  (OJ L, 23.12.2025) each entered into force on the third day after
  publication.
- Delegated Regulation (EU) 2026/2102 (OJ L, 17.9.2026) entered into force on
  the day after publication; its new Annex I entries marked so apply from
  30 December 2027.
- Regulation (EU) No 995/2010 (EU Timber Regulation) is repealed with effect
  from 30 December 2026, with transitional rules to 31 December 2029 for
  timber produced before 29 June 2023 (Article 37 as replaced).

## What the law leaves open, and what Plotline does

| Question | Official text | Plotline |
|---|---|---|
| How to measure the four hectares | Not specified | Geodesic area on the WGS 84 ellipsoid ([area.md](area.md)); for points, the declared `Area` |
| Whether trailing zeros count as decimal digits | Not specified | Warns only when no coordinate of a plot has six decimals |
| What makes a geometry "invalid" | Examples in the GeoJSON File Description | Those examples as requirements; overlapping MultiPolygon parts as an interpretation |
| Overlapping or duplicate plots | Not addressed | Reported as recommendations |
| Ring winding order | Not addressed by the Commission; RFC 7946 says MUST for writers and SHOULD NOT reject for parsers | Reported as a note and repaired |
| Whether "25Mb" means 10⁶ or 2²⁰ bytes | Not specified | 25,000,000 bytes, the smaller |
| Whether the system truncates or rounds to six decimals | The Important notes and the "Geolocation invalid coordinates" rule say "truncate"; common error 7 says "rounding" (its example gives the same result either way) | Truncates toward zero, as the two explicit statements say |
| Whether ranges are checked before or after truncation | Not specified | Before: a value such as −180.0000001 is reported as out of range; `fix` writes it truncated (−180), which is in range, and lists that change |
| Area of MultiPoint plots, and of points inside a GeometryCollection | "Area" is documented for "Point" geometries | Area rules are applied to Point features only; the minimum of 0.0001 ha also to MultiPoint |
