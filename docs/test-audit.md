# Test audit

Newest first.

## 2026-11-16: retention and images

- Promises: entries older than `keepDays` are deleted, recent ones stay, 0 keeps all, the default is 180; images draw in SVG and PDF; a web address is never fetched; another collection, an unreadable upload and a file that is not a PNG or JPEG give a placeholder and a warning.
- Covered: `test/images.test.ts` (5 tests; real in-memory MongoDB and a temporary upload folder).
- Gaps skipped (and why): cloud storage adapters, a scheduled job (the site's), size-limit path (a 5 MB file test is slow for little gain; the check is one comparison), how the image looks printed (hands-on).

## 2026-11-16: fail closed and template lookup

- Promises: with neither `access.manage` nor `access.print` the config throws and names them; manage-only means a plain signed-in member can neither print nor read templates; print-only lets printers print and read templates but not change them or read the log; a template is found by key, then by id as given.
- Covered: three tests in `test/plugin.test.ts` and one in `test/print.test.ts` (the lookup uses a stand-in for Payload, so it does not depend on Mongo ids).
- Gaps skipped (and why): numeric ids on a real Postgres or SQLite (needs another database; the lookup passes the id through unchanged).

## 2026-11-16: print endpoint

- Promises: signed-out, no-scope, other-scope template, unreadable record and over-limit requests are refused and print nothing; a good request returns a PDF with one page per label and writes one log entry holding ids and counts only; the log cannot be written through the API.
- Covered: `test/print.test.ts` (6 tests) on in-memory MongoDB with two sites and site-limited read access on the printed collection.
- Gaps skipped (and why): HTTP-level routing (Payload's own); the no-`print`-check default and a `print` check returning non-true are covered by the shared access code, not repeated here; render time at 2,000 labels (the test renders 2,000 pages but does not measure time).

## 2026-11-16: SVG and PDF output

- Promises: a 4 x 6 in label makes a one-page PDF 288 x 432 pt; the SVG viewBox is the label in mm; text is escaped; barcodes render as vectors; an invalid value warns and never crashes either output; both outputs draw one mark list.
- Covered: `test/render.test.ts` (6 tests).
- Gaps skipped (and why): reading the PDF back with a parser or scanning a barcode (needs extra tools; hands-on check with a printer instead); a byte-level preview-equals-PDF comparison, because the PDF carries a creation date and both outputs are fed the same marks by construction.

## 2026-11-16: scope filtering

- Promises: a person sees and changes only their own site's templates, media and print log; shared templates are readable by all and changed only by a platform admin; no scope or no sign-in means no access; the print log is never written through the API.
- Covered: `test/scope.test.ts` on an in-memory MongoDB, two sites plus a platform admin, a scope-less user and a signed-out request (8 tests): cross-scope read, create, update, delete and move are refused, shared template rules, media, log.
- Gaps skipped (and why): the print endpoint's own scope check (printing only reads the person's site) waits for the endpoint. A scopeOf that throws is covered by the shared strict-answer code path rather than its own test.

## 2026-11-16: core and plugin shell

- Promises: tokens never run code; a missing value is reported; text fits by its rule; sheet positions follow the start slot; the 4 x 6 in preset size; writes are closed by default and only `true` passes; the print log is never writable through the API.
- Covered: all of the above in `test/core.test.ts` and `test/plugin.test.ts` (28 tests), including code-like tokens, inherited property names, a throwing access check and a truthy non-`true` answer.
- Gaps skipped (and why): no database tests, because nothing reads or writes records yet. Site isolation, the 2,000-label limit, PDF page checks and preview-equals-PDF wait for the code they test.

## 2026-11-10: first audit (starter kit)

- Promises: none yet.
- Covered: none yet.
- Gaps added: none.
- Gaps skipped (and why): none.
