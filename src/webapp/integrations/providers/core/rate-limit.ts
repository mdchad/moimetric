const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

// Serialized min-interval limiter. acquire() resolves only once enough time has
// passed since the previous acquisition, so adapters can simply `await acquire()`
// before each HTTP call to respect a provider's budget (e.g. Fathom 10/min => 6s).
export class RateLimiter {
  private readonly minIntervalMs: number;
  private nextAt = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(options: { requestsPerMinute: number }) {
    this.minIntervalMs = Math.ceil(60_000 / Math.max(1, options.requestsPerMinute));
  }

  acquire(): Promise<void> {
    const run = this.chain.then(async () => {
      const wait = this.nextAt - Date.now();
      if (wait > 0) {
        await sleep(wait);
      }
      this.nextAt = Date.now() + this.minIntervalMs;
    });
    // Keep the chain alive even if a waiter is cancelled upstream.
    this.chain = run.catch(() => undefined);
    return run;
  }
}
