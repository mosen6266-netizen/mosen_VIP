# Customer loading reliability

## Behavior

- Customer reads use the SDK's positional `list(sort, limit, skip)` and `filter(query, sort, limit, skip)` signatures. Admin reads all customer records; sales always includes the exact representative scope.
- A complete scan is validated before publishing rows. Only `duplicate_record === true` is hidden; missing `archived` is treated as active. Filtering, sorting, pagination and displayed counts use the same snapshot, without relying on search-index backfills or statistic caches.
- Requests time out after 10 seconds per attempt and retry at most three times for network errors, 408, 429 and 5xx responses. Backoff includes jitter and respects Retry-After up to 15 seconds. Invalid response shapes and incomplete scans cannot replace a successful list.
- A successful snapshot is cached in sessionStorage for 30 minutes, scoped to admin or the representative username, and cleared on logout. Cached results are labeled while refreshing and when the server is unavailable. They are not presented as verified current server data. With no successful snapshot, failure displays an error and a retry action, not an empty-list message.
- Concurrent reads share work. View changes reject old completions. Refreshes caused by mutations or subscription events request a scan after any pending read. Event bursts are coalesced; partial event payloads never remove or replace customer rows directly.
- Opening the pages no longer runs historical integrity repair, index backfill, log archival, daily maintenance or statistic reconciliation. Statistic subscriptions cannot form write/read feedback loops. Explicit backup restores may still rebuild derived statistics, but only after a complete customer scan.
- Counts are not hardcoded. A read-only cloud audit on 2026-09-29 found 79 physical records, one flagged duplicate, and 78 visible customers: 69 active and 9 archived. No customer records were modified by this repair.

## Validation

Run with Node 24:

```sh
node --check customer-loader.js
node --check admin-app.js
node --check sales-app.js
node --check vip-optimizations.js
node --test tests/customer-loading.test.mjs
```

In restricted environments that disallow child processes, use `node --test --test-isolation=none tests/customer-loading.test.mjs`.

Tests cover counts and pagination, missing flags, sales scope, 1,001-record pagination, malformed results, 429/backoff, timeouts, incomplete scans, cache expiry/logout, empty confirmation, out-of-order views, maintenance/event bursts, post-mutation reads, and the real table-rendering functions retaining existing HTML on failed refresh. Application integration tests use a DOM stub and mocked SDK; they do not replace authenticated browser testing against Base44.

Manual browser acceptance: reload admin repeatedly; verify 69 active across 50 + 19 rows and 9 archived; switch archive/representative/search during a slow request; go offline after a successful read and reload; verify a stale-data notice and retry; reconnect and retry; check a sales account can only see its own active and archived customers.

The Pages build hashes the entry scripts in HTML; the new shared module and optimization imports also carry the `20260929-stable-load1` version. Old already-open tabs must reload to stop running their previous background-maintenance code.
