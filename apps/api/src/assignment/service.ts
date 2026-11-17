import type { Pool } from "pg";
import { assignVariant, type Assignment } from "./assign";
import { findForAssignment } from "./repository";

export interface AssignmentResult {
  subjectId: string;
  experiments: Record<string, Assignment>;
}

export class AssignmentService {
  constructor(private readonly pool: Pool) {}

  /**
   * Which variant does this subject see? Without `keys`, every running experiment is considered.
   * A requested key that does not exist is answered with no variant, so an application keeps
   * working (with its default experience) if an experiment is deleted or not created yet.
   *
   * This only computes the assignment. Recording that the subject actually saw it
   * (the exposure) is a separate step.
   */
  async assign(subjectId: string, keys?: string[]): Promise<AssignmentResult> {
    const uniqueKeys = keys ? [...new Set(keys)] : undefined;
    const rows = await findForAssignment(this.pool, uniqueKeys);

    const experiments: Record<string, Assignment> = {};
    for (const row of rows) {
      experiments[row.key] = assignVariant(
        {
          key: row.key,
          status: row.status,
          trafficPercentage: row.traffic_percentage,
          variants: row.variants,
        },
        subjectId,
      );
    }
    for (const key of uniqueKeys ?? []) {
      if (!(key in experiments)) experiments[key] = { variant: null, reason: "not_found" };
    }

    return { subjectId, experiments };
  }
}
