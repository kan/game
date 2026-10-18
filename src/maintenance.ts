/**
 * Deletes expired transfer codes and migration tokens. Runs once a day
 * (docs/ID_DESIGN.md「D1 のスキーマ」); redeeming already ignores expired rows.
 */
export async function deleteExpiredRows(
  db: D1Database,
  now: number,
): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM transfer_codes WHERE expires_at <= ?").bind(now),
    db.prepare("DELETE FROM migration_tokens WHERE expires_at <= ?").bind(now),
  ]);
}
