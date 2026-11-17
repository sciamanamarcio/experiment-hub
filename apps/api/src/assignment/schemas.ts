import { z } from "zod";

const slug = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "must use lowercase letters, numbers and hyphens");

export const assignSchema = z.strictObject({
  subjectId: z.string().min(1).max(200),
  keys: z.array(slug).max(100).optional(),
});
