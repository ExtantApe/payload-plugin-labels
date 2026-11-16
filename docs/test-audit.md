# Test audit

Newest first.

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
