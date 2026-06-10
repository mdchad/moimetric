import { z } from 'zod';

// Stored on source_connections.provider_config.
export const PosthogConfig = z.object({
  host: z.string().url().default('https://us.posthog.com'), // or https://eu.posthog.com / self-hosted
  projectId: z.string().regex(/^\d+$/, 'PostHog project id is numeric'),
  // Optional domain filter (properties.$host) for projects tracking several
  // websites — lets each site be its own connection/chart. Strict hostname
  // charset so it can be safely interpolated into HogQL.
  hostFilter: z
    .string()
    .regex(/^[a-z0-9.-]+$/i, 'hostFilter must be a hostname')
    .optional(),
});
export type PosthogConfig = z.infer<typeof PosthogConfig>;
