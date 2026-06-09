import { z } from 'zod';

export const FathomSecret = z.object({
  apiToken: z.string().min(1), // Fathom Bearer API token
});
export type FathomSecret = z.infer<typeof FathomSecret>;
