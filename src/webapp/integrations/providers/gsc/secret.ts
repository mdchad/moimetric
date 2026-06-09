import { z } from 'zod';

// Self-contained per-connection secret: the user's OAuth refresh token plus the
// app's Google OAuth client credentials needed to mint access tokens. Stored once
// per Google grant and shared (same secret ARN) across that account's properties.
export const GscSecret = z.object({
  refreshToken: z.string().min(1),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
});
export type GscSecret = z.infer<typeof GscSecret>;
