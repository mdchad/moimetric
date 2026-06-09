// Error taxonomy adapters throw and the ingestion worker classifies for retry.
// RateLimited / Transient => retry (SQS redrive). Auth / Permanent => give up,
// mark the connection errored.
export type ProviderErrorKind = 'rate_limited' | 'auth' | 'transient' | 'permanent';

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly retryAfterMs?: number;

  constructor(
    kind: ProviderErrorKind,
    message: string,
    options?: { retryAfterMs?: number; cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ProviderError';
    this.kind = kind;
    this.retryAfterMs = options?.retryAfterMs;
  }
}

export const rateLimited = (message: string, retryAfterMs?: number): ProviderError =>
  new ProviderError('rate_limited', message, { retryAfterMs });

export const authError = (message: string, cause?: unknown): ProviderError =>
  new ProviderError('auth', message, { cause });

export const transientError = (message: string, cause?: unknown): ProviderError =>
  new ProviderError('transient', message, { cause });

export const permanentError = (message: string, cause?: unknown): ProviderError =>
  new ProviderError('permanent', message, { cause });

export const isRetryable = (error: unknown): boolean =>
  error instanceof ProviderError && (error.kind === 'rate_limited' || error.kind === 'transient');
