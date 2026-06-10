import { createFileRoute } from '@tanstack/react-router';
import { connectGscProperties } from '#src/webapp/data/gsc-connect.ts';
import { requestConnectionSync } from '#src/webapp/data/sync-trigger.ts';
import { resolveUserWorkspace } from '#src/webapp/data/workspace.ts';
import { getAuth } from '#src/webapp/integrations/auth/server.ts';
import {
  exchangeCode,
  getGoogleOAuthConfig,
  listSites,
} from '#src/webapp/integrations/google/oauth.ts';

const STATE_COOKIE = 'gsc_oauth_state';
const HTTP_BAD_REQUEST = 400;

const readCookie = (header: string | null, name: string): string | undefined => {
  if (!header) {
    return undefined;
  }
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      return rest.join('=');
    }
  }
  return undefined;
};

const clearStateCookie = `${STATE_COOKIE}=; Path=/; HttpOnly; Max-Age=0`;

async function handler({ request }: { request: Request }) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookieState = readCookie(request.headers.get('cookie'), STATE_COOKIE);

  if (!code || !state || !cookieState || state !== cookieState) {
    return new Response('Invalid OAuth state', { status: HTTP_BAD_REQUEST });
  }

  // The connection belongs to the signed-in user's workspace.
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return new Response(null, {
      status: 302,
      headers: { Location: '/login', 'Set-Cookie': clearStateCookie },
    });
  }
  const workspace = await resolveUserWorkspace(session.user.id);
  if (!workspace) {
    return new Response('No workspace for user', { status: HTTP_BAD_REQUEST });
  }

  const config = await getGoogleOAuthConfig();
  const { accessToken, refreshToken } = await exchangeCode(config, code);
  if (!refreshToken) {
    return new Response(
      'Google did not return a refresh token. Revoke access at https://myaccount.google.com/permissions, then reconnect.',
      { status: HTTP_BAD_REQUEST },
    );
  }

  const siteUrls = await listSites(accessToken);
  const { connectionIds } = await connectGscProperties({
    productId: workspace.productId,
    dashboardId: workspace.dashboardId,
    refreshToken,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    siteUrls,
  });

  // Auto-sync: data starts flowing without a manual "Sync now". Deployed, this
  // enqueues to the ingestion queue (fast); local dev syncs inline. A sync
  // failure must not fail the connect — the hourly schedule will catch up.
  try {
    await requestConnectionSync(connectionIds);
  } catch (error) {
    console.error('auto-sync after GSC connect failed', String(error));
  }

  return new Response(null, {
    status: 302,
    headers: { Location: '/dashboard?connected=1', 'Set-Cookie': clearStateCookie },
  });
}

export const Route = createFileRoute('/api/connect/google/callback')({
  server: { handlers: { GET: handler } },
});
