import { z } from 'zod';

export const FathomConfig = z.object({
  entityId: z.string().min(1), // Fathom site id
  baseUrl: z.string().url().default('https://api.usefathom.com'),
});
export type FathomConfig = z.infer<typeof FathomConfig>;
