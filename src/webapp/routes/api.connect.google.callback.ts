import { createFileRoute } from '@tanstack/react-router';
import { connectGscProperties } from '#src/webapp/data/gsc-connect.ts';
import {
  exchangeCode,
  getGoogleOAuthConfig,
  listSites,
} from '#src/webapp/integrations/google/oauth.ts';
import { DEV_DASHBOARD_ID, DEV_PRODUCT_ID } from '#src/webapp/integrations/turso/dev-ids.ts';

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

  const config = await getGoogleOAuthConfig();
  const { accessToken, refreshToken } = await exchangeCode(config, code);
  if (!refreshToken) {
    return new Response(
      'Google did not return a refresh token. Revoke access at https://myaccount.google.com/permissions, then reconnect.',
      { status: HTTP_BAD_REQUEST },
    );
  }

  const siteUrls = await listSites(accessToken);
  await connectGscProperties({
    productId: DEV_PRODUCT_ID,
    dashboardId: DEV_DASHBOARD_ID,
    refreshToken,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    siteUrls,
  });

  return new Response(null, {
    status: 302,
    headers: { Location: '/dashboard?connected=1', 'Set-Cookie': clearStateCookie },
  });
}

export const Route = createFileRoute('/api/connect/google/callback')({
  server: { handlers: { GET: handler } },
});
