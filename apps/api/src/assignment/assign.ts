import { BUCKETS, bucketFor, isInRollout } from "../bucketing";
import type { ExperimentStatus } from "../experiments/schemas";

export type AssignmentReason = "assigned" | "not_running" | "not_in_traffic" | "no_variants" | "not_found";

export interface Assignment {
  variant: string | null;
  reason: AssignmentReason;
}

export interface AssignableExperiment {
  key: string;
  status: ExperimentStatus;
  trafficPercentage: number;
  variants: { key: string; weight: number }[];
}

/**
 * Decides which variant of an experiment a subject sees.
 *
 * Two independent draws, each with its own salt:
 *  1. the traffic gate: is the subject part of the experiment at all?
 *  2. the variant draw: which variant, according to the weights?
 *
 * Using the SAME hash for both would be a subtle bug: the subjects that pass the gate
 * would all sit in the low buckets, so the first variants would get too many of them.
 *
 * Pure function: same input, same output, on any machine.
 */
export function assignVariant(experiment: AssignableExperiment, subjectId: string): Assignment {
  if (experiment.status !== "running") return { variant: null, reason: "not_running" };
  if (experiment.variants.length === 0) return { variant: null, reason: "no_variants" };

  if (!isInRollout(subjectId, `${experiment.key}:traffic`, experiment.trafficPercentage)) {
    return { variant: null, reason: "not_in_traffic" };
  }

  // Sorted by key, so the result never depends on the order the database returned them in
  const variants = [...experiment.variants].sort((a, b) => a.key.localeCompare(b.key));
  const totalWeight = variants.reduce((sum, variant) => sum + variant.weight, 0);

  // Integer math: bucket / BUCKETS < cumulative / totalWeight, without rounding errors
  const scaled = bucketFor(subjectId, `${experiment.key}:variant`) * totalWeight;
  let cumulative = 0;
  for (const variant of variants) {
    cumulative += variant.weight;
    if (scaled < cumulative * BUCKETS) return { variant: variant.key, reason: "assigned" };
  }

  // Unreachable: the last cumulative weight equals the total
  return { variant: variants[variants.length - 1].key, reason: "assigned" };
}
