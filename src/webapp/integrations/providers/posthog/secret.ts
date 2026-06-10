import { z } from 'zod';

// Stored in Secrets Manager at moimetric/<stage>/connections/<connectionId>.
export const PosthogSecret = z.object({
  apiKey: z.string().min(1), // PostHog personal API key (phx_…) with query:read scope
});
export type PosthogSecret = z.infer<typeof PosthogSecret>;
