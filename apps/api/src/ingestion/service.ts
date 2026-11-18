import type { Pool } from "pg";
import { assignVariant, type AssignmentReason } from "../assignment/assign";
import { AppError } from "../errors";
import * as repo from "./repository";
import type { EventInput } from "./schemas";

const MAX_FUTURE_MS = 5 * 60 * 1000; // tolerance for clocks that are a little ahead
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // late events (offline apps) are fine, up to 30 days

export interface ExposureResult {
  recorded: boolean;
  variant: string | null;
  reason: AssignmentReason | "recorded" | "already_exposed";
}

export interface EventsResult {
  received: number;
  accepted: number;
  duplicates: number;
}

export class IngestionService {
  constructor(
    private readonly pool: Pool,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Records that a subject saw an experiment. The variant is computed here, with the same
   * function as /assign, instead of trusting the client: it cannot be spoofed and it always
   * matches what the subject was actually given.
   *
   * Idempotent: only the first exposure counts, and later calls just say so.
   */
  async recordExposure(experimentKey: string, subjectId: string): Promise<ExposureResult> {
    const experiment = await repo.findExperimentForExposure(this.pool, experimentKey);
    if (!experiment) return { recorded: false, variant: null, reason: "not_found" };

    const assignment = assignVariant(
      {
        key: experiment.key,
        status: experiment.status,
        trafficPercentage: experiment.traffic_percentage,
        variants: experiment.variants,
      },
      subjectId,
    );
    if (assignment.variant === null) {
      return { recorded: false, variant: null, reason: assignment.reason };
    }

    const variant = experiment.variants.find((v) => v.key === assignment.variant);
    if (!variant) return { recorded: false, variant: null, reason: "no_variants" };

    const inserted = await repo.insertExposure(this.pool, experiment.id, variant.id, subjectId);
    return {
      recorded: inserted,
      variant: variant.key,
      reason: inserted ? "recorded" : "already_exposed",
    };
  }

  /** All-or-nothing: either the whole batch is valid and stored, or nothing is. */
  async recordEvents(events: EventInput[]): Promise<EventsResult> {
    this.assertTimestamps(events);
    const accepted = await repo.insertEvents(this.pool, events);
    return { received: events.length, accepted, duplicates: events.length - accepted };
  }

  private assertTimestamps(events: EventInput[]): void {
    const now = this.now().getTime();
    const problems: { path: string; message: string }[] = [];

    events.forEach((event, index) => {
      if (!event.occurredAt) return;
      const at = Date.parse(event.occurredAt);
      if (at > now + MAX_FUTURE_MS) {
        problems.push({ path: `events.${index}.occurredAt`, message: "is in the future" });
      } else if (at < now - MAX_AGE_MS) {
        problems.push({ path: `events.${index}.occurredAt`, message: "is older than 30 days" });
      }
    });

    if (problems.length > 0) {
      throw new AppError(400, "VALIDATION_ERROR", "Invalid request data", problems);
    }
  }
}
