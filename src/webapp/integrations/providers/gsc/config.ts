import { z } from 'zod';

// One connection per GSC property. siteUrl is the exact Search Console property,
// e.g. "https://example.com/" or "sc-domain:example.com".
export const GscConfig = z.object({
  siteUrl: z.string().min(1),
});
export type GscConfig = z.infer<typeof GscConfig>;
