import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { z } from 'zod';

// Google OAuth for Search Console (user-delegated). Config comes from env for
// local dev (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI) or,
// when deployed, from a Secrets Manager secret (GOOGLE_OAUTH_SECRET_ARN) —
// mirroring the Turso credential pattern.

const DEFAULT_REDIRECT_URI = 'http://localhost:3000/api/connect/google/callback';
export const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SITES_URL = 'https://www.googleapis.com/webmasters/v3/sites';

const GoogleOAuthConfig = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  redirectUri: z.string().url(),
});
export type GoogleOAuthConfig = z.infer<typeof GoogleOAuthConfig>;

let cached: Promise<GoogleOAuthConfig> | undefined;
let secretsManager: SecretsManagerClient | undefined;

const loadConfig = async (): Promise<GoogleOAuthConfig> => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? DEFAULT_REDIRECT_URI;
  if (clientId && clientSecret) {
    return GoogleOAuthConfig.parse({ clientId, clientSecret, redirectUri });
  }

  const arn = process.env.GOOGLE_OAUTH_SECRET_ARN;
  if (!arn) {
    throw new Error(
      'Google OAuth not configured: set GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET (local) or GOOGLE_OAUTH_SECRET_ARN.',
    );
  }
  if (!secretsManager) {
    secretsManager = new SecretsManagerClient({});
  }
  const response = await secretsManager.send(new GetSecretValueCommand({ SecretId: arn }));
  if (!response.SecretString) {
    throw new Error('Google OAuth secret has no value');
  }
  const json = JSON.parse(response.SecretString);
  return GoogleOAuthConfig.parse({ redirectUri, ...json });
};

export const getGoogleOAuthConfig = (): Promise<GoogleOAuthConfig> => {
  if (!cached) {
    cached = loadConfig();
  }
  return cached;
};

export const buildConsentUrl = (config: GoogleOAuthConfig, state: string): string => {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: GSC_SCOPE,
    access_type: 'offline', // request a refresh token
    prompt: 'consent', // force refresh token issuance on re-consent
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
};

const TokenExchangeResponse = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number(),
});

export const exchangeCode = async (
  config: GoogleOAuthConfig,
  code: string,
): Promise<{ accessToken: string; refreshToken: string | undefined }> => {
  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: 'authorization_code',
  });
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!response.ok) {
    throw new Error(`Google token exchange failed (${response.status}): ${await response.text()}`);
  }
  const parsed = TokenExchangeResponse.parse(await response.json());
  return { accessToken: parsed.access_token, refreshToken: parsed.refresh_token };
};

const SitesResponse = z.object({
  siteEntry: z
    .array(z.object({ siteUrl: z.string(), permissionLevel: z.string().optional() }))
    .optional(),
});

// All Search Console properties the granting user can access.
export const listSites = async (accessToken: string): Promise<string[]> => {
  const response = await fetch(SITES_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Google sites.list failed (${response.status}): ${await response.text()}`);
  }
  const parsed = SitesResponse.parse(await response.json());
  return (parsed.siteEntry ?? [])
    .filter((entry) => entry.permissionLevel !== 'siteUnverifiedUser')
    .map((entry) => entry.siteUrl);
};
