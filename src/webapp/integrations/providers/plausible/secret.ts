import { z } from 'zod';

// Stored in Secrets Manager at moimetric/<stage>/connections/<connectionId>.
export const PlausibleSecret = z.object({
  apiKey: z.string().min(1), // Plausible Bearer API key
});
export type PlausibleSecret = z.infer<typeof PlausibleSecret>;
