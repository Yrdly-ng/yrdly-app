// Provider limits apply to the entire API key, not an individual server process.
// Return the delay to callers; never automatically replay a payment operation.
export function paylukRetryAfterSeconds(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('httpStatus' in error) || error.httpStatus !== 429) return undefined;
  const seconds = 'retryAfterSeconds' in error ? Number(error.retryAfterSeconds) : NaN;
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 60;
}

export function paylukRateLimitDelay(headers: Headers): number {
  const retryAfter = headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1, Math.ceil(seconds));
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(1, Math.ceil((date - Date.now()) / 1000));
  }
  const reset = headers.get('ratelimit-reset') || headers.get('ratelimit')?.match(/(?:^|[;,])\s*(?:reset|t)=(\d+)/i)?.[1];
  const seconds = Number(reset);
  return reset && Number.isFinite(seconds) && seconds >= 0 ? Math.max(1, Math.ceil(seconds)) : 60;
}

export function payoutRateLimitMessage(seconds: number): string {
  return `Payluk is busy. Wait ${seconds} seconds before retrying this payout.`;
}
