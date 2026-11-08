# Plotline (Python)

Checks, repairs, measures and splits plot geolocation files for the EU
Deforestation Regulation (Regulation (EU) 2023/1115), on your own computer.
Same rules as the TypeScript package `@afkzona/plotline`; both pass one
shared set of test vectors, with byte-identical repaired output.

```python
import plotline

report = plotline.validate(open("plots.geojson", "rb").read(), commodity="cocoa")
for issue in report["issues"]:
    print(issue["severity"], issue["rule"], issue["path"], issue["message"])

fixed = plotline.fix(open("plots.geojson", "rb").read())
if fixed["output"] is not None:
    open("plots.fixed.geojson", "w", encoding="utf-8").write(fixed["output"])

parts = plotline.split(open("big.geojson", "rb").read())  # within 25,000,000 bytes per part
```

Functions: `validate`, `fix`, `split`, `convert`, `read_plots`,
`to_dds_producers`, `rules`. Input: GeoJSON, KML or CSV, as `bytes` or `str`.
No dependencies; Python 3.10 or later. Command line: `plotline-py
validate|fix|split <file>`.

Every rule cites its official source; see the project README and
`docs/rules.md` at https://github.com/afkzonagroup/plotline.

Not legal advice. Plotline checks the format and geometry of geolocation
data; it does not check deforestation or legality and does not make anyone
compliant.

Plotline by AFKzona Group – https://afkzonagroup.lt. Licensed under
AGPL-3.0-only with an attribution term (LICENSE-ADDITIONAL-TERMS.md);
commercial licences: info@afkzonagroup.lt.
