# Safe business backup and recovery

The previous restore implementation deleted current tables before creating replacement rows. Read errors, create failures, interrupted tabs, old cached snapshots and ambiguous ID mappings could leave an empty or partially reconstructed database. The current admin entry points no longer contain that implementation.

## Export

- Read all 13 business/derived tables sequentially with SDK positional pagination, bounded retries and strict response validation. Preserve archived, isolated and historical rows in the file.
- Compare two complete scans, including content and IDs. A changing table or failed page aborts the export. Do not merge live tables with static repository files or cached data and label that result current.
- Embed workflow attachment bytes, deduplicate URLs and checksum each attachment. Any failed attachment aborts export. Recheck table content after downloading attachments. Limit total attachment bytes to 100 MB.
- Write a version 2 envelope with application ID, capture times and a SHA-256 digest over canonical JSON. Save and read back a local IndexedDB copy before downloading.
- Customer counts in the envelope distinguish raw table rows from visible, active and archived customers. Derived statistics are retained for audit, never trusted over customer records.

## Restore

Restore means **fill missing records and preserve current edits**. It does not mean replacing the current database with the exact historical state.

1. Validate format/version, checksum, table allowlist, IDs, customer ownership and progress references before writing anything. Support signed business V1, business V2, signed full V4/legacy JSON, and V5 ZIP business data. V5 ZIP uses archive CRC validation; old formats do not provide all of V2's integrity guarantees. No repository code or templates are restored from these files.
2. Capture current live data and attachments. Persist the source, the original pre-restore safety copy, a fresh safety copy for each attempt, and a durable progress journal in IndexedDB. Read back the safety/source copies before proceeding. The safety download button retrieves the latest attempt's pre-write snapshot.
3. Show counts of proposed creates, existing rows, conflicts and unresolved associations. Require the administrator's confirmation of that concrete plan. Keep buttons disabled and use a Web Lock to prevent another same-origin tab from starting simultaneously.
4. Match records using source IDs and stable legacy/natural identities. Preserve conflicting current records and report them. Never match progress stages by array position. Remap customer IDs, representative usernames, field keys, progress IDs, log references and workflow keys.
5. Record intent durably before each create. Recheck the stable identity before creating. Read back and compare every inserted record. Do not retry a create after a lost response or timeout. A later attempt can resume only if that write can be found, or otherwise stops for investigation. Ordinary read retries are bounded.
6. Never delete or update existing entity records in this recovery engine. On interruption, existing records and successfully recovered rows remain in place. The administrator can select the same file again; its checksum finds the same journal. Unresolved links are reported instead of silently attaching them to another customer.
7. Emit a recovery report and distinguish a complete clean result from a result with preserved conflicts/skipped links. Recompute displayed customer counts through the existing customer loader. Never restore obsolete dashboard cache values.

## Operational limits

- A browser client and the available entity SDK do not provide a distributed database transaction. The Web Lock covers tabs in the same browser origin, not simultaneous restores on different computers. Stable-identity rechecks reduce duplicate creation risk; server-enforced unique keys would be needed for a distributed guarantee.
- Local insurance copies and journals belong to this browser profile. Clearing browser storage removes them; retain downloaded backups separately. No automated cleanup deletes these copies.
- Existing conflicts are intentionally preserved and listed for separate review. This process cannot promise an exact historical overwrite. Old backups that only contain attachment links cannot recreate missing attachment bytes.
- Restoring a missing row creates a new server ID/time. Original server fields remain in the backup for reference; business relationship IDs are remapped.
- Reads can be checked for stability but are not a server-side point-in-time snapshot. If other users keep writing during capture, export stops and asks for a quieter interval.

## Validation

Node 24: `node --test tests/*.test.mjs`. Restricted local environments can use `node --test --test-isolation=none tests/*.test.mjs`.

Regression tests cover complete export and changing snapshots, malformed/failed reads, checksums after JSON serialization, legacy compatibility, graph validation, missing-row restoration, current-edit preservation, repeated imports, ownership/field renames, ambiguous identities, lost create responses, write timeouts, readback failures, journal failures, pre-confirmation safety persistence, cancellation, cross-tab locks, attachment checksums and the customer list regressions.

The repair was also simulated against local copies of the current cloud data and the user's original backup. Existing records were compared before/after and remained unchanged. These tests did not execute a production restore.
