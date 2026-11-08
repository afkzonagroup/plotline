# Changelog

All notable changes are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-11-08

### Added

- Validation of plot geolocation against Regulation (EU) 2023/1115 as
  amended by (EU) 2024/3234 and (EU) 2025/2650, and the Commission's
  published EUDR Information System rules: 51 rules, each with its source
  and status (requirement, interpretation, recommendation, safety limit).
- Safe repairs with a report of every change; geodesic plot areas on WGS 84;
  duplicate and overlap detection; splitting to the Information System's
  size and producer limits; base64 producer data for the DDS API.
- Readers for GeoJSON, KML 2.2 and CSV with strict size, depth and count
  limits.
- Command line tool, offline single-file web page, GitHub Action, Docker
  image.
- Python package with the same rules and shared test vectors.
