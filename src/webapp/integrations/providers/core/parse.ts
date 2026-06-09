import type { z } from 'zod';
import { authError, permanentError } from './errors.ts';

// Validate raw connection config/secret with a provider's Zod schema, mapping
// failures onto the provider error taxonomy.
export const parseConfig = <TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  value: unknown,
): z.infer<TSchema> => {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw permanentError(`Invalid provider config: ${result.error.message}`);
  }
  return result.data;
};

export const parseSecret = <TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  value: unknown,
): z.infer<TSchema> => {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw authError(`Invalid provider secret: ${result.error.message}`);
  }
  return result.data;
};
