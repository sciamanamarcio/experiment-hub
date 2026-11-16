import { isInRollout } from "../bucketing";

export type Reason = "disabled" | "override" | "rollout" | "not_in_rollout" | "not_found";

export interface Evaluation {
  enabled: boolean;
  reason: Reason;
}

export interface FlagRules {
  key: string;
  enabled: boolean;
  rolloutPercentage: number;
}

/**
 * Decides whether a flag is on for a subject. The order matters:
 *  1. a disabled flag is off for everyone, overrides included (it works as a kill switch)
 *  2. an override for the subject wins over the rollout
 *  3. otherwise the subject is on when its bucket falls inside the rollout percentage
 *
 * Pure function: no database, no clock, no randomness.
 */
export function evaluateFlag(
  flag: FlagRules,
  subjectId: string,
  override: boolean | undefined,
): Evaluation {
  if (!flag.enabled) return { enabled: false, reason: "disabled" };
  if (override !== undefined) return { enabled: override, reason: "override" };

  return isInRollout(subjectId, flag.key, flag.rolloutPercentage)
    ? { enabled: true, reason: "rollout" }
    : { enabled: false, reason: "not_in_rollout" };
}
