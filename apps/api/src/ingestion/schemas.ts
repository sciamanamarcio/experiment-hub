import { z } from "zod";

const slug = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "must use lowercase letters, numbers and hyphens");
const subjectId = z.string().min(1).max(200);

export const MAX_EVENTS_PER_BATCH = 100;
const MAX_PROPERTIES_BYTES = 4096;

export const exposureSchema = z.strictObject({
  experimentKey: slug,
  subjectId,
});

const eventSchema = z.strictObject({
  subjectId,
  // snake_case names such as "purchase" or "checkout_completed"
  name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, "must be snake_case, starting with a letter"),
  value: z.number().min(-1e12).max(1e12).default(0),
  properties: z
    .record(z.string(), z.unknown())
    .default({})
    .refine((value) => JSON.stringify(value).length <= MAX_PROPERTIES_BYTES, {
      message: `properties must be at most ${MAX_PROPERTIES_BYTES} bytes as JSON`,
    }),
  // Lets a client retry the same event without it being counted twice
  idempotencyKey: z.string().min(1).max(128).optional(),
  // When it happened on the client; defaults to the time of arrival
  occurredAt: z.iso.datetime({ offset: true }).optional(),
});

export const eventsBatchSchema = z.strictObject({
  events: z.array(eventSchema).min(1).max(MAX_EVENTS_PER_BATCH),
});

export type ExposureInput = z.output<typeof exposureSchema>;
export type EventInput = z.output<typeof eventSchema>;
