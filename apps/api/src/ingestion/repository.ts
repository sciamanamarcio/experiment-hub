import type { Db } from "../db";
import type { ExperimentStatus } from "../experiments/schemas";
import type { EventInput } from "./schemas";

export interface ExperimentForExposure {
  id: string;
  key: string;
  status: ExperimentStatus;
  traffic_percentage: number;
  variants: { id: string; key: string; weight: number }[];
}

export async function findExperimentForExposure(
  db: Db,
  key: string,
): Promise<ExperimentForExposure | null> {
  const { rows } = await db.query<ExperimentForExposure>(
    `SELECT e.id,
            e.key,
            e.status,
            e.traffic_percentage,
            COALESCE(
              json_agg(json_build_object('id', v.id, 'key', v.key, 'weight', v.weight) ORDER BY v.key)
                FILTER (WHERE v.id IS NOT NULL),
              '[]'::json
            ) AS variants
       FROM experiments e
       LEFT JOIN variants v ON v.experiment_id = e.id
      WHERE e.key = $1
      GROUP BY e.id`,
    [key],
  );
  return rows[0] ?? null;
}

/**
 * Records the first exposure of a subject to an experiment.
 * Returns false when it was already recorded: the database decides, so two requests
 * arriving at the same time can never create two rows.
 */
export async function insertExposure(
  db: Db,
  experimentId: string,
  variantId: string,
  subjectId: string,
): Promise<boolean> {
  const { rows } = await db.query(
    `INSERT INTO exposures (experiment_id, variant_id, subject_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (experiment_id, subject_id) DO NOTHING
     RETURNING id`,
    [experimentId, variantId, subjectId],
  );
  return rows.length > 0;
}

/**
 * Inserts a batch of events in one statement and returns how many were new.
 * An event whose idempotency key already exists is skipped. Events without a key are always stored.
 */
export async function insertEvents(db: Db, events: EventInput[]): Promise<number> {
  const { rows } = await db.query(
    `INSERT INTO events (idempotency_key, subject_id, name, value, properties, occurred_at)
     SELECT key, subject, name, value, properties::jsonb, COALESCE(occurred_at, now())
       FROM unnest($1::text[], $2::text[], $3::text[], $4::numeric[], $5::text[], $6::timestamptz[])
            AS t(key, subject, name, value, properties, occurred_at)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [
      events.map((e) => e.idempotencyKey ?? null),
      events.map((e) => e.subjectId),
      events.map((e) => e.name),
      events.map((e) => String(e.value)),
      events.map((e) => JSON.stringify(e.properties)),
      events.map((e) => e.occurredAt ?? null),
    ],
  );
  return rows.length;
}
