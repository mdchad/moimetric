import { createFileRoute } from '@tanstack/react-router';
import { buildConsentUrl, getGoogleOAuthConfig } from '#src/webapp/integrations/google/oauth.ts';

const STATE_COOKIE = 'gsc_oauth_state';
const STATE_MAX_AGE = 600;

async function handler() {
  const config = await getGoogleOAuthConfig();
  const state = globalThis.crypto.randomUUID();
  return new Response(null, {
    status: 302,
    headers: {
      Location: buildConsentUrl(config, state),
      'Set-Cookie': `${STATE_COOKIE}=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${STATE_MAX_AGE}`,
    },
  });
}

export const Route = createFileRoute('/api/connect/google/start')({
  server: { handlers: { GET: handler } },
});
