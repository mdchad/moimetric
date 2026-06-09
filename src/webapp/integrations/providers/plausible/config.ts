import { z } from 'zod';

// Stored on source_connections.provider_config.
export const PlausibleConfig = z.object({
  siteId: z.string().min(1), // Plausible site_id, e.g. "example.com"
  baseUrl: z.string().url().default('https://plausible.io'),
});
export type PlausibleConfig = z.infer<typeof PlausibleConfig>;
