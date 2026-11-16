# Changelog

## Unreleased

- **Core engine** (`src/core`, no Payload, no React): `layout(template, data, media, context)` returns positioned marks in millimeters with warnings; field tokens with dotted paths (up to 4 segments) and the formatters `date`, `money`, `upper`, `lower`, `default` and `slice`, parsed without `eval`; text fitting by shrink, ellipsis or wrap; barcode value checks; sheet grid positions from a start slot; the 4 x 6 inch thermal preset.
- **Provider contract** (`src/contracts/labels.ts`, types only): templates, sets and tokens that other plugins can offer.
- **Plugin**: `labelsPlugin()` adds `label-templates`, `label-media` and `label-prints`. Writes are refused unless the site grants them with an `access` check that returns exactly `true`. Options `scopeField` with `scopeCollection` and `scopeOf`, and `log`. With a scope field, reads, creates, updates and deletes are limited to the person's own scope (records with no scope are readable by all, and changed only by a platform admin); no scope means no access.

No version bump (still 0.0.0).

Tested: 28 tests with made-up data. Core math and tokens; a Payload config build checking the collections, default access and strict answers; and an in-memory MongoDB run with two sites proving cross-scope reads, creates, updates, deletes and moves are refused, the shared template is admin-only, the print log is unwritable, and signed-out and scope-less users get nothing.
Not tested: any database, PDF or SVG output (not built), barcode drawing, the print endpoint, the admin UI, real printers.
