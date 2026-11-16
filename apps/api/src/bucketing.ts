import { createHash } from "node:crypto";

export const BUCKETS = 10_000;

/**
 * Maps a subject to a stable bucket from 0 to 9999.
 *
 * The algorithm is deliberately simple so SDKs in other languages can reproduce it:
 *   SHA-256 of "<salt>:<subjectId>", first 4 bytes as a big-endian unsigned integer, modulo 10000.
 *
 * The salt (the flag or experiment key) makes each one bucket the same people differently,
 * so being early in one rollout does not mean being early in all of them.
 */
export function bucketFor(subjectId: string, salt: string): number {
  const digest = createHash("sha256").update(`${salt}:${subjectId}`).digest();
  return digest.readUInt32BE(0) % BUCKETS;
}

/** True when the subject falls inside the first `percentage` percent of the buckets. */
export function isInRollout(subjectId: string, salt: string, percentage: number): boolean {
  return bucketFor(subjectId, salt) < percentage * (BUCKETS / 100);
}
