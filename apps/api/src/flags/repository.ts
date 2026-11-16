import type { Db } from "../db";
import { buildUpdate } from "../sql";
import type { CreateFlagInput, UpdateFlagInput } from "./schemas";

export interface FlagRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  enabled: boolean;
  rollout_percentage: number;
  created_at: Date;
  updated_at: Date;
}

export interface OverrideRow {
  flag_id: string;
  subject_id: string;
  enabled: boolean;
  created_at: Date;
}

export async function insertFlag(db: Db, input: CreateFlagInput): Promise<FlagRow> {
  const { rows } = await db.query<FlagRow>(
    `INSERT INTO feature_flags (key, name, description, enabled, rollout_percentage)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [input.key, input.name, input.description ?? null, input.enabled, input.rolloutPercentage],
  );
  return rows[0];
}

export async function findFlag(db: Db, id: string): Promise<FlagRow | null> {
  const { rows } = await db.query<FlagRow>("SELECT * FROM feature_flags WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export async function listFlags(
  db: Db,
  limit: number,
  offset: number,
): Promise<{ rows: FlagRow[]; total: number }> {
  const count = await db.query<{ total: number }>("SELECT count(*)::int AS total FROM feature_flags");
  const { rows } = await db.query<FlagRow>(
    "SELECT * FROM feature_flags ORDER BY created_at DESC, id LIMIT $1 OFFSET $2",
    [limit, offset],
  );
  return { rows, total: count.rows[0].total };
}

export async function findFlagsByKeys(db: Db, keys: string[]): Promise<FlagRow[]> {
  const { rows } = await db.query<FlagRow>(
    "SELECT * FROM feature_flags WHERE key = ANY($1::text[]) ORDER BY key",
    [keys],
  );
  return rows;
}

export async function findAllFlags(db: Db): Promise<FlagRow[]> {
  const { rows } = await db.query<FlagRow>("SELECT * FROM feature_flags ORDER BY key");
  return rows;
}

export async function updateFlag(db: Db, id: string, patch: UpdateFlagInput): Promise<FlagRow> {
  const columns: [string, unknown][] = [];
  if (patch.name !== undefined) columns.push(["name", patch.name]);
  if (patch.description !== undefined) columns.push(["description", patch.description]);
  if (patch.enabled !== undefined) columns.push(["enabled", patch.enabled]);
  if (patch.rolloutPercentage !== undefined) columns.push(["rollout_percentage", patch.rolloutPercentage]);

  const { sql, values } = buildUpdate("feature_flags", columns, id, ", updated_at = now()");
  const { rows } = await db.query<FlagRow>(sql, values);
  return rows[0];
}

export async function deleteFlag(db: Db, id: string): Promise<void> {
  await db.query("DELETE FROM feature_flags WHERE id = $1", [id]);
}

export async function upsertOverride(
  db: Db,
  flagId: string,
  subjectId: string,
  enabled: boolean,
): Promise<OverrideRow> {
  const { rows } = await db.query<OverrideRow>(
    `INSERT INTO feature_flag_overrides (flag_id, subject_id, enabled)
     VALUES ($1, $2, $3)
     ON CONFLICT (flag_id, subject_id) DO UPDATE SET enabled = EXCLUDED.enabled
     RETURNING *`,
    [flagId, subjectId, enabled],
  );
  return rows[0];
}

export async function deleteOverride(db: Db, flagId: string, subjectId: string): Promise<boolean> {
  const result = await db.query(
    "DELETE FROM feature_flag_overrides WHERE flag_id = $1 AND subject_id = $2",
    [flagId, subjectId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listOverrides(
  db: Db,
  flagId: string,
  limit: number,
  offset: number,
): Promise<{ rows: OverrideRow[]; total: number }> {
  const count = await db.query<{ total: number }>(
    "SELECT count(*)::int AS total FROM feature_flag_overrides WHERE flag_id = $1",
    [flagId],
  );
  const { rows } = await db.query<OverrideRow>(
    `SELECT * FROM feature_flag_overrides WHERE flag_id = $1
      ORDER BY created_at DESC, subject_id LIMIT $2 OFFSET $3`,
    [flagId, limit, offset],
  );
  return { rows, total: count.rows[0].total };
}

/** The overrides of one subject, for a set of flags: one query for any number of flags. */
export async function findOverridesForSubject(
  db: Db,
  flagIds: string[],
  subjectId: string,
): Promise<Map<string, boolean>> {
  if (flagIds.length === 0) return new Map();
  const { rows } = await db.query<{ flag_id: string; enabled: boolean }>(
    `SELECT flag_id, enabled FROM feature_flag_overrides
      WHERE subject_id = $1 AND flag_id = ANY($2::uuid[])`,
    [subjectId, flagIds],
  );
  return new Map(rows.map((row) => [row.flag_id, row.enabled]));
}
