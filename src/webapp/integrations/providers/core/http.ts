import { authError, permanentError, rateLimited, transientError } from './errors.ts';

const MS_PER_SECOND = 1000;
const SERVER_ERROR_FLOOR = 500;

// Performs an HTTP request and maps transport/status failures onto the provider
// error taxonomy so the worker can decide retry vs give-up uniformly.
export const httpJson = async (
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<unknown> => {
  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    throw transientError(`Network error for ${url}`, error);
  }

  if (response.status === 401 || response.status === 403) {
    throw authError(`Authentication failed (${response.status}) for ${url}`);
  }
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('retry-after'));
    throw rateLimited(
      `Rate limited for ${url}`,
      Number.isFinite(retryAfter) ? retryAfter * MS_PER_SECOND : undefined,
    );
  }
  if (response.status >= SERVER_ERROR_FLOOR) {
    throw transientError(`Server error (${response.status}) for ${url}`);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw permanentError(`Request failed (${response.status}) for ${url}: ${body.slice(0, 200)}`);
  }
  return response.json();
};
