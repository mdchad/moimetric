import { createAuthClient } from 'better-auth/react';

// Browser client; defaults to the current origin + /api/auth.
export const authClient = createAuthClient();
