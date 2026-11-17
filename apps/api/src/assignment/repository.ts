import type { Db } from "../db";
import type { ExperimentStatus } from "../experiments/schemas";

export interface AssignableRow {
  key: string;
  status: ExperimentStatus;
  traffic_percentage: number;
  variants: { key: string; weight: number }[];
}

/**
 * Experiments with their variants, in a single query.
 * With keys: exactly those, in any status (so the caller can say why there is no variant).
 * Without keys: every running experiment.
 */
export async function findForAssignment(db: Db, keys?: string[]): Promise<AssignableRow[]> {
  const { rows } = await db.query<AssignableRow>(
    `SELECT e.key,
            e.status,
            e.traffic_percentage,
            COALESCE(
              json_agg(json_build_object('key', v.key, 'weight', v.weight) ORDER BY v.key)
                FILTER (WHERE v.id IS NOT NULL),
              '[]'::json
            ) AS variants
       FROM experiments e
       LEFT JOIN variants v ON v.experiment_id = e.id
      WHERE ($1::text[] IS NOT NULL AND e.key = ANY($1::text[]))
         OR ($1::text[] IS NULL AND e.status = 'running')
      GROUP BY e.id
      ORDER BY e.key`,
    [keys ?? null],
  );
  return rows;
}
