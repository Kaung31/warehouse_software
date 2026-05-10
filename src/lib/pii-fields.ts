/**
 * PII field inventory + snapshot redactor.
 *
 * This module is the ONE place where PII may be hashed for storage in
 * audit_log. No other code should call `createHash(...)` against
 * customer/user data for audit purposes — go through `redactSnapshot`
 * instead so the inventory and the redaction live in one place.
 *
 * Format of redacted values, per the project brief:
 *   { __pii: true, hash: "<sha256-hex>", len: <int> }
 *
 * Hash is sha256 of the value coerced to string. `len` is the source
 * value's character length (string) or stringified length (other),
 * useful for "did this field actually change" diffing without
 * revealing content.
 *
 * Null / undefined values are left as `null` — there is nothing to
 * leak. Boolean / number fields named in the inventory are still
 * hashed for shape consistency, even though they probably don't
 * appear in real PII inventories.
 *
 * Adding a model:
 *   1. Add an entry to `PII_FIELDS`.
 *   2. Use the EXACT Prisma model name (PascalCase). The audit helper
 *      passes the model name through verbatim.
 *   3. Field names are camelCase (the Prisma client surface), not the
 *      Postgres snake_case column names.
 */

import { createHash } from 'node:crypto'

/**
 * The redacted shape that replaces a PII field's value. The runtime
 * structure is canonical so consumers (BI, audit-log readers,
 * timeline UIs) can recognise it.
 */
export type RedactedPII = {
  __pii: true
  hash:  string | null
  len:   number
}

/**
 * Per-Prisma-model set of fields whose raw values must never appear
 * in audit_log.before / .after.
 *
 * Each entry has a one-line comment explaining why the field is (or
 * isn't) treated as PII. When you add a new model or field, follow
 * the same convention so future devs understand the call without
 * archaeology.
 *
 * Deliberate exclusions (operationally referenced identifiers — NOT
 * personal data, do not redact):
 *   - User.clerkId          // opaque auth token, not personal data; ops needs it readable for support
 *   - Scooter.serialNumber  // device identifier, not a person; appears on labels, invoices, audits
 */
export const PII_FIELDS: Record<string, ReadonlySet<string>> = {
  Customer: new Set([
    'email',         // direct identifier; UK GDPR Art. 4(1)
    'phone',         // direct identifier; reachable contact channel
    'addressLine1',  // street address — fine-grained location PII
    'addressLine2',  // street address — fine-grained location PII
    'postcode',      // UK postcodes resolve to ~15 households on average; treat as PII
    'name',          // PII; operationally referenced often, but raw value never in audit
    'city',          // borderline alone, but combined with other fields enables re-identification
    'notes',         // free text — staff routinely paste sensitive info here
  ]),
  User: new Set([
    'email',         // direct identifier for the staff member
    'name',          // staff name; less sensitive than customer name but still personal
  ]),
  // RepairOrder is the Prisma model name for what the brief calls "Case".
  RepairOrder: new Set([
    // Free-text fields where customer PII commonly leaks.
    'faultDescription', // customer-supplied complaint; often includes name/phone/address
    'diagnosis',        // mechanic's notes; may quote the customer
    'resolution',       // mechanic's notes; may quote the customer
    'internalNotes',    // free text — sensitive ops notes routinely live here
    'rechargeReason',   // explanation sent to CS; sometimes references the customer
    'csPaymentNote',    // CS-typed payment context; can include card-end / bank refs
  ]),
  CaseComment: new Set([
    'content',       // free-text staff comment; the most likely place ad-hoc PII lands
  ]),
  Photo: new Set([
    'caption',       // free-text caption; staff sometimes paste customer info
  ]),
}

/* ─── Per-value redactor ──────────────────────────────────────────── */

/**
 * Replace a single value with the redacted shape. Internal — call
 * `redactSnapshot` from outside this module.
 */
function redactValue(value: unknown): RedactedPII | null {
  if (value === null || value === undefined) return null
  const str  = typeof value === 'string' ? value : JSON.stringify(value)
  const hash = createHash('sha256').update(str).digest('hex')
  return { __pii: true, hash, len: str.length }
}

/**
 * Returns true if the named field on `modelName` is in the PII
 * inventory. Lookup is O(1).
 */
export function isPiiField(modelName: string, fieldName: string): boolean {
  return PII_FIELDS[modelName]?.has(fieldName) ?? false
}

/* ─── Snapshot-level redactor ─────────────────────────────────────── */

/**
 * Walk a flat snapshot object (the kind Prisma produces when you do
 * `findUnique` / `update returning *`) and replace every field that
 * appears in the PII inventory for `modelName`.
 *
 * - Leaves non-PII fields intact.
 * - Returns a new object; doesn't mutate the input.
 * - If `snapshot` is null/undefined (e.g. CREATE has no `before`,
 *   DELETE has no `after`), returns null.
 * - Does not descend into nested relations. Snapshots passed by the
 *   audit helper should be flat — if you need to audit a relation,
 *   record it as its own change.
 */
export function redactSnapshot<T extends Record<string, unknown>>(
  modelName: string,
  snapshot:  T | null | undefined,
): Record<string, unknown> | null {
  if (snapshot === null || snapshot === undefined) return null
  const piiSet = PII_FIELDS[modelName]
  if (!piiSet || piiSet.size === 0) {
    // No PII configured for this model — return the snapshot
    // shallow-copied so the caller can't mutate ours.
    return { ...snapshot }
  }
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(snapshot)) {
    out[key] = piiSet.has(key) ? redactValue(value) : value
  }
  return out
}

/**
 * Compute a shallow diff between two snapshots — keys whose values
 * differ. Returned object preserves the redacted shape of each side
 * (so a diff doesn't reveal raw PII either). Used by the audit
 * helper to populate audit_log.diff.
 */
export function diffSnapshots(
  before: Record<string, unknown> | null,
  after:  Record<string, unknown> | null,
): Record<string, { before: unknown; after: unknown }> | null {
  if (!before || !after) return null
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const out: Record<string, { before: unknown; after: unknown }> = {}
  for (const key of keys) {
    const b = before[key]
    const a = after[key]
    // Cheap deep-equality via JSON. Fine for the flat snapshots we
    // produce; replace with a real deep-eq if relations creep in.
    if (JSON.stringify(b) !== JSON.stringify(a)) {
      out[key] = { before: b, after: a }
    }
  }
  return Object.keys(out).length > 0 ? out : null
}
