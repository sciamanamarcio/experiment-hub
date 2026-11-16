import { z } from "zod";

const slug = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "must use lowercase letters, numbers and hyphens");
const name = z.string().trim().min(1).max(120);
const description = z.string().trim().max(1000);
const rolloutPercentage = z.number().int().min(0).max(100);
const subjectId = z.string().min(1).max(200);

export const createFlagSchema = z.strictObject({
  key: slug,
  name,
  description: description.optional(),
  enabled: z.boolean().default(false),
  rolloutPercentage: rolloutPercentage.default(0),
});

export const updateFlagSchema = z
  .strictObject({
    name: name.optional(),
    description: description.nullable().optional(),
    enabled: z.boolean().optional(),
    rolloutPercentage: rolloutPercentage.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "at least one field is required" });

export const overrideBodySchema = z.strictObject({ enabled: z.boolean() });

export const evaluateSchema = z.strictObject({
  subjectId,
  keys: z.array(slug).max(100).optional(),
});

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const flagParams = z.object({ id: z.uuid() });
export const overrideParams = z.object({ id: z.uuid(), subjectId });

export type CreateFlagInput = z.output<typeof createFlagSchema>;
export type UpdateFlagInput = z.output<typeof updateFlagSchema>;
export type ListQuery = z.output<typeof listQuerySchema>;
