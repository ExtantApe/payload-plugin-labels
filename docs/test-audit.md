# Test audit

Newest first.

## 2026-11-16: core and plugin shell

- Promises: tokens never run code; a missing value is reported; text fits by its rule; sheet positions follow the start slot; the 4 x 6 in preset size; writes are closed by default and only `true` passes; the print log is never writable through the API.
- Covered: all of the above in `test/core.test.ts` and `test/plugin.test.ts` (20 tests), including code-like tokens, inherited property names, a throwing access check and a truthy non-`true` answer.
- Gaps skipped (and why): no database tests, because nothing reads or writes records yet. Site isolation, the 2,000-label limit, PDF page checks and preview-equals-PDF wait for the code they test.

## 2026-11-10: first audit (starter kit)

- Promises: none yet.
- Covered: none yet.
- Gaps added: none.
- Gaps skipped (and why): none.
