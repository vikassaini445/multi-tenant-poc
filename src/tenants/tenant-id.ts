const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tenant IDs are UUIDs. Anything else is rejected before it reaches SQL. */
export function isTenantId(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}
