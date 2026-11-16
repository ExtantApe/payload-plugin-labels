# Changelog

## Unreleased

- **Core engine** (`src/core`, no Payload, no React): `layout(template, data, media, context)` returns positioned marks in millimeters with warnings; field tokens with dotted paths (up to 4 segments) and the formatters `date`, `money`, `upper`, `lower`, `default` and `slice`, parsed without `eval`; text fitting by shrink, ellipsis or wrap; barcode value checks; sheet grid positions from a start slot; the 4 x 6 inch thermal preset.
- **Provider contract** (`src/contracts/labels.ts`, types only): templates, sets and tokens that other plugins can offer.
- **Plugin**: `labelsPlugin()` adds `label-templates`, `label-media` and `label-prints`. Writes are refused unless the site grants them with an `access` check that returns exactly `true`. Options `scopeField` with `scopeCollection`, and `log`.

No version bump (still 0.0.0).

Tested: 20 tests with made-up data. Core math and tokens, plus a Payload config build checking the collections, default access, strict access answers and the scope field.
Not tested: any database, PDF or SVG output (not built), barcode drawing, the print endpoint, the admin UI, site filtering for `scopeField` (fields only, no query filter yet), real printers.
